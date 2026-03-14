/**
 * agent/keywords.ts
 * =================
 * Researches and manages keyword opportunities.
 * Pipeline: Google Suggest (free) → Google Trends → Gemini (expand) → DataForSEO (real volume) → Supabase
 *
 * Auto-refill: triggers research automatically when unused keywords drop below LOW_KEYWORD_THRESHOLD.
 */

import { ask, askFast, stripJsonFences } from './gemini';
import { getServiceClient }              from '../lib/supabase';
import { getRelatedTrendingQueries }     from './trends';
import { getKeywordMetrics }             from './dataforseo';

const LOW_KEYWORD_THRESHOLD = 15; // auto-refill when unused keywords drop below this

// ── Google Suggest (free autocomplete API — no key needed) ───────────────────

/**
 * Fetch Google autocomplete suggestions for a seed query.
 * Uses Google's public suggest API — free, no auth, works immediately.
 * Returns up to 10 suggestions per seed.
 */
async function fetchGoogleSuggestions(seed: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}&hl=en`;
    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    // Response shape: ["seed", ["suggestion1", "suggestion2", ...]]
    const suggestions: string[] = data?.[1] ?? [];
    return suggestions.filter((s) => s.length > 10 && s.length < 100);
  } catch {
    return [];
  }
}

/**
 * Discover new keywords using Google Suggest across multiple seed variations.
 * Generates question-style, comparison, and how-to variations of each seed.
 * Returns deduplicated list of new keywords not already in the DB.
 */
export async function discoverFromSuggest(seeds?: string[]): Promise<string[]> {
  const db        = getServiceClient();
  const seedList  = seeds ?? NICHE_SEEDS;

  // Generate search variations for each seed
  const variations: string[] = [];
  for (const seed of seedList.slice(0, 5)) {
    variations.push(
      seed,
      `how to ${seed}`,
      `best ${seed}`,
      `${seed} for beginners`,
      `${seed} 2025`,
      `${seed} tips`,
    );
  }

  // Fetch suggestions for all variations in parallel (batches of 5)
  const allSuggestions: string[] = [];
  for (let i = 0; i < variations.length; i += 5) {
    const batch   = variations.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(fetchGoogleSuggestions));
    for (const r of results) {
      if (r.status === 'fulfilled') allSuggestions.push(...r.value);
    }
    await new Promise((res) => setTimeout(res, 200)); // small delay
  }

  const unique = [...new Set(allSuggestions.map((s) => s.toLowerCase().trim()))];

  // Filter out keywords already in DB
  const { data: existing } = await db.from('keywords').select('keyword');
  const existingSet = new Set((existing ?? []).map((r: { keyword: string }) => r.keyword.toLowerCase()));
  const novel = unique.filter((k) => !existingSet.has(k));

  console.log(`[Keywords/Suggest] Discovered ${novel.length} new keywords from Google Suggest`);
  return novel;
}

/**
 * Auto-refill the keyword pipeline when unused count drops below LOW_KEYWORD_THRESHOLD.
 * Called at the start of each agent run. Non-blocking.
 */
export async function autoRefillIfLow(): Promise<void> {
  const db = getServiceClient();
  const { count } = await db
    .from('keywords')
    .select('*', { count: 'exact', head: true })
    .eq('used', false);

  const unused = count ?? 0;
  if (unused >= LOW_KEYWORD_THRESHOLD) return;

  console.log(`[Keywords] ⚠️ Only ${unused} unused keywords — auto-refilling...`);

  try {
    // Step 1: Free Google Suggest discovery (instant, no API cost)
    const suggested = await discoverFromSuggest();
    if (suggested.length > 0) {
      const rows = suggested.slice(0, 30).map((keyword) => ({
        keyword,
        search_volume: 'estimated',
        difficulty:    'unknown',
        priority:      5,
        used:          false,
      }));
      const { error } = await db
        .from('keywords')
        .upsert(rows, { onConflict: 'keyword', ignoreDuplicates: true });
      if (!error) console.log(`[Keywords] ✅ Added ${rows.length} keywords from Google Suggest`);
    }

    // Step 2: Also run full research pipeline if still very low
    const { count: newCount } = await db
      .from('keywords')
      .select('*', { count: 'exact', head: true })
      .eq('used', false);
    if ((newCount ?? 0) < 10) {
      console.log('[Keywords] Still low — running full research pipeline...');
      const seed = NICHE_SEEDS[Math.floor(Math.random() * NICHE_SEEDS.length)];
      await researchKeywords(seed, 15).catch((e) => console.warn('[Keywords] Research pipeline error:', e));
    }
  } catch (err) {
    console.warn('[Keywords] Auto-refill error (non-fatal):', err);
  }
}

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
  // AI for Creator Economy seeds
  'AI tools for content creators',
  'ChatGPT for YouTube creators',
  'AI course creation tools',
  'AI video editing for YouTubers',
  'AI for online business creators',
];

// AI Creator Economy specific seeds — used for targeted AI keyword seeding
export const AI_CREATOR_SEEDS = [
  'AI tools for YouTube creators',
  'ChatGPT for content creators',
  'AI for online course creation',
  'AI video script generator',
  'AI thumbnail generator for YouTube',
  'Gemini for content marketing',
  'ElevenLabs voice cloning for creators',
  'AI tools to grow YouTube channel',
  'Pictory AI video creation',
  'Descript AI podcast editing',
  'AI for email marketing creators',
  'AI sales funnel for course creators',
  'automate content creation with AI',
  'AI for creator economy 2026',
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
