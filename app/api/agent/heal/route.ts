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

  if (!slug) {
    return NextResponse.json({ error: 'slug query param required' }, { status: 400 });
  }

  return runHeal(slug, forcePublish);
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
