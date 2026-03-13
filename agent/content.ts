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
  topic:           string,
  category:        string,
  insights?:       FeedbackInsights,
  failureContext?: string,
): Promise<{ title: string; description: string; slug: string; markdown: string; tags: string[]; seoKeywords: string[]; faqs: FAQItem[] }> {

  // Inject performance context if available
  const perfContext = insights?.hasData && insights.agentPromptCtx
    ? `\n${insights.agentPromptCtx}`
    : '';

  // Include top search queries as semantic hints
  const queryHints = insights?.topSearchQueries?.length
    ? `\nTop real search queries from Google (use these naturally in the post where relevant):\n${insights.topSearchQueries.slice(0, 8).map((q) => `  - ${q}`).join('\n')}`
    : '';

  // Inject quality failure feedback on retry
  const retryContext = failureContext ? `\n${failureContext}\n` : '';

  const prompt = `
You are Sandeep Singh, co-founder of Graphy.com — a platform trusted by 50,000+ creators to build and sell online courses.
Before starting Graphy, I spent years studying what separates YouTube channels that break through from those that stagnate. Our platform data shows us exactly how creators monetise — and most are leaving 80–90% of potential revenue on the table by relying only on AdSense.
${perfContext}

Write a HELPFUL, EXPERIENCE-DRIVEN blog post about: "${topic}"
Category: ${category}
${queryHints}
${retryContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 GOOGLE COMPLIANCE RULES — NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STRICTLY BANNED — these phrases trigger Google's Helpful Content penalty:
❌ "In today's digital landscape" / "In today's fast-paced world"
❌ "It's no secret that" / "Needless to say" / "Without further ado"
❌ "Game changer" / "Revolutionize" / "Skyrocket" / "Unlock your potential"
❌ "In conclusion," / "To summarize," / "As we've explored"
❌ "Navigate the" / "Embark on" / "Dive deep into"
❌ "At the end of the day" / "The bottom line is" / "Leverage your"
❌ "When it comes to" (as a sentence opener) / "It is important to note"
❌ Any vague filler paragraph that doesn't contain a specific insight

DO NOT write for search engines. Write for a real YouTube creator who is stuck and needs help RIGHT NOW.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ E-E-A-T REQUIREMENTS (Google ranks these)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXPERIENCE — Include at least 2 of:
- A pattern I've seen across Graphy creators (e.g. "The creators who grow fastest consistently do X...")
- A specific creator type or scenario (e.g. "A cooking channel with 50K subscribers typically earns...")
- Something counterintuitive I've learned (e.g. "Most creators focus on X, but our data shows Y matters more")

EXPERTISE — Every section must include:
- At least one specific number (%, $, timeframe, view count, subscriber threshold)
- A concrete "how to" — not just "you should do X" but "here's exactly how"
- Where relevant: mention specific tools, platforms, or tactics by name

AUTHORITATIVENESS — The post must:
- Have a "## Sandeep's Take" or "## What Most Creators Get Wrong" section with a genuine opinion
- Mention real industry context (YouTube Partner Program thresholds, actual CPM ranges, etc.)
- Reference real-world constraints creators face (time, budget, audience size)

TRUSTWORTHINESS — Never:
- Make up statistics without flagging them as estimates
- Use superlatives without evidence ("the best", "the most powerful") unless verifiable
- Claim something works without explaining why or showing the mechanism

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 STRUCTURE REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LENGTH: 1,600–2,200 words (anything under 1,400 will be rejected)

REQUIRED SECTIONS (use these exact patterns):
1. Opening paragraph — hook with a specific problem or surprising stat (NO generic intro)
2. At least 5 ## H2 sections, each with 200+ words
3. One "## What Most [Creators/YouTubers/Coaches] Get Wrong About [Topic]" section
4. One "## Sandeep's Take" or "## My Take" box — short, direct personal opinion
5. One "## [Topic]: Step-by-Step" or numbered action section
6. One "> **Pro Tip:**" or "> **Quick Win:**" blockquote per major section
7. "## Key Takeaways" or "## Action Plan" near the end (bullet list)
8. "## Frequently Asked Questions" at the very end — 5 Q&A pairs

TONE:
- Write like you're texting a smart friend who's building a YouTube channel
- Be direct. Say what doesn't work, not just what does.
- Short sentences. No academic language.
- Use "you" not "one" or "creators should"

GRAPHY MENTIONS (max 2, must be natural):
- Only mention Graphy.com where it genuinely solves a problem being discussed
- Frame it as a solution, not an ad: "If you want to build a course around this, [Graphy.com](https://graphy.com) makes it straightforward to..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return a JSON object with this exact structure:
{
  "title": "SEO title (50-60 chars, includes primary keyword, compelling for humans)",
  "description": "Meta description (150-160 chars, includes keyword, ends with a benefit or question)",
  "slug": "url-friendly-slug-with-hyphens",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "seo_keywords": ["primary keyword", "secondary keyword 1", "secondary keyword 2", "secondary keyword 3"],
  "faqs": [
    { "question": "Specific question a creator would google?", "answer": "Direct 2-3 sentence answer with specific detail." },
    { "question": "How long does it take to...?", "answer": "Realistic timeframe with context." },
    { "question": "What is the difference between X and Y?", "answer": "Clear comparison." },
    { "question": "Is [topic] worth it for small channels?", "answer": "Honest answer." },
    { "question": "What are the biggest mistakes in [topic]?", "answer": "2-3 specific mistakes." }
  ],
  "markdown": "Full post content in markdown (1600+ words, all required sections included)"
}

Return ONLY the JSON object. No preamble, no explanation, no markdown fences.`;

  const raw     = await ask(prompt, 8192, 0.75);
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
