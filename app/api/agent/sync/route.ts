/**
 * app/api/agent/sync/route.ts
 * ===========================
 * Daily cron: pulls Google Search Console data → stores in Supabase → boosts
 * keyword priorities based on what's actually getting traffic.
 *
 * Schedule: 10:00 UTC (after the 8 AM content run + 9 AM email report)
 *
 * POST /api/agent/sync
 *   Authorization: Bearer <CRON_SECRET>
 *
 * GET  /api/agent/sync?key=<CRON_SECRET>
 *   Returns latest insights as JSON (for debugging / preview)
 */

import { fetchPagePerformance } from '@/agent/gsc';
import { storePagePerformance, getFeedbackInsights, boostKeywordsFromFeedback } from '@/agent/feedback';
import { runCTROptimizer } from '@/agent/ctr';
import { runABTitleTests } from '@/agent/abtitle';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  // Auth check
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Sync] Starting GSC data sync...');

    // 1. Pull fresh data from GSC
    const pages = await fetchPagePerformance(28);

    // 2. Persist to Supabase for historical trend tracking
    await storePagePerformance(pages);

    // 3. Analyse performance and boost keyword priorities
    const insights     = await getFeedbackInsights();
    const boostedCount = await boostKeywordsFromFeedback(insights);

    // 4. Run CTR optimizer on quick win posts
    const ctrResults = await runCTROptimizer();

    // 5. Evaluate A/B title tests (check results, swap if needed, pick winners)
    const abResults = await runABTitleTests().catch((e) => {
      console.warn('[Sync] A/B title test error (non-fatal):', e);
      return [];
    });
    const abSwaps   = abResults.filter((r) => r.action === 'swapped_to_b').length;
    const abWinners = abResults.filter((r) => r.winner).length;

    console.log('[Sync] ✅ Complete');

    return Response.json({
      success:         true,
      pagesSynced:     pages.length,
      hasGSCData:      insights.hasData,
      topPerformers:   insights.topPerformers.length,
      quickWins:       insights.quickWins.length,
      underperformers: insights.underperformers.length,
      keywordsBoosted: boostedCount,
      ctrOptimized:    ctrResults.length,
      abTitleTests:    { checked: abResults.length, swapped: abSwaps, winnersDecided: abWinners },
      hotCategories:   insights.hotCategories,
    });

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Sync] Error:', error);
    return Response.json({ success: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const insights = await getFeedbackInsights();
    return Response.json(insights);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
