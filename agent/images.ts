/**
 * agent/images.ts
 * ===============
 * Fetches cover images from Unsplash.
 * Returns a public URL to store in the posts table.
 */

interface UnsplashPhoto {
  urls: { regular: string; small: string };
  alt_description: string | null;
  user: { name: string; links: { html: string } };
  links: { html: string };
}

/**
 * Search Unsplash for a relevant cover image for the post.
 * Returns the image URL or a fallback SVG path.
 */
export async function fetchCoverImage(
  topic: string,
  category: string,
): Promise<string> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    console.warn('UNSPLASH_ACCESS_KEY not set — using fallback image');
    return getCategoryFallback(category);
  }

  // Build a clean search query
  const query = buildQuery(topic, category);

  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&content_filter=high`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}` },
    });

    if (!res.ok) {
      console.warn(`Unsplash API error ${res.status}`);
      return getCategoryFallback(category);
    }

    const data = await res.json() as { results: UnsplashPhoto[] };
    if (!data.results?.length) return getCategoryFallback(category);

    // Pick a random photo from top 5 for variety
    const photo = data.results[Math.floor(Math.random() * data.results.length)];
    return photo.urls.regular;
  } catch (err) {
    console.error('Unsplash fetch error:', err);
    return getCategoryFallback(category);
  }
}

function buildQuery(topic: string, category: string): string {
  const categoryQueries: Record<string, string> = {
    'YouTube Monetization': 'youtube creator money studio',
    'Course Creation':       'online learning education laptop',
    'Creator Growth':        'social media growth analytics',
    'Content Strategy':      'content creation planning strategy',
    'AI for Creators':       'artificial intelligence technology',
  };

  return categoryQueries[category] ?? `${topic} creator business`;
}

function getCategoryFallback(category: string): string {
  const fallbacks: Record<string, string> = {
    'YouTube Monetization': '/images/posts/youtube-monetization.svg',
    'Course Creation':       '/images/posts/course-creation.svg',
    'Creator Growth':        '/images/posts/creator-growth.svg',
    'Content Strategy':      '/images/posts/content-strategy.svg',
    'AI for Creators':       '/images/posts/ai-creators.svg',
  };
  return fallbacks[category] ?? '/images/default-cover.svg';
}
