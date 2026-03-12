/**
 * agent/keywords.ts
 * =================
 * Researches and manages keyword opportunities.
 * Pipeline: Google Trends → Gemini (expand) → DataForSEO (real volume) → Supabase
 */

import { ask, askFast, stripJsonFences } from './gemini';
import { getServiceClient }              from '../lib/supabase';
import { getRelatedTrendingQueries }     from './trends';
import { getKeywordMetrics }             from './dataforseo';

interface KeywordResult {
  keyword:       string;
  search_volume: string;
  difficulty:    string;
  priority:      number;
}

const NICHE_SEEDS = [
  'youtube monetization',
  'online course creation',
  'youtube channel growth',
  'sell online course',
  'content creator business',
];

/**
 * Full keyword research pipeline:
 * 1. Pull trending queries from Google Trends
 * 2. Use Gemini to expand into long-tail blog topics
 * 3. Score each with real search volume from DataForSEO
 * 4. Store top keywords in Supabase ranked by priority
 */
export async function researchKeywords(niche: string, count = 20): Promise<KeywordResult[]> {
  console.log(`[Keywords] Researching niche: "${niche}"`);

  // ── Step 1: Google Trends — what's trending right now ────────────────────
  let trendingQueries: string[] = [];
  try {
    trendingQueries = await getRelatedTrendingQueries(niche);
    console.log(`[Keywords] Trends: ${trendingQueries.length} queries`);
  } catch (err) {
    console.warn('[Keywords] Trends failed, skipping:', err);
  }

  const trendingContext = trendingQueries.length > 0
    ? `\n\nCurrently trending related searches:\n${trendingQueries.map((q) => `- ${q}`).join('\n')}`
    : '';

  // ── Step 2: Gemini — expand into long-tail keywords ───────────────────────
  const prompt = `
You are an expert SEO researcher for a blog targeting early-stage YouTube creators and online coaches.

Generate ${count} high-value long-tail keyword opportunities for the niche: "${niche}"
${trendingContext}

Focus on:
- "how to" queries (high intent)
- Beginner questions (high volume, low competition)
- Monetization and income topics (high buyer intent)
- YouTube-specific terms
- Course creation and selling
- AI tools for creators

Return ONLY a JSON array:
[{ "keyword": "how to monetize youtube with 1000 subscribers", "search_volume": "estimated", "difficulty": "low", "priority": 8 }]

Priority 1-10 (10 = highest). Return valid JSON only.`;

  const raw  = await ask(prompt, 2048, 0.6);
  let geminiKeywords: KeywordResult[] = [];
  try {
    geminiKeywords = JSON.parse(stripJsonFences(raw));
  } catch {
    console.error('[Keywords] Failed to parse Gemini response');
    return [];
  }

  // ── Step 3: DataForSEO — real search volume ───────────────────────────────
  const keywordStrings = geminiKeywords.map((k) => k.keyword.toLowerCase().trim());
  let scored = geminiKeywords;

  try {
    const metrics = await getKeywordMetrics(keywordStrings);
    console.log(`[Keywords] DataForSEO: got metrics for ${metrics.length} keywords`);

    scored = geminiKeywords.map((gk) => {
      const m = metrics.find((m) => m.keyword === gk.keyword.toLowerCase().trim());
      if (!m || m.searchVolume === 0) return gk;
      return {
        keyword:       gk.keyword,
        search_volume: `${m.searchVolume.toLocaleString()}/mo`,
        difficulty:    m.difficulty,
        priority:      m.priority,
      };
    });
  } catch (err) {
    console.warn('[Keywords] DataForSEO failed, using Gemini estimates:', err);
  }

  // ── Step 4: Store in Supabase ─────────────────────────────────────────────
  const db   = getServiceClient();
  const rows = scored.map((k) => ({
    keyword:       k.keyword.toLowerCase().trim(),
    search_volume: k.search_volume,
    difficulty:    k.difficulty,
    priority:      Math.min(10, Math.max(1, k.priority)),
    used:          false,
  }));

  const { error } = await db
    .from('keywords')
    .upsert(rows, { onConflict: 'keyword', ignoreDuplicates: true });

  if (error) console.error('[Keywords] Store error:', error);
  else console.log(`[Keywords] Stored ${rows.length} keywords`);

  return scored;
}

/**
 * Get highest-priority unused keyword from DB
 */
export async function getNextKeyword(): Promise<string | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('keywords').select('keyword')
    .eq('used', false)
    .order('priority', { ascending: false })
    .limit(1).single();
  if (error || !data) return null;
  return data.keyword;
}

/**
 * Mark a keyword as used after its post is written
 */
export async function markKeywordUsed(keyword: string): Promise<void> {
  const db = getServiceClient();
  await db.from('keywords')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('keyword', keyword.toLowerCase().trim());
}

/**
 * Pick today's topic — uses DB first, runs full research if empty
 */
export async function pickTodaysTopic(existingSlugs: string[]): Promise<string> {
  const nextKeyword = await getNextKeyword();
  if (nextKeyword) {
    console.log(`[Keywords] Using: "${nextKeyword}"`);
    return nextKeyword;
  }

  console.log('[Keywords] DB empty — running full research pipeline...');
  const seed        = NICHE_SEEDS[Math.floor(Math.random() * NICHE_SEEDS.length)];
  const newKeywords = await researchKeywords(seed, 20);

  if (newKeywords.length > 0) {
    return newKeywords.sort((a, b) => b.priority - a.priority)[0].keyword;
  }

  return askFast(
    'Suggest one specific searchable blog post topic for early-stage YouTube creators. Return ONLY the topic.',
    100, 0.8
  );
}
