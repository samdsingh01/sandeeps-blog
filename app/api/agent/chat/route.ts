/**
 * app/api/agent/chat/route.ts
 * ===========================
 * Chat API — processes messages from Sandeep in the /admin/chat UI.
 *
 * GET  ?key=CRON_SECRET&since=ISO_DATE  → fetch recent messages
 * POST ?key=CRON_SECRET                 → send a message, get agent response
 *
 * The agent understands natural language:
 *   "Write about YouTube Shorts monetization" → adds keyword at priority 10
 *   "Skip AI tools for now"                   → suppresses matching keywords
 *   "Run the agent now"                        → triggers /api/agent/run
 *   "Show me stats"                            → returns performance summary
 *   "Pause for 2 days"                         → logs pause instruction
 *   "Focus on Course Creation"                 → logs category preference
 *   "What did you do today?"                   → summarises today's agent_logs
 *   "What posts are in draft?"                 → queries posts table
 *   "Approve [slug] for publishing"            → sets post status to published
 */

import { type NextRequest, NextResponse } from 'next/server';
import {
  saveUserMessage,
  sendAgentMessage,
  getRecentMessages,
} from '../../../../agent/agentchat';
import {
  parseEmailReply,
  executeEmailActions,
  fetchAndEmailStats,
  type ExecutionResult,
} from '../../../../agent/email-reply';
import { ask, stripJsonFences } from '../../../../agent/gemini';
import { getServiceClient }     from '../../../../lib/supabase';

export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

// ── Auth helper ────────────────────────────────────────────────────────────────

function isAuthed(req: NextRequest): boolean {
  const key    = req.nextUrl.searchParams.get('key');
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return key === secret;
}

// ── GET — fetch message history ────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const since = req.nextUrl.searchParams.get('since');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '60', 10);

  try {
    const db = getServiceClient();

    let query = db
      .from('agent_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (since) {
      query = query.gt('created_at', since);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ messages: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

// ── POST — send a message, get agent response ──────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const text = message.trim();

    // 1. Save user message
    await saveUserMessage(text);

    // 2. Check if it's a direct query first (agent log / post status questions)
    const directResponse = await handleDirectQuery(text);
    if (directResponse) {
      await sendAgentMessage(directResponse, 'chat');
      return NextResponse.json({ reply: directResponse });
    }

    // 3. Parse as action instruction
    const parsed = await parseEmailReply(text, 'Admin Chat');

    // 4. Execute actions
    const results = await executeEmailActions(parsed.actions);

    // 5. Handle stats request
    const statsRequested = results.some((r) => r.description === 'STATS_REQUESTED');
    if (statsRequested) {
      const stats = await buildStatsReply();
      await sendAgentMessage(stats, 'info');
      return NextResponse.json({ reply: stats });
    }

    // 6. Build reply
    const reply = buildChatReply(parsed.summary, results, parsed.replyNeeded, parsed.clarification);
    await sendAgentMessage(reply, 'chat', {
      actions: results.map((r) => ({ type: r.actionType, success: r.success })),
    });

    return NextResponse.json({ reply });

  } catch (err) {
    console.error('[AgentChat API] Error:', err);
    const errMsg = 'Something went wrong on my end. Try again or check the Vercel logs.';
    await sendAgentMessage(errMsg, 'chat');
    return NextResponse.json({ reply: errMsg }, { status: 500 });
  }
}

// ── Direct query handler ───────────────────────────────────────────────────────
// Handles questions about agent state, posts, logs — things that aren't "actions"
// but need a DB lookup + Gemini summary.

async function handleDirectQuery(text: string): Promise<string | null> {
  const lower = text.toLowerCase();

  // "What did you do today?" / "Show me today's activity"
  if (/what did you do|today.s activity|agent log|what happened|recent activity/i.test(lower)) {
    return await summariseTodayActivity();
  }

  // "What posts are in draft?" / "Show drafts"
  if (/draft|unpublished|pending post/i.test(lower)) {
    return await listDraftPosts();
  }

  // "How many posts do we have?" / "Post count"
  if (/how many post|post count|total post/i.test(lower)) {
    return await getPostCount();
  }

  // "What keywords are next?" / "Show keyword queue"
  if (/keyword queue|next keyword|what.s next|upcoming keyword/i.test(lower)) {
    return await listNextKeywords();
  }

  // "Approve [slug]" / "Publish [slug]"
  if (/^(approve|publish)\s+/i.test(lower)) {
    const slug = text.replace(/^(approve|publish)\s+/i, '').trim().replace(/\s+/g, '-').toLowerCase();
    return await approvePost(slug);
  }

  return null;
}

async function summariseTodayActivity(): Promise<string> {
  const db    = getServiceClient();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const { data: logs } = await db
    .from('agent_logs')
    .select('run_type, status, post_slug, details, created_at')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (!logs || logs.length === 0) return "Nothing logged yet today. If the daily cron hasn't run yet, check back after 8 AM UTC.";

  const summary = logs.map((l) =>
    `• ${l.run_type} [${l.status}]${l.post_slug ? ` → "${l.post_slug}"` : ''}`
  ).join('\n');

  return `Here's what I did today (${logs.length} log entries):\n\n${summary}`;
}

async function listDraftPosts(): Promise<string> {
  const db = getServiceClient();
  const { data: posts } = await db
    .from('posts')
    .select('title, slug, quality_score, category, created_at')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!posts || posts.length === 0) return 'No draft posts right now — everything has been published.';

  const list = posts.map((p) =>
    `• **${p.title}** (score: ${p.quality_score ?? 'N/A'}, category: ${p.category})\n  slug: \`${p.slug}\``
  ).join('\n');

  return `${posts.length} draft post${posts.length > 1 ? 's' : ''}:\n\n${list}\n\nTo publish one, say: "Approve [slug]"`;
}

async function getPostCount(): Promise<string> {
  const db = getServiceClient();
  const [{ count: total }, { count: published }, { count: draft }] = await Promise.all([
    db.from('posts').select('*', { count: 'exact', head: true }),
    db.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    db.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
  ]);
  return `Total posts: **${total ?? 0}** — ${published ?? 0} published, ${draft ?? 0} in draft.`;
}

async function listNextKeywords(): Promise<string> {
  const db = getServiceClient();
  const { data: kws } = await db
    .from('keywords')
    .select('keyword, priority, source')
    .eq('used', false)
    .order('priority', { ascending: false })
    .limit(8);

  if (!kws || kws.length === 0) return '⚠️ Keyword queue is empty! Add some with "Write about X" or check the keyword research endpoint.';

  const list = kws.map((k, i) =>
    `${i + 1}. ${k.keyword} (priority: ${k.priority}, source: ${k.source ?? 'manual'})`
  ).join('\n');

  return `Next ${kws.length} keywords in queue:\n\n${list}`;
}

async function approvePost(slug: string): Promise<string> {
  const db = getServiceClient();

  // Find the post — try exact slug, then fuzzy title match
  const { data: post } = await db
    .from('posts')
    .select('id, title, slug, status')
    .or(`slug.eq.${slug},title.ilike.%${slug}%`)
    .eq('status', 'draft')
    .maybeSingle();

  if (!post) return `Couldn't find a draft post matching "${slug}". Run "Show drafts" to see what's available.`;

  await db.from('posts').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', post.id);

  return `✅ Published **"${post.title}"** (\`${post.slug}\`). It's now live on the blog.`;
}

async function buildStatsReply(): Promise<string> {
  const db  = getServiceClient();
  const now = new Date();
  const d7  = new Date(now); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

  const [
    { count: published },
    { data: week },
    { data: month },
    { count: unusedKw },
  ] = await Promise.all([
    db.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    db.from('page_performance').select('clicks').gte('date', d7.toISOString().split('T')[0]),
    db.from('page_performance').select('clicks').gte('date', d30.toISOString().split('T')[0]),
    db.from('keywords').select('*', { count: 'exact', head: true }).eq('used', false),
  ]);

  const weekClicks  = (week  ?? []).reduce((s: number, r: { clicks: number }) => s + r.clicks, 0);
  const monthClicks = (month ?? []).reduce((s: number, r: { clicks: number }) => s + r.clicks, 0);
  const goalPct     = Math.round((monthClicks / 10_000) * 100);

  return [
    `📊 **Blog Stats**`,
    ``,
    `• Published posts: **${published ?? 0}**`,
    `• Clicks (7 days): **${weekClicks.toLocaleString()}**`,
    `• Clicks (30 days): **${monthClicks.toLocaleString()}** (${goalPct}% of 10K goal)`,
    `• Keywords in queue: **${unusedKw ?? 0}**`,
  ].join('\n');
}

// ── Reply builder ──────────────────────────────────────────────────────────────

function buildChatReply(
  summary:       string,
  results:       ExecutionResult[],
  replyNeeded:   boolean,
  clarification?: string,
): string {
  const done   = results.filter((r) => r.success && r.description !== 'STATS_REQUESTED');
  const failed = results.filter((r) => !r.success);

  if (results.length === 0 || (done.length === 0 && failed.length === 0)) {
    return `${summary}\n\nNot sure what you'd like me to do — try something like:\n• "Write about YouTube Shorts monetization"\n• "Show me stats"\n• "What did you do today?"\n• "Show drafts"\n• "Run now"`;
  }

  const lines: string[] = [summary, ''];

  if (done.length > 0) {
    lines.push(...done.map((r) => `✅ ${r.description}`));
  }

  if (failed.length > 0) {
    lines.push('');
    lines.push(...failed.map((r) => `❌ ${r.description}${r.error ? ` — ${r.error}` : ''}`));
  }

  if (replyNeeded && clarification) {
    lines.push('', `❓ ${clarification}`);
  }

  return lines.join('\n');
}
