/**
 * app/api/agent/report/route.ts
 * ==============================
 * Daily report endpoint — called by Vercel Cron at 09:00 UTC (1 hour after agent runs).
 * Gathers stats from Supabase and sends a formatted email to Sandeep.
 *
 * NOTE: Vercel Cron always sends GET requests, so the GET handler is the
 * one that actually sends the email. POST is kept for manual triggers.
 *
 * GET  /api/agent/report              → sends email (used by Vercel Cron)
 * GET  /api/agent/report?preview=true → returns JSON only, no email
 * POST /api/agent/report              → sends email (manual trigger)
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport, formatReportEmail } from '../../../../agent/report';
import { sendEmail } from '../../../../agent/email';

export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

function isAuthorised(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const keyParam   = new URL(request.url).searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET?.trim();
  return !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    keyParam    === cronSecret;
}

async function runReport(sendMail: boolean) {
  console.log(`[Report] Building daily report (sendMail=${sendMail})...`);

  const report               = await buildDailyReport();
  const { subject, html }    = formatReportEmail(report);
  const to                   = process.env.REPORT_EMAIL_TO ?? 'sandeep.singh@graphy.com';

  let emailSent = false;
  if (sendMail) {
    emailSent = await sendEmail({ to, subject, html });
    console.log(`[Report] Email ${emailSent ? 'sent ✅' : 'failed ❌'} → ${to}`);
  }

  return NextResponse.json({
    success:      !sendMail || emailSent,
    reportDate:   report.date,
    newPosts:     report.newPostsToday.length,
    totalPosts:   report.totalPosts,
    agentRuns:    report.agentRunsToday.length,
    keywordsLeft: report.keywordStats.unused,
    emailSentTo:  sendMail ? to : null,
    emailSent,
    preview:      !sendMail,
  });
}

// GET — used by Vercel Cron (Vercel always sends GET for cron jobs).
// Pass ?preview=true to get JSON without sending email.
export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const preview = new URL(request.url).searchParams.get('preview') === 'true';

  try {
    return await runReport(!preview); // send email unless ?preview=true
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Report] Error:', error);
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}

// POST — manual trigger (curl, Postman, etc.)
export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return await runReport(true);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Report] Error:', error);
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
