/**
 * agent/index.ts
 * ==============
 * Main orchestrator — called by the Vercel Cron API route.
 *
 * Pipeline (with quality gate + feedback loop):
 *   0. Fetch GSC performance insights (what's ranking, what's working)
 *   1. Pick today's keyword — boosted toward hot topic clusters
 *   2. Classify category
 *   3. Generate post — Gemini writes E-E-A-T compliant, spam-free content
 *   4. Quality gate — score post 0-100, regenerate if < 65, draft if still fails
 *   5. Render markdown → HTML
 *   6. Fetch cover image
 *   7. Write to Supabase (published or draft based on quality)
 *   8. Mark keyword as used
 *   9. Run internal linking (new post ↔ existing posts)
 *  10. Generate distribution drafts (Reddit + Twitter + LinkedIn)
 */

import { getServiceClient }                                                      from '../lib/supabase';
import { pickTodaysTopic, markKeywordUsed, autoRefillIfLow }                    from './keywords';
import { classifyCategory, generatePost, renderMarkdown, calcReadingTime, slugify } from './content';
import { fetchCoverImage }                                                       from './images';
import { logRun }                                                                from './logger';
import { getFeedbackInsights }                                                   from './feedback';
import { runInternalLinking }                                                    from './links';
import { generateDistributionDrafts }                                            from './distribute';
import { checkContentQuality, summariseQualityReport, QualityReport }           from './quality';
import { generateTitleVariant }                                                  from './abtitle';
import { healPost }                                                              from './selfheal';

export interface AgentRunResult {
  success:       boolean;
  postSlug?:     string;
  title?:        string;
  error?:        string;
  skipped?:      boolean;
  reason?:       string;
  hadInsights?:  boolean;
  qualityScore?: number;
  status?:       'published' | 'draft';
}

/**
 * Run the full content generation pipeline.
 * Called daily by Vercel Cron at 08:00 UTC.
 */
export async function runAgent(): Promise<AgentRunResult> {
  const startTime = Date.now();
  const db = getServiceClient();

  try {
    // ── 0a. Auto-refill keywords if running low (non-blocking) ───────────────
    autoRefillIfLow().catch((e) => console.warn('[Agent] Auto-refill error (non-fatal):', e));

    // ── 0b. Load performance feedback (silently skipped if GSC not set up) ──
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
    let generated = await generatePost(topic, category, insights ?? undefined);
    let { title, description, slug: rawSlug, tags, seoKeywords, faqs, markdown } = generated;

    // If title is just the raw keyword (JSON parse fallback), format it properly
    if (title === topic || title === topic.toLowerCase()) {
      title = topic.replace(/\b\w/g, (c) => c.toUpperCase()); // Title Case
    }
    console.log(`[Agent] Generated: "${title}" (${faqs.length} FAQs)`);

    // ── 5. QUALITY GATE — check E-E-A-T, word count, spam signals ────────
    let qualityReport: QualityReport = checkContentQuality(markdown, title, seoKeywords[0] ?? topic);
    console.log(`[Agent] ${summariseQualityReport(qualityReport)}`);

    // If quality fails — regenerate ONCE with explicit failure feedback
    if (!qualityReport.passed) {
      console.log(`[Agent] 🔄 Quality below threshold (${qualityReport.score}/100) — regenerating with feedback...`);

      const failureContext = `
⚠️ PREVIOUS ATTEMPT FAILED QUALITY GATE (score: ${qualityReport.score}/100)
Fix these specific issues before regenerating:
${qualityReport.issues.map((i) => `  • [${i.code}] ${i.message}`).join('\n')}
${qualityReport.warnings.slice(0, 3).map((w) => `  ⚠ ${w}`).join('\n')}

Specifically:
${!qualityReport.hasPersonalVoice ? '  → ADD real first-person experience phrases and specific data from working with Graphy creators\n' : ''}
${!qualityReport.hasStats ? '  → ADD specific numbers (%, $, views, timeframes) in every section\n' : ''}
${qualityReport.aiCheckerResult?.genericPhrases.length ? `  → REMOVE these generic phrases: "${qualityReport.aiCheckerResult.genericPhrases.slice(0, 3).join('", "')}"\n` : ''}
${qualityReport.wordCount < 1400 ? `  → Current word count: ${qualityReport.wordCount}. Must reach 1,600+ words.\n` : ''}`;

      const retry = await generatePost(
        topic,
        category,
        insights ?? undefined,
        failureContext,
      );

      // Re-check quality
      const retryQuality = checkContentQuality(retry.markdown, retry.title, retry.seoKeywords[0] ?? topic);
      console.log(`[Agent] Retry quality: ${summariseQualityReport(retryQuality)}`);

      if (retryQuality.score > qualityReport.score) {
        // Use the better version
        generated = retry;
        ({ title, description, slug: rawSlug, tags, seoKeywords, faqs, markdown } = retry);
        qualityReport = retryQuality;
      }
    }

    // Determine publish status based on final quality
    // score >= 65 → publish live
    // score 45-64 → publish as draft for manual review
    // score < 45 → still draft but log warning
    const publishStatus: 'published' | 'draft' = qualityReport.score >= 65 ? 'published' : 'draft';

    if (publishStatus === 'draft') {
      console.warn(`[Agent] ⚠️ Quality score ${qualityReport.score}/100 — saving as DRAFT for manual review`);
    }

    // Ensure unique slug
    let slug = rawSlug || slugify(title);
    if (existingSlugs.includes(slug)) {
      slug = `${slug}-${Date.now()}`;
    }

    // ── 6. Render markdown → HTML ──────────────────────────────────────────
    const contentHtml = await renderMarkdown(markdown);
    const readingTime  = calcReadingTime(markdown);

    // ── 7. Fetch cover image ───────────────────────────────────────────────
    const coverImage = await fetchCoverImage(topic, category, slug);

    // ── 8. Write to Supabase ───────────────────────────────────────────────
    const { error: insertError } = await db.from('posts').insert({
      slug,
      title,
      description,
      content:        markdown,
      content_html:   contentHtml,
      category,
      tags,
      author:         'Sandeep Singh',
      author_role:    'Co-founder, Graphy.com',
      cover_image:    coverImage,
      seo_keywords:   seoKeywords,
      reading_time:   readingTime,
      faq:            faqs.length > 0 ? faqs : null,
      featured:       false,
      status:         publishStatus,
      published_at:   new Date().toISOString(), // always set — column is NOT NULL
      // Store quality metadata for trending/analysis
      quality_score:  qualityReport.score,
    });

    // Retry once with a unique slug if duplicate key
    if (insertError?.code === '23505') {
      slug = `${slug}-${Date.now()}`;
      const { error: retryError } = await db.from('posts').insert({
        slug, title, description, content: markdown, content_html: contentHtml,
        category, tags, author: 'Sandeep Singh', author_role: 'Co-founder, Graphy.com',
        cover_image: coverImage, seo_keywords: seoKeywords, reading_time: readingTime,
        faq: faqs.length > 0 ? faqs : null, featured: false, status: publishStatus,
        published_at: new Date().toISOString(), quality_score: qualityReport.score,
      });
      if (retryError) throw new Error(`DB insert failed: ${retryError.message}`);
    } else if (insertError) {
      throw new Error(`DB insert failed: ${insertError.message}`);
    }

    // ── 9. Mark keyword as used ────────────────────────────────────────────
    await markKeywordUsed(topic);

    // ── 10. Self-heal — verify and fix the post immediately after publish ──
    // Runs for ALL posts (published + draft) to fix content/image/meta issues
    healPost(slug).then((r) => {
      if (r.healed > 0) console.log(`[Agent] 🔧 Self-heal fixed ${r.healed} issues on "${slug}"`);
    }).catch((err) => console.error('[Agent] Self-heal error (non-fatal):', err));

    // ── 11. Internal linking + distribution (published only) ───────────────
    if (publishStatus === 'published') {
      runInternalLinking(slug).catch((err) =>
        console.error('[Agent] Internal linking error (non-fatal):', err)
      );

      // ── 12. Distribution drafts (async, non-blocking) ──────────────────
      generateDistributionDrafts(slug).catch((err) =>
        console.error('[Agent] Distribution drafts error (non-fatal):', err)
      );

      // ── 12. A/B title variant (async, non-blocking) ─────────────────────
      // Generates a second title to test against the original after 7 days
      generateTitleVariant(title, topic, category).then(async (titleB) => {
        if (!titleB || titleB === title) return;
        const db2 = getServiceClient();
        await db2.from('posts').update({
          title_b:               titleB,
          title_test_started_at: new Date().toISOString(),
        }).eq('slug', slug);
        console.log(`[Agent] 🧪 A/B test started — variant: "${titleB}"`);
      }).catch((err) =>
        console.error('[Agent] A/B title variant error (non-fatal):', err)
      );
    }

    const durationMs = Date.now() - startTime;
    const statusIcon = publishStatus === 'published' ? '✅' : '📋';
    console.log(`[Agent] ${statusIcon} ${publishStatus === 'published' ? 'Published' : 'Saved as draft'}: "${title}" (quality: ${qualityReport.score}/100) in ${durationMs}ms`);

    await logRun({
      runType:    'content_generation',
      status:     'success',
      postSlug:   slug,
      details:    {
        title,
        category,
        topic,
        tags,
        wordCount:       markdown.split(' ').length,
        faqCount:        faqs.length,
        hadInsights:     insights?.hasData ?? false,
        qualityScore:    qualityReport.score,
        publishStatus,
        qualityIssues:   qualityReport.issues.map((i) => i.code),
        eeatScore:       qualityReport.eeatScore,
      },
      durationMs,
    });

    return {
      success:      true,
      postSlug:     slug,
      title,
      hadInsights:  insights?.hasData ?? false,
      qualityScore: qualityReport.score,
      status:       publishStatus,
    };

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
