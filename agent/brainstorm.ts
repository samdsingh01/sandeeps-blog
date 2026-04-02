/**
 * agent/brainstorm.ts
 * ===================
 * Weekly agent intelligence loop — the agent thinks about what's working,
 * plans experiments, and finds new distribution opportunities.
 *
 * Runs every Sunday at 06:00 UTC (before content refresh at 07:00).
 * Output goes to DB + a "Weekly Intelligence Brief" email to Sandeep.
 *
 * Three components:
 *
 * 1. SELF-REFLECTION
 *    Pulls last 30 days of posts + performance data. Asks Gemini:
 *    "What content formats/categories are getting traction? What should we
 *    do more of? What's clearly not working?" Stores conclusions.
 *
 * 2. EXPERIMENT PLANNING
 *    Rotates through content format experiments each week:
 *    Week A: Comparison posts ("X vs Y for creators")
 *    Week B: Ranked lists ("10 Best X for YouTube creators in 2026")
 *    Week C: Case studies ("How a creator achieved X using Y")
 *    Week D: Workflow posts ("My exact step-by-step process for X")
 *    Week E: Tool deep-dives ("Complete guide to using X tool for creators")
 *    Week F: Myth-busting ("5 myths about X every creator believes")
 *    This week's experiment format is stored in agent_logs so BOFU picks it up.
 *
 * 3. DISTRIBUTION QUEUE
 *    For top 3 recent posts, generates ready-to-use copy for:
 *    - Reddit (subreddit + title + opening paragraph for r/youtubers, r/juststart)
 *    - LinkedIn (professional angle, 3-5 bullet insight post)
 *    - Twitter/X thread (hook tweet + 3 follow-up tweets)
 *    Stored in agent_logs for Sandeep to review + post manually.
 *
 * 4. NEW KEYWORD ANGLES
 *    Asks Gemini to brainstorm 10 NEW keyword angles based on what's working,
 *    gaps in current coverage, and trending creator topics. Adds them to the
 *    keywords table with high priority so the agent targets them next.
 */

import { ask, askFast, stripJsonFences } from './gemini';
import { sendEmail } from './email';
import { getServiceClient } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeeklyExperiment {
  week: string; // ISO week string e.g. "2026-W12"
  format: string; // e.g. "comparison" | "ranked-list" | "case-study" | "workflow" | "tool-deep-dive" | "myth-busting"
  description: string; // what to do this week
  exampleTitle: string; // example title in this format
  promptAddition: string; // extra instruction to add to content generation prompt
}

export interface DistributionPost {
  slug: string;
  title: string;
  platform: 'reddit' | 'linkedin' | 'twitter';
  subreddit?: string; // for reddit
  content: string; // ready-to-post copy
}

export interface BrainstormResult {
  weekOf: string;
  experiment: WeeklyExperiment;
  reflectionSummary: string; // what Gemini concluded about what's working
  newKeywords: string[]; // new keyword angles generated
  distributionQueue: DistributionPost[];
  emailSent: boolean;
}

// ── Weekly experiment rotation ─────────────────────────────────────────────────

const WEEKLY_EXPERIMENTS: WeeklyExperiment[] = [
  {
    week: '0',
    format: 'comparison',
    description:
      'Write comparison posts: "X vs Y for YouTube creators/online coaches". Pick two competing tools, strategies, or platforms and give a definitive verdict.',
    exampleTitle:
      'Teachable vs Graphy: Which Course Platform Is Actually Better for Creators in 2026?',
    promptAddition:
      'FORMAT THIS WEEK: Write a COMPARISON post. Use a definitive "X vs Y" or "X or Y" structure. Include a detailed comparison table. Give a clear verdict — don\'t hedge. Real creators want to know which to choose.',
  },
  {
    week: '1',
    format: 'ranked-list',
    description:
      'Write ranked "best of" lists: "N Best X for YouTube creators". Each item must have a specific reason why it\'s ranked there.',
    exampleTitle:
      '7 Best AI Tools for YouTube Creators That Actually Save Time (Tested)',
    promptAddition:
      'FORMAT THIS WEEK: Write a RANKED LIST post. Number each item 1-N with the best at top. Each item gets: what it does, why it\'s ranked here, a real example, and a "best for" note. Include a comparison table of all items.',
  },
  {
    week: '2',
    format: 'case-study',
    description:
      'Write creator case studies: "How [type of creator] achieved [specific result] using [approach]". Use realistic but anonymized creator scenarios.',
    exampleTitle:
      'How a 2,000-Subscriber Cooking Channel Made $3,400 in Their First Month Selling Courses',
    promptAddition:
      'FORMAT THIS WEEK: Write a CASE STUDY post. Follow a specific creator journey from problem → solution → result. Use realistic numbers. Structure: The Problem, The Strategy, Step-by-Step Implementation, Results After 90 Days, Key Lessons. Make it feel real and specific.',
  },
  {
    week: '3',
    format: 'workflow',
    description:
      'Write process/workflow posts: "My exact [X] workflow" or "The [X]-step process for [outcome]". Step-by-step, replicable systems.',
    exampleTitle:
      'My Exact 5-Step Workflow for Turning One YouTube Video Into 6 Pieces of Content',
    promptAddition:
      'FORMAT THIS WEEK: Write a WORKFLOW/PROCESS post. Give readers an exact, numbered, copy-paste-ready system. Include screenshots descriptions, time estimates per step, tools used, and what the output looks like. The reader should be able to replicate this TODAY.',
  },
  {
    week: '4',
    format: 'tool-deep-dive',
    description:
      'Write comprehensive tool guides: "The complete guide to using [specific tool] for [creator goal]". Practical, specific, with real use cases.',
    exampleTitle:
      'The Complete Guide to Using Notion for YouTube Content Planning (With Templates)',
    promptAddition:
      'FORMAT THIS WEEK: Write a TOOL DEEP-DIVE post. Cover: what the tool does, why creators need it, setup guide, 5 specific use cases, pro tips, limitations, and alternatives. Include a table of key features/pricing. The reader should feel like an expert after reading.',
  },
  {
    week: '5',
    format: 'myth-busting',
    description:
      'Write myth-busting posts: "X myths about [topic] every creator believes". Contrarian, backed by data, builds trust.',
    exampleTitle:
      '6 YouTube Monetization Myths That Are Costing Creators Real Money',
    promptAddition:
      'FORMAT THIS WEEK: Write a MYTH-BUSTING post. For each myth: state the myth in bold, explain why creators believe it, then systematically dismantle it with data/logic/examples. Be direct and slightly provocative. The reader should feel like they\'ve been told something important most people get wrong.',
  },
];

// ── Helper: Get current week number (ISO 8601) ──────────────────────────────────

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return weekNum;
}

// ── Helper: Get current week experiment ─────────────────────────────────────────

export function getCurrentWeekExperiment(): WeeklyExperiment {
  const weekNum = getWeekNumber(new Date());
  const experimentIndex = (weekNum - 1) % WEEKLY_EXPERIMENTS.length;
  return WEEKLY_EXPERIMENTS[experimentIndex];
}

// ── Helper: ISO week string ────────────────────────────────────────────────────

function getISOWeekString(date: Date): string {
  const year = date.getFullYear();
  const weekNum = getWeekNumber(date);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

// ── Main brainstorm function ───────────────────────────────────────────────────

export async function runWeeklyBrainstorm(): Promise<BrainstormResult> {
  const db = getServiceClient();
  const weekOf = getISOWeekString(new Date());
  const experiment = getCurrentWeekExperiment();

  let reflectionSummary = '';
  let newKeywords: string[] = [];
  let distributionQueue: DistributionPost[] = [];
  let emailSent = false;

  try {
    // ── 1. Fetch last 30 days of posts ───────────────────────────────────────

    const day30 = new Date();
    day30.setDate(day30.getDate() - 30);

    const { data: recentPosts } = await db
      .from('posts')
      .select('slug, title, category, quality_score, published_at')
      .eq('status', 'published')
      .gte('published_at', day30.toISOString())
      .order('published_at', { ascending: false });

    const posts = recentPosts ?? [];

    // ── 2. Fetch recent agent logs for context ───────────────────────────────

    const { data: recentLogs } = await db
      .from('agent_logs')
      .select('run_type, status, created_at')
      .order('created_at', { ascending: false })
      .limit(30);

    // ── 3. Fetch top unused keywords ────────────────────────────────────────

    const { data: topKeywords } = await db
      .from('keywords')
      .select('keyword, priority, search_volume')
      .eq('used', false)
      .order('priority', { ascending: false })
      .limit(10);

    // ── 4. Self-reflection: Ask Gemini what's working ────────────────────────

    const reflectionPrompt = `
You are analyzing content performance for a blog about YouTube creators, online coaches, and the creator economy.

RECENT POSTS (last 30 days):
${
  posts
    .slice(0, 15)
    .map((p) => `  - "${p.title}" [${p.category}] (score: ${p.quality_score || 'N/A'})`)
    .join('\n')
}

TOP UNUSED KEYWORDS (next targets):
${
  (topKeywords ?? [])
    .slice(0, 10)
    .map((k) => `  - "${k.keyword}" (priority: ${k.priority})`)
    .join('\n')
}

ANALYZE:
1. What content categories/formats are appearing most frequently in the last 30 days?
2. What patterns do you see in post titles? What works?
3. Are there obvious gaps in content coverage based on the keywords?
4. What should we do MORE of? Less of?
5. What's the next big angle/format we should explore?

Return ONLY this JSON (no markdown):
{
  "reflection": "2-3 sentence summary of what's working and what isn't",
  "whatIsWorking": ["pattern 1", "pattern 2", "pattern 3"],
  "whatToDoMore": ["action 1", "action 2"],
  "newKeywordAngles": ["angle 1", "angle 2", "angle 3", "angle 4", "angle 5", "angle 6", "angle 7", "angle 8", "angle 9", "angle 10"]
}
`;

    const reflectionRaw = await ask(reflectionPrompt, 1500, 0.7);
    let reflectionParsed: {
      reflection: string;
      whatIsWorking: string[];
      whatToDoMore: string[];
      newKeywordAngles: string[];
    };

    try {
      reflectionParsed = JSON.parse(stripJsonFences(reflectionRaw));
    } catch {
      reflectionParsed = {
        reflection: 'Unable to analyze performance this week.',
        whatIsWorking: [],
        whatToDoMore: [],
        newKeywordAngles: [],
      };
    }

    reflectionSummary = reflectionParsed.reflection;
    newKeywords = reflectionParsed.newKeywordAngles || [];

    // ── 5. Save new keywords to DB ──────────────────────────────────────────

    if (newKeywords.length > 0) {
      const keywordInserts = newKeywords.map((kw) => ({
        keyword: kw,
        priority: 8,
        used: false,
        source: 'brainstorm',
        created_at: new Date().toISOString(),
      }));

      try {
        await db.from('keywords').insert(keywordInserts);
        console.log(`[Brainstorm] Inserted ${newKeywords.length} new keywords`);
      } catch (err) {
        console.error('[Brainstorm] Failed to insert keywords:', err);
      }
    }

    // ── 6. Generate distribution copy for top 3 recent posts ───────────────────

    const top3Posts = posts.slice(0, 3);

    if (top3Posts.length > 0) {
      for (const post of top3Posts) {
        const distPrompt = `
You are a growth marketer. Given this blog post, generate 3 platform-specific versions of copy to distribute it.

POST TITLE: "${post.title}"
POST SLUG: ${post.slug}
POST CATEGORY: ${post.category}

Create distribution-ready copy for:
1. Reddit (for r/youtubers and r/juststart): Include subreddit, a compelling title, and the opening paragraph
2. LinkedIn: Reframe as a professional/business insight post with 3-5 key takeaways as bullets
3. Twitter/X: A hook tweet + 3 follow-up tweet replies that thread together

Return ONLY this JSON:
{
  "reddit": {
    "subreddit": "r/youtubers",
    "title": "compelling reddit title for the post",
    "content": "opening paragraph and call-to-action for the full post"
  },
  "linkedin": {
    "content": "professional version with 3-5 bullet insights"
  },
  "twitter": {
    "hook": "engaging hook tweet",
    "followup1": "followup 1",
    "followup2": "followup 2",
    "followup3": "followup 3"
  }
}
`;

        try {
          const distRaw = await askFast(distPrompt, 1000, 0.6);
          const distParsed = JSON.parse(stripJsonFences(distRaw));

          if (distParsed.reddit?.content) {
            distributionQueue.push({
              slug: post.slug,
              title: post.title,
              platform: 'reddit',
              subreddit: distParsed.reddit.subreddit,
              content: `Title: ${distParsed.reddit.title}\n\n${distParsed.reddit.content}`,
            });
          }

          if (distParsed.linkedin?.content) {
            distributionQueue.push({
              slug: post.slug,
              title: post.title,
              platform: 'linkedin',
              content: distParsed.linkedin.content,
            });
          }

          if (distParsed.twitter?.hook) {
            const twitterThread =
              `${distParsed.twitter.hook}\n\n` +
              (distParsed.twitter.followup1 ? `1. ${distParsed.twitter.followup1}\n` : '') +
              (distParsed.twitter.followup2 ? `2. ${distParsed.twitter.followup2}\n` : '') +
              (distParsed.twitter.followup3 ? `3. ${distParsed.twitter.followup3}` : '');

            distributionQueue.push({
              slug: post.slug,
              title: post.title,
              platform: 'twitter',
              content: twitterThread,
            });
          }
        } catch (err) {
          console.error(`[Brainstorm] Failed to generate distribution copy for ${post.slug}:`, err);
        }
      }
    }

    // ── 7. Save to agent_logs ──────────────────────────────────────────────

    try {
      await db.from('agent_logs').insert({
        run_type: 'weekly_brainstorm',
        status: 'success',
        details: {
          weekOf,
          experiment: experiment.format,
          reflectionSummary,
          newKeywordsCount: newKeywords.length,
          distributionQueueCount: distributionQueue.length,
          agentActivity: (recentLogs ?? []).length,
        },
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Brainstorm] Failed to save log:', err);
    }

    // ── 8. Send email ──────────────────────────────────────────────────────

    const emailHtml = buildBrainstormEmail({
      weekOf,
      experiment,
      reflectionSummary,
      newKeywords,
      distributionQueue,
    });

    emailSent = await sendEmail({
      to:      process.env.REPORT_EMAIL_TO || 'sandeep.singh@graphy.com',
      subject: `🧠 Weekly Intelligence Brief — ${weekOf}`,
      html:    emailHtml,
    });

    console.log(
      `[Brainstorm] Week ${weekOf}: reflection sent, ${newKeywords.length} keywords added, ${distributionQueue.length} posts queued for distribution`,
    );
  } catch (err) {
    console.error('[Brainstorm] Error during brainstorm run:', err);

    // Try to send error email
    await sendEmail({
      to: process.env.REPORT_EMAIL_TO || 'sandeep.singh@graphy.com',
      subject: `⚠️ Brainstorm run failed — ${weekOf}`,
      html: `<p>The weekly brainstorm run failed. Check logs for details.</p><p>${err instanceof Error ? err.message : String(err)}</p>`,
    });
  }

  return {
    weekOf,
    experiment,
    reflectionSummary,
    newKeywords,
    distributionQueue,
    emailSent,
  };
}

// ── Email builder ──────────────────────────────────────────────────────────────

function buildBrainstormEmail(params: {
  weekOf: string;
  experiment: WeeklyExperiment;
  reflectionSummary: string;
  newKeywords: string[];
  distributionQueue: DistributionPost[];
}): string {
  const { weekOf, experiment, reflectionSummary, newKeywords, distributionQueue } = params;

  const redditPosts = distributionQueue.filter((p) => p.platform === 'reddit');
  const linkedinPosts = distributionQueue.filter((p) => p.platform === 'linkedin');
  const twitterPosts = distributionQueue.filter((p) => p.platform === 'twitter');

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; }
    .header h1 { margin: 0; font-size: 24px; }
    .section { margin-bottom: 30px; border: 1px solid #eee; padding: 20px; border-radius: 8px; }
    .section-title { font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #667eea; }
    .subsection { margin-bottom: 15px; }
    .subsection-title { font-weight: 600; margin-bottom: 8px; }
    .keywords { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .keyword-item { background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 14px; }
    .distribution-item { background: #f9f9f9; border-left: 4px solid #667eea; padding: 15px; margin-bottom: 12px; border-radius: 4px; }
    .distribution-post-title { font-weight: 600; margin-bottom: 8px; font-size: 14px; }
    .distribution-content { font-size: 13px; white-space: pre-wrap; color: #555; }
    .footer { font-size: 12px; color: #999; text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🧠 Weekly Intelligence Brief</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">Week ${weekOf}</p>
    </div>

    <!-- This Week's Experiment -->
    <div class="section">
      <div class="section-title">📋 This Week's Experiment</div>
      <div class="subsection">
        <div class="subsection-title">${experiment.format.toUpperCase()}</div>
        <p>${experiment.description}</p>
        <p><strong>Example:</strong> "${experiment.exampleTitle}"</p>
      </div>
    </div>

    <!-- What's Working -->
    <div class="section">
      <div class="section-title">✅ What's Working</div>
      <p>${reflectionSummary}</p>
    </div>

    <!-- New Keywords -->
    ${
      newKeywords.length > 0
        ? `
    <div class="section">
      <div class="section-title">🎯 New Keyword Angles (${newKeywords.length})</div>
      <div class="keywords">
        ${newKeywords.map((kw) => `<div class="keyword-item">${kw}</div>`).join('')}
      </div>
    </div>
    `
        : ''
    }

    <!-- Distribution Queue -->
    ${
      distributionQueue.length > 0
        ? `
    <div class="section">
      <div class="section-title">📤 Distribution Queue (Ready to Post)</div>

      ${
        redditPosts.length > 0
          ? `
      <div class="subsection">
        <div class="subsection-title">🔴 Reddit (${redditPosts.length} posts)</div>
        ${redditPosts
          .map(
            (p) => `
        <div class="distribution-item">
          <div class="distribution-post-title">${p.title}</div>
          <div class="distribution-content">${p.content}</div>
        </div>
        `,
          )
          .join('')}
      </div>
      `
          : ''
      }

      ${
        linkedinPosts.length > 0
          ? `
      <div class="subsection">
        <div class="subsection-title">🔵 LinkedIn (${linkedinPosts.length} posts)</div>
        ${linkedinPosts
          .map(
            (p) => `
        <div class="distribution-item">
          <div class="distribution-post-title">${p.title}</div>
          <div class="distribution-content">${p.content}</div>
        </div>
        `,
          )
          .join('')}
      </div>
      `
          : ''
      }

      ${
        twitterPosts.length > 0
          ? `
      <div class="subsection">
        <div class="subsection-title">𝕏 Twitter/X Threads (${twitterPosts.length} posts)</div>
        ${twitterPosts
          .map(
            (p) => `
        <div class="distribution-item">
          <div class="distribution-post-title">${p.title}</div>
          <div class="distribution-content">${p.content}</div>
        </div>
        `,
          )
          .join('')}
      </div>
      `
          : ''
      }
    </div>
    `
        : ''
    }

    <div class="section" style="background:#f0fdf4; border:1px solid #bbf7d0;">
      <div class="section-title" style="color:#059669;">💬 Reply to this email with instructions</div>
      <p style="font-size:13px; margin:0; color:#374151;">
        I'll understand and execute them automatically. Try:
      </p>
      <ul style="font-size:13px; margin:10px 0; color:#374151; padding-left:20px;">
        <li><strong>"Write about X"</strong> — adds X as a priority-10 keyword today</li>
        <li><strong>"Skip Y"</strong> — blocks that topic going forward</li>
        <li><strong>"Use case study format this week"</strong> — overrides the experiment rotation</li>
        <li><strong>"Pause for 3 days"</strong> — halts content generation</li>
        <li><strong>"Show me stats"</strong> — emails you a traffic/performance summary</li>
        <li><strong>"Run now"</strong> — triggers an immediate content run</li>
      </ul>
    </div>

    <div class="footer">
      <p>Sent by Sandeep's Blog Agent — ${new Date().toISOString().split('T')[0]}</p>
    </div>
  </div>
</body>
</html>
  `;
}
