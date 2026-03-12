/**
 * agent/content.ts
 * ================
 * Generates full blog posts using Gemini.
 * Returns structured post data ready to insert into Supabase.
 */

import { ask, askFast, stripJsonFences } from './gemini';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import remarkGfm from 'remark-gfm';
import readingTime from 'reading-time';
import type { FeedbackInsights } from './feedback';

export interface FAQItem {
  question: string;
  answer:   string;
}

export interface GeneratedPost {
  slug:         string;
  title:        string;
  description:  string;
  content:      string;       // raw markdown
  content_html: string;       // rendered HTML
  category:     string;
  tags:         string[];
  seo_keywords: string[];
  reading_time: string;
  cover_image:  string;
  featured:     boolean;
  faqs:         FAQItem[];    // for FAQ schema (AEO)
}

const CATEGORIES = [
  'YouTube Monetization',
  'Course Creation',
  'Creator Growth',
  'Content Strategy',
  'AI for Creators',
];

/**
 * Pick the best category for a given topic
 */
export async function classifyCategory(topic: string): Promise<string> {
  const prompt = `
Classify this blog post topic into exactly one category.
Topic: "${topic}"
Categories: ${CATEGORIES.join(', ')}
Return ONLY the category name, nothing else.`;

  const result = await askFast(prompt, 50);
  const match = CATEGORIES.find((c) => result.includes(c));
  return match ?? 'Creator Growth';
}

/**
 * Generate a full blog post for the given topic.
 * Optionally receives feedback insights to write smarter, performance-aware content.
 */
export async function generatePost(
  topic: string,
  category: string,
  insights?: FeedbackInsights,
): Promise<{ title: string; description: string; slug: string; markdown: string; tags: string[]; seoKeywords: string[]; faqs: FAQItem[] }> {

  // Inject performance context if available
  const perfContext = insights?.hasData && insights.agentPromptCtx
    ? `\n${insights.agentPromptCtx}`
    : '';

  // Include top search queries as semantic hints
  const queryHints = insights?.topSearchQueries?.length
    ? `\nTop real search queries from Google (use these naturally in the post where relevant):\n${insights.topSearchQueries.slice(0, 8).map((q) => `  - ${q}`).join('\n')}`
    : '';

  const prompt = `
You are Sandeep Singh, co-founder of Graphy.com — a platform for creators to build and sell online courses.
You write practical, data-driven blog posts for early-stage YouTube creators and online coaches.
${perfContext}
Write a comprehensive, SEO and AEO-optimized blog post about: "${topic}"
Category: ${category}
${queryHints}

WRITING GUIDELINES:
- Write in a direct, practical, encouraging tone (like a knowledgeable friend, not a professor)
- Use real numbers and stats where possible (e.g. "channels with 1,000+ subscribers earn $3-$5 per 1,000 views")
- Include 5-7 actionable sections with H2 headers
- Add a "Quick Win" or "Pro Tip" callout in at least 2 sections
- Mention Graphy.com naturally (not salesy) where it genuinely helps (course creation, selling knowledge)
- End with a strong conclusion and clear next step
- Target length: 1,500-2,000 words
- Use markdown formatting (## for H2, **bold**, bullet lists, numbered steps)
- AEO: include a "## Frequently Asked Questions" section at the end with 4-5 Q&A pairs covering the most common questions about this topic

Return a JSON object with this exact structure:
{
  "title": "SEO-optimized title (50-60 chars)",
  "description": "Meta description (150-160 chars, includes keyword)",
  "slug": "url-friendly-slug-with-hyphens",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "seo_keywords": ["primary keyword", "secondary keyword 1", "secondary keyword 2"],
  "faqs": [
    { "question": "What is the best way to...?", "answer": "The best way is..." },
    { "question": "How long does it take to...?", "answer": "It typically takes..." }
  ],
  "markdown": "## Introduction\\n\\nFull post content here... (include the FAQ section in the markdown too)"
}

Return ONLY the JSON object, no other text.`;

  const raw     = await ask(prompt, 4096, 0.75);
  const cleaned = stripJsonFences(raw);

  let parsed: {
    title:        string;
    description:  string;
    slug:         string;
    tags:         string[];
    seo_keywords: string[];
    faqs:         FAQItem[];
    markdown:     string;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('Content JSON parse failed, using fallback');
    return {
      title:       topic,
      description: `A practical guide to ${topic} for YouTube creators and online coaches.`,
      slug:        slugify(topic),
      tags:        [category.toLowerCase(), 'youtube', 'creators'],
      seoKeywords: [topic],
      faqs:        [],
      markdown:    raw,
    };
  }

  return {
    title:       parsed.title,
    description: parsed.description,
    slug:        parsed.slug || slugify(parsed.title),
    tags:        parsed.tags        ?? [],
    seoKeywords: parsed.seo_keywords ?? [topic],
    faqs:        parsed.faqs         ?? [],
    markdown:    parsed.markdown,
  };
}

/**
 * Generate FAQ items for an existing post (for retroactive AEO upgrade).
 */
export async function generateFAQs(title: string, markdown: string): Promise<FAQItem[]> {
  const prompt = `
Based on this blog post titled "${title}", generate 5 FAQ items that cover the most common questions
readers would have about this topic.

Write answers that are concise (2-4 sentences), factual, and directly answer the question.
These will be used as FAQ structured data for Google AI Overviews and Perplexity.

Return ONLY a JSON array:
[
  { "question": "Question here?", "answer": "Answer here." }
]

Post excerpt (first 1000 chars):
${markdown.slice(0, 1000)}`;

  const raw = await askFast(prompt, 1500, 0.5);
  try {
    return JSON.parse(stripJsonFences(raw)) as FAQItem[];
  } catch {
    return [];
  }
}

/**
 * Render markdown to HTML
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const processed = await remark()
    .use(remarkGfm)
    .use(remarkHtml, { sanitize: false })
    .process(markdown);
  return processed.toString();
}

/**
 * Calculate reading time
 */
export function calcReadingTime(markdown: string): string {
  return readingTime(markdown).text;
}

/**
 * Convert a string to a URL-safe slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
