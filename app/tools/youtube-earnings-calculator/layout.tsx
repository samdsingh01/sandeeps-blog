import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'YouTube Earnings Calculator — How Much Can You Make?',
  description:
    'Free YouTube earnings calculator. Estimate your monthly AdSense revenue based on views, niche (Finance, Gaming, Education), and audience location. Updated 2025 CPM rates.',
  keywords: [
    'youtube earnings calculator',
    'youtube money calculator',
    'how much does youtube pay per view',
    'youtube ad revenue calculator',
    'youtube rpm calculator',
    'youtube cpm calculator',
    'how much can i make on youtube',
  ],
  openGraph: {
    title: 'YouTube Earnings Calculator (Free) — Updated 2025 CPM Rates',
    description:
      'Estimate your YouTube AdSense income. Enter your monthly views, niche, and audience location to see how much you could earn.',
    url: 'https://sandeeps.co/tools/youtube-earnings-calculator',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'YouTube Earnings Calculator — How Much Do YouTubers Make?',
    description: 'Free tool: estimate your YouTube AdSense earnings by niche and views. Updated 2025 CPM rates.',
  },
  alternates: {
    canonical: 'https://sandeeps.co/tools/youtube-earnings-calculator',
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
