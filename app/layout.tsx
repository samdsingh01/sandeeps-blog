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
        <link rel="canonical" href="https://sandeeps.co" />
        {/* JSON-LD Site Identity */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: "Sandeep's Blog",
              url: 'https://sandeeps.co',
              description: 'Grow, monetize & build your creator business',
              author: {
                '@type': 'Person',
                name: 'Sandeep Singh',
                jobTitle: 'Co-founder',
                worksFor: { '@type': 'Organization', name: 'Graphy.com' },
              },
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
