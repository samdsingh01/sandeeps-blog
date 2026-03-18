/**
 * POST /api/agent/backfill-images
 * GET  /api/agent/backfill-images?preview=true  — dry run, shows what would be processed
 *
 * Regenerates cover images (and optionally inline images) for existing posts
 * that are still using picsum / pollinations fallback URLs instead of
 * Gemini-generated Supabase Storage images.
 *
 * Body (POST):
 *  {
 *    key:          string;   // CRON_SECRET
 *    slugs?:       string[]; // specific slugs to fix (omit = all posts without Supabase cover)
 *    includeInline?: boolean; // also regenerate inline section images (default: false)
 *    limit?:       number;   // max posts to process (default: 20)
 *  }
 *
 * GET ?preview=true&key=SECRET — shows posts that need images without touching anything
 */

import { NextRequest, NextResponse }                         from 'next/server';
import { getServiceClient }                                  from '@/lib/supabase';
import { fetchCoverImage, generateContentImages, injectContentImages } from '@/agent/images';

export const dynamic    = 'force-dynamic';
export const maxDuration = 300; // 5-minute max (Vercel Pro limit)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key    = searchParams.get('key') ?? '';
  const secret = process.env.CRON_SECRET ?? process.env.DEBUG_SECRET ?? '';
  if (!secret || key !== secret) {
    return NextResponse.json({ error: 'Unauthorized — pass ?key=SECRET' }, { status: 401 });
  }

  const db = getServiceClient();
  const { data: posts } = await db
    .from('posts')
    .select('slug, title, category, cover_image, content')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  const allPosts = posts ?? [];

  // Find posts that aren't using Supabase Storage
  const needsImage = allPosts.filter((p: any) =>
    !p.cover_image?.includes('supabase')
  );

  return NextResponse.json({
    totalPosts:        allPosts.length,
    needsCoverImage:   needsImage.length,
    posts: needsImage.slice(0, 30).map((p: any) => ({
      slug:            p.slug,
      title:           p.title,
      currentCover:    p.cover_image?.slice(0, 80),
      source:          p.cover_image?.includes('pollinations') ? 'Pollinations' :
                       p.cover_image?.includes('picsum') ? 'Picsum' :
                       p.cover_image?.includes('unsplash') ? 'Unsplash' : 'Unknown',
    })),
    instructions: 'POST to this endpoint with { key, limit } to regenerate images',
  });
}

export async function POST(request: NextRequest) {
  let body: { key?: string; slugs?: string[]; includeInline?: boolean; limit?: number } = {};
  try { body = await request.json(); } catch { /* empty body */ }

  const secret = process.env.CRON_SECRET ?? process.env.DEBUG_SECRET ?? '';
  if (!secret || body.key !== secret) {
    return NextResponse.json({ error: 'Unauthorized — pass key in body' }, { status: 401 });
  }

  const limit         = body.limit ?? 20;
  const includeInline = body.includeInline ?? false;
  const db            = getServiceClient();

  // Find posts to fix
  let query = db
    .from('posts')
    .select('slug, title, category, cover_image, content')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit * 5); // fetch extra to filter down

  const { data: allPosts, error: fetchErr } = await query;
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  // Select which posts to process
  let toProcess: Array<{ slug: string; title: string; category: string; cover_image: string; content: string }> =
    allPosts ?? [];

  if (body.slugs?.length) {
    toProcess = toProcess.filter((p) => body.slugs!.includes(p.slug));
  } else {
    // Auto-select posts without Supabase cover images
    toProcess = toProcess
      .filter((p) => !p.cover_image?.includes('supabase'))
      .slice(0, limit);
  }

  console.log(`[Backfill] Processing ${toProcess.length} posts for image regeneration`);

  const results: Array<{
    slug: string;
    success: boolean;
    coverUrl?: string;
    inlineCount?: number;
    error?: string;
  }> = [];

  for (const post of toProcess) {
    const { slug, title, category, content } = post;
    console.log(`[Backfill] Processing "${slug}"...`);

    try {
      // 1. Regenerate cover image
      const coverUrl = await fetchCoverImage(title, category, slug);
      const updates: Record<string, unknown> = { cover_image: coverUrl };

      // 2. Optionally regenerate inline images
      let inlineCount = 0;
      if (includeInline && content) {
        const contentImages = await generateContentImages(content, title, category, slug);
        if (contentImages.length > 0) {
          const { data: postData } = await db
            .from('posts')
            .select('content_html')
            .eq('slug', slug)
            .single();

          if (postData?.content_html) {
            updates['content_html'] = injectContentImages(postData.content_html, contentImages);
            inlineCount = contentImages.length;
          }
        }
      }

      // 3. Update DB
      const { error: updateErr } = await db
        .from('posts')
        .update(updates)
        .eq('slug', slug);

      if (updateErr) throw new Error(updateErr.message);

      const source = coverUrl.includes('supabase') ? 'Gemini/Supabase ✅'
                   : coverUrl.includes('pollinations') ? 'Pollinations ⚠️'
                   : 'Picsum ❌';

      console.log(`[Backfill] ✅ "${slug}" → ${source}`);
      results.push({ slug, success: true, coverUrl: coverUrl.slice(0, 80), inlineCount });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[Backfill] ❌ "${slug}": ${error}`);
      results.push({ slug, success: false, error: error.slice(0, 200) });
    }

    // Small delay between posts to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  const succeeded = results.filter((r) => r.success).length;
  const geminiCount = results.filter((r) => r.coverUrl?.includes('supabase')).length;

  return NextResponse.json({
    processed:    results.length,
    succeeded,
    geminiImages: geminiCount,
    pollinations: results.filter((r) => r.coverUrl?.includes('pollinations')).length,
    failed:       results.length - succeeded,
    results,
  });
}
