/**
 * agent/index.ts
 * ==============
 * Main orchestrator — called by the Vercel Cron API route.
 *
 * Pipeline (with feedback loop):
 *   0. Fetch GSC performance insights (what's ranking, what's working)
 *   1. Pick today's keyword — boosted toward hot topic clusters
 *   2. Classify category
 *   3. Generate post — Gemini sees real ranking data + top search queries
 *   4. Render markdown → HTML
 *   5. Fetch cover image
 *   6. Write to Supabase (with FAQs for AEO)
 *   7. Mark keyword as used
 */

import { getServiceClient }                                                      from '../lib/supabase';
import { pickTodaysTopic, markKeywordUsed }                                      from './keywords';
import { classifyCategory, generatePost, renderMarkdown, calcReadingTime, slugify } from './content';
import { fetchCoverImage }                                                       from './images';
import { logRun }                                                                from './logger';
import { getFeedbackInsights }                                                   from './feedback';

export interface AgentRunResult {
  success:    boolean;
  postSlug?:  string;
  title?:     string;
  error?:     string;
  skipped?:   boolean;
  reason?:    string;
  hadInsights?: boolean;
}

/**
 * Run the full content generation pipeline.
 * Called daily by Vercel Cron at 08:00 UTC.
 */
export async function runAgent(): Promise<AgentRunResult> {
  const startTime = Date.now();
  const db = getServiceClient();

  try {
    // ── 0. Load performance feedback (silently skipped if GSC not set up) ──
    console.log('[Agent] Loading performance insights...');
    const insights = await getFeedbackInsights().catch(() => null);
    if (insights?.hasData) {
      console.log(`[Agent] Feedback: ${insights.topPerformers.length} top performers, ${insights.quickWins.length} quick wins, hot categories: ${insights.hotCategories.join(', ')}`);
    } else {
      console.log('[Agent] No GSC feedback yet — running without performance context');
    }

    // ── 1. Get all existing slugs to avoid duplicates ──────────────────────
    const { data: existing } = await db
      .from('posts')
      .select('slug, title');
    const existingSlugs = (existing ?? []).map((r: { slug: string }) => r.slug);
    console.log(`[Agent] Found ${existingSlugs.length} existing posts`);

    // ── 2. Pick today's topic ──────────────────────────────────────────────
    const topic = await pickTodaysTopic(existingSlugs);
    console.log(`[Agent] Writing about: "${topic}"`);

    // ── 3. Classify category ───────────────────────────────────────────────
    const category = await classifyCategory(topic);
    console.log(`[Agent] Category: ${category}`);

    // ── 4. Generate post — pass insights so Gemini writes smarter content ──
    const { title, description, slug: rawSlug, tags, seoKeywords, faqs, markdown } =
      await generatePost(topic, category, insights ?? undefined);

    // Ensure unique slug
    let slug = rawSlug || slugify(title);
    if (existingSlugs.includes(slug)) {
      slug = `${slug}-${Date.now()}`;
    }

    console.log(`[Agent] Generated: "${title}" (${faqs.length} FAQs for AEO)`);

    // ── 5. Render markdown → HTML ──────────────────────────────────────────
    const contentHtml = await renderMarkdown(markdown);
    const readingTime = calcReadingTime(markdown);

    // ── 6. Fetch cover image ───────────────────────────────────────────────
    const coverImage = await fetchCoverImage(topic, category);

    // ── 7. Write to Supabase ───────────────────────────────────────────────
    const { error: insertError } = await db.from('posts').insert({
      slug,
      title,
      description,
      content:      markdown,
      content_html: contentHtml,
      category,
      tags,
      author:       'Sandeep Singh',
      author_role:  'Co-founder, Graphy.com',
      cover_image:  coverImage,
      seo_keywords: seoKeywords,
      reading_time: readingTime,
      faq:          faqs.length > 0 ? faqs : null,
      featured:     false,
      status:       'published',
      published_at: new Date().toISOString(),
    });

    if (insertError) throw new Error(`DB insert failed: ${insertError.message}`);

    // ── 8. Mark keyword as used ────────────────────────────────────────────
    await markKeywordUsed(topic);

    const durationMs = Date.now() - startTime;
    console.log(`[Agent] ✅ Published "${title}" (${slug}) in ${durationMs}ms`);

    await logRun({
      runType:    'content_generation',
      status:     'success',
      postSlug:   slug,
      details:    {
        title, category, topic, tags,
        wordCount:   markdown.split(' ').length,
        faqCount:    faqs.length,
        hadInsights: insights?.hasData ?? false,
      },
      durationMs,
    });

    return { success: true, postSlug: slug, title, hadInsights: insights?.hasData ?? false };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    console.error('[Agent] ❌ Error:', error);

    await logRun({
      runType:    'content_generation',
      status:     'error',
      error,
      durationMs,
    });

    return { success: false, error };
  }
}

/**
 * Run keyword research only (no post generation).
 * Can be triggered separately for batch keyword seeding.
 */
export async function runKeywordResearch(): Promise<AgentRunResult> {
  const startTime = Date.now();
  try {
    const { researchKeywords } = await import('./keywords');
    const niches = [
      'YouTube monetization for beginners 2026',
      'online course creation and selling',
      'creator economy and YouTube growth',
      'AI tools for content creators',
    ];

    let total = 0;
    for (const niche of niches) {
      const keywords = await researchKeywords(niche, 10);
      total += keywords.length;
    }

    await logRun({
      runType:    'keyword_research',
      status:     'success',
      details:    { keywords_generated: total },
      durationMs: Date.now() - startTime,
    });

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logRun({ runType: 'keyword_research', status: 'error', error });
    return { success: false, error };
  }
}
