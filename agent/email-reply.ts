/**
 * agent/email-reply.ts
 * ====================
 * Bidirectional email interaction — Sandeep can reply to any agent email
 * with natural-language instructions that the agent understands and executes.
 *
 * FLOW:
 *  1. Agent sends email to Sandeep (escalation, brainstorm brief, daily report)
 *     → every outbound email has Reply-To: reply@inbound.sandeeps.co
 *  2. Sandeep replies with instructions (free text, no special format needed)
 *  3. Resend inbound webhook fires → /api/webhooks/email-reply
 *  4. parseEmailReply() → Gemini classifies intent → structured EmailAction[]
 *  5. executeEmailActions() → dispatches each action to the right agent function
 *  6. Confirmation email sent back to Sandeep summarising what was done
 *
 * SUPPORTED INSTRUCTIONS (Sandeep can say in natural language):
 *  • "Write about X" / "Add keyword X with high priority"  → insert into keywords (priority 10)
 *  • "Skip X" / "Don't write about Y"                      → mark matching keywords as used
 *  • "Use comparison format this week"                      → log format override
 *  • "Pause posting for 2 days"                            → log pause instruction
 *  • "Resume"                                               → log resume instruction
 *  • "Boost priority of X"                                 → update keyword priority
 *  • "Show me stats" / "How are we doing?"                 → email performance summary
 *  • "Focus on [category] content"                         → log category preference
 *  • "Approve Reddit post for [slug]"                      → log distribution approval
 *  • "Run the agent now"                                    → trigger immediate run
 *  • Anything else                                          → logged as custom instruction
 */

import { ask, stripJsonFences }  from './gemini';
import { sendEmail }              from './email';
import { getServiceClient }       from '../lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ActionType =
  | 'add_keywords'          // "Write about X" / "add keyword X"
  | 'skip_topic'            // "Skip X" / "don't write about Y"
  | 'set_format'            // "Use comparison format this week"
  | 'pause_agent'           // "Pause for N days"
  | 'resume_agent'          // "Resume posting"
  | 'boost_keyword'         // "Boost priority of X"
  | 'get_stats'             // "Show me stats" / "how are we doing?"
  | 'focus_category'        // "Focus on course creation content"
  | 'approve_distribution'  // "Approve the Reddit post for X"
  | 'run_now'               // "Run the agent now"
  | 'custom'                // Free-form — logged for manual review
  | 'unknown';              // Can't parse

export interface EmailAction {
  type:        ActionType;
  confidence:  number;                          // 0–1
  params:      Record<string, string | number | string[]>;
  rawIntent:   string;                          // human-readable description
}

export interface ParsedReply {
  actions:       EmailAction[];
  summary:       string;
  replyNeeded:   boolean;
  clarification?: string;
}

export interface ExecutionResult {
  actionType:  ActionType;
  success:     boolean;
  description: string;
  error?:      string;
}

// ── Parse email reply ──────────────────────────────────────────────────────────

/**
 * Use Gemini to parse Sandeep's email reply into structured actions.
 */
export async function parseEmailReply(
  emailText:    string,
  emailSubject: string,
): Promise<ParsedReply> {

  const prompt = `
You are the AI agent running the blog at sandeeps.co.
Sandeep Singh (the blog owner) replied to one of your emails. Parse his reply and extract ALL actionable instructions.

ORIGINAL EMAIL SUBJECT (context): "${emailSubject}"

SANDEEP'S REPLY (clean text, quoted lines already stripped):
---
${emailText.slice(0, 3_000)}
---

BLOG CONTEXT: Creator economy / YouTube / online courses niche. Product: Graphy.com.

Map each instruction to one of these action types:

"add_keywords"
  → Triggered by: "write about X", "add keyword X", "cover X", "do a post on X", or a list of topics
  → params: { "keywords": ["keyword1", "keyword2", ...] }

"skip_topic"
  → Triggered by: "skip X", "don't write about X", "avoid X", "remove X"
  → params: { "topic": "the topic to skip" }

"set_format"
  → Triggered by: "use X format", "switch to X style", "do X posts this week"
  → params: { "format": "comparison|ranked-list|case-study|workflow|tool-deep-dive|myth-busting" }

"pause_agent"
  → Triggered by: "pause", "stop posting", "take a break for N days"
  → params: { "days": <number 1-30>, "reason": "why" }

"resume_agent"
  → Triggered by: "resume", "start posting again", "unpause"
  → params: {}

"boost_keyword"
  → Triggered by: "boost X", "prioritise X", "move X to the front"
  → params: { "keyword": "keyword text", "newPriority": <1-10, default 9> }

"get_stats"
  → Triggered by: "how are we doing", "show stats", "what's the traffic", "performance update"
  → params: { "period": "week|month" }

"focus_category"
  → Triggered by: "focus on X", "more X content", "prioritise X category"
  → Valid categories: "YouTube Monetization", "Course Creation", "Creator Growth", "Content Strategy", "AI for Creator Economy"
  → params: { "category": "<matched category>" }

"approve_distribution"
  → Triggered by: "post it", "go ahead with Reddit", "approve for [platform]", "publish [post] to [platform]"
  → params: { "postSlug": "slug or title", "platform": "reddit|linkedin|twitter" }

"run_now"
  → Triggered by: "run now", "generate a post now", "trigger the agent", "go"
  → params: {}

"custom"
  → Use for real instructions that don't fit above categories
  → params: { "instruction": "full text of the instruction" }

"unknown"
  → Use only if there are truly no instructions (pure thanks/acknowledgement/greeting)
  → params: {}

IMPORTANT:
- Extract ALL instructions — there may be multiple in one reply
- If Sandeep lists topics (e.g. "here are some keywords: ..."), use add_keywords and collect them all
- Be generous with confidence — if it looks like an instruction, parse it
- If partly ambiguous, set replyNeeded: true and write a clarifying question

Return ONLY this JSON (no markdown fences):
{
  "actions": [
    {
      "type": "action_type",
      "confidence": 0.9,
      "params": { ... },
      "rawIntent": "I understood: ..."
    }
  ],
  "summary": "I found X instruction(s) in your reply: short description",
  "replyNeeded": false,
  "clarification": null
}

If the email is purely social (thanks, ok, noted) with no instructions, return actions: [], summary: "No instructions detected — noted.", replyNeeded: false.
`;

  try {
    const raw    = await ask(prompt, 1_500, 0.2);
    const parsed = JSON.parse(stripJsonFences(raw));
    return {
      actions:       (parsed.actions ?? []) as EmailAction[],
      summary:       parsed.summary        ?? 'No specific instructions detected.',
      replyNeeded:   parsed.replyNeeded    ?? false,
      clarification: parsed.clarification  ?? undefined,
    };
  } catch (err) {
    console.error('[EmailReply] Gemini parse failed:', err);
    // Fallback — log the raw text as a custom instruction
    return {
      actions: [{
        type:       'custom',
        confidence: 0.3,
        params:     { instruction: emailText.slice(0, 500) },
        rawIntent:  'Could not parse reply — raw text logged for manual review',
      }],
      summary:     'Could not fully parse your reply — logged it for review.',
      replyNeeded: false,
    };
  }
}

// ── Execute actions ────────────────────────────────────────────────────────────

/**
 * Execute each parsed action and return results.
 */
export async function executeEmailActions(
  actions: EmailAction[],
): Promise<ExecutionResult[]> {
  const db      = getServiceClient();
  const results: ExecutionResult[] = [];

  for (const action of actions) {
    try {
      results.push(await executeSingleAction(db, action));
    } catch (err) {
      results.push({
        actionType:  action.type,
        success:     false,
        description: action.rawIntent,
        error:       err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function executeSingleAction(
  db:     ReturnType<typeof getServiceClient>,
  action: EmailAction,
): Promise<ExecutionResult> {

  switch (action.type) {

    // ── add_keywords ──────────────────────────────────────────────────────────
    case 'add_keywords': {
      const keywords = (action.params.keywords as string[]) ?? [];
      if (keywords.length === 0) {
        return { actionType: action.type, success: false, description: 'No keywords to add', error: 'Empty keywords array' };
      }
      const rows = keywords.map((kw) => ({
        keyword:    kw.trim(),
        priority:   10,   // highest — Sandeep specifically requested it
        used:       false,
        source:     'sandeep_email',
        created_at: new Date().toISOString(),
      }));
      await db.from('keywords').insert(rows);
      console.log(`[EmailReply] ✅ Added ${keywords.length} keywords from Sandeep reply`);
      return {
        actionType:  action.type,
        success:     true,
        description: `Added ${keywords.length} keyword(s) at priority 10: ${keywords.slice(0, 5).join(', ')}${keywords.length > 5 ? ` (+${keywords.length - 5} more)` : ''}`,
      };
    }

    // ── skip_topic ────────────────────────────────────────────────────────────
    case 'skip_topic': {
      const topic = (action.params.topic as string) ?? '';
      if (!topic) return { actionType: action.type, success: false, description: 'No topic to skip', error: 'Empty topic' };

      // Mark matching unused keywords as used so agent won't pick them up
      await db.from('keywords').update({ used: true }).ilike('keyword', `%${topic}%`).eq('used', false);

      // Persist the skip so future keyword research also avoids this
      await db.from('agent_logs').insert({
        run_type:   'email_reply',
        status:     'success',
        details:    { action: 'skip_topic', topic, source: 'sandeep_reply' },
        created_at: new Date().toISOString(),
      });
      console.log(`[EmailReply] ✅ Skipped topic: "${topic}"`);
      return {
        actionType:  action.type,
        success:     true,
        description: `Marked "${topic}" as skipped — matching keywords suppressed, won't be written about`,
      };
    }

    // ── set_format ────────────────────────────────────────────────────────────
    case 'set_format': {
      const format       = (action.params.format as string) ?? '';
      const validFormats = ['comparison', 'ranked-list', 'case-study', 'workflow', 'tool-deep-dive', 'myth-busting'];
      if (!validFormats.includes(format)) {
        return {
          actionType:  action.type,
          success:     false,
          description: `Unknown format "${format}"`,
          error:       `Valid formats: ${validFormats.join(', ')}`,
        };
      }
      await db.from('agent_logs').insert({
        run_type:   'email_reply',
        status:     'success',
        details:    {
          action:              'format_override',
          format,
          expiresAfterPosts:   7,   // override lasts ~7 posts then auto-reverts to rotation
          source:              'sandeep_reply',
          createdAt:           new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      });
      console.log(`[EmailReply] ✅ Format override: ${format}`);
      return {
        actionType:  action.type,
        success:     true,
        description: `Content format overridden to "${format}" for the next 7 posts`,
      };
    }

    // ── pause_agent ───────────────────────────────────────────────────────────
    case 'pause_agent': {
      const days      = Math.min(30, Math.max(1, Number(action.params.days ?? 1)));
      const reason    = (action.params.reason as string) ?? 'Sandeep requested pause via email';
      const resumeAt  = new Date();
      resumeAt.setDate(resumeAt.getDate() + days);

      await db.from('agent_logs').insert({
        run_type:   'email_reply',
        status:     'success',
        details:    {
          action:   'agent_pause',
          days,
          reason,
          resumeAt: resumeAt.toISOString(),
          source:   'sandeep_reply',
        },
        created_at: new Date().toISOString(),
      });
      console.log(`[EmailReply] ✅ Pause logged: ${days} day(s), resumes ${resumeAt.toDateString()}`);
      return {
        actionType:  action.type,
        success:     true,
        description: `Pause instruction logged for ${days} day(s) — resumes ${resumeAt.toDateString()}. ⚠️ Note: to fully pause automated runs, disable the cron in Vercel or reply "resume" when ready.`,
      };
    }

    // ── resume_agent ──────────────────────────────────────────────────────────
    case 'resume_agent': {
      await db.from('agent_logs').insert({
        run_type:   'email_reply',
        status:     'success',
        details:    { action: 'agent_resume', source: 'sandeep_reply' },
        created_at: new Date().toISOString(),
      });
      return {
        actionType:  action.type,
        success:     true,
        description: 'Resume instruction logged — next scheduled cron will proceed normally',
      };
    }

    // ── boost_keyword ─────────────────────────────────────────────────────────
    case 'boost_keyword': {
      const keyword     = (action.params.keyword as string) ?? '';
      const newPriority = Math.min(10, Math.max(1, Number(action.params.newPriority ?? 9)));
      if (!keyword) return { actionType: action.type, success: false, description: 'No keyword specified', error: 'Empty keyword' };

      // Update priority and count affected rows
      await db
        .from('keywords')
        .update({ priority: newPriority })
        .ilike('keyword', `%${keyword}%`)
        .eq('used', false);

      const { count } = await db
        .from('keywords')
        .select('*', { count: 'exact', head: true })
        .ilike('keyword', `%${keyword}%`)
        .eq('used', false);

      console.log(`[EmailReply] ✅ Boosted ${count ?? 0} keyword(s) matching "${keyword}" → priority ${newPriority}`);
      return {
        actionType:  action.type,
        success:     true,
        description: `Boosted priority to ${newPriority} for ${count ?? 0} keyword(s) matching "${keyword}"`,
      };
    }

    // ── get_stats ─────────────────────────────────────────────────────────────
    case 'get_stats': {
      // Caller detects this sentinel and calls fetchAndEmailStats()
      return {
        actionType:  action.type,
        success:     true,
        description: 'STATS_REQUESTED',
      };
    }

    // ── focus_category ────────────────────────────────────────────────────────
    case 'focus_category': {
      const category = (action.params.category as string) ?? '';
      await db.from('agent_logs').insert({
        run_type:   'email_reply',
        status:     'success',
        details:    { action: 'category_focus', category, source: 'sandeep_reply' },
        created_at: new Date().toISOString(),
      });
      return {
        actionType:  action.type,
        success:     true,
        description: `Category focus "${category}" logged — will influence next keyword selection cycle`,
      };
    }

    // ── approve_distribution ──────────────────────────────────────────────────
    case 'approve_distribution': {
      const postSlug = (action.params.postSlug as string) ?? '';
      const platform = (action.params.platform as string) ?? 'reddit';
      await db.from('agent_logs').insert({
        run_type:   'email_reply',
        status:     'success',
        details:    { action: 'distribution_approved', postSlug, platform, source: 'sandeep_reply' },
        created_at: new Date().toISOString(),
      });
      return {
        actionType:  action.type,
        success:     true,
        description: `Distribution approval logged for "${postSlug}" on ${platform}`,
      };
    }

    // ── run_now ───────────────────────────────────────────────────────────────
    case 'run_now': {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sandeeps.co';
      const key     = process.env.CRON_SECRET ?? '';
      // Fire-and-forget — don't await so the webhook doesn't time out
      fetch(`${baseUrl}/api/agent/run?key=${key}`, { method: 'GET' }).catch(() => {});
      console.log('[EmailReply] ✅ Agent run triggered');
      return {
        actionType:  action.type,
        success:     true,
        description: 'Agent run triggered — new BOFU post generating now. Check back in ~5 min.',
      };
    }

    // ── custom ────────────────────────────────────────────────────────────────
    case 'custom': {
      const instruction = (action.params.instruction as string) ?? '';
      await db.from('agent_logs').insert({
        run_type:   'email_reply',
        status:     'success',
        details:    {
          action:      'custom_instruction',
          instruction: instruction.slice(0, 1_000),
          source:      'sandeep_reply',
        },
        created_at: new Date().toISOString(),
      });
      return {
        actionType:  action.type,
        success:     true,
        description: `Custom instruction logged: "${instruction.slice(0, 100)}${instruction.length > 100 ? '…' : ''}"`,
      };
    }

    // ── unknown / fallthrough ─────────────────────────────────────────────────
    case 'unknown':
    default:
      return {
        actionType:  'unknown',
        success:     false,
        description: 'Could not understand this instruction',
        error:       'No matching action type',
      };
  }
}

// ── Stats email ────────────────────────────────────────────────────────────────

/**
 * Fetch blog performance data and email it to Sandeep.
 * Triggered when Sandeep asks "how are we doing?" in a reply.
 */
export async function fetchAndEmailStats(to: string): Promise<void> {
  try {
    const db   = getServiceClient();
    const now  = new Date();
    const d30  = new Date(now); d30.setDate(d30.getDate() - 30);
    const d7   = new Date(now); d7.setDate(d7.getDate() - 7);

    const [
      { count: totalPosts },
      { count: publishedPosts },
      { data: recentPosts },
      { data: week7Data },
      { data: month30Data },
      { data: unusedKw },
    ] = await Promise.all([
      db.from('posts').select('*', { count: 'exact', head: true }),
      db.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      db.from('posts').select('title, published_at, quality_score, status, category')
        .eq('status', 'published').order('published_at', { ascending: false }).limit(5),
      db.from('page_performance').select('clicks, impressions').gte('date', d7.toISOString().split('T')[0]),
      db.from('page_performance').select('clicks, impressions').gte('date', d30.toISOString().split('T')[0]),
      db.from('keywords').select('keyword').eq('used', false).order('priority', { ascending: false }).limit(5),
    ]);

    const weekClicks  = (week7Data   ?? []).reduce((s: number, r: { clicks: number }) => s + r.clicks, 0);
    const monthClicks = (month30Data ?? []).reduce((s: number, r: { clicks: number }) => s + r.clicks, 0);
    const goalPct     = Math.min(100, Math.round((monthClicks / 10_000) * 100));

    const html = `
<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2>📊 Blog Performance Summary (as requested)</h2>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0;">
    <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #16a34a;">${monthClicks.toLocaleString()}</div>
      <div style="font-size: 13px; color: #555;">Clicks (last 30 days)</div>
    </div>
    <div style="background: #eff6ff; padding: 16px; border-radius: 8px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #2563eb;">${goalPct}%</div>
      <div style="font-size: 13px; color: #555;">Of 10K goal</div>
    </div>
    <div style="background: #faf5ff; padding: 16px; border-radius: 8px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #7c3aed;">${weekClicks.toLocaleString()}</div>
      <div style="font-size: 13px; color: #555;">Clicks (last 7 days)</div>
    </div>
    <div style="background: #fff7ed; padding: 16px; border-radius: 8px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #ea580c;">${publishedPosts ?? 0}</div>
      <div style="font-size: 13px; color: #555;">Published posts</div>
    </div>
  </div>

  <h3>Most Recent Posts</h3>
  <table width="100%" cellspacing="0" style="border-collapse: collapse; font-size: 13px;">
    <tr style="background: #f3f4f6;">
      <th style="padding: 8px; text-align: left;">Title</th>
      <th style="padding: 8px; text-align: center;">Score</th>
      <th style="padding: 8px; text-align: right;">Date</th>
    </tr>
    ${(recentPosts ?? []).map((p) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px;">${p.title}</td>
      <td style="padding: 8px; text-align: center;">${p.quality_score ?? 'N/A'}</td>
      <td style="padding: 8px; text-align: right; color: #888;">${new Date(p.published_at).toLocaleDateString()}</td>
    </tr>`).join('')}
  </table>

  ${(unusedKw ?? []).length > 0 ? `
  <h3>Next Up in Queue</h3>
  <ul style="font-size: 13px;">
    ${(unusedKw ?? []).map((k: { keyword: string }) => `<li>${k.keyword}</li>`).join('')}
  </ul>
  ` : ''}

  <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-top: 24px; font-size: 13px;">
    <strong>💬 Tip:</strong> Reply to this email with instructions — I'll execute them automatically.<br/>
    Try: "Write about YouTube Shorts monetization" or "Use case study format this week"
  </div>

  <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">— Agent @ ${new Date().toISOString()}</p>
</div>`;

    await sendEmail({
      to,
      subject: `📊 Blog Stats — ${monthClicks.toLocaleString()} clicks (30d) · ${goalPct}% to 10K goal`,
      html,
      replyTo: 'reply@inbound.sandeeps.co',
    });

  } catch (err) {
    console.error('[EmailReply] fetchAndEmailStats error:', err);
  }
}

// ── Confirmation email ─────────────────────────────────────────────────────────

export function buildConfirmationEmail(
  results:       ExecutionResult[],
  summary:       string,
  replyNeeded:   boolean,
  clarification?: string,
): string {
  const done   = results.filter((r) => r.success && r.description !== 'STATS_REQUESTED');
  const failed = results.filter((r) => !r.success);

  return `
<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #059669; margin-bottom: 4px;">✅ Got it — here's what I did</h2>
  <p style="color: #555; margin-top: 0;">${summary}</p>

  ${done.length > 0 ? `
  <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <strong>Actions taken:</strong>
    <ul style="margin: 8px 0; padding-left: 20px;">
      ${done.map((r) => `<li style="margin-bottom: 4px;">✅ ${r.description}</li>`).join('')}
    </ul>
  </div>` : ''}

  ${failed.length > 0 ? `
  <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <strong>Couldn't execute:</strong>
    <ul style="margin: 8px 0; padding-left: 20px;">
      ${failed.map((r) => `<li style="margin-bottom: 4px;">❌ ${r.description}${r.error ? ` — <em>${r.error}</em>` : ''}</li>`).join('')}
    </ul>
  </div>` : ''}

  ${replyNeeded && clarification ? `
  <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 16px 0;">
    <strong>One quick question:</strong> ${clarification}
  </div>` : ''}

  <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-top: 24px; font-size: 13px; color: #555;">
    <strong>💬 You can reply to any of my emails with instructions:</strong><br/><br/>
    • <code>Write about X</code> — adds X as priority-10 keyword<br/>
    • <code>Skip X</code> — suppresses that topic going forward<br/>
    • <code>Use comparison format this week</code> — changes content format<br/>
    • <code>Pause for 3 days</code> — logs a pause instruction<br/>
    • <code>Boost priority of X</code> — moves it to the front of the queue<br/>
    • <code>Show me stats</code> — emails you a performance summary<br/>
    • <code>Run now</code> — triggers an immediate content generation run<br/>
    • <code>Focus on Course Creation</code> — shifts category focus
  </div>

  <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
    — Agent @ ${new Date().toISOString()} | <a href="https://sandeeps.co">sandeeps.co</a>
  </p>
</div>`;
}
