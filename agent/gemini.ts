/**
 * agent/gemini.ts
 * ===============
 * Shared Gemini client for all agent modules.
 * Uses gemini-2.0-flash for everything.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY environment variable is not set');
    _client = new GoogleGenerativeAI(key);
  }
  return _client;
}

const CONTENT_MODEL = 'gemini-2.5-flash';

/**
 * Heavy generation: blog posts, long-form content
 */
export async function ask(
  prompt: string,
  maxTokens = 4096,
  temperature = 0.7,
): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: CONTENT_MODEL,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * Fast generation: routing, classification, short answers
 */
export async function askFast(
  prompt: string,
  maxTokens = 512,
  temperature = 0.2,
): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: CONTENT_MODEL,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * Generate a rich, specific image prompt for blog cover art.
 * Used by images.ts to create topic-relevant AI-generated covers.
 *
 * Prompt strategy:
 *  - Extracts the core subject matter from the post topic
 *  - Combines category-specific visual language with topic-specific objects
 *  - Specifies lighting, composition, color palette, and photographic style
 *  - Explicitly bans text/faces/logos to keep images clean and professional
 */
export async function generateImagePrompt(
  topic: string,
  category: string,
): Promise<string> {
  // ── Category → illustration style guide ──────────────────────────────────
  // These prompts are designed for the RIGHT PANEL of a split editorial card.
  // The image sits on the right 40% of the cover; the left panel has the title.
  // Key requirements: clean focal element, works with gradient overlay on left edge,
  // bold colours that pop against a dark background, no busy full-scene chaos.
  const categoryContext: Record<string, {
    subject: string;   // the main visual subject (1 clear focal element)
    style:   string;   // rendering style
    palette: string;   // colours
    mood:    string;   // energy / feeling
  }> = {
    'YouTube Monetization': {
      subject: 'a bold 3D YouTube play button trophy or a stylised creator setup with a ring-light and camera facing the viewer — clean and iconic, centred on a dark background',
      style:   'high-end 3D product render, studio lighting, glossy surface reflections',
      palette: 'YouTube red (#FF0000), bright white, deep charcoal background',
      mood:    'achievement, aspiration, monetisation milestone',
    },
    'Course Creation': {
      subject: 'a sleek 3D laptop or tablet floating at a slight angle, screen showing a clean modern course interface with colourful module cards and a progress bar',
      style:   'clean 3D illustration, isometric or slight perspective, soft shadows',
      palette: 'rich purple (#8b5cf6), white screen glow, dark navy background',
      mood:    'education, empowerment, digital learning',
    },
    'Creator Growth': {
      subject: 'a bold upward-trending bar chart or rocket ship launching, rendered as a clean 3D geometric illustration with glowing data elements floating around it',
      style:   'modern 3D render, bold geometric shapes, vibrant neon glow on dark bg',
      palette: 'electric blue (#3b82f6) to cyan, glowing gold accents, dark background',
      mood:    'momentum, scale, growth breakthrough',
    },
    'Content Strategy': {
      subject: 'a stylised 3D content calendar or editorial funnel with colourful cards arranged in a strategic grid — clean, organised, editorial feel',
      style:   'flat-to-3D hybrid illustration, editorial graphic style, clean composition',
      palette: 'warm orange (#f97316), cream, soft brown accents on near-white background',
      mood:    'strategic, organised, intentional, professional',
    },
    'AI for Creators': {
      subject: 'a friendly 3D AI robot character sitting at a creator desk or holding a camera/microphone — modern, approachable, not scary — with subtle digital elements',
      style:   'polished 3D character illustration, Pixar-inspired style, clean studio lighting',
      palette: 'emerald green (#10b981), bright white highlights, dark gradient background',
      mood:    'innovative, empowering, human + AI collaboration',
    },
    'AI for Creator Economy': {
      subject: 'a friendly 3D AI robot or holographic assistant floating beside a creator workstation, with subtle glowing neural lines — modern and approachable',
      style:   'polished 3D illustration, cinematic studio lighting, high-detail render',
      palette: 'emerald green (#10b981), electric cyan, warm white glow, dark background',
      mood:    'transformative, future-forward, creator empowerment through AI',
    },
  };

  const ctx = categoryContext[category] ?? {
    subject: 'a bold 3D trophy or achievement badge floating on a dark gradient background, celebrating a creator milestone',
    style:   '3D product render, clean studio lighting, high polish',
    palette: 'rich purple, gold accents, dark background',
    mood:    'achievement, aspiration, professional growth',
  };

  const prompt = await askFast(
    `You are an art director creating the RIGHT-SIDE ILLUSTRATION for a split editorial blog cover card.
The cover has a dark left panel with the blog title text. Your illustration fills the RIGHT side.

POST TOPIC: "${topic}"
CATEGORY: ${category}

VISUAL SUBJECT: ${ctx.subject}
RENDERING STYLE: ${ctx.style}
COLOUR PALETTE: ${ctx.palette}
MOOD: ${ctx.mood}

KEY CONSTRAINTS (non-negotiable):
- ONE clear central focal element — not a busy scene with many equal elements
- TOPIC-SPECIFIC detail: if the topic is about a specific tool, milestone, or concept, reference it visually (e.g. for "1000 subscribers" show a "1K" milestone; for "Canva" show a design tool)
- The LEFT 20% of the image will be covered by a gradient overlay — keep key elements in the RIGHT 80%
- Clean background — no cluttered environments
- ABSOLUTELY NO text, words, letters, numbers, logos, or UI labels
- No human faces

Write a 100–140 word image generation prompt. Return ONLY the prompt text.`,
    320,
    0.85,
  );

  return prompt.trim().replace(/^["']|["']$/g, '');
}

/**
 * Strip markdown code fences from JSON responses
 */
export function stripJsonFences(text: string): string {
  // Strategy 1: strip simple ```json ... ``` fences
  const fenceStripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // If it looks like valid JSON already, return it
  if (fenceStripped.startsWith('{') || fenceStripped.startsWith('[')) {
    return fenceStripped;
  }

  // Strategy 2: extract the first complete JSON object from the text
  // Handles cases where Gemini adds commentary before/after the JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0].trim();
  }

  // Strategy 3: find JSON inside a code fence anywhere in the text
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return fenceStripped;
}
