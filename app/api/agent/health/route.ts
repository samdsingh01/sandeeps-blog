/**
 * app/api/agent/health/route.ts
 * ==============================
 * Public health check — verifies every integration is connected and working.
 * No auth required (returns no sensitive data).
 *
 * GET /api/agent/health
 */

import { NextResponse }    from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // ── 1. Supabase ───────────────────────────────────────────────────────────
  try {
    const db = getServiceClient();
    const { count, error } = await db
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published');

    checks.supabase = error
      ? { ok: false, detail: error.message }
      : { ok: true,  detail: `${count ?? 0} published posts` };
  } catch (e) {
    checks.supabase = { ok: false, detail: String(e) };
  }

  // ── 2. Gemini API ─────────────────────────────────────────────────────────
  checks.gemini = process.env.GEMINI_API_KEY
    ? { ok: true,  detail: 'API key set' }
    : { ok: false, detail: 'GEMINI_API_KEY not set' };

  // ── 3. Google Search Console ─────────────────────────────────────────────
  checks.google_search_console = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? { ok: true,  detail: 'Service account JSON set' }
    : { ok: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' };

  // ── 4. Google Analytics 4 ────────────────────────────────────────────────
  const hasServiceAccount = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const hasPropertyId     = !!process.env.GA4_PROPERTY_ID;

  if (!hasServiceAccount) {
    checks.ga4 = { ok: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' };
  } else if (!hasPropertyId) {
    checks.ga4 = { ok: false, detail: 'GA4_PROPERTY_ID not set — add it in Vercel env vars' };
  } else {
    // Try a real GA4 API call
    try {
      const { fetchGA4Metrics } = await import('@/agent/ga4');
      const result = await fetchGA4Metrics(7);
      checks.ga4 = result
        ? { ok: true,  detail: `Connected — ${result.totalSessions} sessions (last 7d), ${result.channels.find(c => c.channel.toLowerCase().includes('organic'))?.percentage ?? 0}% organic` }
        : { ok: false, detail: 'API returned null — check property ID and service account permissions' };
    } catch (e) {
      checks.ga4 = { ok: false, detail: String(e).slice(0, 150) };
    }
  }

  // ── 5. Resend (email) ─────────────────────────────────────────────────────
  checks.resend = process.env.RESEND_API_KEY
    ? { ok: true,  detail: 'API key set — daily reports and newsletter active' }
    : { ok: false, detail: 'RESEND_API_KEY not set — email reports disabled' };

  // ── 6. Cron secret ────────────────────────────────────────────────────────
  checks.cron_secret = process.env.CRON_SECRET
    ? { ok: true,  detail: 'Set — cron endpoints protected' }
    : { ok: false, detail: 'CRON_SECRET not set — cron endpoints unprotected' };

  // ── 7. Keyword pipeline ───────────────────────────────────────────────────
  try {
    const db = getServiceClient();
    const { count: total } = await db
      .from('keywords')
      .select('*', { count: 'exact', head: true });

    const { count: unused } = await db
      .from('keywords')
      .select('*', { count: 'exact', head: true })
      .eq('used', false);

    checks.keywords = {
      ok:     (unused ?? 0) > 0,
      detail: `${unused ?? 0} unused / ${total ?? 0} total — ${(unused ?? 0) > 30 ? 'healthy' : (unused ?? 0) > 10 ? 'running low' : '⚠️ needs refill'}`,
    };
  } catch (e) {
    checks.keywords = { ok: false, detail: String(e) };
  }

  // ── 8. Subscribers ────────────────────────────────────────────────────────
  try {
    const db = getServiceClient();
    const { count } = await db
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    checks.newsletter = { ok: true, detail: `${count ?? 0} active subscribers` };
  } catch {
    checks.newsletter = { ok: false, detail: 'subscribers table missing — run migration_newsletter.sql' };
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total   = Object.keys(checks).length;
  const passing = Object.values(checks).filter((c) => c.ok).length;
  const failing = total - passing;

  const overall = failing === 0 ? '✅ All systems operational' :
                  failing <= 2  ? '⚠️ Mostly operational — minor issues' :
                                  '❌ Multiple integrations need attention';

  return NextResponse.json({
    status:  overall,
    passing,
    failing,
    checks,
    ts: new Date().toISOString(),
  }, {
    status: failing === 0 ? 200 : 207,
  });
}
