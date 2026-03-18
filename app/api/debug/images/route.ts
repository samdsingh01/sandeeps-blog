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

  // Check env vars — mirrors exactly what lib/supabase.ts and agent/images.ts use
  // SUPABASE_URL is the preferred name; NEXT_PUBLIC_SUPABASE_URL is the fallback
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envCheck = {
    GEMINI_API_KEY:           !!process.env.GEMINI_API_KEY,
    SUPABASE_URL:             !!process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL_resolved:    !!supabaseUrl,   // true if either var is set
    SUPABASE_SERVICE_KEY:     !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET:              !!process.env.CRON_SECRET,
  };

  // Only block if Gemini key or Supabase URL is truly missing (check both var names)
  const criticalMissing: string[] = [];
  if (!process.env.GEMINI_API_KEY)    criticalMissing.push('GEMINI_API_KEY');
  if (!supabaseUrl)                   criticalMissing.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) criticalMissing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (criticalMissing.length > 0) {
    return NextResponse.json({
      success: false,
      error:   `Missing env vars: ${criticalMissing.join(', ')}`,
      envCheck,
      hint:    'Set these in Vercel Dashboard → Settings → Environment Variables',
    }, { status: 500 });
  }

  // Test all candidate models directly against the Gemini REST API
  const apiKey     = process.env.GEMINI_API_KEY!;
  const testPrompt = 'A simple blue circle on a white background.';
  const modelTests: Array<{ model: string; endpoint: string; status: number | null; hasImage: boolean; error: string | null }> = [];

  // generateContent models (Gemini 2.0 Flash image gen)
  for (const model of [
    'gemini-2.0-flash-exp-image-generation',  // ← correct name
    'gemini-2.0-flash-exp',                   // generic flash (no image gen)
    'gemini-2.0-flash-preview-image-generation', // old name — expect 404
  ]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: testPrompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          signal: AbortSignal.timeout(35_000),
        }
      );
      const text = await res.text();
      let hasImage = false;
      try {
        const json = JSON.parse(text);
        hasImage = (json.candidates?.[0]?.content?.parts ?? []).some(
          (p: any) => p.inlineData?.mimeType?.startsWith('image/')
        );
      } catch { /* noop */ }
      modelTests.push({ model, endpoint: 'generateContent', status: res.status, hasImage, error: res.ok ? null : text.slice(0, 250) });
    } catch (err) {
      modelTests.push({ model, endpoint: 'generateContent', status: null, hasImage: false, error: String(err).slice(0, 250) });
    }
  }

  // predict models (Imagen 3 — different endpoint and request format)
  for (const model of ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: testPrompt }],
            parameters: { sampleCount: 1, aspectRatio: '16:9' },
          }),
          signal: AbortSignal.timeout(35_000),
        }
      );
      const text = await res.text();
      let hasImage = false;
      try {
        const json = JSON.parse(text);
        hasImage = !!(json.predictions?.[0]?.bytesBase64Encoded);
      } catch { /* noop */ }
      modelTests.push({ model, endpoint: 'predict', status: res.status, hasImage, error: res.ok ? null : text.slice(0, 250) });
    } catch (err) {
      modelTests.push({ model, endpoint: 'predict', status: null, hasImage: false, error: String(err).slice(0, 250) });
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
