import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url  = process.env.SUPABASE_URL  ?? process.env.NEXT_PUBLIC_SUPABASE_URL  ?? '';
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const envCheck = {
    SUPABASE_URL:        url  ? `✅ set (${url.slice(0, 40)}...)` : '❌ MISSING',
    SUPABASE_ANON_KEY:   anon ? `✅ set (length ${anon.length})`  : '❌ MISSING',
    SERVICE_ROLE_KEY:    process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ set' : '❌ MISSING',
    GEMINI_API_KEY:      process.env.GEMINI_API_KEY            ? '✅ set' : '❌ MISSING',
    CRON_SECRET:         process.env.CRON_SECRET               ? '✅ set' : '❌ MISSING',
  };

  if (!url || !anon) {
    return NextResponse.json({ envCheck, posts: null, error: 'Missing env vars' });
  }

  try {
    const db = createClient(url, anon);
    const { data, error } = await db
      .from('posts')
      .select('slug, title, status')
      .limit(10);

    return NextResponse.json({
      envCheck,
      postCount: data?.length ?? 0,
      posts: data,
      error: error?.message ?? null,
    });
  } catch (e) {
    return NextResponse.json({ envCheck, posts: null, error: String(e) });
  }
}
