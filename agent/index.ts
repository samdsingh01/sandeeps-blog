/**
 * agent/index.ts
 * ==============
 * Main orchestrator — called by the Vercel Cron API route.
 *
 * DUAL-POST PIPELINE (2 posts per day):
 *
 * POST 1 — BOFU (Bottom-of-Funnel, keyword-driven):
 *   0a. Auto-refill keywords if low
 *   0b. Load GSC performance insights
 *    1. Pick highest-priority unused keyword from DB
 *    2. Classify category
 *    3. Generate post (E-E-A-T, tutorial/guide style, Graphy CTA)
 *    4. Quality gate (0-100 score, regenerate if < 65, draft if still fails)
 *    5. Render markdown → HTML
 *    6. Generate images in parallel (cover + 2 inline concept images)
 *    7. Write to Supabase, mark keyword used
 *    8. Self-heal, internal linking, distribution drafts, A/B title
 *
 * POST 2 — TOFU (Top-of-Funnel, trend-based):
 *   1. Pick trending creator economy topic (Google Trends + Gemini + safety check)
 *   2. Generate TOFU post (commentary/analysis style, opinionated, 900-1200 words)
 *   3. Quality gate (same threshold as BOFU)
 *   4. Render + images + publish
 *   5. Self-heal, internal linking, distribution drafts
 *
 * Agent self-awareness: imports AGENT_MISSION + escalation from agent/escalate.ts
 * Escalates to Sandeep via email before taking uncertain/risky actions.
 */

import { getServiceClient }                                                        from '../lib/supabase';
import { askFast }                                                                  from './gemini';
import { pickTodaysTopic, markKeywordUsed, autoRefillIfLow }                      from './keywords';
import { classifyCategory, generatePost, generateTofuPost, renderMarkdown, calcReadingTime, slugify } from './content';
import { fetchCoverImage, generateContentImages, injectContentImages }            from './images';
import { logRun }                                                                  from './logger';
import { getFeedbackInsights }                                                     from './feedback';
import { runInternalLinking }                                                      from './links';
import { generateDistributionDrafts }                                              from './distribute';
import { checkContentQuality, summariseQualityReport, QualityReport,
         runPublishChecklist }                                                      from './quality';
import { generateTitleVariant }                                                    from './abtitle';
import { healPost }                                                                from './selfheal';
import { checkKeywordHealth, escalateToSandeep }                                  from './escalate';
import { pickTrendingCreatorTopic }                                                from './trends';
import { analyzeCompetitors }                                                      from './competitors';
import { getCurrentWeekExperiment }                                                from './brainstorm';
import { readMemory, buildMemoryContext, updateMemoryAfterPublish }                from './memory';

export interface PostResult {
  slug:         string;
  title:        string;
  qualityScore: number;
  status:       'published' | 'draft';
  type:         'bofu' | 'tofu';
}

export interface AgentRunResult {
  success:       boolean;
  // Legacy single-post fields (kept for backward compat with report/API)
  postSlug?:     string;
  title?:        string;
  error?:        string;
  skipped?:      boolean;
  reason?:       string;
  hadInsights?:  boolean;
  qualityScore?: number;
  status?:       'published' | 'draft';
  // Dual-post results
  posts?:        PostResult[];
  bofuPost?:     PostResult;
  tofuPost?:     PostResult | null;
}

/**
 * Run the BOFU (keyword-driven) post generation pipeline.
 * Called daily by Vercel Cron at 08:00 UTC.
 *
 * NOTE: TOFU (trend-based) posts run separately via /api/agent/run-tofu
 * at 12:00 UTC. They were split because BOFU takes 3-4 minutes and the
 * combined run was hitting the 5-minute Vercel maxDuration — TOFU was
 * silently timing out and never being written.
 */
export async function runAgent(): Promise<AgentRunResult> {
  const startTime = Date.now();
  const db = getServiceClient();

  const results: PostResult[] = [];
  let hadInsights = false;

  try {
    // ── 0a. Auto-refill keywords if running low (non-blocking) ───────────────
    autoRefillIfLow().catch((e) => console.warn('[Agent] Auto-refill error (non-fatal):', e));

    // ── 0b. Keyword pipeline health check (escalates if < 5 unused) ──────────
    await checkKeywordHealth();

    // ── 0c. Load performance feedback (silently skipped if GSC not set up) ────
    console.log('[Agent] Loading performance insights...');
    const insights = await getFeedbackInsights().catch(() => null);
    if (insights?.hasData) {
      hadInsights = true;
      console.log(`[Agent] Feedback: ${insights.topPerformers.length} top performers, hot categories: ${insights.hotCategories.join(', ')}`);
    } else {
      console.log('[Agent] No GSC feedback yet — running without performance context');
    }

    // ── 1. Get all existing slugs ─────────────────────────────────────────────
    const { data: existing } = await db.from('posts').select('slug, title');
    const existingSlugs = (existing ?? []).map((r: { slug: string }) => r.slug);
    console.log(`[Agent] Found ${existingSlugs.length} existing posts`);

    // ════════════════════════════════════════════════════════════════════════
    // BOFU post (keyword-driven, bottom-of-funnel)
    // ════════════════════════════════════════════════════════════════════════
    console.log('[Agent] ── Starting BOFU post (keyword-driven) ────────────────');
    const bofuResult = await runBofuPost({ db, existingSlugs, insights });
    if (bofuResult) {
      results.push(bofuResult);
      console.log(`[Agent] ✅ BOFU done: "${bofuResult.title}" (${bofuResult.qualityScore}/100, ${bofuResult.status})`);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[Agent] 🏁 BOFU run complete in ${durationMs}ms`);

    await logRun({
      runType:    'content_generation',
      status:     'success',
      postSlug:   bofuResult?.slug,
      details:    {
        postsPublished: results.length,
        bofuSlug:       bofuResult?.slug,
        hadInsights,
        note:           'TOFU runs separately at 12:00 UTC via /api/agent/run-tofu',
      },
      durationMs,
    });

    return {
      success:      true,
      postSlug:     bofuResult?.slug,
      title:        bofuResult?.title,
      hadInsights,
      qualityScore: bofuResult?.qualityScore,
      status:       bofuResult?.status,
      posts:        results,
      bofuPost:     bofuResult ?? undefined,
      tofuPost:     null,
    };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    console.error('[Agent] ❌ Fatal error:', error);

    await escalateToSandeep({
      trigger:  'DB or API failures that block the run (agent can\'t complete)',
      action:   'Daily BOFU agent run',
      details:  { error, partialResults: results.length, durationMs },
      skipPost: false,
    }).catch(() => {/* non-fatal */});

    await logRun({ runType: 'content_generation', status: 'error', error, durationMs });

    if (results.length > 0) {
      const primary = results[0];
      return {
        success: true, postSlug: primary.slug, title: primary.title,
        hadInsights, qualityScore: primary.qualityScore, status: primary.status,
        posts: results, error: `Partial success: ${error}`,
      };
    }

    return { success: false, error };
  }
}

/**
 * Run the TOFU (trend-based) post generation pipeline.
 * Called separately at 12:00 UTC via /api/agent/run-tofu.
 *
 * Split from runAgent() so each has a full 5-minute Vercel window.
 */
export async function runTofuOnly(): Promise<AgentRunResult> {
  const startTime = Date.now();
  const db = getServiceClient();

  try {
    const { data: existing } = await db.from('posts').select('slug');
    const existingSlugs = (existing ?? []).map((r: { slug: string }) => r.slug);
    console.log(`[Agent/TOFU] ${existingSlugs.length} existing posts loaded`);

    console.log('[Agent] ── Starting TOFU post (trend-based) ──────────────────');
    const tofuResult = await runTofuPost({ db, existingSlugs });

    const durationMs = Date.now() - startTime;

    if (tofuResult) {
      console.log(`[Agent] ✅ TOFU done: "${tofuResult.title}" (${tofuResult.qualityScore}/100, ${tofuResult.status}) in ${durationMs}ms`);
      await logRun({
        runType:    'content_generation',
        status:     'success',
        postSlug:   tofuResult.slug,
        details:    { tofuSlug: tofuResult.slug, qualityScore: tofuResult.qualityScore },
        durationMs,
      });
      return {
        success:      true,
        postSlug:     tofuResult.slug,
        title:        tofuResult.title,
        qualityScore: tofuResult.qualityScore,
        status:       tofuResult.status,
        posts:        [tofuResult],
        tofuPost:     tofuResult,
      };
    }

    console.warn('[Agent/TOFU] No TOFU post produced (topic escalated or unavailable)');
    await logRun({ runType: 'content_generation', status: 'skipped', details: { reason: 'TOFU topic not available' }, durationMs });
    return { success: true, skipped: true, reason: 'TOFU topic escalated or unavailable' };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    console.error('[Agent/TOFU] ❌ Fatal error:', error);

    await escalateToSandeep({
      trigger:  'DB or API failures that block the run (agent can\'t complete)',
      action:   'Daily TOFU agent run',
      details:  { error, durationMs },
      skipPost: false,
    }).catch(() => {/* non-fatal */});

    await logRun({ runType: 'content_generation', status: 'error', error, durationMs });
    return { success: false, error };
  }
}

// ── BOFU post runner ──────────────────────────────────────────────────────────

interface RunPostOptions {
  db:             ReturnType<typeof getServiceClient>;
  existingSlugs:  string[];
  insights?:      Awaited<ReturnType<typeof getFeedbackInsights>> | null;
}

async function runBofuPost({
  db, existingSlugs, insights,
}: RunPostOptions): Promise<PostResult | null> {

  try {
    // 0. Load agent memory — gives the content generator full context:
    //    what's been covered, which categories are under-served, brand voice rules,
    //    past quality failure patterns, top-performing formats.
    const memory = await readMemory().catch(() => null);
    const memoryCtx = memory ? buildMemoryContext(memory) : '';
    if (memory) {
      const needsMore = memory.needsMoreContent.slice(0, 2).join(', ');
      console.log(`[Agent/BOFU] Memory loaded — ${memory.coveredTopics.length} covered, needs: ${needsMore}`);
    }

    // 1. Pick today's keyword-based BOFU topic
    const topic = await pickTodaysTopic(existingSlugs);
    console.log(`[Agent/BOFU] Topic: "${topic}"`);

    // 2. Classify category
    const category = await classifyCategory(topic);
    console.log(`[Agent/BOFU] Category: ${category}`);

    // 3a. Competition research (runs in parallel with nothing — non-blocking)
    //     Gives Gemini real SERP data: who's ranking, what they cover, content gaps.
    const [competitors, weeklyExperiment] = await Promise.all([
      analyzeCompetitors(topic).catch((e) => {
        console.warn('[Agent/BOFU] Competitor analysis failed (non-fatal):', e);
        return null;
      }),
      Promise.resolve(getCurrentWeekExperiment()),
    ]);
    if (competitors) {
      console.log(`[Agent/BOFU] Competitor analysis: targeting ${competitors.topDomains.slice(0, 3).join(', ')} | ${competitors.contentGaps.length} gaps found | target ${competitors.targetWordCount} words`);
    }
    console.log(`[Agent/BOFU] This week's format experiment: "${weeklyExperiment.format}"`);

    // 3b. Generate post (with competitor intelligence + weekly format experiment + memory context)
    let generated = await generatePost(topic, category, insights ?? undefined, undefined, competitors, weeklyExperiment, memoryCtx);
    let { title, description, slug: rawSlug, tags, seoKeywords, faqs, markdown } = generated;

    if (title === topic || title === topic.toLowerCase()) {
      title = topic.replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // 4. Comprehensive pre-publish checklist — covers ALL dimensions:
    //    title quality, category accuracy, AEO compatibility, content quality,
    //    cover image, slug, meta description. Each has specific fix actions.
    let slug = rawSlug || slugify(title);
    if (existingSlugs.includes(slug)) slug = `${slug}-${Date.now()}`;

    const contentHtml = await renderMarkdown(markdown);
    const readingTime  = calcReadingTime(markdown);
    const [coverImage, contentImages] = await Promise.all([
      fetchCoverImage(topic, category, slug, title),
      generateContentImages(markdown, topic, category, slug),
    ]);
    const enrichedHtml = injectContentImages(contentHtml, contentImages);

    let checklist = runPublishChecklist({
      title, description, markdown, category, faqs,
      slug, coverImage, seoKeywords, topic,
    });
    console.log(`[Agent/BOFU] ${checklist.summary}`);

    // Fix title first (without regenerating the whole post)
    if (checklist.recommendation === 'fix_title') {
      console.log(`[Agent/BOFU] 🔧 Title fix needed: "${title}" — regenerating title only`);
      try {
        const betterTitle = await askFast(
          `You are writing a blog post about: "${topic}"
Category: ${category}
The current title is too short or vague: "${title}"

Write a new SEO title that:
- Is 50–68 characters long (count carefully)
- Starts with a clear action ("How to", "X Best", "Complete Guide to", "Why")
- Includes the main keyword within the first 5 words
- Adds a specificity hook: year 2026, a number, or "for YouTube Creators"
- Is benefit-driven — reader knows what they'll gain

Good examples:
  ✅ "How to Monetize YouTube With 1,000 Subscribers in 2026" (55 chars)
  ✅ "7 Best AI Tools for YouTube Creators That Save 10 Hours" (56 chars)
  ✅ "YouTube Partner Program: How to Get Monetized Fast in 2026" (59 chars)

Return ONLY the improved title — no quotes, no explanation.`,
          100, 0.4,
        );
        const cleaned = betterTitle.trim().replace(/^["']|["']$/g, '');
        if (cleaned.length >= 40 && cleaned.length <= 75) {
          console.log(`[Agent/BOFU] ✅ Title fixed: "${title}" → "${cleaned}"`);
          title = cleaned;
          // Re-run checklist with new title
          checklist = runPublishChecklist({ title, description, markdown, category, faqs, slug, coverImage, seoKeywords, topic });
          console.log(`[Agent/BOFU] Re-check after title fix: ${checklist.summary}`);
        }
      } catch (e) {
        console.warn('[Agent/BOFU] Title fix failed (non-fatal):', e);
      }
    }

    // Fix category mismatch (no regeneration needed — just correct the data)
    let finalCategory = category;
    if (checklist.recommendation === 'fix_category') {
      const catDim = checklist.dimensions.find((d) => d.name === 'Category' && !d.passed);
      if (catDim) {
        // Re-run the classifier with the actual generated title (more accurate than keyword)
        const reclassified = await classifyCategory(title).catch(() => category);
        if (reclassified !== category) {
          console.log(`[Agent/BOFU] 🔧 Category corrected: "${category}" → "${reclassified}"`);
          finalCategory = reclassified;
        }
      }
      checklist = runPublishChecklist({ title, description, markdown, category: finalCategory, faqs, slug, coverImage, seoKeywords, topic });
    }

    // Full regeneration only if content quality itself is poor
    let qualityReport = checkContentQuality(markdown, title, seoKeywords[0] ?? topic);
    if (checklist.recommendation === 'regenerate') {
      console.log(`[Agent/BOFU] 🔄 Regenerating (${checklist.summary})...`);
      const failureContext = buildFailureContext(qualityReport, markdown);
      const retry = await generatePost(topic, finalCategory, insights ?? undefined, failureContext, competitors, weeklyExperiment, memoryCtx);
      const retryChecklist = runPublishChecklist({
        title: retry.title, description: retry.description, markdown: retry.markdown,
        category: finalCategory, faqs: retry.faqs, slug, coverImage,
        seoKeywords: retry.seoKeywords, topic,
      });
      if (retryChecklist.dimensions.filter((d) => d.passed).length >= checklist.dimensions.filter((d) => d.passed).length) {
        generated = retry;
        ({ title, description, tags, seoKeywords, faqs, markdown } = retry);
        checklist = retryChecklist;
        qualityReport = checkContentQuality(markdown, title, seoKeywords[0] ?? topic);
      }
    }

    // Escalate if still has critical failures after all fixes
    const criticalTitleFail = checklist.dimensions.find((d) => d.name === 'Title' && d.score < 40);
    if (criticalTitleFail) {
      await escalateToSandeep({
        trigger:  `Post has critical title failure after fix attempt`,
        action:   `Publish BOFU post about: "${topic}"`,
        details:  { topic, category: finalCategory, title, checklist: checklist.summary },
        skipPost: false,
      }).catch(() => {});
    }

    const publishStatus: 'published' | 'draft' =
      (qualityReport.score >= 65 && checklist.dimensions.filter((d) => d.name === 'Title')[0]?.score >= 70)
        ? 'published' : 'draft';

    // 7. Write to Supabase
    await insertPost(db, {
      slug, title, description, markdown,
      enrichedHtml: await renderMarkdown(markdown),  // re-render if markdown changed
      category: finalCategory, tags, coverImage, seoKeywords, readingTime,
      faqs, publishStatus, qualityScore: qualityReport.score,
    });

    // 8. Mark keyword used
    await markKeywordUsed(topic);

    // 9. Update agent memory with this new post
    updateMemoryAfterPublish(title, slug, finalCategory).catch(() => {/* non-fatal */});

    // 10. Post-publish async tasks
    runPostPublishTasks(slug, title, topic, finalCategory, publishStatus);

    return { slug, title, qualityScore: qualityReport.score, status: publishStatus, type: 'bofu' };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Agent/BOFU] ❌ Error:', error);
    return null; // don't let BOFU failure block TOFU
  }
}

// ── TOFU post runner ──────────────────────────────────────────────────────────

async function runTofuPost({
  db, existingSlugs,
}: { db: ReturnType<typeof getServiceClient>; existingSlugs: string[] }): Promise<PostResult | null> {

  try {
    // 1. Pick trending creator economy topic (with safety check + escalation)
    const trendTopic = await pickTrendingCreatorTopic(existingSlugs);
    if (!trendTopic) {
      console.warn('[Agent/TOFU] Topic escalated or unavailable — skipping TOFU post today');
      return null;
    }
    console.log(`[Agent/TOFU] Topic: "${trendTopic}"`);

    // 2. Generate TOFU post (commentary/analysis style)
    const generated = await generateTofuPost(trendTopic);
    let { title, description, slug: rawSlug, tags, seoKeywords, faqs, markdown, category } = generated;

    // 3. Quality gate (same threshold, but TOFU is shorter so adjust expectations)
    let qualityReport: QualityReport = checkContentQuality(markdown, title, seoKeywords[0] ?? trendTopic);
    console.log(`[Agent/TOFU] ${summariseQualityReport(qualityReport)}`);

    // TOFU posts have lower word count expectations (900-1200 vs 1200-1500)
    // Only escalate if quality is critically low, don't regenerate (trend posts are time-sensitive)
    if (qualityReport.score < 50) {
      await escalateToSandeep({
        trigger:  'Content quality score < 50 after 2 attempts',
        action:   `Publish TOFU trend post about: "${trendTopic}"`,
        details:  { trendTopic, category, qualityScore: qualityReport.score },
        skipPost: false,
      });
    }

    const publishStatus: 'published' | 'draft' = qualityReport.score >= 55 ? 'published' : 'draft';

    // 4. Ensure unique slug
    let slug = rawSlug || slugify(title);
    if (existingSlugs.includes(slug)) slug = `${slug}-${Date.now()}`;

    // 5. Render + images
    const contentHtml  = await renderMarkdown(markdown);
    const readingTime   = calcReadingTime(markdown);
    const [coverImage, contentImages] = await Promise.all([
      fetchCoverImage(trendTopic, category, slug, title),   // pass title for OG card
      generateContentImages(markdown, trendTopic, category, slug),
    ]);
    const enrichedHtml = injectContentImages(contentHtml, contentImages);

    // 6. Write to Supabase
    await insertPost(db, {
      slug, title, description, markdown, enrichedHtml,
      category, tags, coverImage, seoKeywords, readingTime,
      faqs, publishStatus, qualityScore: qualityReport.score,
    });

    // 7. Post-publish async tasks (no A/B title for TOFU — it's time-sensitive)
    runPostPublishTasks(slug, title, trendTopic, category, publishStatus, { skipABTest: true });

    return { slug, title, qualityScore: qualityReport.score, status: publishStatus, type: 'tofu' };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[Agent/TOFU] ❌ Error:', error);
    return null;
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildFailureContext(qualityReport: QualityReport, markdown: string): string {
  return `
⚠️ PREVIOUS ATTEMPT FAILED QUALITY GATE (score: ${qualityReport.score}/100)
Fix these specific issues before regenerating:
${qualityReport.issues.map((i) => `  • [${i.code}] ${i.message}`).join('\n')}
${qualityReport.warnings.slice(0, 3).map((w) => `  ⚠ ${w}`).join('\n')}

Specifically:
${!qualityReport.hasPersonalVoice ? '  → ADD real first-person experience phrases and specific data from working with Graphy creators\n' : ''}
${!qualityReport.hasStats ? '  → ADD specific numbers (%, $, views, timeframes) in every section\n' : ''}
${qualityReport.aiCheckerResult?.genericPhrases.length ? `  → REMOVE these generic phrases: "${qualityReport.aiCheckerResult.genericPhrases.slice(0, 3).join('", "')}"\n` : ''}
${qualityReport.wordCount < 1400 ? `  → Current word count: ${qualityReport.wordCount}. Must reach 1,400+ words.\n` : ''}`;
}

async function insertPost(
  db: ReturnType<typeof getServiceClient>,
  p: {
    slug: string; title: string; description: string; markdown: string; enrichedHtml: string;
    category: string; tags: string[]; coverImage: string; seoKeywords: string[]; readingTime: string;
    faqs: Array<{ question: string; answer: string }>; publishStatus: 'published' | 'draft'; qualityScore: number;
  },
): Promise<void> {
  const row = {
    slug:           p.slug,
    title:          p.title,
    description:    p.description,
    content:        p.markdown,
    content_html:   p.enrichedHtml,
    category:       p.category,
    tags:           p.tags,
    author:         'Sandeep Singh',
    author_role:    'Co-founder, Graphy.com',
    cover_image:    p.coverImage,
    seo_keywords:   p.seoKeywords,
    reading_time:   p.readingTime,
    faq:            p.faqs.length > 0 ? p.faqs : null,
    featured:       false,
    status:         p.publishStatus,
    published_at:   new Date().toISOString(),
    quality_score:  p.qualityScore,
  };

  const { error } = await db.from('posts').insert(row);

  if (error?.code === '23505') {
    // Duplicate slug — retry with timestamp suffix
    const { error: retryError } = await db.from('posts').insert({ ...row, slug: `${p.slug}-${Date.now()}` });
    if (retryError) throw new Error(`DB insert failed: ${retryError.message}`);
  } else if (error) {
    throw new Error(`DB insert failed: ${error.message}`);
  }
}

function runPostPublishTasks(
  slug: string,
  title: string,
  topic: string,
  category: string,
  publishStatus: 'published' | 'draft',
  opts?: { skipABTest?: boolean },
): void {
  // Self-heal — runs for ALL posts
  healPost(slug).then((r) => {
    if (r.healed > 0) console.log(`[Agent] 🔧 Self-heal fixed ${r.healed} issues on "${slug}"`);
  }).catch((err) => console.error('[Agent] Self-heal error (non-fatal):', err));

  if (publishStatus !== 'published') return;

  runInternalLinking(slug).catch((err) =>
    console.error('[Agent] Internal linking error (non-fatal):', err)
  );

  generateDistributionDrafts(slug).catch((err) =>
    console.error('[Agent] Distribution drafts error (non-fatal):', err)
  );

  if (!opts?.skipABTest) {
    generateTitleVariant(title, topic, category).then(async (titleB) => {
      if (!titleB || titleB === title) return;
      const db2 = getServiceClient();
      await db2.from('posts').update({
        title_b:               titleB,
        title_test_started_at: new Date().toISOString(),
      }).eq('slug', slug);
      console.log(`[Agent] 🧪 A/B test started for "${slug}" — variant: "${titleB}"`);
    }).catch((err) =>
      console.error('[Agent] A/B title variant error (non-fatal):', err)
    );
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
