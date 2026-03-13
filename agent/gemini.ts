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

const CONTENT_MODEL = 'gemini-2.0-flash-lite';

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
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}
