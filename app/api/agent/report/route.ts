/**
 * app/api/agent/report/route.ts
 * ==============================
 * Daily report endpoint — called by Vercel Cron at 09:00 UTC (1 hour after agent runs).
 * Gathers stats from Supabase and sends a formatted email to Sandeep.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport, formatReportEmail } from '../../../../agent/report';
import { sendEmail } from '../../../../agent/email';

export const maxDuration = 60;
export const dynamic     = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Report] Building daily report...');

    // Build report data
    const report = await buildDailyReport();
    const { subject, html } = formatReportEmail(report);

    // Send email
    const to      = process.env.REPORT_EMAIL_TO ?? 'sandeep.singh@graphy.com';
    const success = await sendEmail({ to, subject, html });

    return NextResponse.json({
      success,
      reportDate:    report.date,
      newPosts:      report.newPostsToday.length,
      totalPosts:    report.totalPosts,
      agentRuns:     report.agentRunsToday.length,
      keywordsLeft:  report.keywordStats.unused,
      emailSentTo:   to,
    });

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Report] Error:', error);
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}

// GET — preview the report data without sending email
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const report = await buildDailyReport();
  return NextResponse.json(report);
}
