/**
 * app/api/agent/heal/route.ts
 * ============================
 * Manual trigger for self-healing a specific post.
 * Useful for fixing posts that were broken before the self-heal system existed.
 *
 * POST /api/agent/heal  { slug: "youtube-shorts-monetization" }
 * GET  /api/agent/heal?slug=youtube-shorts-monetization
 *
 * Auth: same CRON_SECRET as the agent run endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { healPost }                  from '@/agent/selfheal';
import { getServiceClient }          from '@/lib/supabase';

export const maxDuration = 120; // 2 min — healing may call Gemini
export const dynamic     = 'force-dynamic';

function isAuthorised(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const keyParam   = new URL(request.url).searchParams.get('key');
  const secret     = process.env.CRON_SECRET?.trim();
  return !secret ||
    authHeader === `Bearer ${secret}` ||
    keyParam    === secret;
}

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let slug = '';
  let forcePublish = false;
  try {
    const body  = await request.json().catch(() => ({}));
    slug         = (body.slug ?? '').trim();
    forcePublish = body.forcePublish ?? false;
  } catch { /* ignore */ }

  if (!slug) {
    return NextResponse.json({ error: 'slug is required in the request body' }, { status: 400 });
  }

  return runHeal(slug, forcePublish);
}

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const slug         = (searchParams.get('slug') ?? '').trim();
  const forcePublish = searchParams.get('publish') === 'true';
  const healAll      = searchParams.get('all') === 'true';

  // Heal ALL published posts in one pass
  if (healAll) {
    return runHealAll(forcePublish);
  }

  if (!slug) {
    return NextResponse.json({ error: 'slug query param required, or use ?all=true to heal every post' }, { status: 400 });
  }

  return runHeal(slug, forcePublish);
}

async function runHealAll(forcePublish: boolean) {
  const db = getServiceClient();
  const { data: posts, error } = await db
    .from('posts')
    .select('slug')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error || !posts?.length) {
    return NextResponse.json({ error: 'Could not fetch posts', detail: error?.message }, { status: 500 });
  }

  console.log(`[Heal] Healing all ${posts.length} published posts...`);

  const results: Array<{ slug: string; healed: number; failed: number }> = [];

  for (const post of posts) {
    try {
      const { healPost } = await import('@/agent/selfheal');
      const result = await healPost(post.slug);

      if (forcePublish) {
        await db.from('posts').update({ status: 'published' }).eq('slug', post.slug);
      }

      results.push({ slug: post.slug, healed: result.healed, failed: result.failed });
      console.log(`[Heal] ✅ ${post.slug} — healed: ${result.healed}, failed: ${result.failed}`);
    } catch (err) {
      console.error(`[Heal] Error on ${post.slug}:`, err);
      results.push({ slug: post.slug, healed: 0, failed: 1 });
    }
  }

  const totalHealed = results.reduce((s, r) => s + r.healed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);

  return NextResponse.json({
    success:      totalFailed === 0,
    totalPosts:   posts.length,
    totalHealed,
    totalFailed,
    results,
  });
}

async function runHeal(slug: string, forcePublish: boolean) {
  console.log(`[Heal] Starting self-heal for "${slug}" (forcePublish=${forcePublish})`);

  const result = await healPost(slug);

  // Optionally force-publish the post (useful for posts stuck as draft)
  if (forcePublish) {
    const db = getServiceClient();
    await db.from('posts').update({ status: 'published' }).eq('slug', slug);
    console.log(`[Heal] Force-published "${slug}"`);
  }

  return NextResponse.json({
    success: result.failed === 0,
    slug,
    healed:  result.healed,
    failed:  result.failed,
    checks:  result.checks,
    published: forcePublish,
  });
}
