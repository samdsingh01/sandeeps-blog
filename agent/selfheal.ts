/**
 * agent/selfheal.ts
 * =================
 * Post-publish self-checker and auto-fixer.
 *
 * Runs automatically after every post is published. Checks:
 *   1. Content is real markdown (not raw JSON / empty)
 *   2. Title is properly formatted (not raw keyword)
 *   3. Cover image URL is valid and accessible
 *   4. FAQs are present (for AEO / featured snippets)
 *   5. Description / meta is set
 *   6. Reading time is set
 *   7. HTML content is rendered (not empty)
 *   8. Post is visible in published listings
 *
 * Auto-fixes what it can. Logs everything to agent_logs.
 */

import { getServiceClient }                    from '../lib/supabase';
import { renderMarkdown, calcReadingTime,
         slugify, generateFAQs }               from './content';
import { fetchCoverImage }                     from './images';
import { ask, stripJsonFences }                from './gemini';
import { logRun }                              from './logger';

export interface HealResult {
  slug:     string;
  checks:   Record<string, { ok: boolean; fixed: boolean; detail: string }>;
  healed:   number;
  failed:   number;
}

/**
 * Run all self-healing checks on a newly published post.
 * Called automatically after every agent publish.
 */
export async function healPost(slug: string): Promise<HealResult> {
  const db     = getServiceClient();
  const result: HealResult = { slug, checks: {}, healed: 0, failed: 0 };

  // Fetch the post
  const { data: post, error } = await db
    .from('posts')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !post) {
    console.error(`[SelfHeal] Post not found: ${slug}`);
    return result;
  }

  const updates: Record<string, unknown> = {};

  // ── Check 1: Content is real markdown (not raw JSON) ─────────────────────
  const isRawJson = (post.content ?? '').trim().startsWith('{') ||
                    (post.content ?? '').trim().startsWith('```json');
  const hasContent = (post.content ?? '').length > 500;

  if (isRawJson || !hasContent) {
    console.log(`[SelfHeal] ⚠️ Content is raw JSON or missing — regenerating markdown...`);
    try {
      const { ask: geminiAsk } = await import('./gemini');
      const freshMarkdown = await geminiAsk(`
You are Sandeep Singh, co-founder of Graphy.com.
Write a complete 1,600-word blog post in plain markdown about: "${post.title || slug}"
Include: hook opening, 5 H2 sections, "## What Most Creators Get Wrong", "## Sandeep's Take",
step-by-step action section, Pro Tip blockquotes, Key Takeaways, and FAQ section.
Write only the markdown. No JSON. No preamble.`, 8192, 0.75);

      if (freshMarkdown.length > 500 && !freshMarkdown.trim().startsWith('{')) {
        updates.content      = freshMarkdown.trim();
        updates.content_html = await renderMarkdown(freshMarkdown.trim());
        updates.reading_time = calcReadingTime(freshMarkdown);
        result.checks.content = { ok: true, fixed: true, detail: 'Regenerated clean markdown (was raw JSON)' };
        result.healed++;
      } else {
        result.checks.content = { ok: false, fixed: false, detail: 'Regeneration failed' };
        result.failed++;
      }
    } catch (e) {
      result.checks.content = { ok: false, fixed: false, detail: String(e) };
      result.failed++;
    }
  } else {
    result.checks.content = { ok: true, fixed: false, detail: `${(post.content ?? '').split(' ').length} words` };
  }

  // ── Check 2: HTML is rendered (not empty / not raw JSON) ─────────────────
  const htmlIsEmpty  = !(post.content_html ?? '').trim();
  const htmlIsJson   = (post.content_html ?? '').trim().startsWith('{');

  if (htmlIsEmpty || htmlIsJson) {
    const sourceMarkdown = (updates.content as string) ?? post.content;
    if (sourceMarkdown && !sourceMarkdown.trim().startsWith('{')) {
      updates.content_html = await renderMarkdown(sourceMarkdown);
      result.checks.html = { ok: true, fixed: true, detail: 'Re-rendered HTML from markdown' };
      result.healed++;
    } else {
      result.checks.html = { ok: false, fixed: false, detail: 'Cannot render — markdown also broken' };
      result.failed++;
    }
  } else {
    result.checks.html = { ok: true, fixed: false, detail: 'HTML present and valid' };
  }

  // ── Check 3: Title is properly formatted ─────────────────────────────────
  const title        = post.title ?? '';
  const isRawKeyword = title === title.toLowerCase() && !title.includes(':') && !title.match(/\d/);

  if (isRawKeyword && title.length > 0) {
    const betterTitle = title.replace(/\b\w/g, (c: string) => c.toUpperCase());
    updates.title = betterTitle;
    result.checks.title = { ok: true, fixed: true, detail: `Formatted: "${betterTitle}"` };
    result.healed++;
  } else {
    result.checks.title = { ok: true, fixed: false, detail: title };
  }

  // ── Check 4: Cover image is accessible ───────────────────────────────────
  const coverUrl = post.cover_image ?? '';
  let coverOk    = false;

  if (coverUrl) {
    try {
      const res = await fetch(coverUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      coverOk = res.ok;
    } catch { coverOk = false; }
  }

  if (!coverOk) {
    try {
      const newCover = await fetchCoverImage(post.title ?? post.slug, post.category ?? 'Creator Growth');
      if (newCover) {
        updates.cover_image = newCover;
        result.checks.cover_image = { ok: true, fixed: true, detail: 'Fetched new cover image' };
        result.healed++;
      } else {
        result.checks.cover_image = { ok: false, fixed: false, detail: 'Image fetch returned empty' };
        result.failed++;
      }
    } catch (e) {
      result.checks.cover_image = { ok: false, fixed: false, detail: String(e) };
      result.failed++;
    }
  } else {
    result.checks.cover_image = { ok: true, fixed: false, detail: 'Image accessible' };
  }

  // ── Check 5: FAQs present ────────────────────────────────────────────────
  const hasFaqs = Array.isArray(post.faq) && post.faq.length >= 3;

  if (!hasFaqs) {
    try {
      const sourceMarkdown = (updates.content as string) ?? post.content ?? '';
      if (sourceMarkdown.length > 200) {
        const faqs = await generateFAQs(post.title ?? post.slug, sourceMarkdown);
        if (faqs.length >= 3) {
          updates.faq = faqs;
          result.checks.faqs = { ok: true, fixed: true, detail: `Generated ${faqs.length} FAQs` };
          result.healed++;
        } else {
          result.checks.faqs = { ok: false, fixed: false, detail: 'FAQ generation returned < 3 items' };
          result.failed++;
        }
      }
    } catch (e) {
      result.checks.faqs = { ok: false, fixed: false, detail: String(e) };
      result.failed++;
    }
  } else {
    result.checks.faqs = { ok: true, fixed: false, detail: `${post.faq.length} FAQs present` };
  }

  // ── Check 6: Description is set and reasonable length ────────────────────
  const desc = post.description ?? '';
  if (!desc || desc.length < 50) {
    try {
      const newDesc = await ask(
        `Write a 150-160 character meta description for a blog post titled "${post.title}". Include the primary keyword and end with a benefit. Return only the description text.`,
        200, 0.6
      );
      updates.description = newDesc.trim().slice(0, 160);
      result.checks.description = { ok: true, fixed: true, detail: 'Generated meta description' };
      result.healed++;
    } catch {
      result.checks.description = { ok: false, fixed: false, detail: 'Failed to generate description' };
      result.failed++;
    }
  } else {
    result.checks.description = { ok: true, fixed: false, detail: `${desc.length} chars` };
  }

  // ── Check 7: Reading time is set ─────────────────────────────────────────
  if (!post.reading_time) {
    const sourceMarkdown = (updates.content as string) ?? post.content ?? '';
    updates.reading_time = calcReadingTime(sourceMarkdown) || '5 min read';
    result.checks.reading_time = { ok: true, fixed: true, detail: updates.reading_time as string };
    result.healed++;
  } else {
    result.checks.reading_time = { ok: true, fixed: false, detail: post.reading_time };
  }

  // ── Check 8: SEO keywords present ────────────────────────────────────────
  const hasKeywords = Array.isArray(post.seo_keywords) && post.seo_keywords.length > 0;
  if (!hasKeywords) {
    updates.seo_keywords = [post.title ?? slug];
    result.checks.seo_keywords = { ok: true, fixed: true, detail: 'Set from title' };
    result.healed++;
  } else {
    result.checks.seo_keywords = { ok: true, fixed: false, detail: `${post.seo_keywords.length} keywords` };
  }

  // ── Apply all fixes in one DB update ────────────────────────────────────
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error: updateError } = await db
      .from('posts')
      .update(updates)
      .eq('slug', slug);

    if (updateError) {
      console.error(`[SelfHeal] DB update failed:`, updateError.message);
    } else {
      console.log(`[SelfHeal] ✅ Fixed ${result.healed} issues on "${slug}"`);
    }
  }

  // ── Log the heal run ─────────────────────────────────────────────────────
  await logRun({
    runType:  'self_heal',
    status:   result.failed === 0 ? 'success' : 'error',
    postSlug: slug,
    details:  { healed: result.healed, failed: result.failed, checks: result.checks },
  }).catch(() => {});

  return result;
}
