/**
 * utm.ts — UTM tracking utility for Sandeep's Blog
 * =====================================================
 * Persists UTM parameters in cookies and automatically appends them
 * to ALL outbound Graphy.com links. This ensures every visitor's
 * traffic source is tracked through to Graphy.com's analytics.
 *
 * How it works:
 *   1. On every page load, reads UTM params from the URL
 *   2. Saves them to a cookie (30-day expiry)
 *   3. The <GraphyLink> component automatically reads the cookie
 *      and appends the UTMs to the Graphy.com destination URL
 *
 * UTM params tracked:
 *   utm_source, utm_medium, utm_campaign, utm_content, utm_term
 *
 * Cookie name: cl_utm (sandeeps-blog UTM)
 * Cookie expiry: 30 days (resets on each new visit with UTMs)
 */

export const UTM_COOKIE_NAME = 'cl_utm';
export const UTM_COOKIE_DAYS = 30;

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

/** Default UTMs applied when no override is present */
export const DEFAULT_UTM: UTMParams = {
  utm_source: 'sandeeps-blog',
  utm_medium: 'blog',
  utm_campaign: 'organic',
};

// ─── Cookie helpers (client-side only) ───────────────────────────────────────

function setCookie(name: string, value: string, days: number): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

// ─── Core UTM functions ───────────────────────────────────────────────────────

/**
 * Reads UTM parameters from the current URL.
 * Returns only the keys that are actually present.
 */
export function getUTMFromURL(): UTMParams {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const keys: (keyof UTMParams)[] = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  ];
  const utm: UTMParams = {};
  for (const key of keys) {
    const val = params.get(key);
    if (val) utm[key] = val;
  }
  return utm;
}

/**
 * Saves UTM params to cookie. Called on every page load.
 * Only overwrites cookie if new UTM params are present in the URL.
 */
export function saveUTMToCookie(): void {
  const utm = getUTMFromURL();
  if (Object.keys(utm).length > 0) {
    setCookie(UTM_COOKIE_NAME, JSON.stringify(utm), UTM_COOKIE_DAYS);
  }
}

/**
 * Reads persisted UTM params from cookie.
 * Falls back to DEFAULT_UTM if no cookie exists.
 */
export function getStoredUTM(): UTMParams {
  const raw = getCookie(UTM_COOKIE_NAME);
  if (raw) {
    try {
      return JSON.parse(raw) as UTMParams;
    } catch {
      return DEFAULT_UTM;
    }
  }
  return DEFAULT_UTM;
}

/**
 * Builds a Graphy.com URL with UTM parameters attached.
 *
 * @param path - The Graphy.com path, e.g. "/" or "/pricing"
 * @param overrideUTM - Optional UTMs to override cookie/defaults (e.g. for specific CTAs)
 * @returns Full URL like "https://graphy.com/?utm_source=sandeeps-blog&..."
 *
 * @example
 *   buildGraphyURL('/')                        → graphy.com/?utm_source=sandeeps-blog&utm_medium=blog...
 *   buildGraphyURL('/pricing', {utm_content: 'hero-cta'})  → includes content override
 */
export function buildGraphyURL(
  path: string = '/',
  overrideUTM: Partial<UTMParams> = {}
): string {
  const stored = getStoredUTM();
  const merged: UTMParams = { ...DEFAULT_UTM, ...stored, ...overrideUTM };

  const base = `https://graphy.com${path.startsWith('/') ? path : `/${path}`}`;
  const params = new URLSearchParams();

  const keys: (keyof UTMParams)[] = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  ];
  for (const key of keys) {
    const val = merged[key];
    if (val) params.set(key, val);
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Returns a UTM-tagged Graphy URL for use in server components (no cookie access).
 * Uses DEFAULT_UTM only. Override at call site as needed.
 */
export function buildGraphyURLStatic(
  path: string = '/',
  overrideUTM: Partial<UTMParams> = {}
): string {
  const merged: UTMParams = { ...DEFAULT_UTM, ...overrideUTM };
  const base = `https://graphy.com${path.startsWith('/') ? path : `/${path}`}`;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(merged)) {
    if (val) params.set(key, val as string);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
