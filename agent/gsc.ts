/**
 * agent/gsc.ts
 * ============
 * Google Search Console API integration.
 * Uses service account JWT auth — no extra npm packages needed (uses built-in node:crypto).
 *
 * Required env vars (add to Vercel):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  = paste the full service account JSON as a single line
 *   GSC_SITE_URL                 = sc-domain:sandeeps.co  (or https://sandeeps.co/)
 *
 * Setup steps (one-time, ~5 minutes):
 *   1. console.cloud.google.com → Create project → APIs & Services → Enable "Google Search Console API"
 *   2. IAM → Service Accounts → Create account → Keys → Add Key → JSON → Download
 *   3. Search Console → Settings → Users & permissions → Add user
 *      (paste the service_account email from the JSON, set "Full" permission)
 *   4. Minify the JSON (remove newlines) and add as GOOGLE_SERVICE_ACCOUNT_JSON in Vercel
 *   5. Add GSC_SITE_URL = sc-domain:sandeeps.co
 *
 * If not set up, all functions return [] gracefully — no errors thrown.
 */

import { createSign } from 'node:crypto';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GSC_API   = 'https://www.googleapis.com/webmasters/v3/sites';

interface ServiceAccount {
  client_email: string;
  private_key:  string;
  project_id?:  string;
}

export interface GSCPageData {
  page:        string;   // full URL e.g. https://sandeeps.co/blog/how-to-monetize
  slug:        string;   // extracted slug e.g. how-to-monetize
  clicks:      number;
  impressions: number;
  ctr:         number;   // 0–1 decimal
  position:    number;   // average ranking position
  topQueries:  string[]; // top 5 queries that lead to this page
}

export interface GSCQueryData {
  query:       string;
  clicks:      number;
  impressions: number;
  ctr:         number;
  position:    number;
}

// ── JWT helpers (no extra deps — uses Node.js built-in crypto) ────────────────

function buildJWT(sa: ServiceAccount): string {
  const now    = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim  = Buffer.from(JSON.stringify({
    iss:   sa.client_email,
    sub:   sa.client_email,
    aud:   TOKEN_URL,
    scope: GSC_SCOPE,
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(sa.private_key, 'base64url');

  return `${header}.${claim}.${sig}`;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const jwt = buildJWT(sa);
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GSC auth error: ${data.error_description ?? JSON.stringify(data)}`);
  return data.access_token as string;
}

function getServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    console.error('[GSC] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON');
    return null;
  }
}

function getSiteUrl(): string {
  return process.env.GSC_SITE_URL ?? 'sc-domain:sandeeps.co';
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ── Core API calls ────────────────────────────────────────────────────────────

/**
 * Fetch page-level performance data for the past N days.
 * Returns clicks, impressions, CTR, avg position, and top 5 queries per page.
 */
export async function fetchPagePerformance(days = 28): Promise<GSCPageData[]> {
  const sa = getServiceAccount();
  if (!sa) {
    console.warn('[GSC] GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping GSC sync');
    return [];
  }

  const site  = getSiteUrl();
  const token = await getAccessToken(sa);

  const end   = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  // Step 1: get all pages
  const pageRes = await fetch(
    `${GSC_API}/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate:  formatDate(start),
        endDate:    formatDate(end),
        dimensions: ['page'],
        rowLimit:   100,
        dataState:  'final',
      }),
    }
  );

  if (!pageRes.ok) {
    console.error('[GSC] Page query failed:', await pageRes.text());
    return [];
  }

  const pageData = await pageRes.json();
  const results: GSCPageData[] = [];

  // Step 2: for each page, get its top queries (batched with small delay)
  for (const row of (pageData.rows ?? [])) {
    const url  = row.keys[0] as string;
    const slug = url
      .replace(/^https?:\/\/[^/]+\/blog\//, '')
      .replace(/\/$/, '') || 'home';

    let topQueries: string[] = [];
    try {
      const qRes = await fetch(
        `${GSC_API}/${encodeURIComponent(site)}/searchAnalytics/query`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startDate:  formatDate(start),
            endDate:    formatDate(end),
            dimensions: ['query'],
            dimensionFilterGroups: [{
              filters: [{ dimension: 'page', operator: 'equals', expression: url }],
            }],
            rowLimit:  5,
            dataState: 'final',
          }),
        }
      );
      const qData = await qRes.json();
      topQueries  = (qData.rows ?? []).map((r: { keys: string[] }) => r.keys[0]);
    } catch {
      // non-critical — continue without per-page queries
    }

    results.push({
      page:        url,
      slug,
      clicks:      row.clicks      ?? 0,
      impressions: row.impressions  ?? 0,
      ctr:         row.ctr          ?? 0,
      position:    row.position     ?? 0,
      topQueries,
    });
  }

  console.log(`[GSC] Fetched ${results.length} pages`);
  return results;
}

/**
 * Fetch the top search queries driving traffic to the whole site.
 */
export async function fetchTopQueries(days = 28, limit = 25): Promise<GSCQueryData[]> {
  const sa = getServiceAccount();
  if (!sa) return [];

  const site  = getSiteUrl();
  const token = await getAccessToken(sa);

  const end   = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const res = await fetch(
    `${GSC_API}/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate:  formatDate(start),
        endDate:    formatDate(end),
        dimensions: ['query'],
        rowLimit:   limit,
        dataState:  'final',
      }),
    }
  );

  if (!res.ok) return [];

  const data = await res.json();
  return (data.rows ?? []).map((r: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }) => ({
    query:       r.keys[0],
    clicks:      r.clicks,
    impressions: r.impressions,
    ctr:         r.ctr,
    position:    r.position,
  }));
}
