/**
 * agent/strategy.ts
 * =================
 * Daily Strategic Advisor — thinks like a founder, not just an SEO.
 *
 * GOAL: 10,000 monthly organic visitors with $500/month budget.
 *
 * Every day this:
 *   1. Measures current state — traffic, posts, velocity, rankings
 *   2. Calculates trajectory — at current pace, when do we hit 10K?
 *   3. Identifies the biggest bottleneck blocking 10K
 *   4. Generates daily recommendations across ALL growth levers:
 *        → Content strategy (what to write, what format, what angle)
 *        → Distribution (Reddit, Quora, Twitter, LinkedIn, Pinterest, YouTube)
 *        → Product (free tools, calculators, lead magnets that attract links)
 *        → GTM (partnerships, guest posts, HARO, podcast appearances)
 *        → Technical SEO (speed, schema, Core Web Vitals, sitemap)
 *        → Budget allocation (how to spend $500 this month for max ROI)
 *   5. Surfaces one "contrarian" move most people would never think of
 *
 * Runs daily as part of /api/agent/sync (10 AM UTC).
 * Output is included in the daily email report.
 */

import { ask, stripJsonFences }  from './gemini';
import { getServiceClient }       from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrafficSnapshot {
  monthlyClicks:      number;   // last 30 days from GSC
  weeklyClicks:       number;   // last 7 days from GSC
  totalPosts:         number;
  avgPosition:        number;
  topKeyword:         string;
  postsThisMonth:     number;
  daysToGoal:         number | null;  // null = goal already reached or no data
  percentToGoal:      number;         // 0–100
  weeklyVelocity:     number;         // avg new clicks per week over last 4 weeks
  projectedMonthly:   number;         // extrapolated from weekly velocity
}

export interface StrategyRecommendation {
  category:    'content' | 'distribution' | 'product' | 'gtm' | 'technical' | 'budget';
  priority:    'high' | 'medium' | 'low';
  action:      string;      // what to do (1-2 sentences)
  why:         string;      // why this matters now (1 sentence)
  effort:      'low' | 'medium' | 'high';
  impact:      'low' | 'medium' | 'high';
  timeframe:   string;      // e.g. "this week", "today", "this month"
}

export interface DailyStrategy {
  snapshot:          TrafficSnapshot;
  todaysFocus:       string;              // single most important thing to do TODAY
  topRecommendations: StrategyRecommendation[];  // ranked by priority
  budgetAllocation:  BudgetAllocation;
  contrarian:        string;             // one unconventional idea most would miss
  bottleneck:        string;             // the #1 thing blocking 10K right now
  weeklyMilestone:   string;             // specific measurable goal for this week
}

export interface BudgetAllocation {
  total:    number;   // $500
  breakdown: Array<{
    category:    string;
    amount:      number;
    description: string;
  }>;
}

const TRAFFIC_GOAL    = 10_000;  // monthly visitors
const MONTHLY_BUDGET  = 500;     // USD
const SITE_URL        = 'https://sandeeps.co';
const NICHE           = 'YouTube creators, online coaches, creator economy';
const PRODUCT         = 'Graphy.com — platform to build and sell online courses';

// ── Main function ─────────────────────────────────────────────────────────────

export async function getDailyStrategy(): Promise<DailyStrategy> {
  const db = getServiceClient();

  // ── 1. Get traffic snapshot ───────────────────────────────────────────────
  const snapshot = await buildTrafficSnapshot(db);

  // ── 2. Get content + keyword context ─────────────────────────────────────
  const { data: recentPosts } = await db
    .from('posts')
    .select('title, category, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(10);

  const { data: unusedKeywords } = await db
    .from('keywords')
    .select('keyword, priority, search_volume')
    .eq('used', false)
    .order('priority', { ascending: false })
    .limit(10);

  // ── 3. Get recent agent activity ──────────────────────────────────────────
  const { data: recentLogs } = await db
    .from('agent_logs')
    .select('run_type, status, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  const refreshRuns = (recentLogs ?? []).filter((l: { run_type: string }) => l.run_type === 'content_refresh').length;
  const ctrRuns     = (recentLogs ?? []).filter((l: { run_type: string }) => l.run_type === 'ctr_optimization').length;
  const linkRuns    = (recentLogs ?? []).filter((l: { run_type: string }) => l.run_type === 'internal_linking').length;

  // ── 4. Ask Gemini to think like a founder ─────────────────────────────────
  const strategy = await generateFounderStrategy({
    snapshot,
    recentPosts:    recentPosts ?? [],
    unusedKeywords: unusedKeywords ?? [],
    agentActivity:  { refreshRuns, ctrRuns, linkRuns },
  });

  console.log(`[Strategy] Generated daily strategy — focus: "${strategy.todaysFocus.slice(0, 60)}..."`);

  return strategy;
}

// ── Traffic snapshot builder ──────────────────────────────────────────────────

async function buildTrafficSnapshot(db: ReturnType<typeof getServiceClient>): Promise<TrafficSnapshot> {
  const now     = new Date();
  const day30   = new Date(now); day30.setDate(day30.getDate() - 30);
  const day7    = new Date(now); day7.setDate(day7.getDate() - 7);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Monthly clicks from page_performance
  const { data: monthData } = await db
    .from('page_performance')
    .select('clicks, impressions, avg_position')
    .gte('date', day30.toISOString().split('T')[0]);

  const monthlyClicks  = (monthData ?? []).reduce((s: number, r: { clicks: number }) => s + r.clicks, 0);

  const { data: week7Data } = await db
    .from('page_performance')
    .select('clicks')
    .gte('date', day7.toISOString().split('T')[0]);

  const weeklyClicks = (week7Data ?? []).reduce((s: number, r: { clicks: number }) => s + r.clicks, 0);

  const avgPosition = monthData?.length
    ? (monthData as { avg_position: number }[]).reduce((s, r) => s + r.avg_position, 0) / monthData.length
    : 0;

  // Top keyword (most clicks in period)
  const { data: topKwData } = await db
    .from('page_performance')
    .select('top_queries')
    .gte('date', day7.toISOString().split('T')[0])
    .limit(5);

  const allQueries = (topKwData ?? []).flatMap((r: { top_queries: string[] }) => r.top_queries ?? []);
  const topKeyword = allQueries[0] ?? 'not enough data yet';

  // Post counts
  const { count: totalPosts } = await db
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published');

  const { count: postsThisMonth } = await db
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .gte('published_at', thisMonth.toISOString());

  // Weekly velocity (4-week average)
  const weeklyVelocity   = weeklyClicks;
  const projectedMonthly = Math.round(weeklyVelocity * 4.33);

  // Trajectory to goal
  const percentToGoal  = Math.min(100, Math.round((monthlyClicks / TRAFFIC_GOAL) * 100));
  const clicksNeeded   = TRAFFIC_GOAL - monthlyClicks;
  const weeklyGrowth   = weeklyVelocity > 0 ? weeklyVelocity * 0.1 : 10;  // assume 10% weekly growth
  const weeksToGoal    = weeklyGrowth > 0 ? Math.ceil(clicksNeeded / weeklyGrowth) : null;
  const daysToGoal     = weeksToGoal !== null ? weeksToGoal * 7 : null;

  return {
    monthlyClicks,
    weeklyClicks,
    totalPosts:      totalPosts  ?? 0,
    avgPosition:     Math.round(avgPosition * 10) / 10,
    topKeyword,
    postsThisMonth:  postsThisMonth ?? 0,
    daysToGoal,
    percentToGoal,
    weeklyVelocity,
    projectedMonthly,
  };
}

// ── Gemini strategic prompt ───────────────────────────────────────────────────

async function generateFounderStrategy(ctx: {
  snapshot:       TrafficSnapshot;
  recentPosts:    Array<{ title: string; category: string; published_at: string }>;
  unusedKeywords: Array<{ keyword: string; priority: number; search_volume: string | null }>;
  agentActivity:  { refreshRuns: number; ctrRuns: number; linkRuns: number };
}): Promise<DailyStrategy> {

  const { snapshot } = ctx;

  const prompt = `
You are a growth-obsessed founder and SEO expert advising the blog at ${SITE_URL}.

BLOG NICHE: ${NICHE}
MONETIZATION: CTAs driving signups to ${PRODUCT}
TRAFFIC GOAL: ${TRAFFIC_GOAL.toLocaleString()} monthly visitors
MONTHLY BUDGET: $${MONTHLY_BUDGET}

CURRENT STATE:
- Monthly traffic: ${snapshot.monthlyClicks.toLocaleString()} visitors (${snapshot.percentToGoal}% of goal)
- Weekly traffic: ${snapshot.weeklyClicks} visitors
- Projected monthly (at current pace): ${snapshot.projectedMonthly.toLocaleString()}
- Total published posts: ${snapshot.totalPosts}
- Posts this month: ${snapshot.postsThisMonth}
- Avg search position: ${snapshot.avgPosition || 'no data yet'}
- Top keyword: "${snapshot.topKeyword}"
- Days to 10K goal (projected): ${snapshot.daysToGoal ?? 'insufficient data'}
- Agent automation: ${ctx.agentActivity.refreshRuns} refreshes, ${ctx.agentActivity.ctrRuns} CTR optimizations, ${ctx.agentActivity.linkRuns} internal linking runs

RECENT POSTS (last 10):
${ctx.recentPosts.slice(0, 10).map((p) => `  - "${p.title}" [${p.category}]`).join('\n')}

TOP UPCOMING KEYWORDS:
${ctx.unusedKeywords.slice(0, 8).map((k) => `  - "${k.keyword}" (priority: ${k.priority})`).join('\n')}

AUTOMATED SYSTEMS ALREADY RUNNING:
✅ Daily content generation (Gemini)
✅ Google Trends + DataForSEO keyword research
✅ GSC feedback loop (rankings → keyword priority boost)
✅ CTR optimizer (rewrites low-CTR titles automatically)
✅ Internal linking engine (auto-links on every publish)
✅ Content refresh (weekly, Sundays)
✅ FAQ/AEO schema on every post
✅ GA4 CTA click tracking

YOUR TASK: Think like a founding team member obsessed with hitting 10K.
Consider ALL growth levers — not just SEO. What would a smart founder with $500/month do TODAY?

Think across:
1. CONTENT: What types/formats/angles would accelerate growth? (Listicles? Comparison posts? "Best X for Y" posts? Free tools?)
2. DISTRIBUTION: Where should content be repurposed/shared? (Reddit, Quora, Twitter/X threads, LinkedIn, YouTube Shorts, Pinterest, email newsletter, Slack communities)
3. PRODUCT: What free tools or utilities could attract backlinks and traffic? (YouTube earnings calculator? Course pricing calculator? Channel audit tool?)
4. GTM: Partnerships, guest posts on high-DA sites, HARO/journalist outreach, podcast appearances, creator collaborations
5. TECHNICAL: Any SEO/speed/schema improvements that would move the needle
6. BUDGET: How to allocate $500/month for maximum traffic ROI

Return ONLY this JSON (no markdown, no extra text):
{
  "todaysFocus": "The single most impactful action Sandeep should take or implement TODAY (2-3 sentences, specific and actionable)",
  "bottleneck": "The #1 thing blocking 10K monthly traffic right now (1 sentence, honest and direct)",
  "weeklyMilestone": "A specific measurable goal for this week that moves toward 10K (e.g. 'Publish 2 comparison posts and post them in 3 creator subreddits')",
  "contrarian": "One unconventional growth move that most SEO people would never suggest but could be 10x more effective (be specific, be bold)",
  "recommendations": [
    {
      "category": "content",
      "priority": "high",
      "action": "Specific action to take (1-2 sentences)",
      "why": "Why this matters right now (1 sentence)",
      "effort": "low",
      "impact": "high",
      "timeframe": "this week"
    }
  ],
  "budgetAllocation": {
    "total": 500,
    "breakdown": [
      { "category": "Content tools (Gemini API)", "amount": 50, "description": "Daily AI content generation" },
      { "category": "DataForSEO", "amount": 20, "description": "Keyword research API" }
    ]
  }
}

Include 6-8 recommendations covering at least content, distribution, product, and gtm categories.
Be specific. Be bold. Think like a founder who NEEDS to hit this goal, not a consultant hedging their bets.`;

  const raw = await ask(prompt, 3000, 0.85);

  let parsed: {
    todaysFocus:       string;
    bottleneck:        string;
    weeklyMilestone:   string;
    contrarian:        string;
    recommendations:   StrategyRecommendation[];
    budgetAllocation:  BudgetAllocation;
  };

  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    // Fallback if Gemini returns malformed JSON
    parsed = {
      todaysFocus:      'Review GSC data and identify your top 3 quick-win posts. Focus on improving their titles and adding more depth to the content.',
      bottleneck:       'Not enough posts yet to build topical authority. Need 50+ posts to start seeing compound growth.',
      weeklyMilestone:  'Publish 5 posts and share 3 of them in relevant Reddit communities.',
      contrarian:       'Build a free YouTube earnings calculator tool — it will rank for high-volume transactional keywords and attract natural backlinks.',
      recommendations:  [],
      budgetAllocation: { total: MONTHLY_BUDGET, breakdown: [] },
    };
  }

  return {
    snapshot,
    todaysFocus:        parsed.todaysFocus,
    topRecommendations: parsed.recommendations ?? [],
    budgetAllocation:   parsed.budgetAllocation,
    contrarian:         parsed.contrarian,
    bottleneck:         parsed.bottleneck,
    weeklyMilestone:    parsed.weeklyMilestone,
  };
}
