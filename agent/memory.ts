/**
 * agent/memory.ts
 * ===============
 * Persistent agent memory — the agent's brain across runs.
 *
 * PROBLEM THIS SOLVES:
 * Every time the agent generates a post, it starts completely cold. It has no
 * idea what it's already covered, what writing style worked best, which
 * categories are under-served, or what mistakes to avoid. This means:
 *   - Duplicate / near-duplicate content on similar topics
 *   - Same writing patterns even after quality failures
 *   - No category balancing (everything ends up in Creator Growth)
 *   - No learning from traffic data (high-performing formats not reused)
 *
 * WHAT MEMORY STORES:
 * ─────────────────────────────────────────────────────────────────────────
 * coveredTopics     → titles of all published posts (duplicate detection)
 * categoryBalance   → { "YouTube Monetization": 5, "Course Creation": 2, ... }
 * qualityLessons    → things to avoid based on past quality failures
 * topFormats        → post formats that consistently score ≥ 80 (e.g. "list post")
 * topPerformers     → titles of posts that drove the most traffic (for style clues)
 * brandVoiceRules   → current site voice/tone rules distilled from best posts
 * avoidTopics       → topics already covered (skip these)
 * needsMoreContent  → categories with fewer than target posts (prioritise these)
 * lastUpdated       → ISO timestamp of last memory refresh
 *
 * STORAGE:
 * Written to Supabase agent_logs with run_type 'agent_memory' as JSONB.
 * Only the latest snapshot is used; older ones are historical record.
 *
 * USAGE IN CONTENT GENERATION:
 * Call `buildMemoryContext()` to get a string ready to inject into prompts.
 * Call `refreshMemory()` after every successful publish to keep it current.
 *
 * RUNS:
 * Memory refresh is triggered:
 *   1. After every successful post publish (lightweight update)
 *   2. Nightly via /api/agent/sync (full rebuild from DB)
 */

import { getServiceClient } from '../lib/supabase';
import { askFast }          from './gemini';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentMemory {
  coveredTopics:     string[];     // post titles already published
  categoryBalance:   Record<string, number>; // category → post count
  qualityLessons:    string[];     // specific mistakes/patterns to avoid
  topFormats:        string[];     // e.g. "7 Ways", "Complete Guide", "vs Comparison"
  topPerformers:     string[];     // titles of high-traffic posts (style reference)
  brandVoiceRules:   string[];     // tone/voice rules derived from best posts
  avoidTopics:       string[];     // slugs/topics already well covered
  needsMoreContent:  string[];     // categories under target post count
  recentKeywords:    string[];     // keywords used in last 7 days (avoid repetition)
  lastUpdated:       string;       // ISO timestamp
}

const TARGET_POSTS_PER_CATEGORY = 15;  // ideal minimum per category

// ── Read memory from DB ───────────────────────────────────────────────────────

export async function readMemory(): Promise<AgentMemory | null> {
  const db = getServiceClient();

  const { data } = await db
    .from('agent_logs')
    .select('details, created_at')
    .eq('run_type', 'agent_memory')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return null;

  const raw = data[0].details as Partial<AgentMemory>;
  return {
    coveredTopics:    raw.coveredTopics    ?? [],
    categoryBalance:  raw.categoryBalance  ?? {},
    qualityLessons:   raw.qualityLessons   ?? [],
    topFormats:       raw.topFormats       ?? [],
    topPerformers:    raw.topPerformers    ?? [],
    brandVoiceRules:  raw.brandVoiceRules  ?? [],
    avoidTopics:      raw.avoidTopics      ?? [],
    needsMoreContent: raw.needsMoreContent ?? [],
    recentKeywords:   raw.recentKeywords   ?? [],
    lastUpdated:      raw.lastUpdated      ?? '',
  };
}

// ── Full memory rebuild from DB ───────────────────────────────────────────────

export async function rebuildMemory(): Promise<AgentMemory> {
  const db = getServiceClient();

  // All published posts
  const { data: posts } = await db
    .from('posts')
    .select('title, slug, category, quality_score, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  const allPosts = posts ?? [];

  // Category balance
  const categoryBalance: Record<string, number> = {};
  for (const p of allPosts) {
    categoryBalance[p.category] = (categoryBalance[p.category] ?? 0) + 1;
  }

  // Which categories need more content
  const ALL_CATEGORIES = [
    'YouTube Monetization', 'Course Creation', 'Creator Growth',
    'Content Strategy', 'AI for Creator Economy',
  ];
  const needsMoreContent = ALL_CATEGORIES.filter(
    (c) => (categoryBalance[c] ?? 0) < TARGET_POSTS_PER_CATEGORY,
  ).sort((a, b) => (categoryBalance[a] ?? 0) - (categoryBalance[b] ?? 0)); // least-covered first

  // Top performers (quality score >= 80)
  const topPerformers = allPosts
    .filter((p: any) => (p.quality_score ?? 0) >= 80)
    .slice(0, 8)
    .map((p: any) => p.title);

  // Covered topics (last 60 posts to avoid duplication)
  const coveredTopics = allPosts.slice(0, 60).map((p: any) => p.title);
  const avoidTopics   = allPosts.slice(0, 30).map((p: any) => p.slug);

  // Recent keywords used (last 7 days)
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data: recentKwData } = await db
    .from('keywords')
    .select('keyword')
    .eq('used', true)
    .gte('used_at', sevenDaysAgo.toISOString())
    .limit(20);
  const recentKeywords = (recentKwData ?? []).map((k: { keyword: string }) => k.keyword);

  // Quality lessons — distil from quality failure patterns in agent_logs
  const { data: failLogs } = await db
    .from('agent_logs')
    .select('details')
    .eq('run_type', 'content_generation')
    .contains('details', { regenerated: true })
    .order('created_at', { ascending: false })
    .limit(20);

  const failureCodes: string[] = [];
  for (const log of failLogs ?? []) {
    const codes = (log.details as any)?.issues ?? [];
    failureCodes.push(...codes);
  }
  const codeFrequency: Record<string, number> = {};
  for (const c of failureCodes) codeFrequency[c] = (codeFrequency[c] ?? 0) + 1;
  const qualityLessons = Object.entries(codeFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([code, count]) => `${code} (failed ${count}x) — recurring issue to fix in prompts`);

  // Top formats — extract format patterns from top-performing titles
  const formatPatterns: Record<string, number> = {};
  for (const title of topPerformers) {
    if (/^\d+\s+(ways|tips|best|steps|tools|methods|strategies)/i.test(title))
      formatPatterns['list_post'] = (formatPatterns['list_post'] ?? 0) + 1;
    if (/^how to\b/i.test(title))
      formatPatterns['how_to_guide'] = (formatPatterns['how_to_guide'] ?? 0) + 1;
    if (/\bvs\b|\bversus\b|\bcompar/i.test(title))
      formatPatterns['comparison'] = (formatPatterns['comparison'] ?? 0) + 1;
    if (/\bcomplete guide\b|\bultimate guide\b|\bfull guide\b/i.test(title))
      formatPatterns['ultimate_guide'] = (formatPatterns['ultimate_guide'] ?? 0) + 1;
    if (/\bfor beginners\b|\bfrom scratch\b|\bget started\b/i.test(title))
      formatPatterns['beginner_guide'] = (formatPatterns['beginner_guide'] ?? 0) + 1;
  }
  const topFormats = Object.entries(formatPatterns)
    .sort(([, a], [, b]) => b - a)
    .map(([fmt]) => fmt);

  // Use Gemini to distil brand voice rules from top-performing titles (lightweight)
  let brandVoiceRules: string[] = [
    'Write in first person as Sandeep Singh, co-founder of Graphy.com',
    'Use specific numbers — "1,000 subscribers" not "some subscribers"',
    'Start content with a direct answer, not an intro paragraph',
    'Include at least one Graphy.com creator success story with numbers',
    'Avoid generic filler: no "game changer", "skyrocket", "leverage"',
  ];

  if (topPerformers.length >= 3) {
    try {
      const voicePrompt = `Based on these high-performing blog post titles from sandeeps.co (a blog for YouTube creators by Sandeep Singh, co-founder of Graphy.com):

${topPerformers.slice(0, 6).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Distil 3 specific brand voice rules that made these titles effective. Each rule must be:
- Actionable and specific (not vague like "be authentic")
- About style/tone/format that a content agent can follow
- Under 20 words

Return a JSON array of 3 strings only.`;

      const raw = await askFast(voicePrompt, 200, 0.3);
      const parsed = JSON.parse(raw.replace(/^```json|```$/g, '').trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        brandVoiceRules = [...parsed, ...brandVoiceRules].slice(0, 6);
      }
    } catch {
      // keep defaults
    }
  }

  const memory: AgentMemory = {
    coveredTopics,
    categoryBalance,
    qualityLessons,
    topFormats,
    topPerformers,
    brandVoiceRules,
    avoidTopics,
    needsMoreContent,
    recentKeywords,
    lastUpdated: new Date().toISOString(),
  };

  // Persist to DB
  await db.from('agent_logs').insert({
    run_type: 'agent_memory',
    status:   'success',
    details:  memory as unknown as Record<string, unknown>,
  });

  console.log(
    `[Memory] Rebuilt — ${coveredTopics.length} covered topics, ` +
    `needs more: ${needsMoreContent.slice(0, 3).join(', ')}`,
  );

  return memory;
}

// ── Lightweight memory update after a single publish ─────────────────────────

export async function updateMemoryAfterPublish(
  title:    string,
  slug:     string,
  category: string,
): Promise<void> {
  const existing = await readMemory();
  if (!existing) {
    // No memory yet — do a full rebuild
    await rebuildMemory();
    return;
  }

  const updatedBalance = { ...existing.categoryBalance };
  updatedBalance[category] = (updatedBalance[category] ?? 0) + 1;

  const ALL_CATEGORIES = [
    'YouTube Monetization', 'Course Creation', 'Creator Growth',
    'Content Strategy', 'AI for Creator Economy',
  ];
  const needsMoreContent = ALL_CATEGORIES
    .filter((c) => (updatedBalance[c] ?? 0) < TARGET_POSTS_PER_CATEGORY)
    .sort((a, b) => (updatedBalance[a] ?? 0) - (updatedBalance[b] ?? 0));

  const db = getServiceClient();
  await db.from('agent_logs').insert({
    run_type: 'agent_memory',
    status:   'success',
    details:  {
      ...existing,
      coveredTopics:   [title, ...existing.coveredTopics].slice(0, 60),
      avoidTopics:     [slug,  ...existing.avoidTopics ].slice(0, 30),
      categoryBalance: updatedBalance,
      needsMoreContent,
      lastUpdated:     new Date().toISOString(),
    } as unknown as Record<string, unknown>,
  });

  console.log(`[Memory] Updated after publish: "${title}" (${category})`);
}

// ── Build context string for injection into content generation prompts ────────

export function buildMemoryContext(memory: AgentMemory): string {
  const lines: string[] = ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];
  lines.push('AGENT MEMORY — READ THIS BEFORE GENERATING CONTENT');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Category gaps — tell the agent which categories to prioritise
  if (memory.needsMoreContent.length > 0) {
    lines.push(`\n📊 CATEGORIES NEEDING MORE CONTENT (prioritise these):`);
    for (const cat of memory.needsMoreContent.slice(0, 3)) {
      const count = memory.categoryBalance[cat] ?? 0;
      lines.push(`  • ${cat}: ${count} posts (target: ${TARGET_POSTS_PER_CATEGORY})`);
    }
  }

  // 2. Topics already covered — prevent duplicates
  if (memory.coveredTopics.length > 0) {
    lines.push(`\n🚫 TOPICS ALREADY COVERED (DO NOT duplicate these angles):`);
    for (const t of memory.coveredTopics.slice(0, 15)) {
      lines.push(`  • "${t}"`);
    }
    if (memory.coveredTopics.length > 15) {
      lines.push(`  ... and ${memory.coveredTopics.length - 15} more`);
    }
  }

  // 3. Brand voice rules
  if (memory.brandVoiceRules.length > 0) {
    lines.push(`\n✍️ BRAND VOICE RULES (apply to every post):`);
    for (const rule of memory.brandVoiceRules.slice(0, 5)) {
      lines.push(`  • ${rule}`);
    }
  }

  // 4. Quality lessons — what to avoid
  if (memory.qualityLessons.length > 0) {
    lines.push(`\n⚠️ PAST QUALITY FAILURES TO AVOID:`);
    for (const lesson of memory.qualityLessons.slice(0, 4)) {
      lines.push(`  • ${lesson}`);
    }
  }

  // 5. Top formats that work well
  if (memory.topFormats.length > 0) {
    const formatLabels: Record<string, string> = {
      list_post:      '"X Ways/Tips/Best [Topic]" — numbered list format',
      how_to_guide:   '"How to [Action]" — step-by-step format',
      comparison:     '"X vs Y: Which is Better?" — comparison format',
      ultimate_guide: '"The Complete/Ultimate Guide to [Topic]" — pillar post',
      beginner_guide: '"[Topic] for Beginners" — accessible intro format',
    };
    lines.push(`\n🏆 HIGH-PERFORMING FORMATS (prefer these structures):`);
    for (const fmt of memory.topFormats.slice(0, 3)) {
      lines.push(`  • ${formatLabels[fmt] ?? fmt}`);
    }
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}
