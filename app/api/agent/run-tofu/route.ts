/**
 * app/api/agent/run-tofu/route.ts
 * ================================
 * Dedicated TOFU post generation endpoint — runs separately from BOFU
 * so each gets a full 5-minute Vercel window without competing.
 *
 * Schedule: 12:00 UTC daily (defined in vercel.json)
 * Manual:   POST /api/agent/run-tofu?key=CRON_SECRET
 *           GET  /api/agent/run-tofu?key=CRON_SECRET  (Vercel Cron uses GET)
 *
 * Why separate from /api/agent/run?
 *   BOFU post generation (2× Gemini calls + quality check + retry + images)
 *   takes 3-4 minutes. Adding TOFU in the same request hits the 5-minute
 *   maxDuration limit — TOFU silently times out and is never written.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTofuOnly }               from '../../../../agent/index';

export const maxDuration = 300; // 5 minutes — TOFU needs Gemini + images
export const dynamic     = 'force-dynamic';

function isAuthorised(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const keyParam   = new URL(request.url).searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET?.trim();

  return (
    !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    keyParam   === cronSecret
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log('[Cron/TOFU] Starting TOFU post run via GET');
  try {
    const result = await runTofuOnly();
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Cron/TOFU] Unhandled error:', error);
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log('[Cron/TOFU] Starting TOFU post run via POST');
  try {
    const result = await runTofuOnly();
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Cron/TOFU] Unhandled error:', error);
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
