/**
 * GET /api/debug/images?key=SECRET&topic=xxx&category=yyy
 *
 * Tests Gemini image generation end-to-end:
 *  1. Generates an image prompt via Gemini
 *  2. Calls Gemini 2.0 Flash image generation (REST API)
 *  3. Uploads to Supabase Storage
 *  4. Returns the public URL + full diagnostics
 *
 * Use this to diagnose why images aren't generating.
 * Secured by DEBUG_SECRET env var (or CRON_SECRET).
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchCoverImage }           from '@/agent/images';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Auth check
  const key    = searchParams.get('key') ?? '';
  const secret = process.env.DEBUG_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!secret || key !== secret) {
    return NextResponse.json({ error: 'Unauthorized — pass ?key=SECRET' }, { status: 401 });
  }

  const topic    = searchParams.get('topic')    ?? 'how to monetize a YouTube channel with 1000 subscribers';
  const category = searchParams.get('category') ?? 'YouTube Monetization';

  // Check env vars first
  const envCheck = {
    GEMINI_API_KEY:      !!process.env.GEMINI_API_KEY,
    SUPABASE_URL:        !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_KEY:!!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const missingEnv = Object.entries(envCheck).filter(([, v]) => !v).map(([k]) => k);

  if (missingEnv.length > 0) {
    return NextResponse.json({
      success: false,
      error:   `Missing env vars: ${missingEnv.join(', ')}`,
      envCheck,
    }, { status: 500 });
  }

  // Test raw Gemini REST API directly before going through fetchCoverImage
  const apiKey    = process.env.GEMINI_API_KEY!;
  const modelTests: Array<{ model: string; status: number | null; hasImage: boolean; error: string | null }> = [];

  for (const model of ['gemini-2.0-flash-exp', 'gemini-2.0-flash-preview-image-generation']) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(apiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `Create a simple test image: a blue circle on white background.` }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal: AbortSignal.timeout(35_000),
      });

      const text = await res.text();
      let hasImage = false;
      try {
        const json = JSON.parse(text);
        hasImage = (json.candidates?.[0]?.content?.parts ?? []).some(
          (p: any) => p.inlineData?.mimeType?.startsWith('image/')
        );
      } catch { /* parse failed */ }

      modelTests.push({ model, status: res.status, hasImage, error: res.ok ? null : text.slice(0, 300) });
    } catch (err) {
      modelTests.push({ model, status: null, hasImage: false, error: String(err).slice(0, 300) });
    }
  }

  // Now run full fetchCoverImage pipeline
  const slug  = 'debug-test-image';
  const start = Date.now();
  let imageUrl: string | null = null;
  let pipelineError: string | null = null;

  try {
    imageUrl = await fetchCoverImage(topic, category, slug);
  } catch (err) {
    pipelineError = err instanceof Error ? err.message : String(err);
  }

  const isSupabaseUrl   = imageUrl?.includes('supabase') ?? false;
  const isPollinationsUrl = imageUrl?.includes('pollinations') ?? false;
  const isPicsumUrl     = imageUrl?.includes('picsum') ?? false;

  return NextResponse.json({
    success:        !!imageUrl,
    imageUrl,
    imageSource:    isSupabaseUrl ? 'Gemini → Supabase ✅' : isPollinationsUrl ? 'Pollinations fallback ⚠️' : isPicsumUrl ? 'Picsum fallback ❌' : 'unknown',
    pipelineError,
    durationMs:     Date.now() - start,
    modelTests,
    envCheck,
    topic,
    category,
  });
}
