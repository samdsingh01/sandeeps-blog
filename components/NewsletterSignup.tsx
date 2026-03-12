'use client';

/**
 * components/NewsletterSignup.tsx
 * ================================
 * Email capture component for building the newsletter list.
 *
 * Usage variants:
 *   <NewsletterSignup />                          — default inline block
 *   <NewsletterSignup variant="banner" />         — full-width banner (for blog posts)
 *   <NewsletterSignup variant="minimal" />        — single-line compact (for sidebar)
 *   <NewsletterSignup source="youtube-tool" />    — tracks acquisition source
 */

import { useState } from 'react';

interface Props {
  variant?: 'default' | 'banner' | 'minimal';
  source?:  string;
  title?:   string;
  subtitle?: string;
}

export default function NewsletterSignup({
  variant  = 'default',
  source   = 'website',
  title    = 'Get weekly growth tactics for creators',
  subtitle = 'Join 1,000+ creators getting actionable tips on YouTube growth, course monetization, and the creator economy. No fluff.',
}: Props) {
  const [email,   setEmail]   = useState('');
  const [status,  setStatus]  = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || status === 'loading') return;

    setStatus('loading');
    setMessage('');

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, source }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus('success');
        setMessage(data.message ?? 'You\'re in! First issue lands next week.');
        setEmail('');
        // Track in GA4
        if (typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'newsletter_signup', {
            event_category: 'Engagement',
            event_label:    source,
          });
        }
      } else {
        setStatus('error');
        setMessage(data.error ?? 'Something went wrong. Try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  // ── Minimal variant ──────────────────────────────────────────────────────────
  if (variant === 'minimal') {
    return (
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          disabled={status === 'loading' || status === 'success'}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          type="submit"
          disabled={status === 'loading' || status === 'success'}
          className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-60"
        >
          {status === 'loading' ? '...' : status === 'success' ? '✓' : 'Subscribe'}
        </button>
        {message && (
          <p className={`text-xs mt-1 ${status === 'success' ? 'text-green-600' : 'text-red-500'}`}>
            {message}
          </p>
        )}
      </form>
    );
  }

  // ── Banner variant (inside blog posts) ──────────────────────────────────────
  if (variant === 'banner') {
    return (
      <div className="my-10 bg-gradient-to-br from-brand-50 to-purple-50 border border-brand-100 rounded-2xl p-6 md:p-8 not-prose">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-2xl">📩</span>
          <div>
            <h3 className="font-bold text-gray-900 text-lg leading-tight">{title}</h3>
            <p className="text-gray-600 text-sm mt-1">{subtitle}</p>
          </div>
        </div>

        {status === 'success' ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-green-700 font-medium">🎉 You&apos;re subscribed!</p>
            <p className="text-green-600 text-sm mt-1">{message}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              required
              disabled={status === 'loading'}
              className="flex-1 border border-gray-200 bg-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="bg-brand-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              {status === 'loading' ? 'Subscribing...' : 'Get weekly tips →'}
            </button>
          </form>
        )}

        {status === 'error' && (
          <p className="text-red-500 text-sm mt-2">{message}</p>
        )}
        <p className="text-xs text-gray-400 mt-3">No spam, ever. Unsubscribe in one click.</p>
      </div>
    );
  }

  // ── Default variant ──────────────────────────────────────────────────────────
  return (
    <div className="bg-gradient-to-br from-brand-700 to-brand-600 rounded-2xl p-6 md:p-8 text-white">
      <div className="max-w-xl">
        <p className="text-brand-200 text-sm font-medium mb-2">📩 Free weekly newsletter</p>
        <h3 className="text-xl md:text-2xl font-bold mb-2">{title}</h3>
        <p className="text-brand-100 text-sm mb-6">{subtitle}</p>

        {status === 'success' ? (
          <div className="bg-white/20 rounded-xl p-4">
            <p className="font-semibold">🎉 You&apos;re in!</p>
            <p className="text-brand-100 text-sm mt-1">{message}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              disabled={status === 'loading'}
              className="flex-1 bg-white/20 border border-white/30 text-white placeholder-brand-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-white/50"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="bg-white text-brand-700 font-semibold px-6 py-3 rounded-xl text-sm hover:bg-brand-50 transition-colors disabled:opacity-70 whitespace-nowrap"
            >
              {status === 'loading' ? 'Subscribing...' : 'Subscribe free →'}
            </button>
          </form>
        )}

        {status === 'error' && (
          <p className="text-red-300 text-sm mt-2">{message}</p>
        )}
        <p className="text-brand-300 text-xs mt-3">No spam. Unsubscribe anytime.</p>
      </div>
    </div>
  );
}
