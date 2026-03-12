/**
 * agent/feedback.ts
 * =================
 * The brain of the feedback loop.
 *
 * Reads GSC + Supabase data and produces actionable insights:
 *   - Which posts are top performers (position 1-5, getting clicks)
 *   - Which are quick wins (position 5-20, impressions but low CTR)
 *   - Which are underperformers (30+ days old, 0 clicks)
 *   - Which topic clusters drive the most traffic
 *   - What search queries people actually use to find the blog
 *
 * These insights feed into:
 *   1. agent/keywords.ts  — boost priority for keywords in hot topics
 *   2. agent/index.ts     — pass context to Gemini when writing content
 *   3. agent/report.ts    — SEO performance section in daily email
 */

import { fetchPagePerformance, fetchTopQueries } from './gsc';
import { getServiceClient }                       from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageInsight {
  slug:        string;
  title:       string;
  category:    string;
  clicks:      number;
  impressions: number;
  position:    number;       // avg position, rounded to 1dp
  topQueries:  string[];
  opportunity: 'top_performer' | 'quick_win' | 'underperformer' | 'new';
}

export interface FeedbackInsights {
  hasData:          boolean;        // false if GSC not configured yet
  topPerformers:    PageInsight[];  // high clicks, position 1-5
  quickWins:        PageInsight[];  // 50+ impressions, position 5-20 → push to page 1
  underperformers:  PageInsight[];  // 30+ days live, still 0 clicks
  hotCategories:    string[];       // categories that get most traffic
  hotTopics:        string[];       // specific topic patterns that work
  topSearchQueries: string[];       // actual queries people use
  agentPromptCtx:   string;         // formatted context string for Gemini prompts
}

// ── Main analysis function ────────────────────────────────────────────────────

export async function getFeedbackInsights(): Promise<FeedbackInsights> {
  const EMPTY: FeedbackInsights = {
    hasData: false, topPerformers: [], quickWins: [],
    underperformers: [], hotCategories: [], hotTopics: [],
    topSearchQueries: [], agentPromptCtx: '',
  };

  // Fetch GSC + post metadata in parallel
  const [gscPages, topQueriesData] = await Promise.allSettled([
    fetchPagePerformance(28),
    fetchTopQueries(28, 25),
  ]);

  const pages = gscPages.status === 'fulfilled' ? gscPages.value : [];
  const queries = topQueriesData.status === 'fulfilled' ? topQueriesData.value : [];

  if (pages.length === 0) {
    console.log('[Feedback] No GSC data — agent running without performance feedback');
    return EMPTY;
  }

  // Get post metadata from Supabase
  const db = getServiceClient();
  const { data: posts } = await db
    .from('posts')
    .select('slug, title, category, published_at')
    .eq('status', 'published');

  const postMap = new Map((posts ?? []).map((p: { slug: string; title: string; category: string; published_at: string }) => [p.slug, p]));
  const now = Date.now();

  // Classify each page
  const insights: PageInsight[] = pages.map((g) => {
    const post     = postMap.get(g.slug);
    const daysLive = post
      ? (now - new Date(post.published_at).getTime()) / 864e5
      : 0;

    let opportunity: PageInsight['opportunity'];
    if (g.clicks >= 10 && g.position <= 5)              opportunity = 'top_performer';
    else if (g.impressions >= 50 && g.position <= 20)    opportunity = 'quick_win';
    else if (daysLive >= 30 && g.clicks === 0)           opportunity = 'underperformer';
    else                                                  opportunity = 'new';

    return {
      slug:        g.slug,
      title:       post?.title    ?? g.slug,
      category:    post?.category ?? 'Unknown',
      clicks:      g.clicks,
      impressions: g.impressions,
      position:    Math.round(g.position * 10) / 10,
      topQueries:  g.topQueries,
      opportunity,
    };
  });

  // Group by opportunity type
  const topPerformers  = insights.filter((i) => i.opportunity === 'top_performer')
                                  .sort((a, b) => b.clicks - a.clicks)
                                  .slice(0, 5);
  const quickWins      = insights.filter((i) => i.opportunity === 'quick_win')
                                  .sort((a, b) => b.impressions - a.impressions)
                                  .slice(0, 10);
  const underperformers = insights.filter((i) => i.opportunity === 'underperformer')
                                   .slice(0, 5);

  // Hot categories: which categories get the most clicks
  const catClicks = new Map<string, number>();
  for (const i of insights) {
    catClicks.set(i.category, (catClicks.get(i.category) ?? 0) + i.clicks);
  }
  const hotCategories = [...catClicks.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat)
    .slice(0, 3);

  // Hot topics: aggregate all topQueries from performing pages
  const querySet = new Set<string>();
  for (const i of [...topPerformers, ...quickWins]) {
    i.topQueries.forEach((q) => querySet.add(q));
  }
  const hotTopics        = [...querySet].slice(0, 15);
  const topSearchQueries = queries.map((q) => q.query).slice(0, 20);

  // Build the context string Gemini will see when generating content
  const agentPromptCtx = buildAgentContext({
    topPerformers, quickWins, hotCategories, hotTopics, topSearchQueries,
  });

  console.log(`[Feedback] Insights: ${topPerformers.length} top, ${quickWins.length} quick wins, ${underperformers.length} underperformers`);

  return {
    hasData: true,
    topPerformers,
    quickWins,
    underperformers,
    hotCategories,
    hotTopics,
    topSearchQueries,
    agentPromptCtx,
  };
}

// ── Prompt context builder ────────────────────────────────────────────────────

function buildAgentContext(data: {
  topPerformers:    PageInsight[];
  quickWins:        PageInsight[];
  hotCategories:    string[];
  hotTopics:        string[];
  topSearchQueries: string[];
}): string {
  const lines: string[] = [
    '=== BLOG PERFORMANCE DATA (last 28 days from Google Search Console) ===',
  ];

  if (data.hotCategories.length > 0) {
    lines.push(`\nTop-traffic categories: ${data.hotCategories.join(' → ')}`);
    lines.push('Write in these categories when relevant — they have proven audience demand.');
  }

  if (data.topPerformers.length > 0) {
    lines.push('\nTop performing posts (high clicks, strong rankings):');
    data.topPerformers.forEach((p) =>
      lines.push(`  • "${p.title}" — position ${p.position}, ${p.clicks} clicks, queries: ${p.topQueries.slice(0, 3).join(', ')}`)
    );
    lines.push('Match the depth, tone, and structure of these posts.');
  }

  if (data.quickWins.length > 0) {
    lines.push('\nQuick win posts (ranking 5-20, high impressions but underperforming):');
    data.quickWins.slice(0, 4).forEach((p) =>
      lines.push(`  • "${p.title}" — position ${p.position}, ${p.impressions} impressions, queries: ${p.topQueries.slice(0, 2).join(', ')}`)
    );
    lines.push('For related topics, write more comprehensive content to beat these positions.');
  }

  if (data.topSearchQueries.length > 0) {
    lines.push(`\nTop search queries bringing visitors to the blog:`);
    lines.push(`  ${data.topSearchQueries.slice(0, 10).join(', ')}`);
    lines.push('Use these exact phrases naturally in the post where relevant.');
  }

  lines.push('\n=== END PERFORMANCE DATA ===\n');
  return lines.join('\n');
}

// ── Keyword priority booster ──────────────────────────────────────────────────

/**
 * After generating insights, boost the priority of unused keywords
 * that match hot topics and categories. This makes the agent write
 * more content in areas that are already getting traction.
 */
export async function boostKeywordsFromFeedback(insights: FeedbackInsights): Promise<number> {
  if (!insights.hasData || insights.hotTopics.length === 0) return 0;

  const db = getServiceClient();
  const { data: unusedKws } = await db
    .from('keywords')
    .select('id, keyword, priority')
    .eq('used', false)
    .lt('priority', 9);   // don't touch already-top-priority keywords

  if (!unusedKws?.length) return 0;

  const boosted: number[] = [];

  for (const kw of unusedKws) {
    const kwLower = kw.keyword.toLowerCase();

    const matchesTopic    = insights.hotTopics.some((t) =>
      kwLower.includes(t.toLowerCase().split(' ')[0]) ||
      t.toLowerCase().includes(kwLower.split(' ')[0])
    );
    const matchesCategory = insights.hotCategories.some((c) =>
      kwLower.includes(c.toLowerCase().split(' ')[0])
    );

    if (matchesTopic || matchesCategory) {
      boosted.push(kw.id);
    }
  }

  if (boosted.length > 0) {
    // Bulk update — boost priority by +2 (capped at 10)
    for (const id of boosted) {
      const current = unusedKws.find((k: { id: number; priority: number }) => k.id === id)?.priority ?? 5;
      await db.from('keywords')
        .update({ priority: Math.min(10, current + 2) })
        .eq('id', id);
    }
    console.log(`[Feedback] Boosted ${boosted.length} keyword priorities based on hot topics`);
  }

  return boosted.length;
}

// ── Supabase snapshot storage ─────────────────────────────────────────────────

/**
 * Store today's page performance snapshot. Used for historical trend tracking.
 * Table: page_performance (slug, date, impressions, clicks, ctr, avg_position, top_queries)
 */
export async function storePagePerformance(
  pages: Awaited<ReturnType<typeof fetchPagePerformance>>
): Promise<void> {
  if (pages.length === 0) return;

  const db   = getServiceClient();
  const date = new Date().toISOString().split('T')[0];

  const rows = pages.map((p) => ({
    slug:         p.slug,
    date,
    impressions:  p.impressions,
    clicks:       p.clicks,
    ctr:          p.ctr,
    avg_position: Math.round(p.position * 100) / 100,
    top_queries:  p.topQueries,
  }));

  const { error } = await db
    .from('page_performance')
    .upsert(rows, { onConflict: 'slug,date' });

  if (error) console.error('[Feedback] Store error:', error.message);
  else       console.log(`[Feedback] Stored performance for ${rows.length} pages`);
}
