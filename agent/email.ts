/**
 * agent/email.ts
 * ==============
 * Email sending via Resend API.
 * Sign up free at resend.com — 3,000 emails/month free tier.
 *
 * Required env vars in Vercel:
 *   RESEND_API_KEY  = re_xxxxxxxxx  (from resend.com dashboard)
 *   REPORT_EMAIL_TO = sandeep.singh@graphy.com
 */

const RESEND_API = 'https://api.resend.com/emails';

interface SendEmailParams {
  to:      string;
  subject: string;
  html:    string;
  from?:   string;
}

export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email send');
    return false;
  }

  const from = params.from ?? 'Sandeep\'s Blog <report@sandeeps.co>';

  try {
    const res = await fetch(RESEND_API, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from,
        to:      [params.to],
        subject: params.subject,
        html:    params.html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[Email] Resend error:', data);
      return false;
    }

    console.log('[Email] Sent successfully:', data.id);
    return true;
  } catch (err) {
    console.error('[Email] Send failed:', err);
    return false;
  }
}
