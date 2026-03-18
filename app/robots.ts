/**
 * app/robots.ts
 * =============
 * Generates /robots.txt via Next.js App Router.
 * Tells search engines what to crawl and where the sitemap is.
 */

import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Block internal API routes, debug endpoints, and draft content
        disallow: [
          '/api/',
          '/api/agent/',
          '/api/debug/',
        ],
      },
    ],
    sitemap: 'https://sandeeps.co/sitemap.xml',
    host:    'https://sandeeps.co',
  };
}
