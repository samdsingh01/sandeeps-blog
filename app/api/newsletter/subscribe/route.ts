/**
 * app/api/newsletter/subscribe/route.ts
 * =======================================
 * Newsletter subscription endpoint.
 * Stores email in Supabase subscribers table.
 * Sends a welcome email via Resend.
 *
 * POST /api/newsletter/subscribe
 *   Body: { email: string, source?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient }          from '@/lib/supabase';

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const FROM_EMAIL      = 'Sandeep Singh <newsletter@sandeeps.co>';
const REPLY_TO        = 'sandeep@graphy.com';

// ── POST /api/newsletter/subscribe ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { email, source = 'website' } = await req.json();

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    const normalised = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalised)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const db = getServiceClient();

    // Check if already subscribed
    const { data: existing } = await db
      .from('subscribers')
      .select('id, is_active')
      .eq('email', normalised)
      .single();

    if (existing) {
      if (existing.is_active) {
        return NextResponse.json(
          { message: 'You\'re already subscribed! Check your inbox for the latest issue.' },
          { status: 200 },
        );
      }
      // Re-activate if they previously unsubscribed
      await db
        .from('subscribers')
        .update({ is_active: true, subscribed_at: new Date().toISOString() })
        .eq('id', existing.id);

      return NextResponse.json({ message: 'Welcome back! You\'ve been re-subscribed.' });
    }

    // Insert new subscriber
    const { error: insertError } = await db.from('subscribers').insert({
      email:  normalised,
      source,
    });

    if (insertError) {
      console.error('[Newsletter] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to subscribe. Please try again.' }, { status: 500 });
    }

    // Send welcome email (non-blocking — don't fail the subscription if email fails)
    sendWelcomeEmail(normalised).catch((err) =>
      console.error('[Newsletter] Welcome email failed:', err)
    );

    console.log(`[Newsletter] New subscriber: ${normalised} (source: ${source})`);

    return NextResponse.json({
      message: 'You\'re subscribed! 🎉 Welcome email on its way.',
    });

  } catch (err) {
    console.error('[Newsletter] Error:', err);
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 });
  }
}

// ── Welcome email ─────────────────────────────────────────────────────────────

async function sendWelcomeEmail(email: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log('[Newsletter] RESEND_API_KEY not set — skipping welcome email');
    return;
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">

  <div style="background: linear-gradient(135deg, #86198f, #a21caf); border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 32px;">
    <h1 style="color: white; margin: 0 0 8px; font-size: 24px;">You're in! 🎉</h1>
    <p style="color: #e9d5ff; margin: 0; font-size: 16px;">Welcome to Sandeep's weekly creator growth newsletter</p>
  </div>

  <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hey there,</p>

  <p style="font-size: 16px; line-height: 1.6; color: #374151;">
    Thanks for subscribing! Every week I share actionable tactics for YouTube creators and online coaches to grow faster and monetize smarter.
  </p>

  <p style="font-size: 16px; line-height: 1.6; color: #374151;">Here's what you'll get:</p>

  <ul style="font-size: 15px; line-height: 2; color: #374151; padding-left: 20px;">
    <li>🎯 <strong>One growth tactic</strong> you can implement this week</li>
    <li>📊 <strong>Real data</strong> from creator campaigns (what's working right now)</li>
    <li>🔧 <strong>Tools & resources</strong> to save time and scale faster</li>
    <li>💡 <strong>Monetization ideas</strong> beyond AdSense</li>
  </ul>

  <div style="background: #fdf4ff; border: 1px solid #e9d5ff; border-radius: 12px; padding: 24px; margin: 32px 0;">
    <p style="font-size: 15px; color: #6b21a8; font-weight: 600; margin: 0 0 8px;">💡 Quick win while you wait:</p>
    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
      If you're relying only on AdSense, you're leaving 90% of your revenue on the table. The smartest creators build courses and digital products.
    </p>
    <a href="https://graphy.com?utm_source=newsletter&utm_medium=email&utm_campaign=welcome" style="display: inline-block; background: #a21caf; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Start your free course on Graphy →
    </a>
  </div>

  <p style="font-size: 15px; line-height: 1.6; color: #374151;">
    First issue drops next week. Until then, check out the latest posts at
    <a href="https://sandeeps.co" style="color: #a21caf;">sandeeps.co</a>.
  </p>

  <p style="font-size: 15px; color: #374151;">
    Sandeep Singh<br>
    <span style="color: #9ca3af;">Co-founder, Graphy.com</span>
  </p>

  <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 32px 0;">
  <p style="font-size: 12px; color: #9ca3af; text-align: center;">
    You're receiving this because you signed up at sandeeps.co.
    <a href="https://sandeeps.co/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}" style="color: #9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      [email],
      replyTo: REPLY_TO,
      subject: "You're subscribed 🎉 — Sandeep's Creator Growth Newsletter",
      html,
    }),
  });
}
