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
  const categoryContext: Record<string, {
    scene:   string;
    objects: string;
    mood:    string;
    palette: string;
    style:   string;
  }> = {
    'YouTube Monetization': {
      scene:   'professional YouTube creator studio',
      objects: 'mirrorless camera on tripod, LED ring light, dual monitors showing analytics dashboards, AdSense revenue charts, microphone, softbox lighting, subscriber count milestone plaque on wall',
      mood:    'aspirational, focused, entrepreneurial energy',
      palette: 'warm amber and deep red accents on dark charcoal background, YouTube red highlights',
      style:   'cinematic photography, shallow depth of field, f/1.8 bokeh on background equipment',
    },
    'Course Creation': {
      scene:   'minimal creative workspace for online course production',
      objects: 'open laptop with course slide visible on screen, moleskine notebook with pen, ceramic coffee cup, USB microphone, external monitor showing video timeline, course completion badge, soft plants',
      mood:    'focused, calm, productive, knowledgeable',
      palette: 'clean whites, warm wood tones, sage green accents, soft natural window light',
      style:   'lifestyle product photography, overhead or 45-degree angle, crisp and airy',
    },
    'Creator Growth': {
      scene:   'dynamic data visualization and growth dashboard',
      objects: 'glowing holographic growth charts, follower count rising, interconnected social platform icons as 3D spheres, upward trending graphs with vibrant glow, digital analytics interface',
      mood:    'momentum, optimism, breakthrough, scaling energy',
      palette: 'electric blue to violet gradient, neon accent lines, dark navy background with glowing data elements',
      style:   '3D render, futuristic UI design, volumetric lighting, Behance digital art aesthetic',
    },
    'Content Strategy': {
      scene:   'strategic content planning command center',
      objects: 'large wall-mounted content calendar with color-coded posts, sticky notes arranged in a funnel diagram, open strategy notebook, laptop showing content pipeline, coffee, pens scattered purposefully',
      mood:    'methodical, strategic, organized creative chaos',
      palette: 'warm cream and burnt orange, coral accents, kraft paper textures, bright natural light',
      style:   'editorial flat-lay photography, top-down composition, warm color grading',
    },
    'AI for Creators': {
      scene:   'futuristic AI-augmented creative workspace',
      objects: 'holographic AI interface floating above a laptop, neural network nodes as glowing orbs, abstract data streams, creative tools (camera, pen, microphone) intertwined with digital circuits',
      mood:    'innovative, empowering, human creativity amplified by AI',
      palette: 'deep purple to electric cyan gradient, magenta accent glows, dark background with luminous AI elements',
      style:   'cinematic sci-fi 3D concept art, volumetric light rays, Blade Runner aesthetic meets creator economy',
    },
    'AI for Creator Economy': {
      scene:   'AI-powered creator economy command center',
      objects: 'creator at workstation with translucent AI assistant interface overlay, floating analytics and revenue projections, AI-generated content previews on multiple screens, glowing neural pathways connecting tools',
      mood:    'transformative, empowering, next-generation creator tools',
      palette: 'vibrant purple-to-teal gradient, golden AI highlights, dark rich background, luminous data flows',
      style:   'high-end 3D render + photography composite, cinematic lighting, Wired magazine cover aesthetic',
    },
  };

  const ctx = categoryContext[category] ?? {
    scene:   'modern digital creator workspace',
    objects: 'laptop, premium desk setup, creative tools, soft ambient lighting',
    mood:    'professional, focused, aspirational',
    palette: 'clean neutrals with one bold accent color',
    style:   'professional photography, shallow depth of field',
  };

  const prompt = await askFast(
    `You are a world-class visual art director for a top creator economy publication.
Your job: write a HIGHLY SPECIFIC, VIVID image generation prompt for a blog post cover.

POST TITLE: "${topic}"
CATEGORY: ${category}

SCENE CONTEXT: ${ctx.scene}
KEY OBJECTS TO INCLUDE: ${ctx.objects}
MOOD/ENERGY: ${ctx.mood}
COLOR PALETTE: ${ctx.palette}
PHOTOGRAPHIC/ART STYLE: ${ctx.style}

YOUR TASK:
Write a single image generation prompt (120–160 words) that:
1. Opens with the primary subject and scene — make it SPECIFIC to the post title (e.g. for "1000 subscribers monetization" include a milestone screen showing "1K subscribers", for "Canva for YouTube" show Canva interface visible on screen)
2. Describes exact objects, their arrangement, and key visual details
3. Specifies lighting (direction, quality, color temperature)
4. Names the color palette explicitly (e.g. "warm amber tones with deep red accents")
5. States the photographic/art style and technical details (lens, render style, composition)
6. Ends with: "No text, no words, no letters, no logos anywhere in the image. No human faces."

Return ONLY the image prompt. No explanations, no quotes, no preamble.`,
    350,
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
