/**
 * agent/trends.ts
 * ===============
 * Google Trends integration — finds trending topics in the creator/YouTube niche.
 * Uses the unofficial google-trends-api (no API key needed).
 *
 * Also exports pickTrendingCreatorTopic() — the TOFU post topic picker used by
 * the dual-post pipeline in agent/index.ts.
 */

// We use fetch directly against Google Trends' public JSON endpoint
// to avoid any unofficial library issues in edge environments.

import { askFast }                from './gemini';
import { checkTrendTopicSafety } from './escalate';

const CREATOR_KEYWORDS = [
  'youtube monetization',
  'online course creation',
  'content creator',
  'youtube channel growth',
  'sell online course',
  'AI tools for creators',
  'how to make money online',
  'creator economy',
];

// Curated fallback topics rotated when Trends API is unavailable
const FALLBACK_TOFU_TOPICS = [
  'YouTube just updated its Partner Program requirements — what creators need to know',
  'How AI is changing the way online course creators make content in 2026',
  'Why the creator economy is booming even as social media reach declines',
  'The rise of micro-courses: why shorter courses sell better than comprehensive ones',
  'How top YouTube creators are using AI to 10x their output without burning out',
  'What YouTube\'s new monetization rules mean for small channels',
  'ChatGPT vs Gemini for content creators: which AI actually helps you grow faster',
  'Why email lists are becoming the most valuable asset for online creators',
  'The death of the "educational YouTube channel" — and what\'s replacing it',
  'How creators are building $10k/month businesses with under 5,000 subscribers',
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

// ── TOFU Topic Picker ─────────────────────────────────────────────────────────

/**
 * Pick a trending creator economy topic for today's TOFU post.
 *
 * Strategy:
 *  1. Pull rising/top related queries from Google Trends for a random seed
 *  2. Use Gemini to pick the best TOFU blog angle (commentary + creator lens)
 *  3. Safety-check with checkTrendTopicSafety() — escalates if off-niche
 *  4. Falls back to a curated topic if Trends is unavailable or all fail safety
 *
 * @param existingSlugs - Already-published slugs to avoid near-duplicate angles
 * @returns Topic string suitable for a TOFU trend post, or null if escalated
 */
export async function pickTrendingCreatorTopic(
  existingSlugs: string[],
): Promise<string | null> {
  // 1. Pull trending queries from Google Trends
  const seed = CREATOR_KEYWORDS[Math.floor(Math.random() * CREATOR_KEYWORDS.length)];
  console.log(`[Trends] Fetching trending queries for seed: "${seed}"`);

  let trendingQueries: string[] = [];
  try {
    trendingQueries = await getRelatedTrendingQueries(seed);
    console.log(`[Trends] Got ${trendingQueries.length} trending queries`);
  } catch (err) {
    console.warn('[Trends] Trends API failed, using fallback topics:', err);
  }

  const candidates = trendingQueries.length > 0
    ? trendingQueries
    : FALLBACK_TOFU_TOPICS;

  // 2. Ask Gemini to pick the best TOFU angle from the candidates
  let tofuTopic: string;
  try {
    const geminiPick = await askFast(
      `You are a content strategist for sandeeps.co — a blog for YouTube creators, online coaches, and digital entrepreneurs.

Our TOFU strategy: hook trending search traffic with news/commentary posts. Style = "here's what this means for you as a creator". Not tutorials — analysis and insight.

From this list of trending topics, pick the ONE best for a TOFU post today.
Existing post slugs to avoid (don't cover same angle): ${existingSlugs.slice(-20).join(', ')}

Trending topics:
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Pick the topic most relevant to: YouTube creators, online course sellers, creator economy, AI tools for creators.
Rewrite it as a compelling TOFU blog post TITLE (not a question, opinionated angle, max 80 chars).
Return ONLY the title, nothing else.`,
      150,
      0.8,
    );
    tofuTopic = geminiPick.trim().replace(/^["']|["']$/g, ''); // strip quotes
  } catch {
    // Fall back to a random curated topic
    tofuTopic = FALLBACK_TOFU_TOPICS[Math.floor(Math.random() * FALLBACK_TOFU_TOPICS.length)];
  }

  console.log(`[Trends] TOFU topic candidate: "${tofuTopic}"`);

  // 3. Safety check — escalates to Sandeep if off-niche or risky
  const safe = await checkTrendTopicSafety(tofuTopic, `Google Trends seed: "${seed}"`);
  if (!safe) {
    console.warn(`[Trends] Topic failed safety check — escalated to Sandeep`);
    return null;
  }

  return tofuTopic;
}
