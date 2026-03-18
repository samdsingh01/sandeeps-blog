/**
 * agent/dataforseo.ts
 * ===================
 * DataForSEO integration — real search volume, CPC, and competition data.
 * Sign up at dataforseo.com for free $1 credit (~2000 keyword lookups).
 *
 * Set these env vars in Vercel:
 *   DATAFORSEO_LOGIN    = your DataForSEO login email
 *   DATAFORSEO_PASSWORD = your DataForSEO API password
 */

const BASE_URL = 'https://api.dataforseo.com/v3';

export interface KeywordMetrics {
  keyword:       string;
  searchVolume:  number;   // monthly search volume
  cpc:           number;   // cost per click in USD
  competition:   number;   // 0-1 (0 = low, 1 = high)
  difficulty:    string;   // 'low' | 'medium' | 'high'
  priority:      number;   // 1-10 calculated score
}

function getAuth(): string | null {
  const login    = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return Buffer.from(`${login}:${password}`).toString('base64');
}

/**
 * Get real search volume + metrics for a list of keywords.
 * Uses DataForSEO's Keywords Data API (Google Search Volume).
 * Cost: ~$0.0005 per keyword.
 */
export async function getKeywordMetrics(keywords: string[]): Promise<KeywordMetrics[]> {
  const auth = getAuth();
  if (!auth) {
    console.warn('[DataForSEO] Credentials not set — skipping volume check');
    return keywords.map(fallbackMetrics);
  }

  try {
    const res = await fetch(`${BASE_URL}/keywords_data/google_ads/search_volume/live`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify([{
        keywords,
        location_code: 2840,  // United States
        language_code: 'en',
      }]),
    });

    if (!res.ok) {
      console.error('[DataForSEO] API error:', res.status, await res.text());
      return keywords.map(fallbackMetrics);
    }

    const json = await res.json();
    const items = json?.tasks?.[0]?.result ?? [];

    return items.map((item: any): KeywordMetrics => {
      const vol  = item.search_volume ?? 0;
      const comp = item.competition   ?? 0.5;
      const cpc  = item.cpc           ?? 0;

      return {
        keyword:      item.keyword,
        searchVolume: vol,
        cpc,
        competition:  comp,
        difficulty:   comp < 0.33 ? 'low' : comp < 0.66 ? 'medium' : 'high',
        priority:     calcPriority(vol, comp, cpc),
      };
    });
  } catch (err) {
    console.error('[DataForSEO] Request failed:', err);
    return keywords.map(fallbackMetrics);
  }
}

/**
 * Priority score (1-10) based on search volume, competition, and CPC.
 * High volume + low competition + decent CPC = highest priority.
 */
function calcPriority(volume: number, competition: number, cpc: number): number {
  // Volume score: 0-4 points
  const volScore =
    volume > 10000 ? 4 :
    volume > 5000  ? 3 :
    volume > 1000  ? 2 :
    volume > 100   ? 1 : 0;

  // Competition score: 0-3 points (lower comp = higher score)
  const compScore = Math.round((1 - competition) * 3);

  // CPC score: 0-3 points (higher CPC = more commercial value)
  const cpcScore =
    cpc > 3 ? 3 :
    cpc > 1 ? 2 :
    cpc > 0 ? 1 : 0;

  return Math.min(10, Math.max(1, volScore + compScore + cpcScore));
}

/**
 * Fallback when DataForSEO is not configured — returns neutral metrics.
 */
function fallbackMetrics(keyword: string): KeywordMetrics {
  return {
    keyword,
    searchVolume: 0,
    cpc:          0,
    competition:  0.5,
    difficulty:   'medium',
    priority:     5,
  };
}

/**
 * SERP result from Google organic search
 */
export interface SerpResult {
  rank:        number;
  url:         string;
  title:       string;
  description: string;
  domain:      string;
}

/**
 * Get top 10 organic search results for a keyword from DataForSEO SERP API.
 * Returns empty array if DataForSEO is not configured or on any error.
 */
export async function getSerpResults(keyword: string, limit: number = 10): Promise<SerpResult[]> {
  const auth = getAuth();
  if (!auth) {
    console.warn('[DataForSEO] Credentials not set — skipping SERP check');
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(`${BASE_URL}/serp/google/organic/live/regular`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify([{
        keyword,
        location_code: 2840,
        language_code: 'en',
        device:        'desktop',
        depth:         10,
      }]),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error('[DataForSEO] SERP API error:', res.status, await res.text());
      return [];
    }

    const json = await res.json();
    const items = json?.tasks?.[0]?.result?.[0]?.items ?? [];

    const results: SerpResult[] = [];
    for (const item of items) {
      if (item.type !== 'organic') continue;

      results.push({
        rank:        item.rank ?? 0,
        url:         item.url ?? '',
        title:       item.title ?? '',
        description: item.description ?? '',
        domain:      item.domain ?? '',
      });

      if (results.length >= limit) break;
    }

    return results;
  } catch (err) {
    console.error('[DataForSEO] SERP request failed:', err);
    return [];
  }
}

/**
 * Get unused keywords from the keywords table, ordered by search volume and priority.
 * Returns top `limit` keywords with search_volume and priority.
 */
export async function getTopUnusedKeywords(
  db: any,
  limit: number = 20,
): Promise<Array<{ keyword: string; searchVolume: number; priority: number }>> {
  try {
    const { data, error } = await db
      .from('keywords')
      .select('keyword, search_volume, priority')
      .eq('used', false)
      .order('search_volume', { ascending: false, nullsFirst: false })
      .order('priority', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[getTopUnusedKeywords] Query error:', error);
      return [];
    }

    return (data ?? []).map((row: any) => ({
      keyword:     row.keyword,
      searchVolume: row.search_volume ? parseInt(row.search_volume, 10) : 0,
      priority:    row.priority ?? 0,
    }));
  } catch (err) {
    console.error('[getTopUnusedKeywords] Unexpected error:', err);
    return [];
  }
}
