/**
 * agent/images.ts
 * ===============
 * Generates unique AI cover images for each blog post.
 *
 * Pipeline:
 *  1. Gemini writes a detailed, topic-specific image prompt
 *  2. Pollinations.ai (free Flux AI model, no API key) renders the image
 *  3. Falls back to Unsplash topic search if Pollinations is unavailable
 *  4. Final fallback: picsum.photos with a topic-seeded URL (always unique)
 *
 * Every post gets a UNIQUE, AI-generated cover image.
 */

import { generateImagePrompt } from './gemini';

interface UnsplashPhoto {
  urls: { regular: string };
}

/**
 * Generate an AI cover image for a blog post.
 * Uses Gemini to write the prompt, Pollinations.ai to render it.
 */
export async function fetchCoverImage(
  topic: string,
  category: string,
): Promise<string> {
  // ── 1. Generate AI image prompt with Gemini ────────────────────────────────
  let imagePrompt: string;
  try {
    imagePrompt = await generateImagePrompt(topic, category);
    console.log(`[Images] Gemini prompt: "${imagePrompt.slice(0, 80)}..."`);
  } catch (err) {
    console.warn('[Images] Gemini prompt generation failed, using topic fallback:', err);
    imagePrompt = buildFallbackPrompt(topic, category);
  }

  // ── 2. Render with Pollinations.ai (Flux model, free, no watermark) ────────
  const pollinationsUrl = buildPollinationsUrl(imagePrompt, topic);

  try {
    // Verify Pollinations can serve the image (HEAD check with 10s timeout)
    const check = await fetch(pollinationsUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });
    if (check.ok) {
      console.log(`[Images] ✅ AI image (Pollinations): ${pollinationsUrl.slice(0, 80)}...`);
      return pollinationsUrl;
    }
    console.warn(`[Images] Pollinations returned ${check.status} — trying Unsplash...`);
  } catch (err) {
    console.warn('[Images] Pollinations check timed out — trying Unsplash:', err);
  }

  // ── 3. Fallback: Unsplash API (if API key is set) ────────────────────────
  const unsplashUrl = await tryUnsplash(topic, category);
  if (unsplashUrl) return unsplashUrl;

  // ── 4. Final fallback: unique picsum (always works, topic-seeded) ─────────
  return getTopicFallback(topic);
}

/**
 * Build the Pollinations.ai image URL.
 * - model=flux → high quality Flux image generation
 * - seed based on slug hash → same post always gets the same image
 * - nologo → no Pollinations watermark
 * - enhance → auto-enhances the prompt for better results
 */
function buildPollinationsUrl(prompt: string, topic: string): string {
  const seed = hashCode(topic);
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=1200&height=630&model=flux&nologo=true&enhance=true&seed=${seed}`;
}

/**
 * Simple deterministic hash for a string (used as Pollinations seed).
 * Ensures the same topic always generates the same image.
 */
function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash) % 999_999;
}

/**
 * Fallback image prompt when Gemini is unavailable.
 * Topic-aware, always produces something relevant.
 */
function buildFallbackPrompt(topic: string, category: string): string {
  const categoryPrompts: Record<string, string> = {
    'YouTube Monetization': `Professional YouTube creator studio setup for "${topic}", camera, ring light, editing screen showing analytics, cinematic lighting, 16:9`,
    'Course Creation':       `Clean modern desk workspace for "${topic}", open laptop with course slides, notebook, coffee, soft window light, minimal aesthetic`,
    'Creator Growth':        `Digital dashboard showing social media growth for "${topic}", analytics graphs rising, vibrant blue-purple gradient, tech aesthetic`,
    'Content Strategy':      `Content planning workspace for "${topic}", whiteboard with strategy map, sticky notes, laptop, organized and professional`,
    'AI for Creators':       `Futuristic AI workspace for "${topic}", glowing neural network visualization, holographic interface, dark gradient background`,
  };
  return categoryPrompts[category] ?? `Professional blog header for "${topic}", modern workspace, digital creator aesthetic, clean and vibrant, 16:9 wide format`;
}

/**
 * Try Unsplash API with topic-specific keywords.
 * Returns null if no API key or request fails.
 */
async function tryUnsplash(topic: string, category: string): Promise<string | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  const query = buildUnsplashQuery(topic, category);

  try {
    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`;
    const res  = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}` },
      signal:  AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      const photo = await res.json() as UnsplashPhoto;
      if (photo?.urls?.regular) {
        console.log(`[Images] ✅ Unsplash fallback: ${photo.urls.regular.slice(0, 60)}...`);
        return photo.urls.regular;
      }
    }
  } catch { /* silent — move to next fallback */ }

  return null;
}

/**
 * Build a topic-specific Unsplash query.
 */
function buildUnsplashQuery(topic: string, category: string): string {
  const stopWords = new Set(['how', 'to', 'the', 'a', 'an', 'and', 'or', 'for', 'in', 'on', 'at', 'with', 'your', 'my', 'is', 'are', 'vs', 'versus', 'best', 'top', 'make', 'get', 'use']);
  const keywords = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 3)
    .join(' ');

  const categoryContext: Record<string, string> = {
    'YouTube Monetization': 'youtube creator studio',
    'Course Creation':       'online learning education',
    'Creator Growth':        'social media digital growth',
    'Content Strategy':      'content marketing planning',
    'AI for Creators':       'artificial intelligence technology',
  };

  return `${keywords} ${categoryContext[category] ?? 'digital creator'}`.trim();
}

/**
 * Final fallback: unique picsum image seeded from the topic string.
 * Different topic = different image (no more identical covers per category).
 */
function getTopicFallback(topic: string): string {
  const seed = topic
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `https://picsum.photos/seed/${seed}/1200/630`;
}
