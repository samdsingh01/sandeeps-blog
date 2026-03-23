/**
 * app/api/webhooks/email-reply/route.ts
 * ======================================
 * Inbound email webhook — receives Sandeep's email replies via Resend.
 *
 * ── ONE-TIME SETUP ────────────────────────────────────────────────────────────
 * 1. In Resend dashboard → Domains → sandeeps.co → verify your domain
 * 2. In Resend dashboard → Inbound → "Create route":
 *      Match: reply@sandeeps.co
 *      Webhook URL: https://sandeeps.co/api/webhooks/email-reply
 * 3. Add MX record to your DNS (Resend provides the exact record):
 *      sandeeps.co  MX  10  inbound.resend.com
 * 4. Add env var: RESEND_WEBHOOK_SECRET = <from Resend webhook settings>
 *
 * After setup, every reply to any agent email (escalations, brainstorm briefs,
 * daily reports) will hit this endpoint automatically — Sandeep just hits Reply.
 *
 * ── WHAT SANDEEP CAN SAY ─────────────────────────────────────────────────────
 *   "Write about YouTube Shorts monetization" → keyword added at priority 10
 *   "Skip that topic"                         → topic suppressed
 *   "Use case study format this week"          → format override logged
 *   "Pause for 3 days"                         → pause instruction stored
 *   "Show me stats"                            → performance email sent back
 *   "Run now"                                  → agent triggered immediately
 *   "Boost priority of [keyword]"              → priority updated
 *   "Focus on Course Creation content"         → category focus logged
 *
 * ── RESEND INBOUND PAYLOAD ────────────────────────────────────────────────────
 * https://resend.com/docs/api-reference/webhooks/inbound
 * {
 *   "type": "email.received",
 *   "data": {
 *     "from": "Sandeep Singh <sandeep.singh@graphy.com>",
 *     "to": ["reply@sandeeps.co"],
 *     "subject": "Re: 🧠 Weekly Intelligence Brief — 2026-W12",
 *     "text": "Write about YouTube Shorts monetization next week",
 *     "html": "<p>Write about YouTube Shorts...</p>",
 *     "headers": [{ "name": "In-Reply-To", "value": "<msg-id>" }]
 *   }
 * }
 */

import { type NextRequest, NextResponse } from 'next/server';
import {
  parseEmailReply,
  executeEmailActions,
  fetchAndEmailStats,
  buildConfirmationEmail,
} from '../../../../agent/email-reply';
import { sendEmail } from '../../../../agent/email';

export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

const ALLOWED_SENDERS = [
  'sandeep.singh@graphy.com',
  'sandeep@graphy.com',
  'sandeepsingh@graphy.com',
];

const REPORT_TO = process.env.REPORT_EMAIL_TO ?? 'sandeep.singh@graphy.com';

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Parse the Resend inbound payload ───────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Resend wraps inbound in { type: "email.received", data: { ... } }
    // but also supports flat format — handle both
    const emailData = body.data ?? body;

    const fromRaw    = emailData.from    ?? emailData.sender ?? '';
    const subject    = emailData.subject ?? '(no subject)';
    const textBody   = emailData.text    ?? emailData.plain_text ?? '';
    const htmlBody   = emailData.html    ?? '';

    // ── 2. Validate sender ────────────────────────────────────────────────────
    const fromEmail = extractEmailAddress(fromRaw);

    if (isAutoResponder(fromEmail, subject)) {
      console.log(`[EmailWebhook] Auto-responder ignored: ${fromEmail}`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'auto-responder' });
    }

    const isKnownSender = ALLOWED_SENDERS.some(
      (allowed) => fromEmail.toLowerCase() === allowed.toLowerCase(),
    );
    if (!isKnownSender) {
      console.warn(`[EmailWebhook] Unknown sender rejected: ${fromEmail}`);
      // Return 200 to prevent Resend retrying; just don't process it
      return NextResponse.json({ ok: true, skipped: true, reason: 'unknown_sender' });
    }

    // ── 3. Extract reply text (strip quoted original email) ───────────────────
    const raw       = textBody || stripHtml(htmlBody);
    const replyText = stripQuotedReply(raw).trim();

    if (!replyText || replyText.length < 3) {
      console.log('[EmailWebhook] Empty reply after stripping — ignoring');
      return NextResponse.json({ ok: true, skipped: true, reason: 'empty_reply' });
    }

    console.log(`[EmailWebhook] Reply from ${fromEmail} | "${replyText.slice(0, 80)}"…`);

    // ── 4. Parse with Gemini ──────────────────────────────────────────────────
    const parsed = await parseEmailReply(replyText, subject);
    console.log(
      `[EmailWebhook] Parsed ${parsed.actions.length} action(s): ` +
      parsed.actions.map((a) => a.type).join(', ')
    );

    // ── 5. Execute actions ────────────────────────────────────────────────────
    const results = await executeEmailActions(parsed.actions);

    // Handle stats request (sends a separate detailed stats email)
    const statsRequested = results.some((r) => r.description === 'STATS_REQUESTED');
    if (statsRequested) {
      fetchAndEmailStats(REPORT_TO).catch(() => {/* non-fatal */});
    }

    // ── 6. Send confirmation email back to Sandeep ────────────────────────────
    const hasActionableResults = parsed.actions.length > 0;
    if (hasActionableResults) {
      const confirmHtml = buildConfirmationEmail(
        results,
        parsed.summary,
        parsed.replyNeeded,
        parsed.clarification,
      );
      await sendEmail({
        to:      REPORT_TO,
        subject: `Re: ${subject.startsWith('Re: ') ? subject.slice(4) : subject} — Done ✅`,
        html:    confirmHtml,
        replyTo: 'reply@sandeeps.co',
      });
    }

    return NextResponse.json({
      ok:      true,
      actions: results.length,
      types:   results.map((r) => r.actionType),
    });

  } catch (err) {
    console.error('[EmailWebhook] Error:', err);
    // Always 200 — prevents Resend from retrying and spamming
    return NextResponse.json({ ok: true, error: 'internal_error' });
  }
}

// Health check
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok:       true,
    endpoint: 'email-reply webhook',
    docs:     'POST endpoint receives inbound emails from Resend. Setup: set MX record to inbound.resend.com and configure route in Resend dashboard.',
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  // Might already be just the email address
  return from.trim();
}

function isAutoResponder(email: string, subject: string): boolean {
  const emailLower   = email.toLowerCase();
  const subjectLower = subject.toLowerCase();

  const autoEmailPatterns = ['no-reply', 'noreply', 'mailer-daemon', 'postmaster', 'do-not-reply', 'bounce'];
  const autoSubjectPatterns = [
    'out of office', 'auto-reply', 'automatic reply', 'vacation reply',
    'delivery failed', 'undeliverable', 'mail delivery failure',
  ];

  return (
    autoEmailPatterns.some((p) => emailLower.includes(p)) ||
    autoSubjectPatterns.some((p) => subjectLower.includes(p))
  );
}

/**
 * Strip quoted reply content — everything after the first quote marker.
 * Email clients add different separators; we handle the most common ones.
 */
function stripQuotedReply(text: string): string {
  const lines: string[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trimStart();
    // Stop at quoted lines ("> ") or "On [date]... wrote:" patterns
    if (trimmed.startsWith('>')) break;
    if (/^On .{10,}wrote:/i.test(trimmed)) break;
    if (/^From:\s+/i.test(trimmed) && lines.length > 3) break;
    if (/^-{5,}/.test(trimmed) && lines.length > 3) break;
    lines.push(line);
  }

  return lines.join('\n').trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}
