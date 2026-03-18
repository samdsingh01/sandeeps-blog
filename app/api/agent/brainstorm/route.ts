/**
 * app/api/agent/brainstorm/route.ts
 * ==================================
 * Weekly intelligence briefing: content analysis, experiment planning, and distribution queue.
 * Runs every Sunday at 06:00 UTC (before content refresh).
 *
 * POST /api/agent/brainstorm
 *   Authorization: Bearer <CRON_SECRET>
 *   Triggers a full brainstorm run.
 *
 * GET /api/agent/brainstorm
 *   No auth: Returns a simple health check.
 *   ?key=<CRON_SECRET>: Returns status summary of brainstorm.
 */

import { runWeeklyBrainstorm } from '@/agent/brainstorm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;

  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Brainstorm API] Starting weekly brainstorm run...');
    const result = await runWeeklyBrainstorm();

    return Response.json({
      success: true,
      weekOf: result.weekOf,
      experiment: result.experiment.format,
      newKeywords: result.newKeywords.length,
      distributionQueueItems: result.distributionQueue.length,
      emailSent: result.emailSent,
      reflectionSummary: result.reflectionSummary,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Brainstorm API] Error:', error);
    return Response.json({ success: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Health check (no auth required)
  if (!searchParams.has('key')) {
    return Response.json({
      status: 'ok',
      service: 'weekly_brainstorm',
      description: 'POST with CRON_SECRET to trigger brainstorm',
    });
  }

  // Status check (requires auth)
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return Response.json({
    message: 'Use POST to trigger a brainstorm run',
    endpoint: 'POST /api/agent/brainstorm',
    requiresAuth: true,
  });
}
