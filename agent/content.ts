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
import type { FeedbackInsights }   from './feedback';
import type { CompetitorInsights } from './competitors';
import type { WeeklyExperiment }   from './brainstorm';

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
 * Pick the best category for a given topic.
 *
 * WHY THIS MATTERS:
 * A vague prompt + substring matching caused nearly every post to land in
 * "Creator Growth" (the most generic-sounding category). The fix:
 *   1. Rich per-category descriptions with examples
 *   2. Explicit disambiguation rules for common edge cases
 *   3. Low temperature (0.1) for consistent, deterministic output
 *   4. Exact match → substring match → topic-keyword fallback (3 layers)
 */
export async function classifyCategory(topic: string): Promise<string> {
  const prompt = `You are a blog category classifier for sandeeps.co, a blog for YouTube creators and online coaches.

Classify this topic into EXACTLY ONE category. Return only the category name — nothing else, no punctuation, no explanation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CATEGORY DEFINITIONS (read carefully):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"YouTube Monetization"
  Covers: AdSense, RPM/CPM, YouTube Partner Program (YPP), Super Thanks,
  channel memberships, Shorts monetization, brand deals tied to YouTube,
  making money from YouTube videos, income from a YouTube channel.
  Examples: "how to get monetized on youtube", "youtube adsense revenue",
  "how much does youtube pay per 1000 views", "youtube shorts fund",
  "how to make money with 1000 subscribers"

"Course Creation"
  Covers: Building, pricing, launching, and selling online courses or digital
  products. Platforms: Teachable, Thinkific, Graphy, Kajabi, Udemy, Gumroad.
  Course structure, student completion, course funnels, membership sites.
  Examples: "how to create an online course", "best course creation platforms",
  "teachable vs graphy comparison", "how to price an online course",
  "selling digital products as a creator"

"Creator Growth"
  Covers: Growing a YouTube channel audience — subscriber growth, YouTube
  algorithm, channel niche, thumbnails, video titles, watch time, retention,
  posting frequency, personal branding, building a fanbase from zero.
  Examples: "how to get more youtube subscribers", "youtube algorithm explained",
  "best niche for youtube channel", "how to increase watch time",
  "youtube thumbnail best practices"
  NOT: making money from YouTube (that is YouTube Monetization)
  NOT: content planning across platforms (that is Content Strategy)

"Content Strategy"
  Covers: Planning, batching, repurposing, and distributing content across
  platforms (YouTube → TikTok/Instagram/LinkedIn). Content calendars, content
  pillars, SEO-driven content planning, faceless YouTube channels, editorial
  workflows, video scripting systems.
  Examples: "content repurposing strategy for creators", "content calendar
  for youtube", "youtube SEO strategy 2026", "batch filming workflow",
  "content pillars for a youtube channel", "faceless youtube channel ideas"

"AI for Creator Economy"
  Covers: Using AI tools to create, edit, script, or automate content.
  ChatGPT for YouTube scripts, AI video editing, AI thumbnail generation,
  AI voiceovers, automated content pipelines, AI tools for creators.
  Examples: "best AI tools for youtubers", "how to use ChatGPT for youtube
  scripts", "AI video editing software", "AI thumbnail generators"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISAMBIGUATION RULES (when you are unsure):
  - "grow + income/earn/money/revenue/monetize" → YouTube Monetization
  - "grow + subscribers/views/algorithm/audience/channel" → Creator Growth
  - Anything mentioning "course", "sell knowledge", "digital product" → Course Creation
  - AI / ChatGPT / automation tools for content creation → AI for Creator Economy
  - Content planning, repurposing, calendars, multi-platform → Content Strategy
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOPIC TO CLASSIFY: "${topic}"

Reply with EXACTLY one of these (copy it verbatim):
YouTube Monetization
Course Creation
Creator Growth
Content Strategy
AI for Creator Economy`;

  const result = (await askFast(prompt, 100, 0.1)).trim();

  // Layer 1: exact case-insensitive match
  const exactMatch = CATEGORIES.find(
    (c) => result.toLowerCase() === c.toLowerCase(),
  );
  if (exactMatch) return exactMatch;

  // Layer 2: Gemini included extra words — find which category name is present
  const subMatch = CATEGORIES.find((c) => result.includes(c));
  if (subMatch) return subMatch;

  // Layer 3: keyword heuristics on the TOPIC itself (bypasses Gemini entirely)
  const t = topic.toLowerCase();
  if (/monetiz|adsense|rpm|cpm|earn|income|revenue|pay\b|making money|partner program|brand deal|sponsorship|affiliate|super thanks|channel member/.test(t))
    return 'YouTube Monetization';
  if (/\bcourse\b|teach|sell (online|course|digital|knowledge)|kajabi|teachable|thinkific|gumroad|membership site|digital product|online product/.test(t))
    return 'Course Creation';
  if (/\bai\b|chatgpt|artificial intel|automat(e|ion)|llm|midjourney|dall.?e|voiceover ai|ai tool|ai video|ai script|ai thumbnail/.test(t))
    return 'AI for Creator Economy';
  if (/strategy|calendar|repurpos|pillar|batch|editorial|faceless|multi.?platform|content seo|content plan|scripting|workflow|hook/.test(t))
    return 'Content Strategy';
  // Explicit Creator Growth signals (subscriber/view/algorithm growth)
  if (/subscriber|algorithm|watch time|retention|niche|thumbnail|click.?through|ctr|channel growth|views|viral|trending|shorts growth/.test(t))
    return 'Creator Growth';

  // Layer 4: Ask Gemini one more time with a simpler prompt before falling back
  try {
    const retry = (await askFast(
      `Pick ONE category for this creator blog topic: "${topic}"\n\nOptions:\n1. YouTube Monetization (earning money from YouTube)\n2. Course Creation (making/selling online courses)\n3. Creator Growth (growing YouTube channel audience)\n4. Content Strategy (planning/distributing content)\n5. AI for Creator Economy (AI tools for creators)\n\nReply with the number only (1-5).`,
      10, 0.1,
    )).trim();
    const map: Record<string, string> = {
      '1': 'YouTube Monetization',
      '2': 'Course Creation',
      '3': 'Creator Growth',
      '4': 'Content Strategy',
      '5': 'AI for Creator Economy',
    };
    if (map[retry]) return map[retry];
  } catch { /* fall through */ }

  // Layer 5: true last resort
  console.warn(`[Category] Could not classify "${topic}" — falling back to Creator Growth`);
  return 'Creator Growth';
}

/**
 * Generate a full blog post for the given topic.
 * Uses TWO separate Gemini calls to avoid JSON corruption:
 *   Call 1 — small metadata JSON (title, slug, tags, faqs)
 *   Call 2 — plain markdown content (no JSON wrapper)
 */
export async function generatePost(
  topic:              string,
  category:           string,
  insights?:          FeedbackInsights,
  failureContext?:    string,
  competitors?:       CompetitorInsights | null,
  weeklyExperiment?:  WeeklyExperiment | null,
  memoryContext?:     string,
): Promise<{ title: string; description: string; slug: string; markdown: string; tags: string[]; seoKeywords: string[]; faqs: FAQItem[] }> {

  const perfContext = insights?.hasData && insights.agentPromptCtx
    ? `\n${insights.agentPromptCtx}` : '';
  const queryHints = insights?.topSearchQueries?.length
    ? `\nReal search queries from Google to weave in naturally:\n${insights.topSearchQueries.slice(0, 6).map((q) => `  - ${q}`).join('\n')}` : '';
  const retryContext = failureContext ? `\n${failureContext}\n` : '';

  // Agent memory context — contains: covered topics (avoid), brand voice rules,
  // category gaps, top-performing formats, past quality lessons
  const memCtx = memoryContext ? `\n${memoryContext}\n` : '';

  // Competitor intelligence block (injected when available)
  const competitorCtx = competitors?.competitorContext
    ? `\n\n${competitors.competitorContext}\n` : '';

  // Weekly format experiment (injected when available)
  const experimentCtx = weeklyExperiment?.promptAddition
    ? `\n\n${weeklyExperiment.promptAddition}\n` : '';

  // Dynamic word count target — use competitor-derived target or default
  const wordCountTarget = competitors?.targetWordCount
    ? `${competitors.targetWordCount}–${competitors.targetWordCount + 200}`
    : '1,400–1,800';

  const contentRules = `
BANNED PHRASES (Google Helpful Content + AI-detection penalty):
❌ "In today's digital landscape" / "Game changer" / "Skyrocket" / "Revolutionize"
❌ "In conclusion," / "To summarize," / "Navigate the" / "Embark on" / "Dive deep"
❌ "At the end of the day" / "Leverage your" / "It is important to note"
❌ Any vague filler with no specific insight

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AEO — ANSWER ENGINE OPTIMISATION
(Getting cited in ChatGPT / Perplexity / Google AI Overviews)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 1 — DIRECT ANSWER BLOCK (mandatory, immediately after intro):
Add a "## Quick Answer" section with 2–3 sentences that DIRECTLY answer
the post's primary question. Format:
## Quick Answer
[Direct answer starting with the key fact or recommendation. Include at least
one specific number. E.g.: "You can monetize a YouTube channel with 1,000
subscribers and 4,000 watch hours — the threshold YouTube requires for the
Partner Program. Most creators hit this in 6–18 months with consistent uploads."]

RULE 2 — STATISTICS (5+ required):
Every major claim needs a number. Format attributions for AI citation:
• "According to YouTube's 2025 Partner Program data, channels need..."
• "In Graphy's analysis of 50,000+ creators, those who..."
• "Based on DataForSEO keyword data, '[keyword]' gets X monthly searches"
Never invent numbers — use realistic industry estimates if needed and say "estimates suggest".

RULE 3 — EXPERT ATTRIBUTION (critical for AEO):
Write in first person as Sandeep Singh, Co-founder of Graphy.com. Use explicit
attribution AI engines can quote:
• "In my experience working with 50,000+ creators on Graphy..."
• "What I've seen consistently among top-performing Graphy creators is..."
• "My take after helping thousands of creators monetize their channels: [opinion]"
This bylined authority is exactly what Perplexity and ChatGPT cite.

RULE 4 — DEFINITION SENTENCES (one per H2):
Start each H2 section with a direct definitional sentence that could stand
alone as a search answer:
• "YouTube Super Thanks is a feature that lets viewers pay $2–$50 to highlight
  their comments on a video."
• "A content calendar is a scheduling system that maps what you publish,
  when you publish it, and on which platform."
These 1-sentence definitions are prime AEO extraction targets.

RULE 5 — STRUCTURED FAQ (bottom of post):
Write 5 FAQ pairs in citation-ready format. Each answer must be:
• Self-contained (understandable without reading the rest of the post)
• Specific (include a number, timeframe, or concrete step)
• Under 60 words
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

E-E-A-T REQUIREMENTS:
- At least 2 first-person Graphy creator patterns with specific numbers
- One "## What Most Creators Get Wrong About [Topic]" section
- One "## Sandeep's Take" section with a direct personal opinion + Graphy data
- One step-by-step numbered action section

VISUAL RICHNESS (mandatory — every post):
1. At least 2 markdown comparison/data tables
2. 2–3 <div class="stat-box">📊 [Stat] — [Source]</div> callouts
3. 2–3 <div class="tip-box">💡 <strong>Pro Tip:</strong> [Tip]</div>
4. One <div class="warning-box">⚠️ <strong>Watch out:</strong> [Mistake]</div>
5. One <div class="callout-box">🎯 <strong>Key Insight:</strong> [Insight]</div>

READABILITY:
- Max 3 sentences per paragraph
- **Bold** key terms, numbers, action words
- Every H2 needs at least one visual element

TONE: Direct, like texting a smart friend. "You" not "one".
GRAPHY: Max 2 natural mentions as a solution, never as an ad.
LENGTH: ${wordCountTarget} words — beats competitors, earns AEO trust.`;

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
${competitors ? `Primary keyword to optimise for: "${competitors.keyword}"` : ''}

TITLE RULES (critical for SEO and for the blog cover image):
- Must be 55–70 characters long (count carefully — this is non-negotiable)
- Must read like a real human wrote it for Google — descriptive, benefit-driven
- Include the primary keyword within the first 5 words
- Add a specificity hook: year (2026), number, or "for creators" / "for YouTube"
- Good examples:
    ✅ "How to Monetize YouTube With 1,000 Subscribers in 2026" (55 chars)
    ✅ "7 Best AI Tools for YouTube Creators That Actually Work" (55 chars)
    ✅ "Teachable vs Graphy: Which Course Platform Wins in 2026?" (57 chars)
    ❌ "Passive Income Online Courses" (too short, only 30 chars)
    ❌ "YouTube Monetization" (way too short — 20 chars)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AEO FAQ RULES — THESE GET INJECTED INTO AI SEARCH ENGINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FAQ answers are rendered as FAQPage JSON-LD and read by:
  • Google AI Overviews  • Perplexity  • ChatGPT Browse  • Bing AI

Each answer MUST:
  1. Start with a direct answer to the question (no "Great question..." preamble)
  2. Include at least ONE specific number, stat, or timeframe
  3. Be self-contained — readable without context from the rest of the article
  4. Be under 55 words (longer = less likely to be extracted verbatim)
  5. Attribute to "Sandeep Singh" or "Graphy's data" for at least 2 of 5 answers
     e.g. "According to Sandeep Singh at Graphy, creators who..." — this is how
     AI engines cite content and how you build author authority.

FAQ QUESTION FORMAT (People Also Ask style):
  - Questions 1-2: Primary "how"/"what" questions (highest search volume)
  - Question 3: Comparison/vs question ("X vs Y" or "difference between")
  - Question 4: Threshold/eligibility question ("Do you need X subscribers")
  - Question 5: Mistake/avoid question (negative framing gets 40% more citations)

BAD answer: "There are many ways to monetize your channel. You should think about..."
GOOD answer: "YouTube requires 1,000 subscribers and 4,000 watch hours to join the Partner Program — most creators hit this in 6–18 months. According to Sandeep Singh at Graphy, channels that upload 2x/week reach this threshold 3x faster than once-weekly uploaders."

Return ONLY this JSON object (no markdown, no explanation):
{
  "title": "TITLE MUST BE 55-70 CHARS — see rules above",
  "description": "Meta description 150-160 chars — keyword + specific benefit + credibility signal",
  "slug": "url-friendly-slug-with-hyphens",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "seo_keywords": ["primary keyword", "secondary 1", "secondary 2", "secondary 3"],
  "faqs": [
    {
      "question": "How do you [primary action from ${topic}]?",
      "answer": "Direct answer starting with the core fact. Include a specific number or timeframe. Under 55 words. Self-contained."
    },
    {
      "question": "How long does it take to [key outcome from ${topic}]?",
      "answer": "Specific timeframe + what affects it. Include a data point. Under 55 words."
    },
    {
      "question": "What is the difference between [Option A] and [Option B related to ${topic}]?",
      "answer": "One sentence for each option. Clear contrast. Include a number. Under 55 words."
    },
    {
      "question": "Do you need [threshold/requirement] to [main goal from ${topic}]?",
      "answer": "Start with Yes/No. Give the exact threshold. Add context. Attribute to Sandeep or Graphy data. Under 55 words."
    },
    {
      "question": "What is the biggest mistake creators make with [${topic}]?",
      "answer": "Name one specific mistake. Explain why it fails. Give the correct approach. Under 55 words."
    }
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

  // ── Title length guard: if AI returned a short title, expand it ────────────
  // Short titles (< 45 chars) hurt SEO and look bad on the cover card.
  if (meta.title && meta.title.length < 45) {
    console.warn(`[Content] Title too short (${meta.title.length} chars): "${meta.title}" — expanding`);
    try {
      const expandedRaw = await askFast(
        `The SEO title "${meta.title}" is too short for a blog post about "${topic}" in the ${category} category.
Rewrite it as a 55–70 character SEO title that:
- Keeps the same topic/angle
- Adds a specificity hook (year, number, "for creators", "step-by-step", etc.)
- Includes the primary keyword near the start
Return ONLY the improved title (no quotes, no explanation).`,
        120,
        0.5,
      );
      const expanded = expandedRaw.trim().replace(/^["']|["']$/g, '');
      if (expanded.length >= 45 && expanded.length <= 80) {
        console.log(`[Content] Title expanded: "${expanded}" (${expanded.length} chars)`);
        meta.title = expanded;
      }
    } catch {
      // Non-fatal — keep the original short title
    }
  }

  // AI-specific extra rules for "AI for Creator Economy" posts
  const aiRules = category === 'AI for Creator Economy' ? `
AI CATEGORY RULES (mandatory):
- Start from a REAL creator problem (growing a channel, selling courses, saving time)
- Show HOW AI solves that problem with SPECIFIC tools + step-by-step usage
- Include a "## Before AI vs After AI" section with real numbers/comparisons
- Mention at least 2 specific AI tools by name (ChatGPT, Gemini, ElevenLabs, Pictory, Descript, etc.)
- End with an actionable AI workflow the reader can copy TODAY
- Every section must show concrete tool usage, not just theory
` : '';

  // ── CALL 2: Plain markdown content (no JSON — never corrupts) ────────────
  const contentPrompt = `
You are Sandeep Singh, co-founder of Graphy.com — a platform trusted by 50,000+ creators.
${missionCtx}
${memCtx}
${retryContext}
${competitorCtx}
${experimentCtx}

Write a COMPLETE blog post in plain markdown about: "${topic}"
Title: ${meta.title}
Category: ${category}
${queryHints}

${contentRules}
${aiRules}

STRUCTURE (required):
1. Opening hook — punchy paragraph with a surprising stat or bold claim
2. "## Quick Answer" — 2–3 direct sentences answering the core question (AEO target)
3. At least 5 ## H2 sections — each opens with a definition sentence, then detail
4. One markdown comparison table in the first 2 sections
5. "## What Most Creators Get Wrong About [specific aspect]" — include warning-box
6. "## Sandeep's Take" — first-person opinion with Graphy data, 2–3 paragraphs
7. One numbered step-by-step action section (1. 2. 3. format, each step is actionable)
8. One second comparison or data table
9. "## Key Takeaways" — 5 tight bullet points (each under 20 words)
10. "## Frequently Asked Questions" — 5 Q&A pairs, answers self-contained + specific

LENGTH: ${wordCountTarget} words. No padding — every sentence earns its place.

Write the full markdown post now. Start with the opening paragraph (no title heading).`;

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
