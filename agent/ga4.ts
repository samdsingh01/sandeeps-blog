/**
 * agent/ga4.ts
 * =============
 * Google Analytics 4 Data API integration.
 *
 * Uses the same service account as GSC (no new credentials needed).
 * Zero npm dependencies — JWT built with built-in node:crypto.
 *
 * Required env vars (add to Vercel):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  = (already set for GSC — reused here)
 *   GA4_PROPERTY_ID              = numeric property ID, e.g. 123456789
 *                                  (NOT the G-XXXXXXXX measurement ID)
 *
 * ──────────────────────────────────────────────────────────────────
 * ONE-TIME SETUP (takes ~5 minutes):
 * ──────────────────────────────────────────────────────────────────
 * 1. Google Cloud Console → APIs & Services → Enable:
 *    "Google Analytics Data API" (search for it, click Enable)
 *
 * 2. Get your GA4 Property ID:
 *    GA4 → Admin (gear icon) → Property column → Property details
 *    Copy the "PROPERTY ID" (just the number, e.g. 123456789)
 *
 * 3. Give service account access to GA4:
 *    GA4 → Admin → Property column → Property access management
 *    → "+" → Add users → paste the service_account_email from your JSON
 *    → Role: "Viewer" → Add
 *
 * 4. Add to Vercel environment variables:
 *    GA4_PROPERTY_ID = 123456789  (your numeric ID)
 *
 * ──────────────────────────────────────────────────────────────────
 * What data this gives the agent:
 *   - Traffic by channel: organic search, direct, social, referral
 *   - Page-level: sessions, engaged sessions, engagement rate per post
 *   - CTA click events: which posts are actually converting to Graphy clicks
 *   - Top pages by sessions (what people read most)
 *   - New vs returning users ratio
 *   - Device & country breakdown
 * ──────────────────────────────────────────────────────────────────
 */

import { createSign } from 'node:crypto';

const GA4_SCOPE   = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const GA4_API_URL = 'https://analyticsdata.googleapis.com/v1beta';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key:  string;
}

export interface GA4PageData {
  pagePath:         string;   // e.g. /blog/how-to-monetize
  slug:             string;   // extracted slug
  sessions:         number;
  engagedSessions:  number;
  engagementRate:   number;   // 0–1 decimal (engaged / total)
  avgEngagementSec: number;   // average seconds on page
  newUsers:         number;
  screenPageViews:  number;
}

export interface GA4TrafficSource {
  channel:    string;   // 'Organic Search' | 'Direct' | 'Referral' | 'Social' | etc.
  sessions:   number;
  percentage: number;
}

export interface GA4EventData {
  eventName:  string;
  eventCount: number;
  label?:     string;  // for cta_click events: which button
}

export interface GA4SiteMetrics {
  period:         string;
  totalSessions:  number;
  totalUsers:     number;
  newUsers:       number;
  returningUsers: number;
  avgEngagementSec: number;
  channels:       GA4TrafficSource[];
  topPages:       GA4PageData[];
  ctaClicks:      GA4EventData[];   // Graphy CTA conversions
  topCountries:   Array<{ country: string; sessions: number }>;
  deviceSplit:    Array<{ device: string; sessions: number }>;
}

// ── JWT + Token ──────────────────────────────────────────────────────────────

function buildJWT(sa: ServiceAccount, scope: string): string {
  const now   = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim  = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(sa.private_key, 'base64url');

  return `${header}.${claim}.${sig}`;
}

let _ga4Token:   string | null = null;
let _tokenExpAt: number        = 0;

async function getAccessToken(): Promise<string | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || !process.env.GA4_PROPERTY_ID) return null;

  if (_ga4Token && Date.now() < _tokenExpAt) return _ga4Token;

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw);
  } catch {
    console.error('[GA4] Could not parse GOOGLE_SERVICE_ACCOUNT_JSON');
    return null;
  }

  const jwt = buildJWT(sa, GA4_SCOPE);

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[GA4] Token error:', err.slice(0, 200));
    return null;
  }

  const { access_token, expires_in } = await res.json();
  _ga4Token   = access_token;
  _tokenExpAt = Date.now() + (expires_in - 60) * 1000;
  return access_token;
}

// ── Core API helper ───────────────────────────────────────────────────────────

async function runReport(
  propertyId: string,
  token:      string,
  body:       object,
): Promise<any> {
  const res = await fetch(`${GA4_API_URL}/properties/${propertyId}:runReport`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[GA4] Report error:', err.slice(0, 300));
    return null;
  }

  return res.json();
}

// ── Date helper ───────────────────────────────────────────────────────────────

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];  // YYYY-MM-DD
}

function rowVal(row: any, index: number): string {
  return row?.dimensionValues?.[index]?.value ?? '';
}
function metricVal(row: any, index: number): number {
  return parseFloat(row?.metricValues?.[index]?.value ?? '0') || 0;
}
function slugFromPath(path: string): string {
  return path.replace('/blog/', '').replace(/^\//, '').replace(/\/$/, '') || path;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch comprehensive GA4 site metrics for the last N days.
 * Returns null if GA4 not configured.
 */
export async function fetchGA4Metrics(days: number = 28): Promise<GA4SiteMetrics | null> {
  const token      = await getAccessToken();
  const propertyId = process.env.GA4_PROPERTY_ID;

  if (!token || !propertyId) {
    console.log('[GA4] Not configured — skipping GA4 metrics');
    return null;
  }

  const dateRange = { startDate: daysAgoStr(days), endDate: 'yesterday' };

  // Run all reports in parallel
  const [pageReport, channelReport, eventReport, countryReport, deviceReport, summaryReport] =
    await Promise.allSettled([
      // 1. Per-page engagement metrics
      runReport(propertyId, token, {
        dateRanges: [dateRange],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'BEGINS_WITH', value: '/blog/' },
          },
        },
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 25,
      }),

      // 2. Traffic by channel
      runReport(propertyId, token, {
        dateRanges: [dateRange],
        dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
        metrics:    [{ name: 'sessions' }],
        orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
      }),

      // 3. CTA click events
      runReport(propertyId, token, {
        dateRanges: [dateRange],
        dimensions: [{ name: 'eventName' }, { name: 'customEvent:event_label' }],
        metrics:    [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'EXACT', value: 'cta_click' },
          },
        },
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 20,
      }),

      // 4. Top countries
      runReport(propertyId, token, {
        dateRanges: [dateRange],
        dimensions: [{ name: 'country' }],
        metrics:    [{ name: 'sessions' }],
        orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),

      // 5. Device category
      runReport(propertyId, token, {
        dateRanges: [dateRange],
        dimensions: [{ name: 'deviceCategory' }],
        metrics:    [{ name: 'sessions' }],
        orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
      }),

      // 6. Site-wide summary
      runReport(propertyId, token, {
        dateRanges: [dateRange],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'averageSessionDuration' },
        ],
      }),
    ]);

  // Parse pages
  const pageData: GA4PageData[] = [];
  if (pageReport.status === 'fulfilled' && pageReport.value?.rows) {
    for (const row of pageReport.value.rows) {
      const pagePath = rowVal(row, 0);
      pageData.push({
        pagePath,
        slug:             slugFromPath(pagePath),
        sessions:         metricVal(row, 0),
        engagedSessions:  metricVal(row, 1),
        engagementRate:   metricVal(row, 2),
        avgEngagementSec: metricVal(row, 3),
        newUsers:         metricVal(row, 4),
        screenPageViews:  metricVal(row, 5),
      });
    }
  }

  // Parse channels
  const totalSessionsForPct = pageData.reduce((s, p) => s + p.sessions, 0) || 1;
  const channels: GA4TrafficSource[] = [];
  let totalSessions = 0;

  if (channelReport.status === 'fulfilled' && channelReport.value?.rows) {
    for (const row of channelReport.value.rows) {
      const sessions = metricVal(row, 0);
      totalSessions += sessions;
      channels.push({
        channel:    rowVal(row, 0) || 'Unknown',
        sessions,
        percentage: 0, // calculated below
      });
    }
    const total = totalSessions || 1;
    channels.forEach((c) => { c.percentage = Math.round((c.sessions / total) * 100); });
  }

  // Parse CTA events
  const ctaClicks: GA4EventData[] = [];
  if (eventReport.status === 'fulfilled' && eventReport.value?.rows) {
    for (const row of eventReport.value.rows) {
      ctaClicks.push({
        eventName:  rowVal(row, 0),
        label:      rowVal(row, 1) || undefined,
        eventCount: metricVal(row, 0),
      });
    }
  }

  // Parse countries
  const topCountries: Array<{ country: string; sessions: number }> = [];
  if (countryReport.status === 'fulfilled' && countryReport.value?.rows) {
    for (const row of countryReport.value.rows) {
      topCountries.push({ country: rowVal(row, 0), sessions: metricVal(row, 0) });
    }
  }

  // Parse devices
  const deviceSplit: Array<{ device: string; sessions: number }> = [];
  if (deviceReport.status === 'fulfilled' && deviceReport.value?.rows) {
    for (const row of deviceReport.value.rows) {
      deviceSplit.push({ device: rowVal(row, 0), sessions: metricVal(row, 0) });
    }
  }

  // Parse summary
  let totalUsers = 0, newUsers = 0, avgEngagementSec = 0;
  if (summaryReport.status === 'fulfilled' && summaryReport.value?.rows?.[0]) {
    const row = summaryReport.value.rows[0];
    totalSessions    = metricVal(row, 0);
    totalUsers       = metricVal(row, 1);
    newUsers         = metricVal(row, 2);
    avgEngagementSec = metricVal(row, 3);
  }

  const returningUsers = Math.max(0, totalUsers - newUsers);

  console.log(`[GA4] Fetched: ${totalSessions} sessions, ${pageData.length} pages, ${ctaClicks.length} CTA events`);

  return {
    period:          `Last ${days} days`,
    totalSessions,
    totalUsers,
    newUsers,
    returningUsers,
    avgEngagementSec,
    channels,
    topPages:        pageData.slice(0, 15),
    ctaClicks,
    topCountries:    topCountries.slice(0, 8),
    deviceSplit,
  };
}

/**
 * Get per-page GA4 data for a specific slug.
 * Used by the feedback loop to enrich page insights.
 */
export async function fetchPageGA4Data(slug: string, days: number = 28): Promise<GA4PageData | null> {
  const token      = await getAccessToken();
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!token || !propertyId) return null;

  const result = await runReport(propertyId, token, {
    dateRanges: [{ startDate: daysAgoStr(days), endDate: 'yesterday' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'sessions' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePath',
        stringFilter: { matchType: 'EXACT', value: `/blog/${slug}` },
      },
    },
  });

  const row = result?.rows?.[0];
  if (!row) return null;

  return {
    pagePath:         `/blog/${slug}`,
    slug,
    sessions:         metricVal(row, 0),
    engagedSessions:  metricVal(row, 1),
    engagementRate:   metricVal(row, 2),
    avgEngagementSec: metricVal(row, 3),
    newUsers:         metricVal(row, 4),
    screenPageViews:  metricVal(row, 5),
  };
}

/**
 * Format GA4 metrics as a concise summary string for Gemini prompts.
 * Tells the agent which content is actually engaging readers.
 */
export function buildGA4PromptContext(metrics: GA4SiteMetrics): string {
  const lines: string[] = ['=== GA4 ANALYTICS (real user behaviour) ==='];

  // Traffic sources
  const organicChannel = metrics.channels.find((c) => c.channel.toLowerCase().includes('organic'));
  const directChannel  = metrics.channels.find((c) => c.channel.toLowerCase() === 'direct');
  if (organicChannel) lines.push(`Organic search: ${organicChannel.percentage}% of sessions (${organicChannel.sessions} sessions)`);
  if (directChannel)  lines.push(`Direct traffic: ${directChannel.percentage}% (${directChannel.sessions} sessions)`);

  // Engagement
  const avgSec = Math.round(metrics.avgEngagementSec);
  lines.push(`Avg engagement: ${avgSec}s per session — ${avgSec > 120 ? 'readers are engaged ✓' : 'readers are bouncing quickly — content needs stronger hooks and value delivery'}`);
  lines.push(`New vs returning: ${metrics.newUsers} new users, ${metrics.returningUsers} returning`);

  // Top performing pages by actual engagement (not just GSC position)
  const topEngaged = [...metrics.topPages]
    .filter((p) => p.sessions > 5)
    .sort((a, b) => b.avgEngagementSec - a.avgEngagementSec)
    .slice(0, 5);

  if (topEngaged.length > 0) {
    lines.push('\nMost engaging posts (by time on page):');
    topEngaged.forEach((p) => {
      lines.push(`  • /blog/${p.slug} — ${Math.round(p.avgEngagementSec)}s avg, ${Math.round(p.engagementRate * 100)}% engagement rate, ${p.sessions} sessions`);
    });
    lines.push('Write similar content in depth and structure to these high-engagement posts.');
  }

  // CTA performance
  const totalCTAs = metrics.ctaClicks.reduce((s, e) => s + e.eventCount, 0);
  if (totalCTAs > 0) {
    lines.push(`\nGraphy CTA clicks: ${totalCTAs} total`);
    metrics.ctaClicks.slice(0, 5).forEach((e) => {
      if (e.label) lines.push(`  • ${e.label}: ${e.eventCount} clicks`);
    });
  } else {
    lines.push('\nGraphy CTA clicks: 0 — CTAs are not converting. Make offers more specific and benefit-driven.');
  }

  lines.push('=== END GA4 DATA ===');
  return lines.join('\n');
}
