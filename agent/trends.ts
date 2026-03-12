/**
 * agent/trends.ts
 * ===============
 * Google Trends integration — finds trending topics in the creator/YouTube niche.
 * Uses the unofficial google-trends-api (no API key needed).
 */

// We use fetch directly against Google Trends' public JSON endpoint
// to avoid any unofficial library issues in edge environments.

const CREATOR_KEYWORDS = [
  'youtube monetization',
  'online course creation',
  'content creator',
  'youtube channel growth',
  'sell online course',
];

interface TrendingTopic {
  topic:    string;
  interest: number; // 0-100 relative interest score
}

/**
 * Fetch relative interest for a set of keywords over the past 7 days.
 * Returns keywords sorted by interest score descending.
 */
export async function getTrendingTopics(): Promise<TrendingTopic[]> {
  try {
    const results: TrendingTopic[] = [];

    for (const keyword of CREATOR_KEYWORDS) {
      const interest = await getInterestScore(keyword);
      results.push({ topic: keyword, interest });
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    }

    return results.sort((a, b) => b.interest - a.interest);
  } catch (err) {
    console.warn('[Trends] Failed to fetch trends:', err);
    return CREATOR_KEYWORDS.map((topic) => ({ topic, interest: 50 }));
  }
}

/**
 * Get a 0-100 interest score for a single keyword from Google Trends.
 */
async function getInterestScore(keyword: string): Promise<number> {
  try {
    // Google Trends "Interest over time" — token fetch then data fetch
    const tokenRes = await fetch(
      `https://trends.google.com/trends/api/explore?hl=en-US&tz=-330&req=${encodeURIComponent(
        JSON.stringify({
          comparisonItem: [{ keyword, geo: '', time: 'today 7-d' }],
          category: 0,
          property: '',
        })
      )}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const tokenText = await tokenRes.text();
    // Response starts with ")]}'\n" — strip it
    const tokenJson = JSON.parse(tokenText.replace(/^\)\]\}',\n/, ''));
    const token = tokenJson?.widgets?.find((w: any) => w.id === 'TIMESERIES')?.token;
    if (!token) return 50;

    const dataRes = await fetch(
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-330&req=${encodeURIComponent(
        JSON.stringify({ time: 'today 7-d', resolution: 'DAY', locale: 'en-US', comparisonItem: [{ geo: {}, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: keyword }] } }], requestOptions: { property: '', backend: 'IZG', category: 0 } })
      )}&token=${token}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const dataText = await dataRes.text();
    const dataJson = JSON.parse(dataText.replace(/^\)\]\}',\n/, ''));
    const timelineData = dataJson?.default?.timelineData ?? [];
    if (!timelineData.length) return 50;

    const values = timelineData.map((d: any) => d?.value?.[0] ?? 0);
    const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
    return Math.round(avg);
  } catch {
    return 50; // fallback neutral score
  }
}

/**
 * Get niche-specific trending search terms using Google Trends "related queries".
 * Returns up to 10 rising/top queries for our niche.
 */
export async function getRelatedTrendingQueries(seed = 'youtube monetization'): Promise<string[]> {
  try {
    const tokenRes = await fetch(
      `https://trends.google.com/trends/api/explore?hl=en-US&tz=-330&req=${encodeURIComponent(
        JSON.stringify({
          comparisonItem: [{ keyword: seed, geo: '', time: 'today 3-m' }],
          category: 0,
          property: '',
        })
      )}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const tokenText = await tokenRes.text();
    const tokenJson = JSON.parse(tokenText.replace(/^\)\]\}',\n/, ''));
    const relatedToken = tokenJson?.widgets?.find((w: any) => w.id === 'RELATED_QUERIES')?.token;
    if (!relatedToken) return [];

    const dataRes = await fetch(
      `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=en-US&tz=-330&req=${encodeURIComponent(
        JSON.stringify({ restriction: { geo: {}, time: 'today 3-m', complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: seed }] } }, keywordType: 'QUERY', metric: ['TOP', 'RISING'], trendinessSettings: { compareTime: '2024-12-13 2025-03-13' }, requestOptions: { property: '', backend: 'IZG', category: 0 }, language: 'en' })
      )}&token=${relatedToken}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const dataText = await dataRes.text();
    const dataJson = JSON.parse(dataText.replace(/^\)\]\}',\n/, ''));

    const top: string[]   = (dataJson?.default?.rankedList?.[0]?.rankedKeyword ?? []).slice(0, 5).map((k: any) => k.query);
    const rising: string[] = (dataJson?.default?.rankedList?.[1]?.rankedKeyword ?? []).slice(0, 5).map((k: any) => k.query);

    return [...new Set([...rising, ...top])].filter(Boolean);
  } catch (err) {
    console.warn('[Trends] Related queries failed:', err);
    return [];
  }
}
