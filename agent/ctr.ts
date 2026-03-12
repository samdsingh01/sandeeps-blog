/**
 * agent/ctr.ts
 * ============
 * CTR (Click-Through Rate) Optimizer.
 *
 * Problem: A post ranks position 8 with 5,000 impressions but only 50 clicks (1% CTR).
 * Moving CTR from 1% → 4% means 150 MORE clicks per month from the same ranking.
 * That's often more impactful than writing 3 new posts.
 *
 * How it works:
 *   1. Reads "quick win" posts from page_performance (position 5-20, 50+ impressions, CTR < 4%)
 *   2. Generates 3 title variations + 2 meta description variations per post using Gemini
 *   3. Scores them using click psychology principles (numbers, power words, curiosity gaps)
 *   4. Updates the winning title + description in Supabase
 *
 * Runs daily as part of the /api/agent/sync cron (10 AM UTC).
 * Processes max 3 posts per run to control costs.
 */

import { getServiceClient }  from '../lib/supabase';
import { askFast, stripJsonFences } from './gemini';
import { logRun }            from './logger';

export interface CTROptimization {
  slug:           string;
  oldTitle:       string;
  newTitle:       string;
  oldDescription: string;
  newDescription: string;
  reason:         string;
}

const MAX_CTR_OPTS_PER_RUN = 3;
const CTR_THRESHOLD        = 0.04;   // optimize posts with CTR below 4%
const MIN_IMPRESSIONS      = 50;     // only optimize posts with enough impressions
const MIN_POSITION         = 5;      // only optimize posts that are actually indexed
const MAX_POSITION         = 25;     // beyond position 25, CTR isn't the problem

/**
 * Find quick-win posts and optimize their titles + meta descriptions.
 */
export async function runCTROptimizer(): Promise<CTROptimization[]> {
  const db          = getServiceClient();
  const optimized: CTROptimization[] = [];

  // ── 1. Get quick win candidates from page_performance ────────────────────
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Get 7-day aggregates for each page
  const { data: perfRows } = await db
    .from('page_performance')
    .select('slug, impressions, clicks, ctr, avg_position')
    .gte('date', weekAgo.toISOString().split('T')[0])
    .order('impressions', { ascending: false });

  if (!perfRows?.length) {
    console.log('[CTR] No performance data yet — skipping');
    return [];
  }

  // Aggregate by slug (sum clicks/impressions, avg position)
  const slugMap = new Map<string, { impressions: number; clicks: number; position: number }>();
  for (const row of perfRows) {
    const existing = slugMap.get(row.slug) ?? { impressions: 0, clicks: 0, position: 0 };
    slugMap.set(row.slug, {
      impressions: existing.impressions + row.impressions,
      clicks:      existing.clicks + row.clicks,
      position:    (existing.position + row.avg_position) / 2,
    });
  }

  // Filter: quick wins only
  const candidates = [...slugMap.entries()]
    .map(([slug, data]) => ({
      slug,
      impressions: data.impressions,
      clicks:      data.clicks,
      ctr:         data.impressions > 0 ? data.clicks / data.impressions : 0,
      position:    data.position,
    }))
    .filter((p) =>
      p.impressions >= MIN_IMPRESSIONS &&
      p.ctr < CTR_THRESHOLD &&
      p.position >= MIN_POSITION &&
      p.position <= MAX_POSITION
    )
    .sort((a, b) => b.impressions - a.impressions)  // highest impressions first
    .slice(0, MAX_CTR_OPTS_PER_RUN);

  if (candidates.length === 0) {
    console.log('[CTR] No CTR optimization candidates found');
    return [];
  }

  console.log(`[CTR] Optimizing ${candidates.length} posts`);

  // ── 2. For each candidate, get current title/desc and generate better ones ─
  for (const candidate of candidates) {
    const { data: post } = await db
      .from('posts')
      .select('title, description, seo_keywords, category')
      .eq('slug', candidate.slug)
      .single();

    if (!post) continue;

    // Skip if recently CTR-optimized (track via agent_logs)
    const { data: recentLog } = await db
      .from('agent_logs')
      .select('id')
      .eq('run_type', 'ctr_optimization')
      .eq('post_slug', candidate.slug)
      .gte('created_at', new Date(Date.now() - 14 * 864e5).toISOString())  // 14 days
      .limit(1);

    if (recentLog?.length) {
      console.log(`[CTR] Skipping ${candidate.slug} — optimized within last 14 days`);
      continue;
    }

    try {
      const optimization = await optimizeTitle(
        candidate.slug,
        post.title,
        post.description,
        post.seo_keywords ?? [],
        post.category,
        { impressions: candidate.impressions, ctr: candidate.ctr, position: candidate.position }
      );

      // Update in Supabase
      const { error } = await db.from('posts').update({
        title:       optimization.newTitle,
        description: optimization.newDescription,
        updated_at:  new Date().toISOString(),
      }).eq('slug', candidate.slug);

      if (error) throw new Error(`DB update failed: ${error.message}`);

      optimized.push(optimization);

      await logRun({
        runType:  'ctr_optimization',
        status:   'success',
        postSlug: candidate.slug,
        details:  {
          oldTitle:  optimization.oldTitle,
          newTitle:  optimization.newTitle,
          impressions: candidate.impressions,
          ctr:         (candidate.ctr * 100).toFixed(2) + '%',
          position:    candidate.position.toFixed(1),
        },
      });

      console.log(`[CTR] ✅ "${optimization.oldTitle}" → "${optimization.newTitle}"`);

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[CTR] Failed for ${candidate.slug}:`, error);
      await logRun({ runType: 'ctr_optimization', status: 'error', postSlug: candidate.slug, error });
    }
  }

  return optimized;
}

// ── Title + meta generation ───────────────────────────────────────────────────

async function optimizeTitle(
  slug:        string,
  currentTitle: string,
  currentDesc:  string,
  keywords:     string[],
  category:     string,
  stats:        { impressions: number; ctr: number; position: number },
): Promise<CTROptimization> {
  const prompt = `
You are an expert SEO copywriter optimizing blog post titles for maximum click-through rate.

CURRENT TITLE: "${currentTitle}"
CURRENT META DESCRIPTION: "${currentDesc}"
PRIMARY KEYWORDS: ${keywords.slice(0, 3).join(', ')}
CATEGORY: ${category}
CURRENT STATS: Position ${stats.position.toFixed(1)}, ${stats.impressions} impressions, ${(stats.ctr * 100).toFixed(1)}% CTR

The current title has low CTR — people see it in search results but don't click. Your job is to write a title so compelling they HAVE to click.

TITLE PRINCIPLES:
- Include the primary keyword near the start
- Use specific numbers where possible ("7 Ways" beats "Ways to")
- Create a curiosity gap or promise a clear outcome
- Use power words: "proven", "exactly", "complete", "ultimate", "simple", "fast"
- Keep it 50-60 characters
- Match search intent (informational posts = "How to...", "X Ways to...", "Complete Guide to...")

META DESCRIPTION PRINCIPLES:
- 150-160 characters
- Include the keyword naturally
- State the value proposition clearly
- End with a subtle CTA ("Learn exactly how →" or "Here's what works.")

Generate 3 title options and pick the BEST one.

Return ONLY this JSON:
{
  "titles": ["Title Option 1", "Title Option 2", "Title Option 3"],
  "bestTitle": "Title Option 2",
  "bestDescription": "The improved meta description here (150-160 chars).",
  "reason": "Why this title will get more clicks (1 sentence)"
}`;

  const raw    = await askFast(prompt, 800, 0.8);
  const parsed = JSON.parse(stripJsonFences(raw));

  return {
    slug,
    oldTitle:       currentTitle,
    newTitle:       parsed.bestTitle,
    oldDescription: currentDesc,
    newDescription: parsed.bestDescription,
    reason:         parsed.reason,
  };
}
