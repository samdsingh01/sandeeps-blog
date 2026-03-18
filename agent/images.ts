/**
 * agent/images.ts
 * ===============
 * Generates AI images for blog posts — both cover images and inline concept images.
 *
 * Cover image pipeline:
 *  1. Gemini writes a topic-specific visual prompt
 *  2. Gemini 2.0 Flash generates the image → uploaded to Supabase Storage
 *  3. Falls back to Pollinations.ai (Flux), then topic-seeded picsum
 *
 * Inline concept images:
 *  - `generateContentImages()` picks 2 key sections from the markdown,
 *    generates a relevant concept image for each, and returns them as
 *    { h2Index, imageUrl } pairs for injection into the rendered HTML.
 *  - `injectContentImages()` splices the <figure> elements into the HTML
 *    after the chosen <h2> tags.
 */

import { generateImagePrompt, askFast } from './gemini';
import { getServiceClient }             from '../lib/supabase';

const STORAGE_BUCKET = 'post-covers';

// ── Cover image ───────────────────────────────────────────────────────────────

/**
 * Generate an AI cover image for a blog post.
 *
 * @param topic    - Post title / topic string
 * @param category - Post category (drives style guidance)
 * @param slug     - Post slug — used as storage filename (optional but recommended)
 */
export async function fetchCoverImage(
  topic:    string,
  category: string,
  slug?:    string,
): Promise<string> {
  const storageKey = slug ?? slugifyTopic(topic);

  // 1. Gemini writes a detailed visual prompt
  let imagePrompt: string;
  try {
    imagePrompt = await generateImagePrompt(topic, category);
    console.log(`[Images] cover prompt (${storageKey}): "${imagePrompt.slice(0, 80)}..."`);
  } catch {
    imagePrompt = buildFallbackPrompt(topic, category);
  }

  // 2. Gemini generates the image → Supabase Storage
  try {
    const url = await generateAndStoreGeminiImage(imagePrompt, storageKey);
    if (url) { console.log(`[Images] ✅ cover stored: ${url.slice(0, 80)}`); return url; }
  } catch (err) {
    console.warn('[Images] Gemini cover gen failed, trying Pollinations:', err);
  }

  // 3. Pollinations.ai fallback
  const pollinationsUrl = buildPollinationsUrl(imagePrompt, topic);
  try {
    const check = await fetch(pollinationsUrl, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
    if (check.ok) { console.log(`[Images] ✅ Pollinations cover: ${pollinationsUrl.slice(0, 80)}`); return pollinationsUrl; }
  } catch { /* fall through */ }

  // 4. Picsum final fallback
  return getTopicFallback(topic);
}

// ── Inline concept images ─────────────────────────────────────────────────────

export interface ContentImage {
  /** 1-based index of the <h2> after which to inject the image */
  h2Index:  number;
  /** Heading text (used as alt text) */
  heading:  string;
  /** Supabase Storage public URL (or Pollinations fallback) */
  imageUrl: string;
}

/**
 * Generate 2 inline concept images for key sections of a blog post.
 *
 * Strategy:
 *  - Extracts all ## headings from the markdown
 *  - Picks the 2nd heading and the midpoint heading
 *  - Asks Gemini to describe a visual concept for each section
 *  - Generates the images in parallel (Gemini → Supabase Storage)
 *  - Falls back to Pollinations per image if Gemini fails
 *
 * @param markdown - Raw markdown source of the post
 * @param topic    - Post title / topic
 * @param category - Post category
 * @param slug     - Post slug (used to name storage files)
 */
export async function generateContentImages(
  markdown: string,
  topic:    string,
  category: string,
  slug:     string,
): Promise<ContentImage[]> {
  // Extract ## headings
  const headings = (markdown.match(/^## .+/gm) ?? []).map((h) => h.replace(/^## /, '').trim());

  if (headings.length < 2) {
    console.log('[Images] Not enough H2 sections for inline images, skipping');
    return [];
  }

  // Pick 2 representative sections: the 2nd heading, and the midpoint
  const picks: Array<{ index: number; heading: string }> = [];
  picks.push({ index: 2, heading: headings[1] }); // h2Index is 1-based → 2nd heading

  const midIdx = Math.floor(headings.length / 2);
  if (midIdx >= 2) { // avoid duplicates
    picks.push({ index: midIdx + 1, heading: headings[midIdx] }); // 1-based
  }

  console.log(`[Images] Generating inline images for sections: ${picks.map((p) => `"${p.heading}"`).join(', ')}`);

  // Build prompts + generate images in parallel
  const results = await Promise.all(picks.map(async ({ index, heading }) => {
    try {
      // Ask Gemini for a section-specific visual concept
      const prompt = await askFast(
        `You are a visual art director for a creator economy blog.
Write a SHORT image generation prompt (max 60 words) for a CONCEPT ILLUSTRATION inside a blog post.

Post topic: "${topic}"
This section heading: "${heading}"
Category: ${category}

Requirements:
- Conceptual, educational illustration (not a generic stock photo)
- Shows the KEY IDEA of the section visually (diagram, metaphor, realistic scene)
- No text, no words, no letters anywhere in the image
- Clean, modern, professional style
- Wide format (16:9)

Return ONLY the image prompt, nothing else.`,
        150,
        0.75,
      );

      const storageKey = `${slug}-section-${index}`;
      console.log(`[Images] section prompt for "${heading}": "${prompt.slice(0, 60)}..."`);

      // Try Gemini image generation first
      try {
        const url = await generateAndStoreGeminiImage(prompt.trim(), storageKey);
        if (url) {
          console.log(`[Images] ✅ inline image ${index}: ${url.slice(0, 80)}`);
          return { h2Index: index, heading, imageUrl: url } satisfies ContentImage;
        }
      } catch (err) {
        console.warn(`[Images] Gemini failed for section "${heading}", trying Pollinations:`, err);
      }

      // Pollinations fallback per section
      const pollinationsUrl = buildPollinationsUrl(prompt.trim(), `${slug}-${index}`);
      try {
        const check = await fetch(pollinationsUrl, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
        if (check.ok) {
          console.log(`[Images] ✅ Pollinations inline image ${index}`);
          return { h2Index: index, heading, imageUrl: pollinationsUrl } satisfies ContentImage;
        }
      } catch { /* fall through */ }

      return null; // give up on this section image
    } catch (err) {
      console.warn(`[Images] Failed to generate inline image for section "${heading}":`, err);
      return null;
    }
  }));

  return results.filter((r): r is ContentImage => r !== null);
}

/**
 * Inject `<figure>` image blocks into rendered HTML after the chosen <h2> tags.
 *
 * Uses a positional counter so it doesn't need to parse heading text, which
 * avoids issues with special characters / HTML entities in heading content.
 */
export function injectContentImages(html: string, images: ContentImage[]): string {
  if (images.length === 0) return html;

  // Sort by ascending h2Index so we count correctly left-to-right
  const sorted = [...images].sort((a, b) => a.h2Index - b.h2Index);

  let h2Count  = 0;
  let imageIdx = 0;
  let result   = '';
  let remaining = html;

  // Walk through HTML, counting </h2> occurrences and injecting after target ones
  const closeH2 = '</h2>';
  let pos = remaining.indexOf(closeH2);

  while (pos !== -1 && imageIdx < sorted.length) {
    h2Count++;
    const after = pos + closeH2.length;
    result    += remaining.slice(0, after); // everything up to and including </h2>
    remaining  = remaining.slice(after);

    // Check if this h2 is one we want to inject after
    if (sorted[imageIdx].h2Index === h2Count) {
      const { heading, imageUrl } = sorted[imageIdx];
      result += buildFigureHtml(imageUrl, heading);
      imageIdx++;
    }

    pos = remaining.indexOf(closeH2);
  }

  result += remaining; // append the rest
  return result;
}

function buildFigureHtml(src: string, alt: string): string {
  // Sanitise alt text for HTML attribute (strip angle brackets / quotes)
  const safeAlt = alt.replace(/[<>"'&]/g, '');
  return `
<figure class="content-image my-8 not-prose">
  <img
    src="${src}"
    alt="${safeAlt}"
    loading="lazy"
    class="rounded-xl w-full object-cover shadow-md"
    style="max-height:420px;object-fit:cover"
  />
  <figcaption class="text-center text-xs text-gray-400 mt-2 italic">${safeAlt}</figcaption>
</figure>`;
}

// ── Gemini image generation (REST API) ───────────────────────────────────────

/**
 * Calls Gemini 2.0 Flash image generation, uploads result to Supabase Storage,
 * and returns the public URL.
 *
 * Uses REST directly — the @google/generative-ai SDK doesn't type
 * `responseModalities` yet.
 *
 * IMPORTANT: responseModalities MUST include 'TEXT' alongside 'IMAGE' — Gemini
 * rejects requests with ['IMAGE'] alone (400 INVALID_ARGUMENT).
 * Model name: 'gemini-2.0-flash-exp' is the stable alias; the preview name is
 * kept as a fallback.
 */
async function generateAndStoreGeminiImage(
  prompt:     string,
  storageKey: string,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // Try stable model first, fall back to preview name
  const MODELS = [
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash-preview-image-generation',
  ];

  let lastError = '';

  for (const model of MODELS) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const body = {
        contents: [{
          role:  'user',
          parts: [{ text: `Create a professional blog image. No text, no words, no letters. ${prompt}` }],
        }],
        // MUST include TEXT alongside IMAGE — IMAGE-only causes 400 error
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      };

      const res = await fetch(apiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(40_000),
      });

      if (!res.ok) {
        const errText = await res.text();
        lastError = `Gemini image gen [${model}] ${res.status}: ${errText.slice(0, 300)}`;
        console.warn(`[Images] ${lastError} — trying next model`);
        continue; // try next model
      }

      const data      = await res.json() as GeminiImageResponse;
      const parts     = data.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));

      if (!imagePart?.inlineData) {
        const reason = data.promptFeedback?.blockReason;
        lastError = `No image in Gemini response [${model}]${reason ? ` (blocked: ${reason})` : ''}`;
        console.warn(`[Images] ${lastError} — trying next model`);
        continue;
      }

      // Success — upload to Supabase and return URL
      const { data: b64, mimeType } = imagePart.inlineData;
      const ext         = mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const filename    = `${storageKey}.${ext}`;
      const imageBuffer = Buffer.from(b64, 'base64');

      const supabase = getServiceClient();

      // Auto-create bucket if needed
      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.some((b) => b.name === STORAGE_BUCKET)) {
        await supabase.storage.createBucket(STORAGE_BUCKET, {
          public: true, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], fileSizeLimit: 5_242_880,
        });
        console.log(`[Images] Created Storage bucket "${STORAGE_BUCKET}"`);
      }

      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filename, imageBuffer, { contentType: mimeType, upsert: true, cacheControl: '31536000' });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
      console.log(`[Images] ✅ Gemini image stored via model "${model}"`);
      return urlData.publicUrl;

    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[Images] Model "${model}" threw: ${lastError}`);
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}

// ── Pollinations fallback ─────────────────────────────────────────────────────

function buildPollinationsUrl(prompt: string, seed: string): string {
  const numSeed = hashCode(seed);
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=1200&height=630&model=flux&nologo=true&enhance=true&seed=${numSeed}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashCode(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h) % 999_999;
}

function buildFallbackPrompt(topic: string, category: string): string {
  const map: Record<string, string> = {
    'YouTube Monetization': `YouTube creator studio setup for "${topic}", camera, ring light, analytics on screen, cinematic 16:9`,
    'Course Creation':       `Clean desk workspace for "${topic}", laptop with course slides, notebook, coffee, minimal aesthetic`,
    'Creator Growth':        `Rising analytics dashboard for "${topic}", social graphs, vibrant blue-purple gradient, tech aesthetic`,
    'Content Strategy':      `Content planning board for "${topic}", sticky notes, calendar, strategy map, professional workspace`,
    'AI for Creators':           `Futuristic AI interface for "${topic}", neural network glow, holographic display, dark gradient`,
    'AI for Creator Economy':    `Futuristic AI tools interface for "${topic}", creator at laptop with AI overlay, data streams, vibrant purple-cyan gradient`,
  };
  return map[category] ?? `Professional blog cover for "${topic}", modern digital creator workspace, clean and vibrant, 16:9`;
}

function slugifyTopic(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function getTopicFallback(topic: string): string {
  return `https://picsum.photos/seed/${slugifyTopic(topic).slice(0, 40)}/1200/630`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeminiImageResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
  promptFeedback?: { blockReason?: string };
}
