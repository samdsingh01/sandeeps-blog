/**
 * GET /api/debug/post?slug=xxx&key=YOUR_CRON_SECRET
 *
 * Diagnostic endpoint: fetches raw post data + renders a text description
 * of what the blog post page would use. Helps isolate whether 500s are
 * caused by (a) bad data from Supabase, or (b) a rendering crash.
 *
 * Remove or restrict this after debugging.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPost, getRelatedPosts } from '@/lib/posts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug   = (searchParams.get('slug') ?? '').trim();
  const secret = process.env.CRON_SECRET?.trim();
  const key    = searchParams.get('key') ?? '';

  if (secret && key !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!slug) {
    return NextResponse.json({ error: 'slug param required' }, { status: 400 });
  }

  const result: Record<string, unknown> = { slug, timestamp: new Date().toISOString() };

  // ── Step 1: fetch post ────────────────────────────────────────────────────
  try {
    const post = await getPost(slug);
    if (!post) {
      result.postFound      = false;
      result.postError      = 'getPost returned null';
    } else {
      result.postFound      = true;
      result.title          = post.title;
      result.status         = 'published'; // only published posts are returned by getPost
      result.category       = post.category;
      result.coverImage     = post.coverImage;
      result.readingTime    = post.readingTime;
      result.date           = post.date;
      result.author         = post.author;
      result.authorRole     = post.authorRole;
      result.tagsType       = typeof post.tags;
      result.tagsIsArray    = Array.isArray(post.tags);
      result.tagsLength     = Array.isArray(post.tags) ? post.tags.length : 'n/a';
      result.faqsType       = typeof post.faqs;
      result.faqsIsArray    = Array.isArray(post.faqs);
      result.faqsLength     = Array.isArray(post.faqs) ? post.faqs.length : 'n/a';
      result.seoKwType      = typeof post.seoKeywords;
      result.seoKwIsArray   = Array.isArray(post.seoKeywords);
      result.contentType    = typeof post.content;
      result.contentLength  = (post.content ?? '').length;
      result.descriptionLen = (post.description ?? '').length;
      // Check for any null/undefined fields
      const nullFields = Object.entries(post)
        .filter(([, v]) => v === null || v === undefined)
        .map(([k]) => k);
      result.nullFields     = nullFields;
    }
  } catch (err: unknown) {
    result.postFound  = false;
    result.postError  = err instanceof Error ? err.message : String(err);
    result.postStack  = err instanceof Error ? err.stack : undefined;
  }

  // ── Step 2: fetch related posts ───────────────────────────────────────────
  try {
    const related = await getRelatedPosts(slug);
    result.relatedCount   = related.length;
    result.relatedOk      = true;
    // Check for any related posts with bad tags
    const badRelated = related.filter((p) => !Array.isArray(p.tags));
    result.relatedBadTags = badRelated.map((p) => p.slug);
  } catch (err: unknown) {
    result.relatedOk    = false;
    result.relatedError = err instanceof Error ? err.message : String(err);
  }

  // ── Step 3: simulate render safety checks ────────────────────────────────
  if (result.postFound) {
    try {
      const post = await getPost(slug); // second fetch to get typed post
      if (post) {
        const safeFaqs    = Array.isArray(post.faqs)        ? post.faqs        : [];
        const safeTags    = Array.isArray(post.tags)        ? post.tags        : [];
        const safeSeoKw   = Array.isArray(post.seoKeywords) ? post.seoKeywords : [];
        const safeContent = post.content ?? '';

        // Simulate schema construction (what page.tsx does)
        const articleSchema = {
          "@context":  "https://schema.org",
          "@type":     "Article",
          headline:    post.title,
          description: post.description,
          author:      { "@type": "Person", name: post.author },
          datePublished: post.date,
          keywords:    safeSeoKw.join(", "),
        };
        JSON.stringify(articleSchema); // will throw if circular or non-serializable

        result.renderSimulation = {
          ok:              true,
          safeFaqsLength:  safeFaqs.length,
          safeTagsLength:  safeTags.length,
          safeContentLen:  safeContent.length,
          articleSchemaOk: true,
          faqSchemaOk:     safeFaqs.length > 0,
        };
      }
    } catch (err: unknown) {
      result.renderSimulation = {
        ok:    false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      };
    }
  }

  // ── Step 4: env var check ─────────────────────────────────────────────────
  result.envCheck = {
    hasSupabaseUrl:     !!(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasAnonKey:         !!(process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasServiceKey:      !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasCronSecret:      !!process.env.CRON_SECRET,
  };

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
