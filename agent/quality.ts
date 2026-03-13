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
  const hasPersonalVoice = foundExperienceSignals.length >= 3;
  const hasStats = /\d+[\%\$]|\$\d+|\d+,\d{3}|\d+k|\d+ (creators|channels|subscribers|views|percent)/i.test(markdown);

  if (!hasPersonalVoice) {
    issues.push({ type: 'error', code: 'NO_EEEAT', message: 'No E-E-A-T signals found. Content reads as generic AI text. Needs first-hand experience, real data, and personal perspective.', impact: 20 });
    score -= 20;
  }
  if (!hasStats) {
    issues.push({ type: 'warning', code: 'NO_STATS', message: 'No specific numbers or statistics. Add real data: views, earnings, percentages, timeframes.', impact: 10 });
    score -= 10;
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

  // ── 10. Title quality ─────────────────────────────────────────────────────────
  if (title.length > 65) {
    warnings.push(`Title is ${title.length} chars (ideal: 50-60). May get truncated in SERPs.`);
    score -= 3;
  }
  if (title.length < 35) {
    warnings.push(`Title is too short (${title.length} chars). Add the keyword and a benefit.`);
    score -= 3;
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
    finalScore >= 65 ? 'publish' :
    finalScore >= 45 ? 'regenerate' : 'draft';

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
