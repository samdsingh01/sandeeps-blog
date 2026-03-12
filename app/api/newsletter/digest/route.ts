/**
 * app/api/newsletter/digest/route.ts
 * ====================================
 * Weekly digest email — sends a curated digest of the week's best posts
 * to all active subscribers.
 *
 * Runs: manually via POST, or add to vercel.json as a cron.
 * Recommended: every Monday at 9 AM UTC
 *   { "path": "/api/newsletter/digest", "schedule": "0 9 * * 1" }
 *
 * Protection: requires CRON_SECRET header (same as other agent routes).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient }          from '@/lib/supabase';
import { ask, stripJsonFences }      from '@/agent/gemini';

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const CRON_SECRET     = process.env.CRON_SECRET;
const FROM_EMAIL      = 'Sandeep Singh <newsletter@sandeeps.co>';
const REPLY_TO        = 'sandeep@graphy.com';
const SITE_URL        = 'https://sandeeps.co';

// ── Auth helper ───────────────────────────────────────────────────────────────

function isAuthorised(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const secret     = authHeader?.replace('Bearer ', '') ?? req.nextUrl.searchParams.get('secret');
  return CRON_SECRET ? secret === CRON_SECRET : true;
}

// ── GET — preview / health check ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getServiceClient();
  const { count } = await db
    .from('subscribers')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  return NextResponse.json({
    status:      'ready',
    subscribers: count ?? 0,
    message:     `POST to this endpoint to send the weekly digest to ${count ?? 0} subscribers.`,
  });
}

// ── POST — send digest ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!RESEND_API_KEY) {
    return NextResponse.json({
      error: 'RESEND_API_KEY not set — cannot send emails.',
    }, { status: 500 });
  }

  const db = getServiceClient();

  // 1. Get recent posts (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentPosts } = await db
    .from('posts')
    .select('title, slug, excerpt, category, reading_time_minutes')
    .eq('status', 'published')
    .gte('published_at', sevenDaysAgo.toISOString())
    .order('published_at', { ascending: false })
    .limit(5);

  // 2. If no recent posts, take the latest 3
  const postsToFeature = recentPosts?.length
    ? recentPosts
    : (await db
        .from('posts')
        .select('title, slug, excerpt, category, reading_time_minutes')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(3)
      ).data ?? [];

  if (!postsToFeature.length) {
    return NextResponse.json({ error: 'No posts found to feature' }, { status: 200 });
  }

  // 3. Generate a personal intro via Gemini
  const introPrompt = `You are Sandeep Singh, Co-founder of Graphy.com, writing the opening paragraph of a weekly email newsletter.

The newsletter is for YouTube creators and online coaches. This week's featured posts are:
${postsToFeature.map((p: { title: string; category: string }) => `- "${p.title}" (${p.category})`).join('\n')}

Write a warm, personal, 2-3 sentence intro for the newsletter. Sound like a founder who genuinely cares about helping creators succeed. Reference current trends if relevant. Don't be salesy. No emoji overload. Return only the paragraph text.`;

  let introText = '';
  try {
    introText = await ask(introPrompt, 200, 0.8);
  } catch {
    introText = `Happy Monday! Here are this week's top resources to help you grow your creator business. Whether you're building your YouTube channel or launching your first course, there's something useful for you below.`;
  }

  // 4. Get all active subscribers
  const { data: subscribers } = await db
    .from('subscribers')
    .select('id, email')
    .eq('is_active', true);

  if (!subscribers?.length) {
    return NextResponse.json({ message: 'No active subscribers yet.' });
  }

  // 5. Build HTML
  const postsHtml = postsToFeature.map((post: {
    title: string;
    slug: string;
    excerpt: string | null;
    category: string;
    reading_time_minutes: number | null;
  }) => `
    <div style="border: 1px solid #f3f4f6; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
      <span style="background: #fdf4ff; color: #9333ea; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px;">${post.category.replace(/-/g, ' ')}</span>
      <h3 style="margin: 10px 0 8px; font-size: 17px;">
        <a href="${SITE_URL}/blog/${post.slug}" style="color: #111827; text-decoration: none;">${post.title}</a>
      </h3>
      ${post.excerpt ? `<p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0 0 12px;">${post.excerpt}</p>` : ''}
      <a href="${SITE_URL}/blog/${post.slug}?utm_source=newsletter&utm_medium=email&utm_campaign=weekly-digest" style="color: #9333ea; font-size: 13px; font-weight: 600; text-decoration: none;">
        Read article → ${post.reading_time_minutes ? `(${post.reading_time_minutes} min)` : ''}
      </a>
    </div>
  `).join('');

  const buildHtml = (email: string) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; background: #ffffff;">

  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; border-bottom: 1px solid #f3f4f6; padding-bottom: 20px;">
    <div>
      <span style="font-weight: 700; color: #86198f; font-size: 18px;">sandeeps.co</span>
      <span style="color: #9ca3af; font-size: 13px; margin-left: 8px;">Weekly Creator Digest</span>
    </div>
    <span style="color: #9ca3af; font-size: 12px;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
  </div>

  <h2 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 16px;">This week in the creator economy 📈</h2>

  <p style="font-size: 15px; line-height: 1.7; color: #374151; margin-bottom: 28px;">${introText}</p>

  <h3 style="font-size: 14px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">This week's posts</h3>

  ${postsHtml}

  <div style="background: #fdf4ff; border: 1px solid #e9d5ff; border-radius: 12px; padding: 24px; margin: 32px 0; text-align: center;">
    <p style="font-size: 14px; font-weight: 600; color: #6b21a8; margin: 0 0 8px;">Ready to stop relying on AdSense?</p>
    <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">Build and sell your first course on Graphy — free to start.</p>
    <a href="https://graphy.com?utm_source=newsletter&utm_medium=email&utm_campaign=weekly-digest&utm_content=cta" style="display: inline-block; background: #a21caf; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Start for free →
    </a>
  </div>

  <p style="font-size: 14px; color: #374151; line-height: 1.6;">
    Until next week,<br>
    <strong>Sandeep Singh</strong><br>
    <span style="color: #9ca3af;">Co-founder, Graphy.com</span>
  </p>

  <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 32px 0;">
  <p style="font-size: 11px; color: #9ca3af; text-align: center; line-height: 1.6;">
    You're receiving this because you signed up at sandeeps.co.<br>
    <a href="${SITE_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}" style="color: #9ca3af;">Unsubscribe</a> · <a href="${SITE_URL}" style="color: #9ca3af;">View in browser</a>
  </p>
</body>
</html>`;

  // 6. Send to all subscribers (batch with small delay to respect rate limits)
  let sent    = 0;
  let failed  = 0;
  const BATCH = 50; // Resend free tier: 100 emails/day

  for (let i = 0; i < subscribers.length; i += BATCH) {
    const batch = subscribers.slice(i, i + BATCH);

    await Promise.allSettled(
      batch.map(async (sub: { id: string; email: string }) => {
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_API_KEY}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({
              from:    FROM_EMAIL,
              to:      [sub.email],
              replyTo: REPLY_TO,
              subject: `This week: ${postsToFeature[0]?.title ?? 'Creator growth tactics'}`,
              html:    buildHtml(sub.email),
            }),
          });

          if (res.ok) sent++;
          else failed++;
        } catch {
          failed++;
        }
      })
    );

    // Small pause between batches
    if (i + BATCH < subscribers.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`[Newsletter] Digest sent — ${sent} delivered, ${failed} failed`);

  return NextResponse.json({
    status:      'sent',
    subscribers: subscribers.length,
    sent,
    failed,
    posts:       postsToFeature.length,
  });
}
