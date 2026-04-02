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
 * Generate a cinematic, topic-specific image prompt using the structured
 * Prompt Formula approach:
 *
 *   [Photo type], [Subject + Action], [Environment], [Color Scheme],
 *   [Camera/Lens], [Lighting], [Composition], [Additional Details]
 *
 * Each formula component is filled with category-specific defaults, then
 * Gemini generates the SUBJECT component to be hyper-specific to the topic.
 * This produces unique, cinematic images — not generic tech wallpapers.
 */
export async function generateImagePrompt(
  topic: string,
  category: string,
): Promise<string> {

  // ── Formula components by category ────────────────────────────────────────
  // Each field maps to a slot in the Prompt Formula.
  // The "subjectHint" tells Gemini what KIND of visual subject to generate
  // for the topic — Gemini fills in the specific, topic-accurate details.
  const formula: Record<string, {
    photoType:    string;
    subjectHint:  string;   // Gemini will make this topic-specific
    environment:  string;
    colorScheme:  string;
    cameraLens:   string;
    lighting:     string;
    composition:  string;
    additional:   string;
  }> = {

    'YouTube Monetization': {
      photoType:   'cinematic studio photography',
      subjectHint: 'a creator-economy object directly related to the topic — e.g. for "1000 subscribers" show a glowing milestone trophy or phone with notification; for "Super Thanks" show a floating gift icon; for "AdSense" show a floating revenue dashboard; always ONE iconic object',
      environment: 'sleek dark home studio backdrop, subtle depth of field, minimal clutter',
      colorScheme: 'YouTube red and warm amber against deep charcoal (#1a1a1a), high contrast, rich shadows',
      cameraLens:  'Canon EOS R5, 85mm f/1.2 prime lens, razor-sharp subject with creamy bokeh background',
      lighting:    'dramatic three-point studio lighting, warm amber key light from upper-left, YouTube red rim light behind subject, deep controlled shadows',
      composition: 'rule of thirds, subject positioned center-right, strong negative space on the left third',
      additional:  'magazine editorial quality, cinematic colour grade, ultra-high detail, no text no letters no logos no faces',
    },

    'Course Creation': {
      photoType:   'clean lifestyle product photography',
      subjectHint: 'a device or prop directly tied to the topic — e.g. for "online course" show a floating laptop with a modern course UI; for "video lessons" show a camera pointing at a whiteboard setup; for "course pricing" show floating price cards; ONE clear hero object',
      environment: 'minimal warm white desk surface, soft sage green plant in background, light wooden textures',
      colorScheme: 'rich violet (#7c3aed) and white, warm cream tones, sage green accent, natural warmth',
      cameraLens:  'Sony A7 IV, 50mm f/1.8 lens, 3/4 elevated angle, natural shallow focus',
      lighting:    'soft diffused north-facing window light, 5500K daylight balanced, minimal hard shadows, airy and clean',
      composition: 'subject centered or slight right offset, overhead-to-3/4 angle, clean breathing room all sides',
      additional:  'Pinterest-worthy lifestyle aesthetic, fresh and approachable, ultra-sharp focus on hero object, no text no letters no logos no faces',
    },

    'Creator Growth': {
      photoType:   'premium 3D data visualization render',
      subjectHint: 'a 3D data object that visualises the topic\'s outcome — e.g. for "grow subscribers" show a rocket launching from a bar chart; for "viral video" show glowing play button with orbit rings; for "algorithm" show a flowing network graph; ONE bold 3D element',
      environment: 'abstract dark digital space, subtle glowing grid floor, infinite dark backdrop',
      colorScheme: 'electric blue (#3b82f6) and cyan (#06b6d4), white glowing accents, deep navy (#050f1f) background',
      cameraLens:  'wide-angle 24mm equivalent, slightly low dramatic angle looking upward at subject',
      lighting:    'neon volumetric light rays emanating from the data element, blue-cyan glow, high contrast shadows',
      composition: 'subject lower-center ascending diagonally upward, dynamic energy, empty dark sky above',
      additional:  'Behance-quality 3D render, cinematic depth of field, glowing particle details, no text no letters no logos',
    },

    'Content Strategy': {
      photoType:   'editorial flat-lay photography',
      subjectHint: 'physical planning tools directly related to the topic — e.g. for "content calendar" show a colour-coded wall planner with sticky notes; for "editorial workflow" show a notebook with a funnel sketch; for "SEO strategy" show a printed keyword map with highlighters; real tactile objects',
      environment: 'warm kraft paper desk surface, purposefully arranged planning tools, light wood accents',
      colorScheme: 'burnt orange (#f97316), cream white, forest green accent, natural warm brown tones',
      cameraLens:  'medium format camera, 65mm tilt-shift lens, perfectly level overhead angle',
      lighting:    'twin soft-box overhead lighting, 3200K warm colour temperature, no harsh shadows, perfectly even flat-lay light',
      composition: 'overhead 90-degree flat-lay, items arranged in clear visual hierarchy with intentional negative space',
      additional:  'premium editorial magazine aesthetic, Kinfolk-style warmth, ultra-sharp textures, no text no letters no logos no faces',
    },

    'AI for Creator Economy': {
      photoType:   'cinematic sci-fi photography composite',
      subjectHint: 'a futuristic AI object tied to the specific topic — e.g. for "AI video editing" show a glowing AI interface over a timeline; for "ChatGPT for creators" show a holographic chat bubble with creative sparks; for "AI tools" show a sleek robotic hand holding a creator tool; ONE iconic futuristic object',
      environment: 'minimal dark studio environment with subtle dark-to-deep-teal gradient backdrop',
      colorScheme: 'emerald green (#10b981) and electric cyan, white glow highlights, near-black background (#060d0a)',
      cameraLens:  'cinema camera Arri Alexa, 35mm anamorphic T1.3, slight horizontal lens flare',
      lighting:    'dramatic theatrical side lighting, green and cyan LED accent, deep directional shadows, volumetric haze',
      composition: 'centered symmetrical OR rule-of-thirds with strong depth cues, foreground element blurred, focus at mid-distance',
      additional:  'Wired magazine cover aesthetic, cinematic colour grade, photorealistic detail, no text no letters no logos no faces',
    },

    'AI for Creators': {
      photoType:   'cinematic sci-fi photography composite',
      subjectHint: 'a futuristic AI object tied to the specific creator topic — e.g. for "AI script writing" show a holographic text stream flowing into a microphone; for "AI thumbnails" show a glowing design panel with creative sparks; ONE bold futuristic focal object',
      environment: 'minimal dark studio environment with subtle dark-to-deep-teal gradient backdrop',
      colorScheme: 'emerald green (#10b981) and electric cyan, white glow highlights, near-black background',
      cameraLens:  'cinema camera, 35mm anamorphic lens, gentle lens flare',
      lighting:    'dramatic green-cyan LED accent lighting, deep directional shadows, volumetric atmosphere',
      composition: 'centered or rule-of-thirds, strong depth, one clear focal point',
      additional:  'Wired magazine cover quality, no text no letters no logos no faces',
    },
  };

  const f = formula[category] ?? {
    photoType:   'editorial photography',
    subjectHint: 'a symbolic object representing the topic — a relevant tool, trophy, or concept rendered as one clean focal element',
    environment: 'minimal dark gradient studio backdrop',
    colorScheme: 'rich purple and gold, deep dark background',
    cameraLens:  'Canon EOS R5, 85mm prime, shallow depth of field',
    lighting:    'dramatic studio three-point lighting, deep shadows',
    composition: 'subject centered, strong negative space',
    additional:  'magazine quality, no text no letters no logos no faces',
  };

  // ── Ask Gemini to fill in the SUBJECT slot, topic-specifically ─────────────
  const subjectPrompt = await askFast(
    `You are generating ONE formula component for a blog cover photo prompt.

FORMULA SLOT: [Subject + Action]
BLOG TOPIC: "${topic}"
CATEGORY: ${category}
SUBJECT HINT: ${f.subjectHint}

Write a SINGLE precise Subject + Action description (15–25 words) that is:
1. Hyper-specific to the blog topic "${topic}" — not generic
2. Describes exactly ONE visual object and what it's doing/showing
3. No text, words, logos, letters, or human faces
4. Cinematic and specific — something an AI image model can render accurately

Examples of GOOD Subject + Action:
- "a glowing gold trophy shaped like a YouTube play button floating mid-air with light rays radiating outward"
- "a sleek MacBook Pro open at 45 degrees showing a purple course module grid on screen, pages fanned around it"
- "a bold 3D ascending bar chart in electric blue with a small rocket launching from the tallest bar"

Return ONLY the Subject + Action description. No preamble, no quotes.`,
    120,
    0.9,
  );

  const subject = subjectPrompt.trim().replace(/^["']|["']$/g, '');

  // ── Assemble the full structured prompt using the formula ──────────────────
  const fullPrompt = [
    f.photoType,
    subject,
    f.environment,
    f.colorScheme,
    f.cameraLens,
    f.lighting,
    f.composition,
    f.additional,
  ].join(', ');

  return fullPrompt;
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
