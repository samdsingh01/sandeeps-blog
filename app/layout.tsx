import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import UTMProvider from '@/components/UTMProvider';
import { GoogleAnalytics } from '@next/third-parties/google';

export const metadata: Metadata = {
  metadataBase: new URL('https://sandeeps.co'),
  title: {
    default: "Sandeep's Blog — Grow, Monetize & Build Your Creator Business",
    template: "%s | Sandeep's Blog",
  },
  description:
    'Actionable guides for early-stage YouTube creators and coaches to monetize their audience, create online courses, and build a sustainable creator business.',
  keywords: [
    'youtube monetization',
    'how to make money on youtube',
    'creator economy',
    'online course creation',
    'youtube for beginners',
    'content creator tips',
    'graphy course platform',
  ],
  authors: [{ name: 'Sandeep Singh', url: 'https://graphy.com' }],
  creator: 'Sandeep Singh',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://sandeeps.co',
    siteName: "Sandeep's Blog",
    images: [{ url: '/images/og-default.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    creator: '@graphyapp',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  // Google Search Console verification — set NEXT_PUBLIC_SEARCH_CONSOLE_VERIFICATION in Vercel env vars
  ...(process.env.NEXT_PUBLIC_SEARCH_CONSOLE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_SEARCH_CONSOLE_VERIFICATION } }
    : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        {/* NOTE: Per-page canonical URLs are set in each page's generateMetadata() — NOT here.
            A hardcoded canonical here would wrongly point every post to the homepage. */}
        {/* WebSite entity — SearchAction enables Google Sitelinks Search Box */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type':    'WebSite',
              '@id':      'https://sandeeps.co/#website',
              name:       "Sandeep's Blog",
              url:        'https://sandeeps.co',
              description: 'Actionable guides for YouTube creators and online coaches to grow and monetize their audience.',
              inLanguage:  'en-US',
              potentialAction: {
                '@type':       'SearchAction',
                target: {
                  '@type':     'EntryPoint',
                  urlTemplate: 'https://sandeeps.co/blog?q={search_term_string}',
                },
                'query-input': 'required name=search_term_string',
              },
            }),
          }}
        />
        {/* Person entity — @id allows Article schemas to reference Sandeep
            consistently, which AI engines use to build author authority graphs */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context':  'https://schema.org',
              '@type':     'Person',
              '@id':       'https://sandeeps.co/#author',
              name:        'Sandeep Singh',
              url:         'https://sandeeps.co/about',
              jobTitle:    'Co-founder',
              description: 'Sandeep Singh is co-founder of Graphy.com, a platform used by 50,000+ creators to build and sell online courses. He writes about YouTube monetization, creator growth, and building online businesses.',
              worksFor: {
                '@type': 'Organization',
                '@id':   'https://graphy.com/#organization',
                name:    'Graphy.com',
                url:     'https://graphy.com',
              },
              sameAs: [
                'https://graphy.com',
                'https://twitter.com/graphyapp',
              ],
            }),
          }}
        />
      </head>
      <body>
        {/* UTMProvider captures ?utm_* params on every page load and persists to cookie */}
        <UTMProvider />
        <Header />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
      {/* Google Analytics 4 — GA ID is hardcoded; override via NEXT_PUBLIC_GA_ID env var if needed */}
      <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID ?? 'G-KJG6E7PGJR'} />
    </html>
  );
}
