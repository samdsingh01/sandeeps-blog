/**
 * app/sitemap.ts
 * ===============
 * Auto-generates /sitemap.xml for Google Search Console.
 * Next.js App Router serves this at /sitemap.xml automatically.
 *
 * Includes:
 *   - Static pages (home, blog index, about, tools)
 *   - All published blog posts (from Supabase)
 *   - All category pages
 */

import type { MetadataRoute } from 'next';
import { getServiceClient }   from '@/lib/supabase';

const SITE_URL   = 'https://sandeeps.co';
const CATEGORIES = [
  'youtube-growth',
  'monetization',
  'online-courses',
  'creator-economy',
  'video-production',
  'social-media',
  'coaching',
  'youtube-monetization',
  'course-creation',
  'creator-growth',
  'ai-for-creators',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url:              SITE_URL,
      lastModified:     new Date(),
      changeFrequency:  'daily',
      priority:         1.0,
    },
    {
      url:              `${SITE_URL}/blog`,
      lastModified:     new Date(),
      changeFrequency:  'daily',
      priority:         0.9,
    },
    {
      url:              `${SITE_URL}/tools/youtube-earnings-calculator`,
      lastModified:     new Date(),
      changeFrequency:  'monthly',
      priority:         0.9,
    },
    {
      url:              `${SITE_URL}/about`,
      lastModified:     new Date(),
      changeFrequency:  'monthly',
      priority:         0.5,
    },
  ];

  // Category pages
  const categoryPages: MetadataRoute.Sitemap = CATEGORIES.map((cat) => ({
    url:              `${SITE_URL}/categories/${cat}`,
    lastModified:     new Date(),
    changeFrequency:  'weekly' as const,
    priority:         0.7,
  }));

  // All published blog posts from Supabase
  let postPages: MetadataRoute.Sitemap = [];
  try {
    const db = getServiceClient();
    const { data: posts } = await db
      .from('posts')
      .select('slug, published_at, updated_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (posts) {
      postPages = posts.map((post: {
        slug: string;
        published_at: string;
        updated_at: string | null;
      }) => ({
        url:             `${SITE_URL}/blog/${post.slug}`,
        lastModified:    new Date(post.updated_at ?? post.published_at),
        changeFrequency: 'weekly' as const,
        priority:        0.8,
      }));
    }
  } catch (err) {
    console.error('[Sitemap] Failed to fetch posts:', err);
  }

  return [...staticPages, ...categoryPages, ...postPages];
}
