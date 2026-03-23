/**
 * agent/escalate.ts
 * =================
 * Agent self-awareness, mission config, and escalation system.
 *
 * The agent reads its mission from AGENT_MISSION before making decisions.
 * When it encounters a situation it's uncertain about, it sends Sandeep an
 * email (via Resend) and skips the action rather than proceeding blindly.
 *
 * HOW SANDEEP INTERACTS WITH THE AGENT:
 *   Agent → Sandeep : email (this module)
 *   Sandeep → Agent : Claude chat — discuss the issue and update strategy/code
 *
 * ESCALATION TRIGGERS (agent pauses + emails instead of proceeding):
 *   - Topic appears clearly off-niche (politics, sports, cooking, etc.)
 *   - Quality score < 50 after two regeneration attempts
 *   - Keyword list drops below 5 unused keywords (pipeline about to run dry)
 *   - Content seems to contradict Graphy.com positioning
 *   - Same topic/angle already covered recently (duplicate content risk)
 *   - Trend topic seems controversial or potentially harmful
 */

import { sendEmail }       from './email';
import { getServiceClient } from '../lib/supabase';

// ── Agent Mission Config ──────────────────────────────────────────────────────
// This is the single source of truth for what the agent does and why.
// It's used in generation prompts to keep the agent on-brand.

export const AGENT_MISSION = {
  site:     'sandeeps.co',
  siteUrl:  'https://sandeeps.co',
  author:   'Sandeep Singh, Co-founder of Graphy.com',
  contact:  process.env.REPORT_EMAIL_TO ?? 'sandeep.singh@graphy.com',

  audience: 'Early-stage YouTube creators, online coaches, digital entrepreneurs who want to build a creator business',

  goal: 'Build topical authority in the creator economy → drive organic traffic → convert readers to Graphy.com signups',

  product: 'Graphy.com — a no-code platform for creators to build and sell online courses. 50,000+ creators trust it.',

  contentStrategy: {
    postsPerDay: 2,
    bofu: {
      description: 'Keyword-driven how-to posts. High commercial intent. Converts directly to Graphy signups.',
      style:       'Tutorial / guide / comparison. Specific, actionable, numbers-driven.',
      example:     'How to monetize your YouTube channel with 1,000 subscribers',
    },
    tofu: {
      description: 'Trend-based analysis posts. Hooks onto creator economy news. Builds brand awareness and TOFU traffic.',
      style:       'Commentary, analysis, "what this means for you" angle. Opinionated. AI-first where relevant.',
      example:     'YouTube just changed its monetization rules — here is what creators need to know',
    },
  },

  categories: [
    'YouTube Monetization',   // BOFU — high intent, Graphy CTA
    'Course Creation',        // BOFU — high intent, Graphy CTA
    'Creator Growth',         // BOFU/TOFU — audience building
    'Content Strategy',       // BOFU/TOFU — SEO, scripting
    'AI for Creator Economy', // TOFU → BOFU — AI tools + creator business
  ],

  aiCategoryManifesto: `
Every post in "AI for Creator Economy" must:
1. Start from a REAL creator problem (growing a channel, selling courses, saving time)
2. Show HOW AI solves that problem with specific tools + step-by-step usage
3. Include a "Before AI / After AI" comparison with real numbers where possible
4. Mention at least 2 specific AI tools (ChatGPT, Gemini, ElevenLabs, Pictory, etc.)
5. End with an actionable AI workflow the reader can copy today
6. Have an AI-first angle — not "AI can help" but "here is EXACTLY how to use AI for this"
`,

  contentValues: [
    'Original insights over generic advice — say something most creators don\'t know',
    'Specific numbers, real examples, actionable steps — no vague generalisations',
    'AI-first angle for creator economy — show HOW to use AI, not just that it exists',
    'Quality over quantity — score ≥ 65 before publishing, draft if below',
    'Never publish off-niche content — creator economy only',
    'Max 2 natural Graphy mentions per post — solution, not advertisement',
    'Internal links to related posts — every post should link to 2+ existing posts',
  ],

  offNicheTopics: [
    'politics', 'sports', 'cooking', 'health/fitness (general)', 'gaming (unless YouTube gaming)',
    'finance (unless creator income)', 'travel', 'fashion', 'real estate',
    'celebrity gossip', 'news unrelated to creators or AI',
  ],

  escalationTriggers: [
    'Topic seems clearly off-niche (not creator economy, YouTube, courses, or AI)',
    'Content quality score < 50 after 2 attempts',
    'Unused keyword count drops below 5 (pipeline about to run dry)',
    'Trending topic is controversial, political, or potentially harmful',
    'Same post slug already exists (collision risk)',
    'Trend topic seems to criticise Graphy.com or position competitors',
    'DB or API failures that block the run (agent can\'t complete)',
  ],
} as const;

// ── Escalation functions ──────────────────────────────────────────────────────

export interface EscalationContext {
  trigger:   string;                    // which escalation trigger fired
  action:    string;                    // what the agent was about to do
  details:   Record<string, unknown>;   // relevant context data
  skipPost?: boolean;                   // if true, agent skips this post entirely
}

/**
 * Escalate to Sandeep via email and log to DB.
 * The agent STOPS the current action and waits for human input.
 *
 * @returns false — caller should treat this as "skip this action"
 */
export async function escalateToSandeep(ctx: EscalationContext): Promise<false> {
  const subject = `⚠️ Agent escalation: ${ctx.trigger}`;

  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #dc2626;">⚠️ Agent Escalation — Action Paused</h2>

  <p>Hi Sandeep,</p>
  <p>The blog agent encountered a situation it wasn't confident handling and has <strong>paused the action</strong> rather than proceeding. Here's what happened:</p>

  <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 16px 0;">
    <strong>Trigger:</strong> ${ctx.trigger}<br/>
    <strong>Action paused:</strong> ${ctx.action}
  </div>

  <h3>Details:</h3>
  <pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px;">${JSON.stringify(ctx.details, null, 2)}</pre>

  <p>The agent did <strong>not</strong> proceed with this action. Come to Claude chat to review the situation and give direction.</p>

  <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 16px; border-radius: 8px; margin-top: 24px;">
    <strong>💬 Reply to this email with instructions — I'll execute them automatically:</strong><br/><br/>
    • <code>"Approve"</code> — proceed with the action as planned<br/>
    • <code>"Skip this topic"</code> — mark it as blocked, move to next keyword<br/>
    • <code>"Write about X instead"</code> — swap topic immediately<br/>
    • <code>"Pause for 2 days"</code> — halt generation temporarily<br/>
    • <code>"Run now"</code> — trigger an immediate agent run<br/><br/>
    Or manually re-trigger via:<br/>
    <code style="font-size: 12px;">https://sandeeps.co/api/agent/run?key=${process.env.CRON_SECRET ?? 'YOUR_KEY'}</code>
  </div>

  <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
    — Agent @ ${new Date().toISOString()}
  </p>
</div>`;

  // Send email — reply-to enables Sandeep to reply with instructions
  const to = AGENT_MISSION.contact;
  await sendEmail({
    to,
    subject,
    html,
    replyTo: 'reply@sandeeps.co',
  }).catch((e) => console.error('[Escalate] Failed to send escalation email:', e));

  // Log to DB
  try {
    const db = getServiceClient();
    await db.from('agent_logs').insert({
      run_type:  'self_heal',
      status:    'skipped',
      post_slug: null,
      details:   { escalation: true, trigger: ctx.trigger, action: ctx.action, ...ctx.details },
      error:     `ESCALATED: ${ctx.trigger}`,
    });
  } catch { /* non-fatal */ }

  console.warn(`[Agent] 🚨 ESCALATED to Sandeep — trigger: "${ctx.trigger}" | action: "${ctx.action}"`);
  return false;
}

/**
 * Check whether a proposed TOFU trending topic should be escalated
 * (off-niche, controversial, etc.) before the agent writes about it.
 *
 * Returns true if it's safe to proceed, false if escalated.
 */
export async function checkTrendTopicSafety(
  topic: string,
  trendSource: string,
): Promise<boolean> {
  const topicLower = topic.toLowerCase();

  // Quick keyword check for obviously off-niche topics
  const offNicheSignals = [
    'politics', 'election', 'war', 'conflict', 'religion', 'sports',
    'cooking', 'recipe', 'fitness', 'diet', 'weight loss', 'travel',
    'celebrity', 'gossip', 'stock market', 'crypto (generic)',
    'real estate (general)', 'weather', 'climate',
  ];

  const isOffNiche = offNicheSignals.some((signal) => topicLower.includes(signal));

  if (isOffNiche) {
    await escalateToSandeep({
      trigger:  'Trending topic appears off-niche',
      action:   `Write a TOFU trend post about: "${topic}"`,
      details:  { topic, trendSource, offNicheSignalDetected: true },
      skipPost: true,
    });
    return false;
  }

  return true;
}

/**
 * Check keyword pipeline health. Escalates if running very low.
 */
export async function checkKeywordHealth(): Promise<void> {
  try {
    const db = getServiceClient();
    const { count } = await db
      .from('keywords')
      .select('*', { count: 'exact', head: true })
      .eq('used', false);

    const unused = count ?? 0;
    if (unused < 5) {
      await escalateToSandeep({
        trigger:  'Keyword pipeline critically low',
        action:   'Continue daily BOFU post generation',
        details:  { unusedKeywords: unused, minimumRecommended: 15 },
        skipPost: false, // don't skip — just warn
      });
    }
  } catch { /* non-fatal */ }
}

/**
 * Inject the agent mission into a content generation prompt.
 * Use this to keep Gemini on-brand for every post type.
 */
export function getMissionContext(postType: 'bofu' | 'tofu' | 'ai'): string {
  const base = `
SITE: ${AGENT_MISSION.site} | AUTHOR: ${AGENT_MISSION.author}
PRODUCT: ${AGENT_MISSION.product}
AUDIENCE: ${AGENT_MISSION.audience}
MISSION: ${AGENT_MISSION.goal}`;

  if (postType === 'ai') {
    return `${base}\n\nAI CATEGORY RULES:${AGENT_MISSION.aiCategoryManifesto}`;
  }

  if (postType === 'tofu') {
    return `${base}\n\nPOST TYPE: Top-of-funnel trend analysis.
Style: ${AGENT_MISSION.contentStrategy.tofu.style}
Goal: Hook trending traffic, build brand authority, soft-link to BOFU posts.`;
  }

  return `${base}\n\nPOST TYPE: Bottom-of-funnel keyword post.
Style: ${AGENT_MISSION.contentStrategy.bofu.style}
Goal: Rank for commercial-intent keywords, drive Graphy.com signups.`;
}
