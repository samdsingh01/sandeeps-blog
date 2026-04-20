/**
 * app/api/agent/heal/route.ts
 * ============================
 * Two-layer healing system for published posts:
 *
 * LAYER 1 — selfheal.ts (structural fixes):
 *   Raw JSON content, empty HTML, missing cover image, missing FAQs,
 *   missing description, missing reading time, missing SEO keywords.
 *   Runs first — ensures the post is structurally valid.
 *
 * LAYER 2 — patch.ts (quality fixes, surgical):
 *   Bad title → regenerate title only
 *   Wrong category → re-classify and update
 *   Missing Quick Answer → inject block into existing markdown
 *   Short/missing FAQs → regenerate FAQs only
 *   Thin H2 section → expand that section only
 *   Bad description → regenerate description only
 *   Runs after structural healing — improves quality without touching good parts.
 *
 * ENDPOINTS:
 *   GET  ?slug=<slug>              → heal + patch one post
 *   GET  ?slug=<slug>&patch=false  → structural heal only (no quality patching)
 *   GET  ?all=true                 → scan all posts, patch up to 5 with issues
 *   GET  ?scan=true                → scan all posts and report issues (no fixes)
 *   GET  ?all=true&publish=true    → heal + force-publish drafts
 *   POST { slug }                  → same as GET ?slug=
 *
 * Auth: Bearer <CRON_SECRET> header or ?key=<CRON_SECRET> query param.
 */

import { NextRequest, NextResponse } from 'next/server';
import { healPost }                  from '@/agent/selfheal';
import { patchPost, scanAllPosts, runPatcher } from '@/agent/patch';
import { getServiceClient }          from '@/lib/supabase';
import { checkContentQuality }       from '@/agent/quality';
import { runPublishChecklist }        from '@/agent/quality';

export const maxDuration = 300; // 5 min — patching calls Gemini multiple times
export const dynamic     = 'force-dynamic';

function isAuthorised(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const keyParam   = new URL(request.url).searchParams.get('key');
  const secret     = process.env.CRON_SECRET?.trim();
  return !secret ||
    authHeader === `Bearer ${secret}` ||
    keyParam    === secret;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const slug         = (searchParams.get('slug') ?? '').trim();
  const forcePublish = searchParams.get('publish') === 'true';
  const withPatch    = searchParams.get('patch') !== 'false'; // default true
  const healAll      = searchParams.get('all') === 'true';
  const scanOnly     = searchParams.get('scan') === 'true';
  const publishDrafts = searchParams.get('drafts') === 'true';

  // Scan all posts and return issues report (no fixes)
  if (scanOnly) {
    return runScanAll();
  }

  // Re-evaluate all draft posts and publish ones that now pass quality threshold
  if (publishDrafts) {
    return runPublishDrafts();
  }

  // Heal + patch all posts (runs patcher on up to 5 most critical)
  if (healAll) {
    return runHealAll(forcePublish, withPatch);
  }

  if (!slug) {
    return NextResponse.json({
      error: 'Provide ?slug=<slug> to fix one post, ?all=true to fix all, or ?scan=true to preview issues',
    }, { status: 400 });
  }

  return runHealOne(slug, forcePublish, withPatch);
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body         = await request.json().catch(() => ({}));
  const slug         = (body.slug ?? '').trim();
  const forcePublish = body.forcePublish ?? false;
  const withPatch    = body.patch !== false;

  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  return runHealOne(slug, forcePublish, withPatch);
}

// ── Heal one post ─────────────────────────────────────────────────────────────

async function runHealOne(slug: string, forcePublish: boolean, withPatch: boolean) {
  console.log(`[Heal] Starting for "${slug}" (patch=${withPatch}, publish=${forcePublish})`);

  // Layer 1: structural heal
  const healResult = await healPost(slug);
  console.log(`[Heal] Structural: ${healResult.healed} fixed, ${healResult.failed} failed`);

  // Layer 2: quality patch
  let patchResult = null;
  if (withPatch) {
    patchResult = await patchPost(slug);
    console.log(`[Heal] Quality patch: ${patchResult.totalApplied} applied, ${patchResult.totalFailed} failed`);
  }

  if (forcePublish) {
    const db = getServiceClient();
    await db.from('posts').update({ status: 'published' }).eq('slug', slug);
    console.log(`[Heal] Force-published "${slug}"`);
  }

  return NextResponse.json({
    success:   healResult.failed === 0,
    slug,
    structural: {
      healed: healResult.healed,
      failed: healResult.failed,
      checks: healResult.checks,
    },
    quality: patchResult ? {
      applied: patchResult.totalApplied,
      failed:  patchResult.totalFailed,
      patches: patchResult.patches,
    } : null,
    published: forcePublish,
  });
}

// ── Heal all posts ────────────────────────────────────────────────────────────

async function runHealAll(forcePublish: boolean, withPatch: boolean) {
  const db = getServiceClient();

  const { data: posts, error } = await db
    .from('posts')
    .select('slug')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error || !posts?.length) {
    return NextResponse.json({ error: 'Could not fetch posts', detail: error?.message }, { status: 500 });
  }

  console.log(`[Heal] Processing all ${posts.length} published posts...`);

  // Layer 1: structural heal on every post
  const healResults: Array<{ slug: string; healed: number; failed: number }> = [];
  for (const post of posts) {
    try {
      const result = await healPost(post.slug);
      if (forcePublish) {
        await db.from('posts').update({ status: 'published' }).eq('slug', post.slug);
      }
      healResults.push({ slug: post.slug, healed: result.healed, failed: result.failed });
    } catch (err) {
      console.error(`[Heal] Structural error on ${post.slug}:`, err);
      healResults.push({ slug: post.slug, healed: 0, failed: 1 });
    }
    await new Promise((r) => setTimeout(r, 300)); // rate limit friendly
  }

  // Layer 2: quality patch — prioritised, max 5 most critical posts per run
  let patchSummary = null;
  if (withPatch) {
    const patchRun = await runPatcher(5);
    patchSummary = {
      scanned:    patchRun.scanned,
      patched:    patchRun.patched,
      totalFixes: patchRun.totalFixes,
      details:    patchRun.results.map((r) => ({
        slug:    r.slug,
        title:   r.title,
        applied: r.totalApplied,
        patches: r.patches.filter((p) => p.applied).map((p) => `${p.type}: ${p.detail.slice(0, 60)}`),
      })),
    };
  }

  const totalHealed = healResults.reduce((s, r) => s + r.healed, 0);
  const totalFailed = healResults.reduce((s, r) => s + r.failed, 0);

  return NextResponse.json({
    success:     totalFailed === 0,
    totalPosts:  posts.length,
    structural:  { totalHealed, totalFailed },
    quality:     patchSummary,
    published:   forcePublish,
  });
}

// ── Publish drafts that pass the (new lower) quality threshold ────────────────
// Fetches all draft posts, re-evaluates quality with current thresholds,
// and publishes any that now score >= 60 overall and >= 60 on the title dimension.

async function runPublishDrafts() {
  const db = getServiceClient();

  const { data: drafts, error } = await db
    .from('posts')
    .select('slug, title, content, description, category, faq, seo_keywords')
    .eq('status', 'draft')
    .order('created_at', { ascending: false });

  if (error || !drafts?.length) {
    return NextResponse.json({
      success: true,
      message: error ? `DB error: ${error.message}` : 'No draft posts found.',
      published: [],
      stillDraft: [],
    });
  }

  console.log(`[Heal/Drafts] Evaluating ${drafts.length} draft posts...`);

  const published: string[] = [];
  const stillDraft: Array<{ slug: string; title: string; score: number; reason: string }> = [];

  for (const post of drafts) {
    try {
      const markdown     = post.content ?? '';
      const primaryKw    = ((post.seo_keywords ?? []) as string[])[0] ?? post.title;
      const qualReport   = checkContentQuality(markdown, post.title, primaryKw);
      const checklist    = runPublishChecklist({
        title:       post.title,
        description: post.description ?? '',
        markdown,
        category:    post.category ?? 'Creator Growth',
        faqs:        (post.faq ?? []) as Array<{ question: string; answer: string }>,
        slug:        post.slug,
        coverImage:  '',
        seoKeywords: (post.seo_keywords ?? []) as string[],
        topic:       primaryKw,
      });

      const titleScore = checklist.dimensions.find((d) => d.name === 'Title')?.score ?? 0;
      const passes     = qualReport.score >= 60 && titleScore >= 60;

      if (passes) {
        await db.from('posts')
          .update({ status: 'published', published_at: new Date().toISOString() })
          .eq('slug', post.slug);
        published.push(post.slug);
        console.log(`[Heal/Drafts] ✅ Published "${post.title}" (score: ${qualReport.score}, title: ${titleScore})`);
      } else {
        const reason = qualReport.score < 60
          ? `quality score too low (${qualReport.score}/100)`
          : `title score too low (${titleScore}/100)`;
        stillDraft.push({ slug: post.slug, title: post.title, score: qualReport.score, reason });
        console.log(`[Heal/Drafts] ⏸ Still draft "${post.title}" — ${reason}`);
      }
    } catch (err) {
      console.error(`[Heal/Drafts] Error on ${post.slug}:`, err);
      stillDraft.push({ slug: post.slug, title: post.title, score: 0, reason: 'evaluation error' });
    }
  }

  return NextResponse.json({
    success:    true,
    totalDrafts: drafts.length,
    published:  published.length,
    stillDraft: stillDraft.length,
    publishedSlugs: published,
    draftDetails:   stillDraft,
  });
}

// ── Scan only — returns issues without fixing ─────────────────────────────────

async function runScanAll() {
  console.log(`[Heal] Scanning all posts for issues...`);

  const scanResults = await scanAllPosts(100);

  const summary = {
    postsWithIssues: scanResults.length,
    criticalIssues:  scanResults.filter((r) => r.issues.some((i) => i.severity === 'critical')).length,
    highIssues:      scanResults.filter((r) => r.issues.some((i) => i.severity === 'high')).length,
    byIssueType:     {} as Record<string, number>,
  };

  for (const result of scanResults) {
    for (const issue of result.issues) {
      summary.byIssueType[issue.type] = (summary.byIssueType[issue.type] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    success: true,
    summary,
    posts: scanResults.map((r) => ({
      slug:     r.slug,
      title:    r.title,
      category: r.category,
      issues:   r.issues.map((i) => ({ type: i.type, severity: i.severity, detail: i.detail.slice(0, 100) })),
    })),
  });
}
