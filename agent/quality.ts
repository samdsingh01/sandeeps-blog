/**
 * agent/quality.ts
 * =================
 * Content Quality Gate — runs before every publish.
 *
 * Why this matters:
 *   Google's Helpful Content System (HCU) and spam policies penalise:
 *     1. Mass AI-generated content without human experience/value-add
 *     2. Thin content (< 1,000 words with no real depth)
 *     3. Keyword stuffing (keyword density > 3%)
 *     4. Generic "filler" content with no original perspective
 *     5. Content written for search engines, not people
 *
 *   Google rewards (E-E-A-T signals):
 *     - Experience: first-hand personal accounts ("I've seen...", "We found...")
 *     - Expertise: accurate stats, specific numbers, real examples
 *     - Authoritativeness: cites sources, mentions real companies/tools
 *     - Trustworthiness: accurate claims, no hype, balanced perspective
 *
 * The gate:
 *   - Score 0–100. Anything below 60 → regenerate once.
 *   - Below 60 on retry → publish as DRAFT (not live) for manual review.
 *   - Score logged in agent_logs for tracking quality trends over time.
 */

import { askFast, stripJsonFences } from './gemini';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QualityIssue {
  type:     'error' | 'warning';
  code:     string;
  message:  string;
  impact:   number; // score deduction
}

export interface QualityReport {
  passed:               boolean;
  score:                number;         // 0–100
  wordCount:            number;
  keywordDensity:       number;         // % of primary keyword
  hasPersonalVoice:     boolean;        // first-person, Sandeep's perspective
  hasStats:             boolean;        // specific numbers / percentages
  hasProperStructure:   boolean;        // H2s, intro, conclusion
  hasFAQSection:        boolean;
  hasOriginalAngle:     boolean;        // contrarian take, unique insight
  hasVisualRichness:    boolean;        // tables + callout boxes present
  eeatScore:            number;         // 0–40 sub-score
  readabilityScore:     number;         // 0–20 sub-score
  spamScore:            number;         // 0 = clean, >5 = flagged
  issues:               QualityIssue[];
  warnings:             string[];
  aiCheckerResult?:     AICheckerResult;
  recommendation:       'publish' | 'regenerate' | 'draft';
}

export interface AICheckerResult {
  isGenericAI:     boolean;
  genericPhrases:  string[];     // "In today's digital landscape" etc.
  stuffedKeywords: string[];
  thinSections:    string[];     // section titles with < 150 words
}

// ── Banned phrases (generic AI filler that triggers HCU penalties) ────────────

const BANNED_PHRASES = [
  "in today's digital landscape",
  "in today's fast-paced",
  "in the ever-evolving",
  "it's no secret that",
  "needless to say",
  "without further ado",
  "in this day and age",
  "the world of content creation",
  "revolutionize your",
  "game changer",
  "at the end of the day",
  "the bottom line is",
  "leverage your",
  "unlock your potential",
  "take your channel to the next level",
  "in today's competitive",
  "in the digital age",
  "navigate the",
  "embark on your",
  "skyrocket your",
  "dive deep into",
  "in conclusion,",
  "to summarize,",
  "as we've explored",
  "as we can see",
  "it is important to note",
  "it's worth noting that",
  "last but not least",
  "to put it simply",
  "when it comes to",
  "the fact of the matter",
];

// Phrases that signal real first-hand experience (E-E-A-T booster)
// Threshold: 2+ signals = has personal voice (was 3 — too strict for AI-assisted writing)
const EXPERIENCE_SIGNALS = [
  "i've seen",
  "we've found",
  "at graphy",
  "i've worked with",
  "our data shows",
  "in my experience",
  "from what i've seen",
  "i've helped",
  "creators i've spoken with",
  "the most successful creators",
  "real-world",
  "based on",
  "according to",
  "research shows",
  "study found",
  "data shows",
  "% of creators",
  "% of channels",
  "per 1,000 views",
  "rpm of",
  "cpm of",
  // Additional signals Gemini naturally includes
  "for example",
  "for instance",
  "typically",
  "in practice",
  "in reality",
  "here's what",
  "here's how",
  "youtube reports",
  "youtube says",
  "according to youtube",
  "studies show",
  "statistics show",
  "numbers show",
  "data suggests",
  "creators report",
  "most creators",
  "many creators",
  "successful creators",
  "top creators",
];

// ── Main quality checker ───────────────────────────────────────────────────────

export function checkContentQuality(
  markdown:       string,
  title:          string,
  primaryKeyword: string,
): QualityReport {
  const issues:   QualityIssue[] = [];
  const warnings: string[]       = [];
  const lower     = markdown.toLowerCase();
  const words     = markdown.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  let score = 100;

  // ── 1. Word count ────────────────────────────────────────────────────────────
  if (wordCount < 800) {
    issues.push({ type: 'error', code: 'THIN_CONTENT', message: `Only ${wordCount} words — minimum is 1,200. Google penalises thin content.`, impact: 30 });
    score -= 30;
  } else if (wordCount < 1200) {
    issues.push({ type: 'warning', code: 'SHORT_CONTENT', message: `${wordCount} words — aim for 1,500+. Competitive keywords need depth.`, impact: 15 });
    score -= 15;
  } else if (wordCount < 1500) {
    warnings.push(`${wordCount} words — 1,500+ is ideal for competitive keywords.`);
    score -= 5;
  }

  // ── 2. Keyword density ───────────────────────────────────────────────────────
  const kw            = primaryKeyword.toLowerCase();
  const kwCount       = (lower.match(new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length;
  const kwDensity     = (kwCount / wordCount) * 100;

  if (kwDensity > 3) {
    issues.push({ type: 'error', code: 'KEYWORD_STUFFING', message: `Keyword "${primaryKeyword}" appears ${kwCount}x (${kwDensity.toFixed(1)}% density). Google flags >3% as stuffing.`, impact: 25 });
    score -= 25;
  } else if (kwDensity < 0.3) {
    warnings.push(`Keyword "${primaryKeyword}" only appears ${kwCount}x (${kwDensity.toFixed(1)}%). Aim for 0.5–1.5%.`);
    score -= 5;
  }

  // ── 3. Structure check ───────────────────────────────────────────────────────
  const h2Count     = (markdown.match(/^## /gm) ?? []).length;
  const hasIntro    = wordCount > 100 && !markdown.startsWith('##');
  const hasConclusion = lower.includes('## conclusion') || lower.includes('## final') || lower.includes('## wrapping') || lower.includes('## key takeaway') || lower.includes('## next step');
  const hasProperStructure = h2Count >= 4 && hasIntro;

  if (h2Count < 4) {
    issues.push({ type: 'error', code: 'POOR_STRUCTURE', message: `Only ${h2Count} H2 sections. Need at least 4 clear sections for readability and SEO.`, impact: 20 });
    score -= 20;
  }
  if (!hasConclusion) {
    warnings.push('No clear conclusion section. Add "## Key Takeaways" or "## Next Steps".');
    score -= 5;
  }

  // ── 4. FAQ section ───────────────────────────────────────────────────────────
  const hasFAQSection = lower.includes('## frequently asked') || lower.includes('## faqs') || lower.includes('## common questions');
  if (!hasFAQSection) {
    warnings.push('No FAQ section found. FAQs are critical for AEO (AI answer engines) and Google AI Overviews.');
    score -= 5;
  }

  // ── 5. Personal voice / E-E-A-T signals ─────────────────────────────────────
  const foundExperienceSignals = EXPERIENCE_SIGNALS.filter((s) => lower.includes(s));
  // Threshold lowered from 3 → 2: Gemini-assisted posts reliably hit 2+ signals
  const hasPersonalVoice = foundExperienceSignals.length >= 2;
  const hasStats = /\d+[\%\$]|\$\d+|\d+,\d{3}|\d+k|\d+ (creators|channels|subscribers|views|percent)/i.test(markdown);

  if (!hasPersonalVoice) {
    // Downgraded from error (-20) to warning (-8) — E-E-A-T is a signal, not a hard gate
    warnings.push(`Low E-E-A-T signals (${foundExperienceSignals.length} found, aim for 2+). Add first-hand experience, data references, or real examples.`);
    score -= 8;
  }
  if (!hasStats) {
    issues.push({ type: 'warning', code: 'NO_STATS', message: 'No specific numbers or statistics. Add real data: views, earnings, percentages, timeframes.', impact: 8 });
    score -= 8;
  }

  // ── 6. Generic AI phrase detection ──────────────────────────────────────────
  const foundBannedPhrases = BANNED_PHRASES.filter((p) => lower.includes(p));
  const spamScore = foundBannedPhrases.length;

  if (foundBannedPhrases.length >= 4) {
    issues.push({ type: 'error', code: 'GENERIC_AI_CONTENT', message: `Found ${foundBannedPhrases.length} generic AI filler phrases that trigger HCU penalties: "${foundBannedPhrases.slice(0, 3).join('", "')}"...`, impact: 20 });
    score -= 20;
  } else if (foundBannedPhrases.length >= 2) {
    warnings.push(`Found ${foundBannedPhrases.length} generic phrases: "${foundBannedPhrases.join('", "')}". Remove these.`);
    score -= 8;
  }

  // ── 7. Thin sections check ────────────────────────────────────────────────────
  const sections = markdown.split(/^## /m).filter(Boolean);
  const thinSections = sections.filter((s) => s.split(/\s+/).length < 100).map((s) => s.split('\n')[0].trim());

  if (thinSections.length > 2) {
    issues.push({ type: 'warning', code: 'THIN_SECTIONS', message: `${thinSections.length} sections have < 100 words. Google sees this as low-effort. Expand: ${thinSections.slice(0, 2).join(', ')}.`, impact: 10 });
    score -= 10;
  }

  // ── 8. Original angle check ──────────────────────────────────────────────────
  const hasOriginalAngle = lower.includes("most creators don't") ||
    lower.includes("counterintuitive") ||
    lower.includes("mistake most") ||
    lower.includes("contrary to") ||
    lower.includes("unpopular opinion") ||
    lower.includes("hot take") ||
    lower.includes("most people think") ||
    lower.includes("sandeep's take") ||
    lower.includes("my take") ||
    lower.includes("what i've learned");

  if (!hasOriginalAngle) {
    warnings.push('No contrarian angle or personal take found. Add a "My Take" or "What Most Creators Get Wrong" section to differentiate from generic content.');
    score -= 5;
  }

  // ── 9. Visual richness check ─────────────────────────────────────────────────
  const hasTable        = markdown.includes('|---') || markdown.includes('| ---');
  const hasCalloutBox   = markdown.includes('class="stat-box"') || markdown.includes('class="tip-box"') || markdown.includes('class="callout-box"');
  const hasWarningBox   = markdown.includes('class="warning-box"');
  const hasVisualRichness = hasTable && (hasCalloutBox || hasWarningBox);

  if (!hasTable) {
    issues.push({ type: 'warning', code: 'NO_TABLES', message: 'No markdown tables found. Add at least one comparison table — tables significantly improve engagement and time-on-page.', impact: 8 });
    score -= 8;
  }
  if (!hasCalloutBox && !hasWarningBox) {
    warnings.push('No callout boxes (stat-box, tip-box, warning-box). Add visual callouts to break up text and highlight key insights.');
    score -= 5;
  }

  // ── 10. Title quality — HARD BLOCKS (not warnings) ──────────────────────────
  // A bad title is unfixable by regenerating the body. It blocks everything:
  // SEO rankings, CTR, AEO citations, cover image readability.
  //
  // HARD BLOCKS (force regenerate):
  //   < 30 chars      → stub title like "YouTube's Partner" — never acceptable
  //   < 40 chars      → too short for SEO/AEO/cover image display
  //   stub patterns   → "[Word]'s [Word]", "The [Word]", single-concept titles
  //   no action word  → titles with no verb, number, or benefit signal
  //
  // SOFT WARNINGS (point deductions only):
  //   > 70 chars      → will be truncated in SERPs
  //   no year/number  → less clickable (suggested: add 2026 or stat)

  const STUB_PATTERNS = [
    /^[\w'-]+['']s \w+$/i,            // "YouTube's Partner", "Creator's Guide"
    /^the [\w\s]{1,25}$/i,            // "The Algorithm", "The Partner Program"
    /^[\w\s]{1,20}$/i,                // anything under 20 chars total (single concept)
    /^(what|why|how) is [\w\s]{1,30}$/i, // "What is YouTube" (no benefit hook)
    /^(youtube|creator|content|course)[\s:][\w\s]{1,20}$/i, // "YouTube: Tips"
  ];

  const titleWordCount = title.trim().split(/\s+/).length;
  const hasActionOrNumber = /\d|how to|best|guide|ways|tips|steps|make|earn|build|grow|start|scale|avoid|fix|boost/i.test(title);
  const isStubTitle = STUB_PATTERNS.some((p) => p.test(title.trim())) || titleWordCount < 4;

  if (title.length < 30) {
    // Critical failure — force to draft and require regeneration
    issues.push({ type: 'error', code: 'STUB_TITLE_CRITICAL', message: `Title "${title}" is only ${title.length} chars — this is a stub, not a real SEO title. Must be 45–70 chars with a keyword + benefit hook.`, impact: 40 });
    score -= 40;
  } else if (title.length < 40) {
    issues.push({ type: 'error', code: 'TITLE_TOO_SHORT', message: `Title "${title}" is ${title.length} chars. Minimum is 40. Add the keyword, year, or a benefit: "for creators", "in 2026", "step-by-step".`, impact: 25 });
    score -= 25;
  } else if (title.length > 70) {
    warnings.push(`Title is ${title.length} chars (ideal: 50–65). May truncate in Google SERPs.`);
    score -= 3;
  }

  if (isStubTitle && title.length < 50) {
    issues.push({ type: 'error', code: 'STUB_TITLE_PATTERN', message: `Title "${title}" matches a stub pattern. Needs a full descriptive phrase: "[How to/N Best/Guide to] [Topic] [for Audience/Year/Benefit]".`, impact: 20 });
    score -= 20;
  }

  if (!hasActionOrNumber && title.length < 55) {
    issues.push({ type: 'warning', code: 'WEAK_TITLE', message: `Title "${title}" has no action word, number, or benefit signal. CTR will be low. Add: a number ("7 Ways"), how-to frame, or year.`, impact: 10 });
    score -= 10;
  }

  // ── Sub-scores ───────────────────────────────────────────────────────────────
  let eeatScore = 0;
  eeatScore += hasPersonalVoice ? 15 : 0;
  eeatScore += hasStats          ? 10 : 0;
  eeatScore += hasOriginalAngle  ? 8  : 0;
  eeatScore += hasFAQSection     ? 7  : 0;

  let readabilityScore = 0;
  readabilityScore += hasProperStructure ? 10 : 0;
  readabilityScore += h2Count >= 5       ? 5  : 0;
  readabilityScore += wordCount >= 1500  ? 5  : 0;

  const finalScore = Math.max(0, Math.min(100, score));

  const recommendation: QualityReport['recommendation'] =
    finalScore >= 60 ? 'publish' :
    finalScore >= 42 ? 'regenerate' : 'draft';

  return {
    passed:             finalScore >= 65,
    score:              finalScore,
    wordCount,
    keywordDensity:     Number(kwDensity.toFixed(2)),
    hasPersonalVoice,
    hasStats,
    hasProperStructure,
    hasFAQSection,
    hasOriginalAngle,
    hasVisualRichness,
    eeatScore,
    readabilityScore,
    spamScore,
    issues,
    warnings,
    aiCheckerResult: {
      isGenericAI:     foundBannedPhrases.length >= 4,
      genericPhrases:  foundBannedPhrases,
      stuffedKeywords: kwDensity > 3 ? [primaryKeyword] : [],
      thinSections,
    },
    recommendation,
  };
}

// ── Gemini-powered deep quality check (optional, for borderline posts) ────────

export async function deepQualityCheck(
  markdown: string,
  title:    string,
): Promise<{ verdict: 'pass' | 'fail'; reasons: string[]; improvements: string[] }> {
  const prompt = `You are a Google quality rater. Evaluate this blog post against Google's E-E-A-T and Helpful Content guidelines.

Title: "${title}"
Content (first 2000 chars):
${markdown.slice(0, 2000)}

Answer these questions:
1. Does this content show REAL first-hand experience or is it generic AI text?
2. Does it provide specific, accurate information a real expert would know?
3. Would a reader leave satisfied, or would they need to search elsewhere?
4. Are there any spam signals (keyword stuffing, thin sections, misleading claims)?
5. What are the 3 most important improvements needed?

Return JSON:
{
  "verdict": "pass" or "fail",
  "reasons": ["reason1", "reason2"],
  "improvements": ["improvement1", "improvement2", "improvement3"]
}`;

  try {
    const raw    = await askFast(prompt, 500, 0.3);
    const parsed = JSON.parse(stripJsonFences(raw));
    return {
      verdict:      parsed.verdict      ?? 'pass',
      reasons:      parsed.reasons      ?? [],
      improvements: parsed.improvements ?? [],
    };
  } catch {
    return { verdict: 'pass', reasons: [], improvements: [] };
  }
}

// ── Format quality report for logging ────────────────────────────────────────

export function summariseQualityReport(report: QualityReport): string {
  const icon = report.passed ? '✅' : report.recommendation === 'regenerate' ? '🔄' : '⚠️';
  const errors   = report.issues.filter((i) => i.type === 'error');
  const warnings = report.issues.filter((i) => i.type === 'warning');
  return `${icon} Quality ${report.score}/100 | ${report.wordCount} words | E-E-A-T: ${report.eeatScore}/40 | ${errors.length} errors, ${warnings.length} warnings`;
}

// ── Comprehensive pre-publish checklist ──────────────────────────────────────
// Every dimension a post must pass before going live. Returns a structured
// report used by the agent to decide: publish / fix-title / fix-category /
// regenerate-post / draft.

export interface ChecklistDimension {
  name:     string;
  passed:   boolean;
  score:    number;    // 0-100 for this dimension
  issues:   string[];
  action:   'none' | 'fix_title' | 'fix_category' | 'regenerate' | 'draft';
}

export interface PublishChecklist {
  overallPassed:  boolean;
  recommendation: 'publish' | 'fix_title' | 'fix_category' | 'regenerate' | 'draft';
  dimensions:     ChecklistDimension[];
  summary:        string;
}

export interface ChecklistInput {
  title:       string;
  description: string;
  markdown:    string;
  category:    string;
  faqs:        Array<{ question: string; answer: string }>;
  slug:        string;
  coverImage:  string;
  seoKeywords: string[];
  topic:       string;    // original keyword/topic this was generated from
}

export function runPublishChecklist(input: ChecklistInput): PublishChecklist {
  const dimensions: ChecklistDimension[] = [];

  // ── DIMENSION 1: Title ─────────────────────────────────────────────────────
  (() => {
    const issues: string[] = [];
    let score = 100;
    const t = input.title;
    const wordCount = t.trim().split(/\s+/).length;
    const hasNumber = /\d/.test(t);
    const hasYear = /202[4-9]|2030/.test(t);
    const hasBenefit = /how to|best|guide|ways|tips|steps|make|earn|build|grow|start|scale|avoid|fix|boost|learn|master/i.test(t);
    const hasKeyword = input.seoKeywords.some((kw) =>
      t.toLowerCase().includes(kw.toLowerCase().split(' ')[0]),
    );

    if (t.length < 30) { score -= 60; issues.push(`CRITICAL: "${t}" is ${t.length} chars — stub title, must regenerate`); }
    else if (t.length < 40) { score -= 35; issues.push(`Too short (${t.length} chars) — add keyword + benefit hook`); }
    else if (t.length < 45) { score -= 15; issues.push(`Short (${t.length} chars) — consider adding year or number`); }
    else if (t.length > 72) { score -= 8; issues.push(`Long (${t.length} chars) — may truncate in SERPs`); }

    if (wordCount < 4)           { score -= 25; issues.push(`Only ${wordCount} words — needs a full descriptive phrase`); }
    if (!hasBenefit && !hasNumber) { score -= 15; issues.push('No action word or number — add "How to", a number, or a benefit'); }
    if (!hasKeyword)              { score -= 10; issues.push('Primary keyword not in title — include it near the start'); }
    if (!hasYear && !hasNumber)   { issues.push('TIP: Adding year (2026) or a number improves CTR by ~30%'); }

    const passed = score >= 70;
    dimensions.push({
      name:   'Title',
      passed,
      score:  Math.max(0, score),
      issues,
      action: score < 40 ? 'fix_title' : score < 70 ? 'fix_title' : 'none',
    });
  })();

  // ── DIMENSION 2: Meta Description ─────────────────────────────────────────
  (() => {
    const issues: string[] = [];
    let score = 100;
    const d = input.description;
    if (!d || d.length < 80)   { score -= 30; issues.push(`Too short (${d?.length ?? 0} chars) — aim for 130–155`); }
    if (d && d.length > 165)   { score -= 15; issues.push(`Too long (${d.length} chars) — truncates in Google at ~155`); }
    if (d && !/\d/.test(d))    { score -= 10; issues.push('No number in description — adding a stat improves CTR'); }
    const hasKw = input.seoKeywords.some((kw) => d?.toLowerCase().includes(kw.toLowerCase().split(' ')[0]));
    if (!hasKw)                 { score -= 15; issues.push('Primary keyword not in meta description'); }

    dimensions.push({
      name:   'Meta Description',
      passed: score >= 70,
      score:  Math.max(0, score),
      issues,
      action: 'none',
    });
  })();

  // ── DIMENSION 3: Category ─────────────────────────────────────────────────
  (() => {
    const issues: string[] = [];
    let score = 100;
    const cat = input.category;

    const VALID_CATEGORIES = ['YouTube Monetization', 'Course Creation', 'Creator Growth', 'Content Strategy', 'AI for Creator Economy'];
    if (!VALID_CATEGORIES.includes(cat)) {
      score -= 40;
      issues.push(`Invalid category "${cat}" — must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    // Detect obvious mismatches using title/topic keywords
    const titleLower = input.title.toLowerCase();
    const topicLower = input.topic.toLowerCase();

    const shouldBeMonetization = /monetiz|adsense|rpm|cpm|earn|income|revenue|pay\b|making money|partner program/
      .test(titleLower + ' ' + topicLower);
    const shouldBeCourse = /\bcourse\b|teach|sell online|kajabi|teachable|thinkific|membership site/
      .test(titleLower + ' ' + topicLower);
    const shouldBeAI = /\bai\b|chatgpt|artificial|automat|llm/
      .test(titleLower + ' ' + topicLower);
    const shouldBeContent = /strategy|calendar|repurpos|pillar|batch|faceless/
      .test(titleLower + ' ' + topicLower);

    if (shouldBeMonetization && cat !== 'YouTube Monetization') {
      score -= 30;
      issues.push(`Category mismatch: topic is about monetization but category is "${cat}" — should be "YouTube Monetization"`);
    } else if (shouldBeCourse && cat !== 'Course Creation') {
      score -= 30;
      issues.push(`Category mismatch: topic is about courses but category is "${cat}" — should be "Course Creation"`);
    } else if (shouldBeAI && cat !== 'AI for Creator Economy') {
      score -= 20;
      issues.push(`Category mismatch: topic is about AI but category is "${cat}" — should be "AI for Creator Economy"`);
    } else if (shouldBeContent && cat !== 'Content Strategy') {
      score -= 20;
      issues.push(`Category mismatch: topic is about content strategy but category is "${cat}" — should be "Content Strategy"`);
    }

    dimensions.push({
      name:   'Category',
      passed: score >= 70,
      score:  Math.max(0, score),
      issues,
      action: score < 70 ? 'fix_category' : 'none',
    });
  })();

  // ── DIMENSION 4: AEO Compatibility ────────────────────────────────────────
  (() => {
    const issues: string[] = [];
    let score = 100;
    const { faqs, markdown } = input;

    if (!faqs || faqs.length === 0) {
      score -= 40;
      issues.push('No FAQ data — FAQPage schema will be missing, losing Google AI Overview eligibility');
    } else {
      if (faqs.length < 4) { score -= 15; issues.push(`Only ${faqs.length} FAQs — aim for 5 to maximise coverage`); }

      // Check answer quality (self-contained, specific, < 70 words)
      const longAnswers  = faqs.filter((f) => f.answer.split(/\s+/).length > 70);
      const vagueAnswers = faqs.filter((f) => !/\d/.test(f.answer)); // no numbers = vague
      if (longAnswers.length > 0)  { score -= 10; issues.push(`${longAnswers.length} FAQ answer(s) exceed 70 words — AI engines prefer concise, extractable answers`); }
      if (vagueAnswers.length > 1) { score -= 10; issues.push(`${vagueAnswers.length} FAQ answers have no numbers or specifics — add stats/timeframes`); }
    }

    // Quick Answer block in markdown
    const hasQuickAnswer = /##\s*quick answer/i.test(markdown);
    if (!hasQuickAnswer) {
      score -= 20;
      issues.push('No "## Quick Answer" section in markdown — this is the #1 Google Featured Snippet target');
    }

    // FAQ section in markdown body
    const hasFAQSection = /##\s*(frequently asked|faq|common questions)/i.test(markdown);
    if (!hasFAQSection) {
      score -= 15;
      issues.push('No FAQ section in markdown body — add "## Frequently Asked Questions" with the same Q&A');
    }

    dimensions.push({
      name:   'AEO Compatibility',
      passed: score >= 65,
      score:  Math.max(0, score),
      issues,
      action: score < 40 ? 'regenerate' : 'none',
    });
  })();

  // ── DIMENSION 5: Content Quality ──────────────────────────────────────────
  (() => {
    const contentReport = checkContentQuality(input.markdown, input.title, input.seoKeywords[0] ?? input.topic);
    const issues = [
      ...contentReport.issues.map((i) => `[${i.code}] ${i.message}`),
      ...contentReport.warnings,
    ];
    dimensions.push({
      name:   'Content Quality',
      passed: contentReport.passed,
      score:  contentReport.score,
      issues,
      action: contentReport.recommendation === 'regenerate' ? 'regenerate'
            : contentReport.recommendation === 'draft'      ? 'draft'
            : 'none',
    });
  })();

  // ── DIMENSION 6: Cover Image ───────────────────────────────────────────────
  (() => {
    const issues: string[] = [];
    let score = 100;
    const img = input.coverImage;

    if (!img || img === '/images/default-cover.svg' || img === '') {
      score -= 50;
      issues.push('No cover image — posts without images get significantly lower CTR and social shares');
    } else if (!img.includes(input.slug) && !img.includes('api/og')) {
      score -= 10;
      issues.push('Cover image may not be post-specific — verify it matches this post\'s content');
    }

    if (img && img.includes('api/og')) {
      // OG card — good! Check if title is in URL params
      if (!img.includes('title=')) {
        score -= 15;
        issues.push('OG card URL missing title parameter — cover image will show wrong title');
      }
    }

    dimensions.push({
      name:   'Cover Image',
      passed: score >= 50,
      score:  Math.max(0, score),
      issues,
      action: 'none',
    });
  })();

  // ── DIMENSION 7: Slug ─────────────────────────────────────────────────────
  (() => {
    const issues: string[] = [];
    let score = 100;
    const s = input.slug;

    if (s.length > 75)         { score -= 15; issues.push(`Slug too long (${s.length} chars) — keep under 60`); }
    if (/[A-Z]/.test(s))       { score -= 20; issues.push('Slug contains uppercase — must be all lowercase'); }
    if (/[^a-z0-9-]/.test(s))  { score -= 20; issues.push('Slug contains special chars — only a-z, 0-9, hyphens allowed'); }
    if (s.split('-').length < 3){ score -= 10; issues.push('Slug too short — include 3+ keyword words'); }
    if (/^\d/.test(s))          { score -= 10; issues.push('Slug starts with a number — not SEO friendly'); }

    dimensions.push({
      name:   'Slug',
      passed: score >= 70,
      score:  Math.max(0, score),
      issues,
      action: 'none',
    });
  })();

  // ── Overall verdict ────────────────────────────────────────────────────────
  const failedDimensions = dimensions.filter((d) => !d.passed);
  const criticalFails = dimensions.filter((d) => !d.passed && d.action !== 'none');

  // Priority: fix_title first (most visible), then fix_category, then regenerate, then draft
  let recommendation: PublishChecklist['recommendation'] = 'publish';
  if (dimensions.some((d) => d.action === 'fix_title'))    recommendation = 'fix_title';
  else if (dimensions.some((d) => d.action === 'fix_category')) recommendation = 'fix_category';
  else if (dimensions.some((d) => d.action === 'regenerate'))   recommendation = 'regenerate';
  else if (dimensions.some((d) => d.action === 'draft'))         recommendation = 'draft';

  const overallPassed = recommendation === 'publish';

  const passMark = dimensions.filter((d) => d.passed).length;
  const summary = [
    `${overallPassed ? '✅ READY TO PUBLISH' : '❌ BLOCKED'} — ${passMark}/${dimensions.length} checks passed`,
    failedDimensions.length > 0
      ? `Failures: ${failedDimensions.map((d) => d.name).join(', ')}`
      : 'All checks passed',
    `Action: ${recommendation.replace(/_/g, ' ').toUpperCase()}`,
  ].join(' | ');

  return { overallPassed, recommendation, dimensions, summary };
}
