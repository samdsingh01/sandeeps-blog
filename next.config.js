/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel handles image optimization natively — no need to disable it
  images: {
    // Allow Vercel's built-in image optimizer (best performance on Vercel)
    unoptimized: false,
    // If you ever embed external images, add their domains here:
    // remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
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
    ];
  },

  // Redirects — add any old URLs you want to 301 redirect here
  async redirects() {
    return [
      // Example: redirect /blog/old-post → /blog/new-post
      // { source: '/blog/old-post', destination: '/blog/new-post', permanent: true },
    ];
  },
};

module.exports = nextConfig;
