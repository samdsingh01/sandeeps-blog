/**
 * agent/content.ts
 * ================
 * Generates full blog posts using Gemini.
 * Returns structured post data ready to insert into Supabase.
 */

import { ask, askFast, stripJsonFences } from './gemini';
import { getMissionContext }              from './escalate';
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

export const CATEGORIES = [
  'YouTube Monetization',
  'Course Creation',
  'Creator Growth',
  'Content Strategy',
  'AI for Creator Economy',
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

VISUAL RICHNESS REQUIREMENTS (mandatory — makes posts scannable and engaging):
1. TABLES: Include at least 2 markdown comparison tables. Examples:
   | Platform | Revenue Share | Min Payout | Best For |
   |----------|--------------|------------|----------|
   | YouTube  | 55%          | $100       | Long-form |

2. STAT CALLOUTS: Wrap key stats in this HTML (use 2–3 times):
   <div class="stat-box">📊 Channels with consistent uploads earn <strong>3x more AdSense</strong> than irregular ones — YouTube Creator Academy, 2025</div>

3. TIP BOXES: Use for standout Pro Tips (use 2–3 times):
   <div class="tip-box">💡 <strong>Pro Tip:</strong> Your actionable tip here.</div>

4. WARNING BOXES: Use once for the biggest mistake to avoid:
   <div class="warning-box">⚠️ <strong>Watch out:</strong> Warning text here.</div>

5. CALLOUT BOXES: Use once for a key mid-article insight:
   <div class="callout-box">🎯 <strong>Key Insight:</strong> Insight text here.</div>

READABILITY RULES:
- Max 3 sentences per paragraph — no walls of text
- Use **bold** for key terms, numbers, and action words
- Every H2 section needs at least one visual element (table, box, or list)
- Target 1,200–1,500 words — tight and punchy beats long and fluffy

TONE: Direct, like texting a smart friend. Short sentences. "You" not "one".
GRAPHY: Max 2 natural mentions as a solution, not an ad.`;

  // Determine post type from category for mission context injection
  const postType = category === 'AI for Creator Economy' ? 'ai' : 'bofu';
  const missionCtx = getMissionContext(postType);

  // ── CALL 1: Metadata only (small JSON — reliable parsing) ────────────────
  const metaPrompt = `
You are Sandeep Singh, co-founder of Graphy.com (50,000+ creators).
${missionCtx}
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

  // AI-specific extra rules for "AI for Creator Economy" posts
  const aiRules = category === 'AI for Creator Economy' ? `
AI CATEGORY RULES (mandatory for this category):
- Start from a REAL creator problem (growing a channel, selling courses, saving time)
- Show HOW AI solves that problem with SPECIFIC tools + step-by-step usage
- Include a "## Before AI vs After AI" section with real numbers/comparisons
- Mention at least 2 specific AI tools by name (ChatGPT, Gemini, ElevenLabs, Pictory, Descript, etc.)
- End with an actionable AI workflow the reader can copy TODAY
- AI-first angle — not "AI can help" but "here is EXACTLY how to use AI for this"
- Every section must show concrete tool usage, not just theory
` : '';

  // ── CALL 2: Plain markdown content (no JSON — never corrupts) ────────────
  const contentPrompt = `
You are Sandeep Singh, co-founder of Graphy.com — a platform trusted by 50,000+ creators.
${missionCtx}
${retryContext}

Write a COMPLETE blog post in plain markdown about: "${topic}"
Title: ${meta.title}
Category: ${category}
${queryHints}

${contentRules}
${aiRules}

STRUCTURE (required):
1. Opening hook — one punchy paragraph with a surprising stat or bold claim
2. At least 5 ## H2 sections — each with a table OR stat-box OR tip-box
3. One markdown comparison table in the first 2 sections
4. "## What Most Creators Get Wrong About [specific aspect]" — include a warning-box
5. "## Sandeep's Take" — 2–3 short paragraphs, direct opinion, no fluff
6. One numbered step-by-step action section (use 1. 2. 3. format)
7. One second comparison or data table anywhere in the post
8. "## Key Takeaways" — 5 tight bullet points
9. "## Frequently Asked Questions" — 5 Q&A pairs at the very end

LENGTH: 1,200–1,500 words. Every sentence must add value.

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
 * Generate a TOFU (Top-of-Funnel) trend-commentary post.
 *
 * TOFU posts are different from BOFU:
 *  - Hook: a trending creator economy topic or news angle
 *  - Style: commentary + analysis ("what this means for YOU as a creator")
 *  - Goal: broad traffic, brand authority, soft conversion via internal links
 *  - NOT a tutorial — it's opinionated analysis with a creator lens
 *
 * @param trendTopic - The trending topic/title picked by pickTrendingCreatorTopic()
 */
export async function generateTofuPost(
  trendTopic: string,
): Promise<{ title: string; description: string; slug: string; markdown: string; tags: string[]; seoKeywords: string[]; faqs: FAQItem[]; category: string }> {

  // Classify category for this trend topic
  const category = await classifyCategory(trendTopic);
  const missionCtx = getMissionContext('tofu');

  // ── CALL 1: Metadata ────────────────────────────────────────────────────
  const metaPrompt = `
You are Sandeep Singh, co-founder of Graphy.com (50,000+ creators).
${missionCtx}

Generate SEO metadata for a TOFU trend-analysis blog post.
Topic: "${trendTopic}"
Category: ${category}
Style: Commentary + analysis, opinionated, "what this means for you as a creator"

Return ONLY this JSON (no markdown, no explanation):
{
  "title": "Punchy opinionated title 50-65 chars — can start with the trend itself",
  "description": "Meta description 150-160 chars — what changed and why creators should care",
  "slug": "url-friendly-slug",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "seo_keywords": ["primary keyword", "secondary 1", "secondary 2", "secondary 3"],
  "faqs": [
    { "question": "What does [trend] mean for content creators?", "answer": "Direct 2-3 sentence answer." },
    { "question": "How should creators respond to [trend]?", "answer": "Specific actionable advice." },
    { "question": "Is [trend] good or bad for creators?", "answer": "Nuanced answer with context." },
    { "question": "Which creators are most affected by [trend]?", "answer": "Specific segments with reasoning." },
    { "question": "What should creators do right now about [trend]?", "answer": "Concrete next steps." }
  ]
}`;

  const metaRaw = await askFast(metaPrompt, 1500, 0.6);
  let meta: { title: string; description: string; slug: string; tags: string[]; seo_keywords: string[]; faqs: FAQItem[] };

  try {
    meta = JSON.parse(stripJsonFences(metaRaw));
  } catch {
    console.warn('[Content/TOFU] Meta JSON parse failed — using fallback metadata');
    meta = {
      title:        trendTopic.slice(0, 80),
      description:  `Analysis of ${trendTopic} and what it means for creators.`,
      slug:         slugify(trendTopic),
      tags:         [category.toLowerCase(), 'creator economy', 'youtube'],
      seo_keywords: [trendTopic.toLowerCase()],
      faqs:         [],
    };
  }

  // ── CALL 2: Content ─────────────────────────────────────────────────────
  const tofuRules = `
BANNED PHRASES (Google Helpful Content penalty):
❌ "In today's digital landscape" / "Game changer" / "Skyrocket" / "Revolutionize"
❌ "In conclusion," / "Navigate the" / "Embark on" / "Dive deep"
❌ Any vague filler with no specific insight

TOFU CONTENT RULES:
- This is NOT a tutorial — it's NEWS + ANALYSIS for creators
- Lead with what changed / what's happening — establish the trend immediately
- "What this means for creators" angle in every section
- Include your own OPINION — agree/disagree with the trend, take a stance
- Use REAL numbers and examples (YouTube stats, creator case studies, etc.)
- 2-3 internal linking hooks ("If you want to monetize this, see our guide on X")
- Soft Graphy mention at most once — only if directly relevant
- End with a specific call to action: what should the reader do TODAY

VISUAL RICHNESS:
1. At least 1 comparison table (e.g., Before vs After, Old vs New)
2. One <div class="stat-box"> with a key statistic
3. One <div class="tip-box"> with a standout creator tip
4. One <div class="callout-box"> with the key insight
5. One <div class="warning-box"> if there's a common mistake to avoid

STRUCTURE (required):
1. Opening: 2-3 punchy sentences — what's happening and why it matters NOW
2. "## What's Actually Changing" — the facts, stripped of hype
3. "## Why This Matters for [specific creator type]" — concrete impact
4. "## What Most Creators Will Do (And Why That's Wrong)" — contrarian take
5. "## Sandeep's Take" — 2–3 short paragraphs with clear personal opinion
6. "## What You Should Do Right Now" — numbered action steps (3-5 steps)
7. "## Key Takeaways" — 5 tight bullet points
8. "## Frequently Asked Questions" — 5 Q&A pairs

TONE: Direct, like texting a smart friend. Short sentences. "You" not "one".
LENGTH: 900–1,200 words. Tight and punchy. TOFU readers scan — make it scannable.`;

  const contentPrompt = `
You are Sandeep Singh, co-founder of Graphy.com — a platform trusted by 50,000+ creators.
${missionCtx}

Write a COMPLETE TOFU trend-analysis blog post in plain markdown.
Topic: "${trendTopic}"
Title: ${meta.title}
Category: ${category}

${tofuRules}

Write the full markdown post now. Start directly with the opening paragraph — no title heading needed.`;

  const markdown = await ask(contentPrompt, 6000, 0.8);
  console.log(`[Content/TOFU] Generated ${markdown.split(' ').length} words for "${meta.title}"`);

  return {
    title:       meta.title,
    description: meta.description,
    slug:        meta.slug || slugify(meta.title),
    tags:        meta.tags        ?? [],
    seoKeywords: meta.seo_keywords ?? [trendTopic.toLowerCase()],
    faqs:        meta.faqs         ?? [],
    markdown:    markdown.trim(),
    category,
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
