/**
 * app/api/newsletter/unsubscribe/route.ts
 * =========================================
 * One-click unsubscribe link.
 * GET /api/newsletter/unsubscribe?email=user@example.com
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient }          from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');

  if (!email) {
    return new NextResponse(
      '<h1>Invalid unsubscribe link</h1><p>No email provided.</p>',
      { status: 400, headers: { 'Content-Type': 'text/html' } },
    );
  }

  try {
    const db = getServiceClient();
    await db
      .from('subscribers')
      .update({ is_active: false })
      .eq('email', email.toLowerCase().trim());

    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family: sans-serif; max-width: 500px; margin: 80px auto; text-align: center; color: #374151;">
  <h1 style="font-size: 32px;">✓ Unsubscribed</h1>
  <p style="color: #6b7280;">You've been removed from the newsletter. No more emails.</p>
  <p style="margin-top: 24px;"><a href="https://sandeeps.co" style="color: #9333ea;">← Back to sandeeps.co</a></p>
</body>
</html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  } catch (err) {
    console.error('[Newsletter] Unsubscribe error:', err);
    return new NextResponse(
      '<h1>Error</h1><p>Something went wrong. Please try again.</p>',
      { status: 500, headers: { 'Content-Type': 'text/html' } },
    );
  }
}
