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
import { runAutoExec }    from '@/agent/autoexec';
import { rebuildMemory }  from '@/agent/memory';
import { runPatcher }     from '@/agent/patch';

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

    // 6. Rebuild agent memory — full refresh of covered topics, category balance,
    //    brand voice rules, quality lessons. Runs daily so content generation
    //    always has fresh context before each post.
    let memoryResult: { coveredTopics: number; needsMoreContent: string[] } | null = null;
    try {
      const mem = await rebuildMemory();
      memoryResult = {
        coveredTopics:    mem.coveredTopics.length,
        needsMoreContent: mem.needsMoreContent.slice(0, 3),
      };
      console.log(`[Sync] Memory rebuilt — ${mem.coveredTopics.length} topics tracked`);
    } catch (e) {
      console.warn('[Sync] Memory rebuild failed (non-fatal):', e);
    }

    // 7. Auto-execute today's strategic recommendations (non-blocking)
    //    This queues content keywords, logs distribution/technical tasks,
    //    and stores a daily snapshot for delta reporting in tomorrow's email.
    let autoExecResult: Awaited<ReturnType<typeof runAutoExec>> | null = null;
    try {
      autoExecResult = await runAutoExec();
      console.log(
        `[Sync] AutoExec — ${autoExecResult.keywordsQueued} keywords queued, ` +
        `${autoExecResult.tasksLogged} tasks logged`,
      );
    } catch (e) {
      console.warn('[Sync] AutoExec failed (non-fatal):', e);
    }

    // 8. Surgical quality patching — scan all published posts and fix the top 3
    //    most critical issues (bad title, wrong category, missing Quick Answer,
    //    short FAQs, thin sections, bad description). Runs daily so published
    //    posts are continuously improved without manual intervention.
    let patchResult: Awaited<ReturnType<typeof runPatcher>> | null = null;
    try {
      patchResult = await runPatcher(3);
      console.log(
        `[Sync] Patcher — scanned ${patchResult.scanned}, patched ${patchResult.patched}, ` +
        `${patchResult.totalFixes} fixes applied`,
      );
    } catch (e) {
      console.warn('[Sync] Patcher failed (non-fatal):', e);
    }

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
      memory: memoryResult,
      autoExec: autoExecResult
        ? {
            keywordsQueued: autoExecResult.keywordsQueued,
            tasksLogged:    autoExecResult.tasksLogged,
            focus:          autoExecResult.strategyFocus.slice(0, 80),
          }
        : null,
      qualityPatch: patchResult
        ? {
            scanned:    patchResult.scanned,
            patched:    patchResult.patched,
            totalFixes: patchResult.totalFixes,
            posts:      patchResult.results.map((r) => ({
              slug:    r.slug,
              applied: r.totalApplied,
              fixes:   r.patches.filter((p) => p.applied).map((p) => p.type),
            })),
          }
        : null,
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
