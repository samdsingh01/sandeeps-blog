'use client';

/**
 * app/tools/youtube-earnings-calculator/page.tsx
 * ================================================
 * Free YouTube Earnings Calculator — high-value SEO tool page.
 *
 * Targets keywords:
 *   - "youtube earnings calculator"           ~74K/mo
 *   - "how much does youtube pay per view"    ~60K/mo
 *   - "youtube money calculator"              ~40K/mo
 *   - "youtube ad revenue calculator"         ~15K/mo
 *
 * This page will naturally attract backlinks and drive organic signups.
 * CTA: "Build a course to diversify beyond AdSense → Graphy.com"
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

// ── CPM data by niche ──────────────────────────────────────────────────────────
const NICHES = [
  { label: 'Finance & Investing',    cpmLow: 12, cpmHigh: 45 },
  { label: 'Business & Marketing',   cpmLow: 10, cpmHigh: 35 },
  { label: 'Technology & Software',  cpmLow: 7,  cpmHigh: 20 },
  { label: 'Education & Tutorials',  cpmLow: 5,  cpmHigh: 15 },
  { label: 'Health & Fitness',       cpmLow: 4,  cpmHigh: 12 },
  { label: 'Beauty & Fashion',       cpmLow: 3,  cpmHigh: 10 },
  { label: 'Cooking & Food',         cpmLow: 2,  cpmHigh: 8  },
  { label: 'Travel & Adventure',     cpmLow: 2,  cpmHigh: 7  },
  { label: 'Gaming',                 cpmLow: 2,  cpmHigh: 6  },
  { label: 'Lifestyle & Vlogs',      cpmLow: 1,  cpmHigh: 5  },
  { label: 'Entertainment',          cpmLow: 1,  cpmHigh: 4  },
  { label: 'Kids & Family',          cpmLow: 1,  cpmHigh: 3  },
];

// Audience location — affects CPM significantly
const AUDIENCE_TIERS = [
  { label: 'Mostly US / UK / Australia / Canada',    multiplier: 1.0,  description: 'Highest ad rates' },
  { label: 'Mix of US + Europe',                     multiplier: 0.75, description: 'Above average' },
  { label: 'Mostly Europe / Japan / Korea',          multiplier: 0.55, description: 'Moderate rates' },
  { label: 'Mixed global audience',                  multiplier: 0.45, description: 'Average rates' },
  { label: 'Mostly India / Southeast Asia',          multiplier: 0.18, description: 'Lower ad rates' },
  { label: 'Mostly Latin America / Middle East',     multiplier: 0.22, description: 'Lower-moderate rates' },
];

// YouTube takes 45% — creator gets RPM = CPM × 0.55
const YOUTUBE_CUT = 0.45;

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

const VIEW_PRESETS = [
  { label: '10K', value: 10_000 },
  { label: '50K', value: 50_000 },
  { label: '100K', value: 100_000 },
  { label: '500K', value: 500_000 },
  { label: '1M', value: 1_000_000 },
  { label: '5M', value: 5_000_000 },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function YouTubeEarningsCalculator() {
  const [monthlyViews,     setMonthlyViews]     = useState<number>(100_000);
  const [viewsInput,       setViewsInput]        = useState<string>('100000');
  const [nicheIndex,       setNicheIndex]        = useState<number>(3);   // Education
  const [audienceIndex,    setAudienceIndex]     = useState<number>(3);   // Mixed
  const [ctrPercent,       setCtrPercent]        = useState<number>(3.5); // % of views = ad impressions

  // ── Calculation ──────────────────────────────────────────────────────────────
  const results = useMemo(() => {
    const niche    = NICHES[nicheIndex];
    const audience = AUDIENCE_TIERS[audienceIndex];

    const effectiveCPMLow  = niche.cpmLow  * audience.multiplier;
    const effectiveCPMHigh = niche.cpmHigh * audience.multiplier;
    const effectiveCPMMid  = (effectiveCPMLow + effectiveCPMHigh) / 2;

    // Ad impressions = views × CTR (only monetised views count)
    const monetisedViews = monthlyViews * (ctrPercent / 100);
    const monetisedPer1K = monetisedViews / 1000;

    // Monthly AdSense revenue
    const monthlyLow  = monetisedPer1K * effectiveCPMLow  * (1 - YOUTUBE_CUT);
    const monthlyMid  = monetisedPer1K * effectiveCPMMid  * (1 - YOUTUBE_CUT);
    const monthlyHigh = monetisedPer1K * effectiveCPMHigh * (1 - YOUTUBE_CUT);

    // RPM (Revenue Per Mille — per 1000 total views, not just monetised)
    const rpmLow  = (monthlyLow  / monthlyViews) * 1000;
    const rpmMid  = (monthlyMid  / monthlyViews) * 1000;
    const rpmHigh = (monthlyHigh / monthlyViews) * 1000;

    return {
      monthlyLow, monthlyMid, monthlyHigh,
      annualLow:  monthlyLow  * 12,
      annualMid:  monthlyMid  * 12,
      annualHigh: monthlyHigh * 12,
      rpmLow, rpmMid, rpmHigh,
      effectiveCPMLow, effectiveCPMMid, effectiveCPMHigh,
      monetisedViews,
    };
  }, [monthlyViews, nicheIndex, audienceIndex, ctrPercent]);

  const handleViewsChange = (val: string) => {
    setViewsInput(val);
    const parsed = parseInt(val.replace(/,/g, ''), 10);
    if (!isNaN(parsed) && parsed >= 0) setMonthlyViews(parsed);
  };

  // ── FAQ data (for AEO/AI answer engines) ──────────────────────────────────
  const faqs = [
    {
      q: 'How much does YouTube pay per 1000 views?',
      a: 'YouTube pays creators an RPM (Revenue Per Mille) of $1–$29 per 1,000 views, depending on your niche, audience location, and content type. Finance and business creators earn the most ($8–$29 RPM), while entertainment and kids content earns less ($0.50–$3 RPM). YouTube keeps 45% of ad revenue, so your earnings are about 55% of the total CPM.',
    },
    {
      q: 'How do I calculate my YouTube earnings?',
      a: 'To calculate YouTube earnings: (1) Find your monthly views in YouTube Studio. (2) Multiply views by your estimated monetisation rate (typically 2–5%). (3) Multiply by your niche CPM and 0.55 (your share after YouTube\'s 45% cut). Our calculator above does this automatically — just enter your views, niche, and audience location.',
    },
    {
      q: 'What is a good RPM on YouTube?',
      a: 'A good YouTube RPM depends on your niche. For education/tutorials, $2–$8 RPM is typical. Finance creators often see $10–$25 RPM. Gaming creators average $1–$4 RPM. If your RPM is below $1, consider targeting US/UK audiences or moving to higher-CPM topics.',
    },
    {
      q: 'How many views do you need to make $1,000 on YouTube?',
      a: 'To earn $1,000/month on YouTube, you typically need 100,000–500,000 monthly views, depending on your niche. Finance creators may only need 50,000 views, while entertainment creators might need 1 million+. This is why smart creators diversify with courses and digital products using platforms like Graphy.',
    },
    {
      q: 'Does YouTube pay for Shorts views?',
      a: 'Yes, YouTube Shorts now monetise through the Shorts Monetisation Module. However, RPMs for Shorts are significantly lower than long-form content — typically $0.03–$0.08 per 1,000 Shorts views vs $1–$29 for long-form videos. Most creators use Shorts for discovery, not income.',
    },
    {
      q: 'Why is my YouTube earnings lower than the calculator shows?',
      a: 'Several factors reduce actual earnings: ad blockers reduce monetised views by 15–30%, some viewers are in low-CPM countries, not all videos are fully monetised, and CPM fluctuates seasonally (highest in Q4, lowest in Q1). Use our calculator\'s "low" estimate as a conservative baseline.',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
            <span>🆓</span> Free Tool · No signup required
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
            YouTube Earnings Calculator
          </h1>
          <p className="text-xl text-brand-100 max-w-2xl mx-auto">
            Estimate how much you can earn from YouTube AdSense based on your views, niche, and audience. Updated for 2025 CPM rates.
          </p>
        </div>
      </section>

      {/* Calculator Card */}
      <section className="max-w-4xl mx-auto px-4 -mt-8 pb-16">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

          {/* Inputs */}
          <div className="p-6 md:p-8 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800 mb-6">Enter your channel details</h2>

            <div className="grid md:grid-cols-2 gap-6">

              {/* Monthly Views */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Monthly Views
                </label>
                <div className="flex gap-2 flex-wrap mb-3">
                  {VIEW_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => { setMonthlyViews(preset.value); setViewsInput(String(preset.value)); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        monthlyViews === preset.value
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={viewsInput}
                  onChange={(e) => handleViewsChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-brand-400"
                  placeholder="Enter monthly views"
                  min="0"
                />
                <p className="text-sm text-gray-500 mt-1.5">{formatViews(monthlyViews)} views/month</p>
              </div>

              {/* Niche */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Content Niche / Category
                </label>
                <select
                  value={nicheIndex}
                  onChange={(e) => setNicheIndex(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
                >
                  {NICHES.map((n, i) => (
                    <option key={n.label} value={i}>
                      {n.label} (${n.cpmLow}–${n.cpmHigh} CPM)
                    </option>
                  ))}
                </select>
              </div>

              {/* Audience location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Audience Location
                </label>
                <select
                  value={audienceIndex}
                  onChange={(e) => setAudienceIndex(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
                >
                  {AUDIENCE_TIERS.map((t, i) => (
                    <option key={t.label} value={i}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">{AUDIENCE_TIERS[audienceIndex].description}</p>
              </div>

              {/* Monetisation rate */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Monetised Views Rate: <span className="text-brand-600 font-semibold">{ctrPercent}%</span>
                  <span className="font-normal text-gray-400 ml-2">(industry avg: 3–5%)</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={ctrPercent}
                  onChange={(e) => setCtrPercent(Number(e.target.value))}
                  className="w-full accent-brand-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>1% (low)</span>
                  <span>5% (average)</span>
                  <span>10% (high)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="p-6 md:p-8 bg-gradient-to-br from-brand-50 to-white">
            <h2 className="text-lg font-semibold text-gray-800 mb-6">Your estimated earnings</h2>

            {/* Monthly earnings — 3 columns */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Conservative',  value: results.monthlyLow,  color: 'text-gray-700',   bg: 'bg-gray-50' },
                { label: 'Estimated',     value: results.monthlyMid,  color: 'text-brand-700',  bg: 'bg-brand-50' },
                { label: 'Optimistic',    value: results.monthlyHigh, color: 'text-green-700',  bg: 'bg-green-50' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={`${bg} rounded-xl p-4 text-center`}>
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={`text-2xl md:text-3xl font-bold ${color}`}>{formatMoney(value)}</p>
                  <p className="text-xs text-gray-400 mt-1">per month</p>
                </div>
              ))}
            </div>

            {/* Annual & RPM breakdown */}
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <p className="text-sm text-gray-500 mb-3 font-medium">Annual Earnings</p>
                <div className="space-y-2">
                  {[
                    { label: 'Low',  val: results.annualLow  },
                    { label: 'Mid',  val: results.annualMid  },
                    { label: 'High', val: results.annualHigh },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-gray-600">{label} estimate</span>
                      <span className="font-semibold text-gray-800">{formatMoney(val)}/yr</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <p className="text-sm text-gray-500 mb-3 font-medium">RPM (per 1,000 views)</p>
                <div className="space-y-2">
                  {[
                    { label: 'Your RPM (low)',  val: results.rpmLow  },
                    { label: 'Your RPM (mid)',  val: results.rpmMid  },
                    { label: 'Your RPM (high)', val: results.rpmHigh },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-gray-600">{label}</span>
                      <span className="font-semibold text-gray-800">${val.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Disclaimer */}
            <p className="text-xs text-gray-400 mb-6">
              * Estimates based on 2025 industry CPM data. Actual earnings vary based on ad inventory, seasonality, ad blockers, and content type. YouTube keeps 45% of ad revenue — you receive the remaining 55% as RPM.
            </p>

            {/* CTA */}
            <div className="bg-gradient-to-r from-brand-600 to-brand-700 rounded-xl p-6 text-white">
              <p className="text-sm font-medium text-brand-200 mb-1">💡 Smart creators don&apos;t rely on AdSense alone</p>
              <h3 className="text-xl font-bold mb-2">
                Turn your audience into a real business
              </h3>
              <p className="text-brand-100 text-sm mb-4">
                AdSense pays cents per view. Courses pay $97–$997 per student. Build and sell your first course on Graphy — free to start, no transaction fees.
              </p>
              <a
                href="https://graphy.com?utm_source=sandeeps-blog&utm_medium=tool&utm_campaign=youtube-calculator&utm_content=cta-bottom"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white text-brand-700 font-semibold px-6 py-3 rounded-xl hover:bg-brand-50 transition-colors"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.gtag) {
                    window.gtag('event', 'cta_click', {
                      event_category: 'CTA',
                      event_label: 'youtube-calculator-bottom',
                      link_url: 'https://graphy.com',
                    });
                  }
                }}
              >
                Start for free on Graphy →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-4 pb-16">
        <div className="bg-white rounded-2xl shadow-sm p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">How YouTube pays creators</h2>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            {[
              {
                step: '1',
                title: 'CPM (Cost Per Mille)',
                desc: 'Advertisers pay a CPM — the cost per 1,000 ad impressions. Finance and business niches command the highest CPMs ($10–$45), while entertainment earns less ($1–$5).',
              },
              {
                step: '2',
                title: 'YouTube Takes 45%',
                desc: 'YouTube keeps 45% of ad revenue. Your RPM (what you actually receive per 1,000 views) is about 55% of the gross CPM. Always focus on RPM, not CPM, when tracking your channel.',
              },
              {
                step: '3',
                title: 'Monetisation Rate',
                desc: 'Not every view shows an ad. Typically 3–5% of your views are "monetised" — meaning an ad played and the viewer didn\'t immediately skip. Ad blockers, short views, and exempt content reduce this.',
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-bold text-sm">
                  {step}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">{title}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CPM Table */}
          <h3 className="text-lg font-semibold text-gray-800 mb-4">2025 YouTube CPM Rates by Niche</h3>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Niche</th>
                  <th className="px-4 py-3 font-medium text-gray-600">CPM Range (US)</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Your RPM (est.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {NICHES.map((n) => (
                  <tr key={n.label} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{n.label}</td>
                    <td className="px-4 py-3 text-gray-600">${n.cpmLow}–${n.cpmHigh}</td>
                    <td className="px-4 py-3 font-medium text-brand-700">
                      ${(n.cpmLow * 0.55).toFixed(2)}–${(n.cpmHigh * 0.55).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ Section — AEO optimised */}
      <section className="max-w-4xl mx-auto px-4 pb-20">
        <div className="bg-white rounded-2xl shadow-sm p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Frequently Asked Questions</h2>
          <p className="text-gray-500 mb-8">Everything you need to know about YouTube earnings</p>

          <div className="space-y-6">
            {faqs.map(({ q, a }) => (
              <div key={q} className="border-b border-gray-100 pb-6 last:border-0 last:pb-0">
                <h3 className="font-semibold text-gray-900 mb-2">{q}</h3>
                <p className="text-gray-600 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Internal links */}
      <section className="max-w-4xl mx-auto px-4 pb-20">
        <div className="bg-gray-50 rounded-2xl p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Related guides for creators</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { title: 'How to Monetize Your YouTube Channel', href: '/blog' },
              { title: 'Best Platforms to Sell Online Courses', href: '/blog' },
              { title: 'How to Make Money as an Online Coach', href: '/blog' },
            ].map(({ title, href }) => (
              <Link
                key={title}
                href={href}
                className="bg-white rounded-xl p-4 border border-gray-100 hover:border-brand-300 hover:shadow-sm transition-all text-sm font-medium text-gray-700 hover:text-brand-600"
              >
                {title} →
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* JSON-LD: FAQPage + Tool schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faqs.map(({ q, a }) => ({
                '@type': 'Question',
                name: q,
                acceptedAnswer: { '@type': 'Answer', text: a },
              })),
            },
            {
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'YouTube Earnings Calculator',
              description: 'Free tool to estimate YouTube AdSense earnings based on views, niche, and audience location.',
              url: 'https://sandeeps.co/tools/youtube-earnings-calculator',
              applicationCategory: 'FinanceApplication',
              operatingSystem: 'Web',
              isAccessibleForFree: true,
              author: {
                '@type': 'Person',
                name: 'Sandeep Singh',
              },
            },
          ]),
        }}
      />
    </div>
  );
}
