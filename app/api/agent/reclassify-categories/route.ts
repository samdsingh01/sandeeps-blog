/**
 * app/api/agent/reclassify-categories/route.ts
 * =============================================
 * One-time fix: re-runs classifyCategory on all published posts and updates
 * any that were miscategorized (mostly stuck in "Creator Growth").
 *
 * WHY THIS EXISTS:
 * A bug in the old classifyCategory function (vague prompt + substring matching
 * + "Creator Growth" fallback) caused most posts to land in Creator Growth
 * regardless of actual content. This endpoint corrects the historical data.
 *
 * USAGE:
 *   GET /api/agent/reclassify-categories?key=<CRON_SECRET>&dry_run=true
 *     → Preview what would change (no DB writes)
 *   GET /api/agent/reclassify-categories?key=<CRON_SECRET>
 *     → Actually update categories in DB
 *
 * RATE LIMITING: Processes 3 posts at a time with 1s delay between batches
 * to avoid hitting Gemini rate limits.
 *
 * SAFE TO RUN MULTIPLE TIMES: Only updates posts where the new category
 * differs from the current one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient }          from '@/lib/supabase';
import { classifyCategory }          from '@/agent/content';

export const dynamic     = 'force-dynamic';
export const maxDuration = 300;  // 5 minutes — enough for ~50 posts

function isAuthorised(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const keyParam   = new URL(request.url).searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET?.trim();
  return !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    keyParam    === cronSecret;
}

// Wait helper — avoids Gemini rate limits
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get('dry_run') === 'true';
  const db     = getServiceClient();

  // Fetch all published posts
  const { data: posts, error } = await db
    .from('posts')
    .select('slug, title, category')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error || !posts) {
    return NextResponse.json({ error: 'Failed to fetch posts', detail: error?.message }, { status: 500 });
  }

  console.log(`[Reclassify] ${posts.length} posts to process (dry_run=${dryRun})`);

  const results: Array<{
    slug:        string;
    title:       string;
    oldCategory: string;
    newCategory: string;
    changed:     boolean;
  }> = [];

  // Process in batches of 3 (Gemini rate limit friendly)
  const BATCH_SIZE = 3;
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (post: { slug: string; title: string; category: string }) => {
        try {
          const newCategory = await classifyCategory(post.title);
          const changed     = newCategory !== post.category;

          if (changed && !dryRun) {
            const { error: updateErr } = await db
              .from('posts')
              .update({ category: newCategory })
              .eq('slug', post.slug);

            if (updateErr) {
              console.error(`[Reclassify] Failed to update ${post.slug}:`, updateErr.message);
            } else {
              console.log(`[Reclassify] ✅ ${post.slug}: "${post.category}" → "${newCategory}"`);
            }
          } else if (changed) {
            console.log(`[Reclassify] (dry) ${post.slug}: "${post.category}" → "${newCategory}"`);
          }

          return {
            slug:        post.slug,
            title:       post.title.slice(0, 60),
            oldCategory: post.category,
            newCategory,
            changed,
          };
        } catch (err) {
          console.error(`[Reclassify] Error on ${post.slug}:`, err);
          return {
            slug:        post.slug,
            title:       post.title.slice(0, 60),
            oldCategory: post.category,
            newCategory: post.category,  // keep unchanged on error
            changed:     false,
          };
        }
      }),
    );

    results.push(...batchResults);

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < posts.length) await wait(1200);
  }

  const changed       = results.filter((r) => r.changed);
  const unchanged     = results.filter((r) => !r.changed);
  const categoryTally = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.newCategory] = (acc[r.newCategory] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    success:      true,
    dryRun,
    totalPosts:   posts.length,
    changed:      changed.length,
    unchanged:    unchanged.length,
    categoryBreakdown: categoryTally,
    changes: changed.map((r) => ({
      slug:  r.slug,
      title: r.title,
      from:  r.oldCategory,
      to:    r.newCategory,
    })),
  });
}
