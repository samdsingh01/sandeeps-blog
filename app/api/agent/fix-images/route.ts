/**
 * app/api/agent/fix-images/route.ts
 * ===================================
 * Refresh cover images for all (or specific) posts using the improved
 * topic-specific image fetching logic.
 *
 * GET /api/agent/fix-images?key=<CRON_SECRET>
 *   Preview: returns all posts and their current cover images (no changes)
 *
 * GET /api/agent/fix-images?key=<CRON_SECRET>&run=true
 *   Updates cover images for all posts that have a picsum.photos URL
 *
 * GET /api/agent/fix-images?key=<CRON_SECRET>&run=true&all=true
 *   Forces update of ALL post cover images (including Unsplash ones)
 *
 * GET /api/agent/fix-images?key=<CRON_SECRET>&slug=post-slug&run=true
 *   Updates cover image for a single post by slug
 */

import { fetchCoverImage } from '@/agent/images';
import { getServiceClient } from '@/lib/supabase';

export const dynamic     = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key    = searchParams.get('key');
  const run    = searchParams.get('run') === 'true';
  const all    = searchParams.get('all') === 'true';
  const slug   = searchParams.get('slug');

  if (key !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getServiceClient();

  // Fetch posts to update
  let query = db.from('posts').select('slug, title, category, cover_image');
  if (slug) {
    query = query.eq('slug', slug) as typeof query;
  }
  const { data: posts, error } = await query;

  if (error || !posts) {
    return Response.json({ error: 'Failed to fetch posts', detail: error?.message }, { status: 500 });
  }

  // Preview mode — just show current state
  if (!run) {
    return Response.json({
      message: 'Preview only — add &run=true to actually update images',
      total:   posts.length,
      posts:   posts.map((p) => ({
        slug:         p.slug,
        title:        p.title,
        current_image: p.cover_image,
        is_picsum:    (p.cover_image ?? '').includes('picsum.photos'),
      })),
    });
  }

  // Determine which posts need updated images
  const toUpdate = all
    ? posts
    : posts.filter((p) => (p.cover_image ?? '').includes('picsum.photos'));

  console.log(`[FixImages] Updating images for ${toUpdate.length} posts (all=${all})`);

  const results: Array<{ slug: string; old: string; new: string; ok: boolean }> = [];

  for (const post of toUpdate) {
    try {
      const newImage = await fetchCoverImage(
        post.title ?? post.slug,
        post.category ?? 'Creator Growth',
      );

      const { error: updateError } = await db
        .from('posts')
        .update({ cover_image: newImage, updated_at: new Date().toISOString() })
        .eq('slug', post.slug);

      results.push({
        slug: post.slug,
        old:  post.cover_image ?? '',
        new:  newImage,
        ok:   !updateError,
      });

      if (updateError) {
        console.error(`[FixImages] Failed to update ${post.slug}:`, updateError.message);
      } else {
        console.log(`[FixImages] ✅ Updated image for ${post.slug}`);
      }

      // Small delay between API calls to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      results.push({ slug: post.slug, old: post.cover_image ?? '', new: '', ok: false });
      console.error(`[FixImages] Error for ${post.slug}:`, err);
    }
  }

  const updated = results.filter((r) => r.ok).length;
  const failed  = results.filter((r) => !r.ok).length;

  return Response.json({
    success:  true,
    updated,
    failed,
    skipped:  posts.length - toUpdate.length,
    results,
  });
}
