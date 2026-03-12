/**
 * agent/refresh.ts
 * ================
 * Content Refresh Pipeline.
 *
 * Finds stale/underperforming posts and rewrites them with:
 *   - Updated stats and figures
 *   - Stronger intro (first 200 words determine bounce rate)
 *   - Deeper sections where content was thin
 *   - FAQ section if missing (for AEO)
 *   - Updated published_at (signals freshness to Google)
 *
 * Priority order:
 *   1. GSC underperformers (30+ days live, 0 clicks)
 *   2. Posts older than 60 days with no FAQ
 *   3. Posts older than 90 days (general freshness pass)
 *
 * Runs once per week (Sunday 7 AM UTC) via Vercel Cron.
 * Refreshes max 2 posts per run to control Gemini token usage.
 */

import { getServiceClient }                        from '../lib/supabase';
import { ask, stripJsonFences }                    from './gemini';
import { renderMarkdown, calcReadingTime, FAQItem } from './content';
import { logRun }                                  from './logger';
import { getFeedbackInsights }                     from './feedback';

export interface RefreshResult {
  slug:        string;
  title:       string;
  reason:      string;
  improved:    boolean;
}

const MAX_REFRESHES_PER_RUN = 2;

/**
 * Main refresh runner — finds and refreshes stale posts.
 */
export async function runContentRefresh(): Promise<{ refreshed: RefreshResult[]; skipped: number }> {
  const db      = getServiceClient();
  const results: RefreshResult[] = [];

  // ── 1. Find candidates ────────────────────────────────────────────────────
  const candidates = await findRefreshCandidates();
  console.log(`[Refresh] Found ${candidates.length} candidates`);

  if (candidates.length === 0) {
    return { refreshed: [], skipped: 0 };
  }

  const toRefresh = candidates.slice(0, MAX_REFRESHES_PER_RUN);

  // ── 2. Refresh each candidate ─────────────────────────────────────────────
  for (const candidate of toRefresh) {
    console.log(`[Refresh] Refreshing: "${candidate.title}" (${candidate.reason})`);

    try {
      const result = await refreshPost(candidate);
      results.push(result);

      await logRun({
        runType:  'content_refresh',
        status:   'success',
        postSlug: candidate.slug,
        details:  { reason: candidate.reason, title: candidate.title },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[Refresh] Failed for ${candidate.slug}:`, error);

      await logRun({
        runType:  'content_refresh',
        status:   'error',
        postSlug: candidate.slug,
        error,
      });

      results.push({ slug: candidate.slug, title: candidate.title, reason: candidate.reason, improved: false });
    }
  }

  return { refreshed: results, skipped: candidates.length - toRefresh.length };
}

// ── Candidate selection ───────────────────────────────────────────────────────

interface RefreshCandidate {
  slug:         string;
  title:        string;
  category:     string;
  content:      string;     // raw markdown
  publishedAt:  string;
  hasFaq:       boolean;
  reason:       string;
}

async function findRefreshCandidates(): Promise<RefreshCandidate[]> {
  const db  = getServiceClient();
  const now = Date.now();

  // Get all published posts
  const { data: posts } = await db
    .from('posts')
    .select('slug, title, category, content, published_at, faq, last_refreshed_at')
    .eq('status', 'published')
    .order('published_at', { ascending: true });  // oldest first

  if (!posts?.length) return [];

  // Get underperformer slugs from GSC feedback
  let underperformerSlugs = new Set<string>();
  try {
    const insights = await getFeedbackInsights();
    underperformerSlugs = new Set(insights.underperformers.map((p) => p.slug));
  } catch {
    // continue without GSC data
  }

  const candidates: RefreshCandidate[] = [];

  for (const post of posts) {
    const daysOld = (now - new Date(post.published_at).getTime()) / 864e5;
    const daysSinceRefresh = post.last_refreshed_at
      ? (now - new Date(post.last_refreshed_at).getTime()) / 864e5
      : daysOld;
    const hasFaq = !!(post.faq && Array.isArray(post.faq) && post.faq.length > 0);

    // Skip if refreshed recently (within 30 days)
    if (daysSinceRefresh < 30) continue;

    let reason = '';

    if (underperformerSlugs.has(post.slug)) {
      reason = 'GSC underperformer: 30+ days live, 0 clicks';
    } else if (daysOld > 60 && !hasFaq) {
      reason = 'Missing FAQ section — AEO opportunity';
    } else if (daysOld > 90) {
      reason = 'Content older than 90 days — freshness pass';
    }

    if (reason) {
      candidates.push({
        slug:        post.slug,
        title:       post.title,
        category:    post.category,
        content:     post.content,
        publishedAt: post.published_at,
        hasFaq,
        reason,
      });
    }
  }

  // Sort: underperformers first, then no-FAQ, then general
  return candidates.sort((a, b) => {
    const priority = (r: string) =>
      r.includes('GSC') ? 0 : r.includes('FAQ') ? 1 : 2;
    return priority(a.reason) - priority(b.reason);
  });
}

// ── Core refresh logic ────────────────────────────────────────────────────────

async function refreshPost(candidate: RefreshCandidate): Promise<RefreshResult> {
  const db = getServiceClient();

  const prompt = `
You are Sandeep Singh, co-founder of Graphy.com. You are refreshing and improving an existing blog post.

ORIGINAL POST TITLE: "${candidate.title}"
CATEGORY: ${candidate.category}
REFRESH REASON: ${candidate.reason}

ORIGINAL CONTENT:
${candidate.content.slice(0, 6000)}

YOUR TASK — improve the post by:
1. Rewrite the introduction (first 3 paragraphs) to be more compelling and hook-driven
2. Update any outdated stats, figures, or references to 2025/2026
3. Strengthen any thin sections (add more actionable advice, examples, specifics)
4. Add a "## Frequently Asked Questions" section at the end with 4-5 Q&A pairs if not present
5. Keep the same URL slug, overall structure, and Graphy.com mentions
6. Do NOT change the post topic or core message

Return a JSON object:
{
  "markdown": "the full improved post in markdown",
  "faqs": [
    { "question": "Question?", "answer": "Answer in 2-3 sentences." }
  ],
  "improvements": ["short description of change 1", "change 2", "change 3"]
}

Return ONLY the JSON object.`;

  const raw    = await ask(prompt, 4096, 0.7);
  const cleaned = stripJsonFences(raw);

  let parsed: { markdown: string; faqs: FAQItem[]; improvements: string[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini returned invalid JSON for refresh');
  }

  const newMarkdown    = parsed.markdown;
  const newFaqs        = parsed.faqs ?? [];
  const newContentHtml = await renderMarkdown(newMarkdown);
  const newReadingTime = calcReadingTime(newMarkdown);

  // Update in Supabase
  const { error } = await db.from('posts').update({
    content:           newMarkdown,
    content_html:      newContentHtml,
    reading_time:      newReadingTime,
    faq:               newFaqs.length > 0 ? newFaqs : undefined,
    published_at:      new Date().toISOString(),   // signals freshness to Google
    last_refreshed_at: new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }).eq('slug', candidate.slug);

  if (error) throw new Error(`DB update failed: ${error.message}`);

  console.log(`[Refresh] ✅ Refreshed "${candidate.title}" — ${parsed.improvements?.length ?? 0} improvements`);

  return {
    slug:     candidate.slug,
    title:    candidate.title,
    reason:   candidate.reason,
    improved: true,
  };
}
