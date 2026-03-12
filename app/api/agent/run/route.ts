/**
 * app/api/agent/run/route.ts
 * ==========================
 * Vercel Cron endpoint — called automatically at 08:00 UTC daily.
 * Can also be triggered manually via POST for testing.
 *
 * Security: Protected by CRON_SECRET env var.
 * Vercel automatically sends the secret in the Authorization header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAgent, runKeywordResearch } from '../../../../agent/index';

// Tell Vercel this route can run for up to 5 minutes (agent needs time)
export const maxDuration = 300;

// Force dynamic — prevents Next.js from statically rendering this at build time
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // ── Auth check ────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse action ──────────────────────────────────────────────────────────
  let action = 'generate'; // default
  try {
    const body = await request.json().catch(() => ({}));
    action = body.action ?? 'generate';
  } catch { /* ignore parse errors */ }

  console.log(`[Cron] Starting agent run — action: ${action}`);

  // ── Run agent ─────────────────────────────────────────────────────────────
  try {
    if (action === 'keywords') {
      const result = await runKeywordResearch();
      return NextResponse.json(result);
    }

    // Default: full content generation
    const result = await runAgent();
    return NextResponse.json(result);

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Cron] Unhandled error:', error);
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}

// Allow GET for quick health check (no auth needed)
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Agent endpoint is live. POST to trigger a run.',
    schedule: '08:00 UTC daily',
  });
}
