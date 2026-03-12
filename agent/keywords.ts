/**
 * agent/keywords.ts
 * =================
 * Researches and manages keyword opportunities.
 * Stores keywords in Supabase keywords table.
 */

import { ask, askFast, stripJsonFences } from './gemini';
import { getServiceClient } from '../lib/supabase';

interface KeywordResult {
  keyword:       string;
  search_volume: string;
  difficulty:    string;
  priority:      number;
}

/**
 * Generate new keyword ideas and store them in the DB
 */
export async function researchKeywords(niche: string, count = 20): Promise<KeywordResult[]> {
  const prompt = `
You are an expert SEO researcher for a blog targeting early-stage YouTube creators and online coaches.

Generate ${count} high-value, low-competition long-tail keyword opportunities for the niche: "${niche}"

Focus on:
- "how to" queries (high intent)
- beginner questions (high volume)
- monetization topics (high buyer intent)
- YouTube-specific terms
- Course creation queries

Return ONLY a JSON array like this:
[
  {
    "keyword": "how to monetize a youtube channel with 1000 subscribers",
    "search_volume": "8,100/mo",
    "difficulty": "low",
    "priority": 9
  }
]

Priority 1-10 (10 = highest value). Return valid JSON only, no other text.`;

  const raw = await ask(prompt, 2048, 0.6);
  const cleaned = stripJsonFences(raw);

  let keywords: KeywordResult[] = [];
  try {
    keywords = JSON.parse(cleaned);
  } catch {
    console.error('Failed to parse keyword JSON:', cleaned.slice(0, 200));
    return [];
  }

  // Store in Supabase (upsert to avoid duplicates)
  const db = getServiceClient();
  const rows = keywords.map((k) => ({
    keyword:       k.keyword.toLowerCase().trim(),
    search_volume: k.search_volume,
    difficulty:    k.difficulty,
    priority:      Math.min(10, Math.max(1, k.priority)),
    used:          false,
  }));

  const { error } = await db
    .from('keywords')
    .upsert(rows, { onConflict: 'keyword', ignoreDuplicates: true });

  if (error) console.error('Error storing keywords:', error);
  else console.log(`Stored ${rows.length} keywords`);

  return keywords;
}

/**
 * Get the best unused keyword from the DB to write about next
 */
export async function getNextKeyword(): Promise<string | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('keywords')
    .select('keyword')
    .eq('used', false)
    .order('priority', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.keyword;
}

/**
 * Mark a keyword as used after a post is written for it
 */
export async function markKeywordUsed(keyword: string): Promise<void> {
  const db = getServiceClient();
  await db
    .from('keywords')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('keyword', keyword.toLowerCase().trim());
}

/**
 * Decide the best topic to write about today
 */
export async function pickTodaysTopic(existingSlugs: string[]): Promise<string> {
  // First check if we have unused keywords in the DB
  const nextKeyword = await getNextKeyword();
  if (nextKeyword) return nextKeyword;

  // If no keywords in DB, generate fresh ones
  console.log('No unused keywords found — generating new batch...');
  const niches = [
    'YouTube monetization for beginners',
    'online course creation',
    'creator economy 2026',
    'YouTube SEO and growth',
  ];
  const niche = niches[Math.floor(Math.random() * niches.length)];
  const newKeywords = await researchKeywords(niche, 15);

  if (newKeywords.length > 0) {
    return newKeywords[0].keyword;
  }

  // Absolute fallback
  const fallbackPrompt = `
Suggest one specific, searchable blog post topic for early-stage YouTube creators.
Focus on practical how-to content or monetization.
Return ONLY the topic title, nothing else.`;

  return askFast(fallbackPrompt, 100, 0.8);
}
