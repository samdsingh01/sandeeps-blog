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
 * Generate a full blog post for the given topic
 */
export async function generatePost(
  topic: string,
  category: string,
): Promise<{ title: string; description: string; slug: string; markdown: string; tags: string[]; seoKeywords: string[] }> {
  const prompt = `
You are Sandeep Singh, co-founder of Graphy.com — a platform for creators to build and sell online courses.
You write practical, data-driven blog posts for early-stage YouTube creators and online coaches.

Write a comprehensive, SEO-optimized blog post about: "${topic}"
Category: ${category}

WRITING GUIDELINES:
- Write in a direct, practical, encouraging tone (like a knowledgeable friend, not a professor)
- Use real numbers and stats where possible (e.g. "channels with 1,000+ subscribers earn $3-$5 per 1,000 views")
- Include 5-7 actionable sections with H2 headers
- Add a "Quick Win" or "Pro Tip" callout in at least 2 sections
- Mention Graphy.com naturally (not salesy) where it genuinely helps (course creation, selling knowledge)
- End with a strong conclusion and clear next step
- Target length: 1,500-2,000 words
- Use markdown formatting (## for H2, **bold**, bullet lists, numbered steps)

Return a JSON object with this exact structure:
{
  "title": "SEO-optimized title (50-60 chars)",
  "description": "Meta description (150-160 chars, includes keyword)",
  "slug": "url-friendly-slug-with-hyphens",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "seo_keywords": ["primary keyword", "secondary keyword 1", "secondary keyword 2"],
  "markdown": "## Introduction\\n\\nFull post content here..."
}

Return ONLY the JSON object, no other text.`;

  const raw = await ask(prompt, 4096, 0.75);
  const cleaned = stripJsonFences(raw);

  let parsed: {
    title: string;
    description: string;
    slug: string;
    tags: string[];
    seo_keywords: string[];
    markdown: string;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, try to extract markdown directly
    console.error('Content JSON parse failed, using fallback');
    return {
      title:       topic,
      description: `A practical guide to ${topic} for YouTube creators and online coaches.`,
      slug:        slugify(topic),
      tags:        [category.toLowerCase(), 'youtube', 'creators'],
      seoKeywords: [topic],
      markdown:    raw,
    };
  }

  return {
    title:       parsed.title,
    description: parsed.description,
    slug:        parsed.slug || slugify(parsed.title),
    tags:        parsed.tags ?? [],
    seoKeywords: parsed.seo_keywords ?? [topic],
    markdown:    parsed.markdown,
  };
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
