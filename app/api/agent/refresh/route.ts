/**
 * app/api/agent/refresh/route.ts
 * ==============================
 * Weekly cron: refreshes stale/underperforming posts with updated content.
 * Runs every Sunday at 07:00 UTC.
 *
 * POST /api/agent/refresh
 *   Authorization: Bearer <CRON_SECRET>
 *
 * GET /api/agent/refresh?key=<CRON_SECRET>
 *   Returns list of refresh candidates (preview, no changes made).
 */

import { runContentRefresh } from '@/agent/refresh';

export const dynamic    = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Refresh] Starting content refresh run...');
    const result = await runContentRefresh();

    return Response.json({
      success:  true,
      refreshed: result.refreshed.length,
      skipped:   result.skipped,
      posts:     result.refreshed,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Refresh] Error:', error);
    return Response.json({ success: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ message: 'Use POST to trigger a refresh run' });
}
