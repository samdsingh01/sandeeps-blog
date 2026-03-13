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
 * Uses TWO separate Gemini calls to avoid JSON corruption:
 *   Call 1 — small metadata JSON (title, slug, tags, faqs)
 *   Call 2 — plain markdown content (no JSON wrapper)
 */
export async function generatePost(
  topic:           string,
  category:        string,
  insights?:       FeedbackInsights,
  failureContext?: string,
): Promise<{ title: string; description: string; slug: string; markdown: string; tags: string[]; seoKeywords: string[]; faqs: FAQItem[] }> {

  const perfContext = insights?.hasData && insights.agentPromptCtx
    ? `\n${insights.agentPromptCtx}` : '';
  const queryHints = insights?.topSearchQueries?.length
    ? `\nReal search queries from Google to weave in naturally:\n${insights.topSearchQueries.slice(0, 6).map((q) => `  - ${q}`).join('\n')}` : '';
  const retryContext = failureContext ? `\n${failureContext}\n` : '';

  const contentRules = `
BANNED PHRASES (Google Helpful Content penalty):
❌ "In today's digital landscape" / "Game changer" / "Skyrocket" / "Revolutionize"
❌ "In conclusion," / "To summarize," / "Navigate the" / "Embark on" / "Dive deep"
❌ "At the end of the day" / "Leverage your" / "It is important to note"
❌ Any vague filler with no specific insight

E-E-A-T REQUIREMENTS:
- At least 2 first-person Graphy creator patterns ("The creators who..." / "Our data shows...")
- Specific numbers in every section (%, $, timeframes, subscriber counts)
- One "## What Most Creators Get Wrong About [Topic]" section
- One "## Sandeep's Take" section with a direct personal opinion
- One step-by-step numbered action section
- Blockquote Pro Tip per major section

TONE: Direct, like texting a smart friend. Short sentences. "You" not "one".
GRAPHY: Max 2 natural mentions as a solution, not an ad.`;

  // ── CALL 1: Metadata only (small JSON — reliable parsing) ────────────────
  const metaPrompt = `
You are Sandeep Singh, co-founder of Graphy.com (50,000+ creators).
${perfContext}

Generate SEO metadata for a blog post about: "${topic}"
Category: ${category}
${queryHints}

Return ONLY this JSON object (no markdown, no explanation):
{
  "title": "Compelling SEO title 50-60 chars with primary keyword",
  "description": "Meta description 150-160 chars with keyword and clear benefit",
  "slug": "url-friendly-slug-with-hyphens",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "seo_keywords": ["primary keyword", "secondary 1", "secondary 2", "secondary 3"],
  "faqs": [
    { "question": "Specific question a creator googles?", "answer": "Direct 2-3 sentence answer with specific detail." },
    { "question": "How long does it take to [topic action]?", "answer": "Realistic timeframe with context." },
    { "question": "What is the difference between X and Y related to ${topic}?", "answer": "Clear comparison." },
    { "question": "Is [topic] worth it for small channels?", "answer": "Honest answer with numbers." },
    { "question": "What are the biggest mistakes with [topic]?", "answer": "2-3 specific mistakes." }
  ]
}`;

  const metaRaw = await askFast(metaPrompt, 1500, 0.6);
  let meta: { title: string; description: string; slug: string; tags: string[]; seo_keywords: string[]; faqs: FAQItem[] };

  try {
    meta = JSON.parse(stripJsonFences(metaRaw));
  } catch {
    console.warn('[Content] Meta JSON parse failed — using fallback metadata');
    meta = {
      title:        topic.replace(/\b\w/g, (c) => c.toUpperCase()),
      description:  `A practical guide to ${topic} for YouTube creators and online coaches.`,
      slug:         slugify(topic),
      tags:         [category.toLowerCase(), 'youtube', 'creators'],
      seo_keywords: [topic],
      faqs:         [],
    };
  }

  // ── CALL 2: Plain markdown content (no JSON — never corrupts) ────────────
  const contentPrompt = `
You are Sandeep Singh, co-founder of Graphy.com — a platform trusted by 50,000+ creators.
${retryContext}

Write a COMPLETE blog post in plain markdown about: "${topic}"
Title: ${meta.title}
Category: ${category}
${queryHints}

${contentRules}

STRUCTURE (required):
1. Opening hook — specific problem or surprising stat (no generic intro)
2. At least 5 ## H2 sections with 200+ words each
3. "## What Most Creators Get Wrong About [specific aspect]" section
4. "## Sandeep's Take" — short direct personal opinion
5. Numbered step-by-step action section
6. "> **Pro Tip:**" blockquote in each major section
7. "## Key Takeaways" bullet list near end
8. "## Frequently Asked Questions" at the very end with 5 Q&A pairs

LENGTH: 1,600–2,200 words minimum.

Write the full markdown post now. Start directly with the opening paragraph — no title heading needed.`;

  const markdown = await ask(contentPrompt, 8192, 0.75);

  console.log(`[Content] Generated ${markdown.split(' ').length} words for "${meta.title}"`);

  return {
    title:       meta.title,
    description: meta.description,
    slug:        meta.slug || slugify(meta.title),
    tags:        meta.tags        ?? [],
    seoKeywords: meta.seo_keywords ?? [topic],
    faqs:        meta.faqs         ?? [],
    markdown:    markdown.trim(),
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
