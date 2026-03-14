/**
 * agent/images.ts
 * ===============
 * Generates unique AI cover images for each blog post.
 *
 * Pipeline:
 *  1. Gemini writes a detailed, topic-specific image prompt
 *  2. Gemini 2.0 Flash generates the actual image (base64 → Supabase Storage)
 *  3. Falls back to Pollinations.ai (Flux model, no API key) if Gemini image gen fails
 *  4. Final fallback: topic-seeded picsum URL (always unique, never breaks)
 *
 * Every post gets a UNIQUE, AI-generated cover image. The slug is used as the
 * storage key so the same post always gets the same image URL even after re-heal.
 */

import { generateImagePrompt } from './gemini';
import { getServiceClient }    from '../lib/supabase';

const STORAGE_BUCKET = 'post-covers';

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generate an AI cover image for a blog post.
 * Uses Gemini to both write the prompt AND render the image.
 *
 * @param topic    - Post title or topic string
 * @param category - Post category (used for style guidance)
 * @param slug     - Post slug (used as storage filename; optional but recommended)
 */
export async function fetchCoverImage(
  topic:    string,
  category: string,
  slug?:    string,
): Promise<string> {
  const storageKey = slug ?? slugifyTopic(topic);

  // ── 1. Generate AI image prompt with Gemini ──────────────────────────────
  let imagePrompt: string;
  try {
    imagePrompt = await generateImagePrompt(topic, category);
    console.log(`[Images] Gemini prompt (${storageKey}): "${imagePrompt.slice(0, 80)}..."`);
  } catch (err) {
    console.warn('[Images] Prompt generation failed, using fallback prompt:', err);
    imagePrompt = buildFallbackPrompt(topic, category);
  }

  // ── 2. Generate image with Gemini 2.0 Flash → upload to Supabase Storage ──
  try {
    const url = await generateAndStoreGeminiImage(imagePrompt, storageKey);
    if (url) {
      console.log(`[Images] ✅ Gemini image stored: ${url.slice(0, 80)}...`);
      return url;
    }
  } catch (err) {
    console.warn('[Images] Gemini image generation failed, trying Pollinations:', err);
  }

  // ── 3. Fallback: Pollinations.ai (free Flux model, no API key needed) ─────
  const pollinationsUrl = buildPollinationsUrl(imagePrompt, topic);
  try {
    const check = await fetch(pollinationsUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });
    if (check.ok) {
      console.log(`[Images] ✅ Pollinations fallback: ${pollinationsUrl.slice(0, 80)}...`);
      return pollinationsUrl;
    }
    console.warn(`[Images] Pollinations returned ${check.status}`);
  } catch (err) {
    console.warn('[Images] Pollinations timed out:', err);
  }

  // ── 4. Final fallback: topic-seeded picsum (always works) ─────────────────
  const fallback = getTopicFallback(topic);
  console.log(`[Images] Using picsum fallback: ${fallback}`);
  return fallback;
}

// ── Gemini Image Generation ───────────────────────────────────────────────────

/**
 * Calls the Gemini 2.0 Flash image generation REST API, decodes the base64
 * image, uploads it to Supabase Storage, and returns the public URL.
 *
 * Uses the REST API directly because the @google/generative-ai SDK (0.21.0)
 * does not yet type `responseModalities` for image generation.
 */
async function generateAndStoreGeminiImage(
  prompt:     string,
  storageKey: string,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // ── Call Gemini 2.0 Flash image generation ────────────────────────────────
  const model  = 'gemini-2.0-flash-preview-image-generation';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      role:  'user',
      parts: [{ text: `Create a professional, visually striking blog cover image (16:9 ratio). No text, no words, no letters in the image. ${prompt}` }],
    }],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  const res = await fetch(apiUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(30_000), // 30s timeout for image generation
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini image gen failed ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as GeminiImageResponse;
  const parts = data.candidates?.[0]?.content?.parts ?? [];

  // Find the image part in the response
  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart?.inlineData) {
    const blockReason = data.promptFeedback?.blockReason;
    throw new Error(`No image in Gemini response${blockReason ? ` (blocked: ${blockReason})` : ''}`);
  }

  const { data: base64Data, mimeType } = imagePart.inlineData;
  const ext         = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const filename    = `${storageKey}.${ext}`;
  const imageBuffer = Buffer.from(base64Data, 'base64');

  // ── Upload to Supabase Storage ─────────────────────────────────────────────
  const supabase = getServiceClient();

  // Ensure the bucket exists (create as public if it doesn't)
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.name === STORAGE_BUCKET);

  if (!bucketExists) {
    const { error: bucketErr } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public:           true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      fileSizeLimit:    5_242_880, // 5 MB
    });
    if (bucketErr) {
      throw new Error(`Failed to create Storage bucket: ${bucketErr.message}`);
    }
    console.log(`[Images] Created Supabase Storage bucket "${STORAGE_BUCKET}"`);
  }

  // Upload (upsert: overwrite if slug already has an image from a previous heal)
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, imageBuffer, {
      contentType:  mimeType,
      upsert:       true,
      cacheControl: '31536000', // 1 year — image is stable once generated
    });

  if (uploadErr) {
    throw new Error(`Supabase Storage upload failed: ${uploadErr.message}`);
  }

  // Return the public URL
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filename);

  return urlData.publicUrl;
}

// ── Pollinations fallback ─────────────────────────────────────────────────────

function buildPollinationsUrl(prompt: string, topic: string): string {
  const seed    = hashCode(topic);
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=1200&height=630&model=flux&nologo=true&enhance=true&seed=${seed}`;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

/** Simple deterministic hash → numeric seed for Pollinations fallback */
function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash) % 999_999;
}

/** Fallback image prompt when Gemini text generation is unavailable */
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

/** Slugify a topic string into a safe Supabase Storage filename */
function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Final fallback: unique picsum image seeded from the topic string */
function getTopicFallback(topic: string): string {
  const seed = slugifyTopic(topic).slice(0, 40);
  return `https://picsum.photos/seed/${seed}/1200/630`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?:       string;
        inlineData?: {
          mimeType: string;
          data:     string; // base64-encoded image bytes
        };
      }>;
    };
  }>;
  promptFeedback?: { blockReason?: string };
}
