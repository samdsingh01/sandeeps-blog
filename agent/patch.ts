/**
 * agent/patch.ts
 * ==============
 * Surgical post patcher — finds specific failures in published posts and
 * fixes only the broken part, not the whole post.
 *
 * PHILOSOPHY:
 * Regenerating an entire post to fix a bad title wastes 8,000 tokens and
 * risks breaking the good parts. Instead, this module operates like a surgeon:
 *   - Bad title?          → regenerate TITLE ONLY (100 tokens)
 *   - Wrong category?     → re-classify and UPDATE DB (0 tokens)
 *   - Missing Quick Answer → INJECT Quick Answer block into existing markdown
 *   - FAQ answers too long → regenerate FAQs ONLY (500 tokens)
 *   - Thin H2 section?   → EXPAND that section only (800 tokens)
 *   - Bad description?   → regenerate DESCRIPTION ONLY (200 tokens)
 *   - Missing category?  → re-classify from title (50 tokens)
 *
 * PRIORITY ORDER (per post):
 *   1. Title issues (most visible, highest CTR impact)
 *   2. Category mismatch (affects navigation, internal linking, related posts)
 *   3. AEO issues (Quick Answer, FAQ — search visibility)
 *   4. Thin sections (content depth — ranking factor)
 *   5. Description (meta CTR)
 *
 * RUNS:
 *   - Automatically after every publish (for the new post)
 *   - Daily via /api/agent/sync (scans up to 5 posts per day)
 *   - Manually via GET /api/agent/heal?patch=true&all=true
 *
 * SAFE TO RUN MULTIPLE TIMES:
 *   Each patch checks if the issue still exists before fixing it.
 *   Already-fixed posts are skipped in < 50ms.
 */

import { askFast, ask, stripJsonFences }   from './gemini';
import { renderMarkdown, generateFAQs,
         FAQItem, classifyCategory }        from './content';
import { runPublishChecklist }             from './quality';
import { getServiceClient }               from '../lib/supabase';
import { logRun }                         from './logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PatchType =
  | 'title'
  | 'category'
  | 'quick_answer'
  | 'faqs'
  | 'thin_section'
  | 'description'
  | 'slug_quality';

export interface PatchResult {
  slug:        string;
  title:       string;
  patches:     Array<{
    type:    PatchType;
    applied: boolean;
    detail:  string;
  }>;
  totalApplied: number;
  totalFailed:  number;
}

export interface ScanResult {
  slug:     string;
  title:    string;
  category: string;
  issues:   Array<{ type: PatchType; severity: 'critical' | 'high' | 'medium'; detail: string }>;
}

// ── Scan a single post for patchable issues ───────────────────────────────────

export async function scanPost(slug: string): Promise<ScanResult | null> {
  const db = getServiceClient();

  const { data: post } = await db
    .from('posts')
    .select('slug, title, description, content, category, faq, seo_keywords, cover_image')
    .eq('slug', slug)
    .single();

  if (!post) return null;

  const faqs        = Array.isArray(post.faq) ? post.faq as FAQItem[] : [];
  const seoKeywords = Array.isArray(post.seo_keywords) ? post.seo_keywords as string[] : [];

  const checklist = runPublishChecklist({
    title:       post.title       ?? '',
    description: post.description ?? '',
    markdown:    post.content     ?? '',
    category:    post.category    ?? '',
    faqs,
    slug:        post.slug,
    coverImage:  post.cover_image ?? '',
    seoKeywords,
    topic:       seoKeywords[0]   ?? post.title ?? post.slug,
  });

  const issues: ScanResult['issues'] = [];

  for (const dim of checklist.dimensions) {
    if (dim.passed) continue;

    if (dim.name === 'Title') {
      const severity = dim.score < 40 ? 'critical' : 'high';
      issues.push({ type: 'title', severity, detail: dim.issues[0] ?? 'Title quality failure' });
    }

    if (dim.name === 'Category') {
      issues.push({ type: 'category', severity: 'high', detail: dim.issues[0] ?? 'Category mismatch' });
    }

    if (dim.name === 'AEO Compatibility') {
      // Check sub-issues
      const noQuickAnswer = dim.issues.some((i) => i.includes('Quick Answer'));
      const noFAQs        = dim.issues.some((i) => i.includes('No FAQ data'));
      const longFAQs      = dim.issues.some((i) => i.includes('exceed 70 words'));

      if (noFAQs || longFAQs) {
        issues.push({ type: 'faqs', severity: noFAQs ? 'critical' : 'high',
          detail: noFAQs ? 'No FAQ data — missing FAQPage schema' : 'FAQ answers too long for AEO extraction' });
      }
      if (noQuickAnswer) {
        issues.push({ type: 'quick_answer', severity: 'high',
          detail: 'Missing ## Quick Answer block — prime Featured Snippet target' });
      }
    }

    if (dim.name === 'Meta Description') {
      issues.push({ type: 'description', severity: 'medium', detail: dim.issues[0] ?? 'Description quality failure' });
    }

    if (dim.name === 'Content Quality') {
      // Check for thin sections specifically
      const thinIssue = dim.issues.find((i) => i.includes('THIN_SECTIONS'));
      if (thinIssue) {
        issues.push({ type: 'thin_section', severity: 'medium', detail: thinIssue });
      }
    }
  }

  return {
    slug:     post.slug,
    title:    post.title ?? '',
    category: post.category ?? '',
    issues,
  };
}

// ── Scan ALL posts and return priority-ordered issue list ─────────────────────

export async function scanAllPosts(limit = 50): Promise<ScanResult[]> {
  const db = getServiceClient();

  const { data: posts } = await db
    .from('posts')
    .select('slug, title, quality_score')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (!posts?.length) return [];

  const results: ScanResult[] = [];

  // Process in batches of 5 to stay within rate limits
  for (let i = 0; i < posts.length; i += 5) {
    const batch = posts.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map((p: { slug: string }) => scanPost(p.slug).catch(() => null)),
    );
    for (const r of batchResults) {
      if (r && r.issues.length > 0) results.push(r);
    }
    if (i + 5 < posts.length) await new Promise((res) => setTimeout(res, 500));
  }

  // Sort by severity: critical first, then high, then medium
  return results.sort((a, b) => {
    const severityScore = (s: ScanResult) =>
      s.issues.some((i) => i.severity === 'critical') ? 0 :
      s.issues.some((i) => i.severity === 'high')     ? 1 : 2;
    return severityScore(a) - severityScore(b);
  });
}

// ── Patch a single post — applies all fixes that can be applied ───────────────

export async function patchPost(slug: string): Promise<PatchResult> {
  const db = getServiceClient();

  const { data: post } = await db
    .from('posts')
    .select('*')
    .eq('slug', slug)
    .single();

  if (!post) return { slug, title: '', patches: [], totalApplied: 0, totalFailed: 0 };

  const scan = await scanPost(slug);
  if (!scan || scan.issues.length === 0) {
    return { slug, title: post.title, patches: [], totalApplied: 0, totalFailed: 0 };
  }

  console.log(`[Patch] "${post.title}" — ${scan.issues.length} issues: ${scan.issues.map((i) => i.type).join(', ')}`);

  const updates: Record<string, unknown> = {};
  const patches: PatchResult['patches'] = [];
  let markdown = post.content ?? '';

  // Process issues in priority order
  const orderedIssues = [...scan.issues].sort((a, b) => {
    const order: PatchType[] = ['title', 'category', 'quick_answer', 'faqs', 'description', 'thin_section'];
    return order.indexOf(a.type) - order.indexOf(b.type);
  });

  for (const issue of orderedIssues) {
    try {
      switch (issue.type) {

        // ── Fix: Title ─────────────────────────────────────────────────────
        case 'title': {
          const seoKeywords = Array.isArray(post.seo_keywords) ? post.seo_keywords : [];
          const newTitle = await patchTitle(post.title, post.category, seoKeywords);
          if (newTitle && newTitle !== post.title) {
            updates.title = newTitle;
            patches.push({ type: 'title', applied: true, detail: `"${post.title}" → "${newTitle}"` });
            console.log(`[Patch] ✅ Title fixed: "${post.title}" → "${newTitle}"`);
          } else {
            patches.push({ type: 'title', applied: false, detail: 'Could not generate better title' });
          }
          break;
        }

        // ── Fix: Category ──────────────────────────────────────────────────
        case 'category': {
          const titleForClassify = (updates.title as string) ?? post.title;
          const newCategory = await classifyCategory(titleForClassify);
          if (newCategory !== post.category) {
            updates.category = newCategory;
            patches.push({ type: 'category', applied: true, detail: `"${post.category}" → "${newCategory}"` });
            console.log(`[Patch] ✅ Category fixed: "${post.category}" → "${newCategory}"`);
          } else {
            patches.push({ type: 'category', applied: false, detail: 'Classifier returned same category' });
          }
          break;
        }

        // ── Fix: Quick Answer block ────────────────────────────────────────
        case 'quick_answer': {
          const faqs = Array.isArray(post.faq) ? post.faq as FAQItem[] : [];
          const { markdown: patchedMd, injected } = await patchQuickAnswer(
            markdown,
            post.title,
            faqs,
          );
          if (injected) {
            markdown = patchedMd;
            updates.content      = markdown;
            updates.content_html = await renderMarkdown(markdown);
            patches.push({ type: 'quick_answer', applied: true, detail: 'Injected ## Quick Answer block after intro' });
            console.log(`[Patch] ✅ Quick Answer injected in "${post.slug}"`);
          } else {
            patches.push({ type: 'quick_answer', applied: false, detail: 'Could not inject Quick Answer' });
          }
          break;
        }

        // ── Fix: FAQs ──────────────────────────────────────────────────────
        case 'faqs': {
          const newFaqs = await patchFAQs(post.title, markdown);
          if (newFaqs.length >= 3) {
            updates.faq = newFaqs;
            // Also ensure FAQ section exists in markdown body
            const { markdown: mdWithFAQ } = await ensureFAQSection(markdown, newFaqs);
            if (mdWithFAQ !== markdown) {
              markdown = mdWithFAQ;
              updates.content      = markdown;
              updates.content_html = await renderMarkdown(markdown);
            }
            patches.push({ type: 'faqs', applied: true, detail: `Generated ${newFaqs.length} AEO-optimised FAQs` });
            console.log(`[Patch] ✅ FAQs generated for "${post.slug}"`);
          } else {
            patches.push({ type: 'faqs', applied: false, detail: 'FAQ generation returned < 3 items' });
          }
          break;
        }

        // ── Fix: Description ───────────────────────────────────────────────
        case 'description': {
          const seoKeywords = Array.isArray(post.seo_keywords) ? post.seo_keywords : [];
          const newDesc = await patchDescription(post.title, seoKeywords);
          if (newDesc && newDesc.length >= 100) {
            updates.description = newDesc;
            patches.push({ type: 'description', applied: true, detail: `${newDesc.length} chars — "${newDesc.slice(0, 60)}..."` });
            console.log(`[Patch] ✅ Description fixed for "${post.slug}"`);
          } else {
            patches.push({ type: 'description', applied: false, detail: 'Could not generate valid description' });
          }
          break;
        }

        // ── Fix: Thin section ──────────────────────────────────────────────
        case 'thin_section': {
          const { markdown: expanded, sectionTitle } = await patchThinSection(
            markdown,
            post.title,
            post.category,
          );
          if (expanded !== markdown) {
            markdown = expanded;
            updates.content      = markdown;
            updates.content_html = await renderMarkdown(markdown);
            patches.push({ type: 'thin_section', applied: true, detail: `Expanded section: "${sectionTitle}"` });
            console.log(`[Patch] ✅ Thin section expanded in "${post.slug}": "${sectionTitle}"`);
          } else {
            patches.push({ type: 'thin_section', applied: false, detail: 'No thin sections found to expand' });
          }
          break;
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      patches.push({ type: issue.type, applied: false, detail: `Error: ${detail.slice(0, 100)}` });
      console.error(`[Patch] Error on ${issue.type} for "${slug}":`, detail);
    }
  }

  // Re-calculate reading time if content changed
  if (updates.content && typeof updates.content === 'string') {
    updates.reading_time = calcReadingTimeFromWords(updates.content);
  }

  // Apply all updates in one DB write
  const totalApplied = patches.filter((p) => p.applied).length;
  const totalFailed  = patches.filter((p) => !p.applied).length;

  if (totalApplied > 0) {
    updates.updated_at = new Date().toISOString();

    const { error: updateErr } = await db
      .from('posts')
      .update(updates)
      .eq('slug', slug);

    if (updateErr) {
      console.error(`[Patch] DB write failed for "${slug}":`, updateErr.message);
    } else {
      console.log(`[Patch] ✅ "${slug}" — ${totalApplied} patches applied, ${totalFailed} failed`);
    }

    // Log the patch run
    await logRun({
      runType:  'content_patch',
      status:   totalFailed === 0 ? 'success' : 'error',
      postSlug: slug,
      details:  {
        patchesApplied: totalApplied,
        patchesFailed:  totalFailed,
        patches: patches.map((p) => ({ type: p.type, applied: p.applied, detail: p.detail.slice(0, 80) })),
      },
    }).catch(() => {});
  }

  return {
    slug,
    title:  (updates.title as string) ?? post.title,
    patches,
    totalApplied,
    totalFailed,
  };
}

// ── Batch patcher — runs daily on up to N posts with the most critical issues ──

export async function runPatcher(maxPosts = 5): Promise<{
  scanned: number;
  patched: number;
  totalFixes: number;
  results: PatchResult[];
}> {
  console.log(`[Patcher] Scanning published posts for issues...`);

  const scanResults = await scanAllPosts(60);
  console.log(`[Patcher] Found ${scanResults.length} posts with issues`);

  if (scanResults.length === 0) {
    return { scanned: 0, patched: 0, totalFixes: 0, results: [] };
  }

  const toFix    = scanResults.slice(0, maxPosts);
  const results: PatchResult[] = [];

  for (const scan of toFix) {
    try {
      const result = await patchPost(scan.slug);
      results.push(result);
      // Small delay between posts to avoid rate limits
      await new Promise((res) => setTimeout(res, 1000));
    } catch (err) {
      console.error(`[Patcher] Failed on "${scan.slug}":`, err);
    }
  }

  const totalFixes = results.reduce((s, r) => s + r.totalApplied, 0);
  const patched    = results.filter((r) => r.totalApplied > 0).length;

  console.log(`[Patcher] ✅ Done — ${patched} posts patched, ${totalFixes} total fixes`);

  return {
    scanned:    scanResults.length,
    patched,
    totalFixes,
    results,
  };
}

// ── Individual patch functions ─────────────────────────────────────────────────

async function patchTitle(
  currentTitle: string,
  category:     string,
  seoKeywords:  string[],
): Promise<string | null> {
  const primaryKw = seoKeywords[0] ?? '';

  const raw = await askFast(
    `You are a senior SEO specialist. The following blog title is too short, vague, or stub-like.

Current title: "${currentTitle}"
Category: ${category}
Primary keyword: "${primaryKw}"

Write an improved SEO title that:
- Is 50–68 characters long (count carefully)
- Starts with a compelling hook: "How to", "X Best", "Why", "Complete Guide to", a number
- Includes "${primaryKw || currentTitle.split(' ')[0]}" near the start
- Adds a specificity signal: year 2026, a number, "for YouTube Creators", "step-by-step"
- Is benefit-driven — reader knows exactly what they'll gain

Good examples for reference:
  ✅ "How to Get Monetized on YouTube: Full 2026 Guide for Creators" (61 chars)
  ✅ "7 YouTube Monetization Strategies That Work With 1K Subscribers" (63 chars)
  ✅ "YouTube Partner Program Requirements: What Creators Need in 2026" (64 chars)
  ❌ "YouTube's Partner" (too short, no benefit)
  ❌ "YouTube Monetization Tips" (vague, no hook)

Return ONLY the improved title — no quotes, no explanation, no markdown.`,
    100, 0.4,
  );

  const cleaned = raw.trim().replace(/^["'`]|["'`]$/g, '').trim();
  if (cleaned.length >= 40 && cleaned.length <= 75 && cleaned !== currentTitle) {
    return cleaned;
  }
  return null;
}

async function patchCategory(title: string): Promise<string> {
  return classifyCategory(title);
}

async function patchQuickAnswer(
  markdown:    string,
  title:       string,
  faqs:        FAQItem[],
): Promise<{ markdown: string; injected: boolean }> {
  // Check if Quick Answer already exists
  if (/##\s*quick answer/i.test(markdown)) {
    return { markdown, injected: false };
  }

  // Use first FAQ as source if available, otherwise generate
  let question = faqs[0]?.question ?? `What do creators need to know about ${title}?`;
  let answer   = faqs[0]?.answer   ?? '';

  if (!answer || answer.split(/\s+/).length < 10) {
    // Generate a fresh Quick Answer
    const raw = await askFast(
      `Write a "Quick Answer" for this blog post title: "${title}"

The Quick Answer should:
- Be 2–3 sentences (40–60 words total)
- Start with the direct answer to what the title promises
- Include at least one specific number, stat, or timeframe
- Be self-contained — readable without any other context
- Sound like Sandeep Singh, co-founder of Graphy.com (friendly, expert, specific)

Return ONLY the answer text — no question, no label, no markdown formatting.`,
      150, 0.5,
    );
    answer   = raw.trim();
    question = `Quick answer: ${title}`;
  }

  // Find the end of the intro (first paragraph block before first H2)
  // Strategy: inject after the first blank line following the intro paragraph(s)
  const quickAnswerBlock = `\n## Quick Answer\n\n${answer}\n`;

  // Find first ## heading position
  const firstH2Match = markdown.match(/\n##\s+/);
  if (firstH2Match?.index !== undefined) {
    const insertAt = firstH2Match.index;
    const patched = markdown.slice(0, insertAt) + quickAnswerBlock + markdown.slice(insertAt);
    return { markdown: patched, injected: true };
  }

  // Fallback: inject after first two paragraphs
  const paragraphs = markdown.split('\n\n');
  if (paragraphs.length >= 2) {
    const patched = [
      ...paragraphs.slice(0, 2),
      `## Quick Answer\n\n${answer}`,
      ...paragraphs.slice(2),
    ].join('\n\n');
    return { markdown: patched, injected: true };
  }

  return { markdown, injected: false };
}

async function patchFAQs(title: string, markdown: string): Promise<FAQItem[]> {
  return generateFAQs(title, markdown);
}

async function ensureFAQSection(
  markdown: string,
  faqs:     FAQItem[],
): Promise<{ markdown: string }> {
  // Check if FAQ section already exists in body
  if (/##\s*(frequently asked|faq|common questions)/i.test(markdown)) {
    return { markdown };
  }

  // Append FAQ section at end
  const faqSection = [
    '\n\n## Frequently Asked Questions\n',
    ...faqs.map((f) => `\n**${f.question}**\n\n${f.answer}\n`),
  ].join('');

  return { markdown: markdown + faqSection };
}

async function patchDescription(title: string, seoKeywords: string[]): Promise<string | null> {
  const primaryKw = seoKeywords[0] ?? title;

  const raw = await askFast(
    `Write a meta description for this blog post: "${title}"

Requirements:
- Exactly 130–155 characters (count carefully)
- Include the keyword "${primaryKw}" naturally
- Include at least one specific number or stat
- End with a clear benefit or call to action
- No fluff — direct, specific, valuable

Return ONLY the description text — no quotes, no labels.`,
    200, 0.5,
  );

  const cleaned = raw.trim().replace(/^["'`]|["'`]$/g, '');
  if (cleaned.length >= 100 && cleaned.length <= 165) return cleaned;
  return null;
}

async function patchThinSection(
  markdown:  string,
  postTitle: string,
  category:  string,
): Promise<{ markdown: string; sectionTitle: string }> {
  // Find the thinnest H2 section (fewest words)
  const sections = markdown.split(/(?=\n## )/);
  let thinnestIdx   = -1;
  let thinnestWords = Infinity;
  let thinnestTitle = '';

  for (let i = 1; i < sections.length; i++) {
    const sec      = sections[i];
    const titleMatch = sec.match(/^## (.+)/m);
    const secTitle   = titleMatch?.[1]?.trim() ?? '';

    // Skip FAQ, Conclusion, Quick Answer, Sandeep's Take (these have deliberate lengths)
    if (/^(faq|frequently|conclusion|quick answer|sandeep|key takeaway|next step)/i.test(secTitle)) continue;

    const wordCount = sec.split(/\s+/).length;
    if (wordCount < thinnestWords) {
      thinnestWords = wordCount;
      thinnestIdx   = i;
      thinnestTitle = secTitle;
    }
  }

  if (thinnestIdx === -1 || thinnestWords >= 200) {
    return { markdown, sectionTitle: '' };
  }

  console.log(`[Patch] Expanding thin section "${thinnestTitle}" (${thinnestWords} words)`);

  // Extract the thin section content
  const thinSection = sections[thinnestIdx];

  const expanded = await ask(
    `You are Sandeep Singh, co-founder of Graphy.com (50,000+ creators). You are improving a blog post.

Post title: "${postTitle}"
Category: ${category}

The following section is too thin (under 200 words). Expand it to 350–500 words while keeping:
- The same section heading (## ${thinnestTitle})
- The same core message and any bullet points/tables already there
- First-person voice as Sandeep
- At least 2 specific numbers or stats
- One "💡 Pro Tip" callout (<div class="tip-box">💡 <strong>Pro Tip:</strong> [tip]</div>)
- Real, actionable advice — not generic filler

THIN SECTION TO EXPAND:
${thinSection}

Return ONLY the improved section markdown — starting with ## ${thinnestTitle}`,
    1500, 0.7,
  );

  if (expanded.length > thinSection.length) {
    sections[thinnestIdx] = expanded.trim() + '\n';
    return { markdown: sections.join(''), sectionTitle: thinnestTitle };
  }

  return { markdown, sectionTitle: '' };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function calcReadingTimeFromWords(markdown: string): string {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  const minutes = Math.ceil(words / 200);
  return `${minutes} min read`;
}
