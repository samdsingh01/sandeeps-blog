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
