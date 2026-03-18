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
 * Generate a detailed, visual image prompt for blog cover art.
 * Used by images.ts to create topic-relevant AI-generated covers.
 */
export async function generateImagePrompt(
  topic: string,
  category: string,
): Promise<string> {
  const categoryStyle: Record<string, string> = {
    'YouTube Monetization':   'modern YouTube studio, camera equipment, bright ring light, creative workspace with screens showing analytics',
    'Course Creation':         'clean desk with laptop, notebook, and coffee, online learning aesthetic, soft natural light',
    'Creator Growth':          'rising chart, social media analytics dashboard, vibrant colors, digital growth visualization',
    'Content Strategy':        'content planning board, sticky notes, calendar, strategic planning workspace',
    'AI for Creators':         'glowing neural network, futuristic digital art workspace, AI holographic interface',
    'AI for Creator Economy':  'creator at laptop with AI assistant overlay, neural network data streams, vibrant purple-cyan gradient, futuristic-yet-human workspace',
  };

  const style = categoryStyle[category] ?? 'modern digital creator workspace, laptop, clean minimal aesthetic';

  const prompt = await askFast(
    `You are a visual art director creating cover images for a creator economy blog.
Write a single detailed image generation prompt (under 80 words) for a blog post titled: "${topic}"

The image should be: ${style}
Style: professional photography or 3D render, vibrant but clean, high-contrast, suitable as a wide blog header (16:9 ratio)
No text in the image. No people's faces. Focus on objects, workspace, technology, and mood.

Return ONLY the image prompt. No quotes, no preamble.`,
    200,
    0.8,
  );

  return prompt.trim().replace(/^["']|["']$/g, ''); // strip surrounding quotes if any
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
