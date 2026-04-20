/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel handles image optimization natively — no need to disable it
  images: {
    // Allow Vercel's built-in image optimizer (best performance on Vercel)
    unoptimized: false,
    // External image sources used by the agent for cover images
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },         // Supabase Storage (Gemini-generated images)
      { protocol: 'https', hostname: 'image.pollinations.ai' }, // Pollinations.ai fallback (Flux AI)
      { protocol: 'https', hostname: 'picsum.photos' },         // final fallback covers
      { protocol: 'https', hostname: 'fastly.picsum.photos' },  // picsum CDN alias
      { protocol: 'https', hostname: 'images.unsplash.com' },   // Unsplash (when key is set)
    ],
  },

  // Security headers — automatically added to every response
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      // Blog listing pages — never cache so new agent posts appear immediately
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/blog',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/categories/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },

  // Redirects
  async redirects() {
    return [
      // Canonical: www → non-www (permanent 301)
      // Fixes Google Search Console "Page with redirect" errors for sandeeps.co
      // and prevents duplicate indexing of www vs non-www URLs.
      {
        source:      '/:path*',
        has:         [{ type: 'host', value: 'www.sandeeps.co' }],
        destination: 'https://sandeeps.co/:path*',
        permanent:   true,
      },
    ];
  },
};

module.exports = nextConfig;
