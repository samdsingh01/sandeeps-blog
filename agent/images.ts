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

  // 3. Pollinations.ai fallback — return URL directly, no HEAD check needed.
  // Pollinations generates on-demand; the browser fetches the image when it renders.
  // The HEAD check was causing unnecessary timeouts and falling through to picsum.
  const pollinationsUrl = buildPollinationsUrl(imagePrompt, topic);
  console.log(`[Images] ⚠️ Falling back to Pollinations: ${pollinationsUrl.slice(0, 80)}`);
  return pollinationsUrl;
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
      // Ask Gemini for a rich, section-specific visual prompt
      const prompt = await askFast(
        `You are a world-class visual art director for a creator economy publication.
Write a HIGHLY SPECIFIC image generation prompt for an inline concept illustration inside a blog post.

POST TITLE: "${topic}"
SECTION HEADING: "${heading}"
CATEGORY: ${category}

Your prompt must:
1. Visually represent the SPECIFIC idea in the section heading — not the general topic
   - e.g. "Setting Up Super Thanks" → YouTube donation button glowing on screen, creator celebrating, coins/stars animation
   - e.g. "Building Your Email List" → email inbox filling up with subscriber notifications, magnet metaphor, dashboard
   - e.g. "Using AI to Write Scripts" → AI chat interface open alongside video script, split-screen workflow
2. Name exact objects, composition, and setting (2–3 sentences)
3. Specify lighting and color mood that matches the section's energy
4. Style: photorealistic photography OR clean 3D render — whichever fits better
5. End with: "No text, no words, no letters, no UI labels in the image. 16:9 wide format."

Return ONLY the image prompt (80–120 words). No explanations, no preamble.`,
        300,
        0.85,
      );

      const storageKey = `${slug}-section-${index}`;
      console.log(`[Images] section prompt for "${heading}": "${prompt.slice(0, 60)}..."`);

      // Try Gemini image generation first (inline type = no "blog cover" framing)
      try {
        const url = await generateAndStoreGeminiImage(prompt.trim(), storageKey, 'inline');
        if (url) {
          console.log(`[Images] ✅ inline image ${index}: ${url.slice(0, 80)}`);
          return { h2Index: index, heading, imageUrl: url } satisfies ContentImage;
        }
      } catch (err) {
        console.warn(`[Images] Gemini failed for section "${heading}", trying Pollinations:`, err);
      }

      // Pollinations fallback per section — return URL directly, no HEAD check
      const pollinationsUrl = buildPollinationsUrl(prompt.trim(), `${slug}-${index}`);
      console.log(`[Images] ⚠️ Section ${index} falling back to Pollinations`);
      return { h2Index: index, heading, imageUrl: pollinationsUrl } satisfies ContentImage;
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

// ── Gemini model auto-discovery ───────────────────────────────────────────────

/**
 * Cached list of image-capable Gemini models discovered via ListModels.
 * Resets on each cold start (fine for Vercel serverless), prevents
 * repeated API calls within a single invocation.
 */
let _cachedImageModels: string[] | null = null;

/**
 * Query the Gemini ListModels endpoint and return the names of models that
 * (a) support generateContent AND (b) have "image" or "imagen" in their name
 *     OR support responseModalities with IMAGE.
 *
 * Returns an empty array on any error — callers fall back to hardcoded names.
 */
async function discoverImageModels(apiKey: string): Promise<string[]> {
  if (_cachedImageModels !== null) return _cachedImageModels;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) { _cachedImageModels = []; return []; }

    const data = await res.json() as { models?: Array<{
      name: string;
      supportedGenerationMethods?: string[];
      description?: string;
    }> };

    const all = data.models ?? [];
    const imageModels = all
      .filter((m) => {
        const name = (m.name ?? '').toLowerCase();
        // Include models that are explicitly image-generation capable
        return (name.includes('image') || name.includes('imagen')) &&
               m.supportedGenerationMethods?.includes('generateContent');
      })
      .map((m) => m.name.replace('models/', ''));

    // Also include flash models that support generateContent — they may support
    // responseModalities IMAGE even if their name doesn't say "image"
    const flashModels = all
      .filter((m) => {
        const name = (m.name ?? '').toLowerCase();
        return name.includes('flash') && m.supportedGenerationMethods?.includes('generateContent');
      })
      .map((m) => m.name.replace('models/', ''));

    _cachedImageModels = [...new Set([...imageModels, ...flashModels])];
    if (_cachedImageModels.length > 0) {
      console.log(`[Images] Discovered models: ${_cachedImageModels.join(', ')}`);
    }
    return _cachedImageModels;
  } catch {
    _cachedImageModels = [];
    return [];
  }
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
  imageType:  'cover' | 'inline' = 'cover',
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // Different framing for cover vs. inline section images
  const fullPrompt = imageType === 'cover'
    ? [
        'Ultra-high quality professional blog cover image, 16:9 wide aspect ratio, photorealistic or cinematic 3D render.',
        prompt,
        'CRITICAL: Absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO watermarks anywhere in the image.',
        'Sharp focus on key elements, professional color grading, magazine-cover quality composition.',
      ].join(' ')
    : [
        'High quality inline concept illustration for a blog article, 16:9 wide format.',
        prompt,
        'CRITICAL: Absolutely NO text, NO words, NO letters, NO numbers, NO labels, NO UI copy visible anywhere.',
        'Clear focal point, contextually relevant to the section topic, clean professional style.',
      ].join(' ');
  let b64: string | null = null;
  let mimeType = 'image/png';
  let lastError = '';

  // ── Attempt 1: Gemini image generation (generateContent) ─────────────────
  // We try a broad set of model names because availability varies by API key project.
  // The confirmed working text model for this key is gemini-2.5-flash, so we try
  // newer models first (2.5, 2.0-flash), then the dedicated image-gen variants.
  // Auto-discovery: if ListModels reveals additional image-capable models, we use those too.
  const discoveredModels = await discoverImageModels(apiKey);
  const geminiModels = [
    ...discoveredModels,                         // runtime-discovered models take priority
    // Confirmed working models for this project (discovered via ListModels 2026-03-18):
    'gemini-2.5-flash-image',                    // ✅ confirmed working
    'gemini-3.1-flash-image-preview',            // ✅ confirmed working
    'gemini-3-pro-image-preview',                // ✅ confirmed working (heavier)
    // Legacy fallbacks (expect 404 but kept for other key projects):
    'gemini-2.0-flash-exp-image-generation',
    'gemini-2.0-flash-exp',
  ].filter((m, i, arr) => arr.indexOf(m) === i); // deduplicate

  for (const model of geminiModels) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          signal: AbortSignal.timeout(40_000),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        lastError = `[${model}] ${res.status}: ${errText.slice(0, 200)}`;
        console.warn(`[Images] Gemini generateContent failed: ${lastError}`);
        continue;
      }

      const data  = await res.json() as GeminiImageResponse;
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const img   = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));

      if (img?.inlineData) {
        b64      = img.inlineData.data;
        mimeType = img.inlineData.mimeType;
        console.log(`[Images] ✅ Gemini generateContent succeeded with "${model}"`);
        break;
      }

      const reason = data.promptFeedback?.blockReason;
      lastError = `No image in response [${model}]${reason ? ` blocked: ${reason}` : ''}`;
      console.warn(`[Images] ${lastError}`);
    } catch (err) {
      lastError = `[${model}] threw: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[Images] ${lastError}`);
    }
  }

  // ── Attempt 2: Imagen 3 (predict endpoint — different format) ─────────────
  // Imagen 3 uses :predict not :generateContent, and a different request/response shape
  if (!b64) {
    // Confirmed working Imagen 4 models (discovered via ListModels 2026-03-18).
    // imagen-3 models return 404 for this project.
    const imagenModels = [
      'imagen-4.0-fast-generate-001',   // ✅ fastest
      'imagen-4.0-generate-001',         // ✅ standard quality
      'imagen-4.0-ultra-generate-001',   // ✅ highest quality (slower)
    ];

    for (const model of imagenModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances:  [{ prompt: fullPrompt }],
              parameters: { sampleCount: 1, aspectRatio: '16:9', safetyFilterLevel: 'block_some' },
            }),
            signal: AbortSignal.timeout(40_000),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          lastError = `[${model}] ${res.status}: ${errText.slice(0, 200)}`;
          console.warn(`[Images] Imagen predict failed: ${lastError}`);
          continue;
        }

        const data = await res.json() as ImagenResponse;
        const pred = data.predictions?.[0];

        if (pred?.bytesBase64Encoded) {
          b64      = pred.bytesBase64Encoded;
          mimeType = pred.mimeType ?? 'image/png';
          console.log(`[Images] ✅ Imagen 3 succeeded with "${model}"`);
          break;
        }

        lastError = `No image in Imagen response [${model}]`;
        console.warn(`[Images] ${lastError}`);
      } catch (err) {
        lastError = `[${model}] threw: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[Images] ${lastError}`);
      }
    }
  }

  if (!b64) {
    throw new Error(`All image generation models failed. Last: ${lastError}`);
  }

  // ── Upload to Supabase Storage ─────────────────────────────────────────────
  const ext         = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const filename    = `${storageKey}.${ext}`;
  const imageBuffer = Buffer.from(b64, 'base64');
  const supabase    = getServiceClient();

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
  return urlData.publicUrl;
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
    'YouTube Monetization':
      `Professional YouTube creator studio, mirrorless camera on tripod with LED ring light, dual monitors showing subscriber growth charts and AdSense revenue for "${topic}", softbox lighting casting warm amber glow, shallow depth of field, cinematic photography, dark charcoal background with YouTube red accents, no text no words no letters`,
    'Course Creation':
      `Minimal creative workspace for an online course about "${topic}", open laptop showing slide deck, moleskine notebook with pen, ceramic coffee cup, USB microphone, soft natural window light, overhead flat-lay composition, clean whites and warm wood tones, sage green plant, lifestyle product photography, no text no words no letters`,
    'Creator Growth':
      `Glowing 3D holographic analytics dashboard visualizing growth metrics for "${topic}", upward-trending graphs as luminous neon lines, interconnected social platform spheres rising, electric blue to violet gradient background, volumetric light rays, futuristic data visualization art, Behance aesthetic, no text no words no letters`,
    'Content Strategy':
      `Strategic content planning setup for "${topic}", large color-coded wall calendar, sticky notes arranged in a funnel shape, open strategy notebook, laptop showing editorial calendar, warm amber and coral color palette, flat-lay top-down photography, editorial magazine aesthetic, no text no words no letters`,
    'AI for Creators':
      `Futuristic AI-augmented creative workspace inspired by "${topic}", holographic neural network nodes floating above a laptop, abstract data streams in magenta and electric cyan, creative tools (camera, microphone, pen tablet) intertwined with glowing digital circuits, deep purple to teal gradient, cinematic sci-fi 3D render, volumetric lighting, no text no words no letters`,
    'AI for Creator Economy':
      `AI-powered creator economy workspace for "${topic}", translucent AI interface overlay on creator workstation with multiple screens, glowing neural pathways connecting creative tools, floating revenue projection charts, vibrant purple-to-gold gradient, high-end 3D render and photography composite, cinematic lighting, Wired magazine cover aesthetic, no text no words no letters`,
  };
  return map[category] ?? `Ultra-high quality professional blog cover for "${topic}", modern premium creator workspace, dramatic cinematic lighting, rich color palette with bold accent, sharp composition, photorealistic, 16:9, no text no words no letters`;
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

// Imagen 3 uses :predict endpoint with a different response shape
interface ImagenResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
}
