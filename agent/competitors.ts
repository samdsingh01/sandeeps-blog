/**
 * agent/competitors.ts
 * ====================
 * Competition intelligence for BOFU content — runs before every post.
 *
 * Pipeline:
 *  1. DataForSEO SERP API → top 10 ranking URLs for the keyword
 *  2. Fetch top 5 competitor pages → extract headings + estimate word count
 *  3. Gemini analysis → common topics, content gaps, our recommended angle
 *  4. Returns CompetitorInsights injected into generatePost()
 *
 * Degrades gracefully: if DataForSEO not configured or pages fail to fetch,
 * returns null so content generation proceeds without competitor context.
 */

import { getSerpResults } from './dataforseo';
import { askFast, stripJsonFences } from './gemini';

export interface CompetitorPage {
  rank:          number;
  url:           string;
  domain:        string;
  title:         string;
  headings:      string[];   // H1+H2+H3 text extracted from HTML
  wordCountEst:  number;     // rough estimate from text length
  metaDesc:      string;
}

export interface CompetitorInsights {
  keyword:            string;
  topDomains:         string[];   // domains ranking in top 10
  commonTopics:       string[];   // topics all/most top results cover (must-have baseline)
  contentGaps:        string[];   // what none of the top results covers well → our edge
  competitorAngles:   string[];   // the main differentiating angle each top result takes
  recommendedAngle:   string;     // our differentiated angle to beat them
  targetWordCount:    number;     // avg of top 5 + 20% (but min 1200, max 2500)
  weaknesses:         string[];   // specific weaknesses in top results we can exploit
  competitorContext:  string;     // formatted string for injection into content prompt
}

/**
 * Fetch a single competitor page and extract headings + word count estimate.
 * Returns null on any error or non-200 status.
 */
async function fetchCompetitorPage(url: string, rank: number): Promise<CompetitorPage | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[fetchCompetitorPage] Failed to fetch ${url}: ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Extract title from <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract meta description
    const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    const metaDesc = metaMatch ? metaMatch[1].trim() : '';

    // Extract domain from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Extract headings: H1, H2, H3
    const headingRegex = /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi;
    const headings: string[] = [];
    let headingMatch;
    while ((headingMatch = headingRegex.exec(html)) !== null && headings.length < 20) {
      const heading = headingMatch[1].replace(/<[^>]+>/g, '').trim();
      if (heading) {
        headings.push(heading);
      }
    }

    // Estimate word count: strip all HTML, count words, apply 0.8 accuracy multiplier
    const textOnly = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = textOnly.split(/\s+/).length;
    const wordCountEst = Math.round(words * 0.8);

    return {
      rank,
      url,
      domain,
      title,
      headings,
      wordCountEst,
      metaDesc,
    };
  } catch (err) {
    console.warn(`[fetchCompetitorPage] Error fetching ${url}:`, err);
    return null;
  }
}

/**
 * Analyze competitors for a given keyword.
 * Fetches top 10 SERP results, analyzes top 5 pages, uses Gemini for insights.
 * Returns null if DataForSEO unavailable or < 2 pages fetch successfully.
 */
export async function analyzeCompetitors(keyword: string): Promise<CompetitorInsights | null> {
  try {
    // 1. Get SERP results
    const serpResults = await getSerpResults(keyword, 10);
    if (serpResults.length === 0) {
      console.warn(`[analyzeCompetitors] No SERP results for "${keyword}"`);
      return null;
    }

    // Extract top domains for context
    const topDomains = [...new Set(serpResults.map(r => r.domain))];

    // 2. Fetch top 5 pages in parallel
    const fetchPromises = serpResults.slice(0, 5).map(r => fetchCompetitorPage(r.url, r.rank));
    const fetchResults = await Promise.allSettled(fetchPromises);

    const pages: CompetitorPage[] = [];
    for (const result of fetchResults) {
      if (result.status === 'fulfilled' && result.value !== null) {
        pages.push(result.value);
      }
    }

    // If fewer than 2 pages fetched, bail
    if (pages.length < 2) {
      console.warn(`[analyzeCompetitors] Only ${pages.length} pages fetched successfully for "${keyword}"`);
      return null;
    }

    // 3. Call Gemini for analysis
    const geminiPrompt = `You are an SEO content strategist. Analyze these top-ranking competitor pages for the keyword: "${keyword}"

COMPETITOR PAGES:
${pages
  .map(
    (p, i) => `
[${i + 1}] ${p.domain} (${p.wordCountEst} words)
Headings: ${p.headings.join(' | ')}
Meta: ${p.metaDesc}
`,
  )
  .join('\n')}

Identify:
1. What topics ALL/MOST of these pages cover (the baseline readers expect)
2. What important topics NONE of these pages covers well (content gap = our opportunity)
3. The main angle/differentiator each competitor uses
4. Specific weaknesses: thin sections, missing data, poor structure, no examples
5. The best angle WE should take to differentiate and outrank them

Return ONLY this JSON:
{
  "commonTopics": ["topic1", "topic2", ...],
  "contentGaps": ["gap1", "gap2", ...],
  "competitorAngles": ["angle1", "angle2", ...],
  "recommendedAngle": "Our specific differentiated angle in one sentence",
  "weaknesses": ["weakness1", "weakness2", ...]
}`;

    const geminiResponse = await askFast(geminiPrompt, 1500, 0.6);
    const jsonText = stripJsonFences(geminiResponse);
    const analysis = JSON.parse(jsonText);

    // 4. Calculate target word count: avg of top 5 + 20%, clamped to [1200, 2500]
    const avgWordCount = Math.round(pages.reduce((sum, p) => sum + p.wordCountEst, 0) / pages.length);
    const targetWordCount = Math.max(1200, Math.min(2500, Math.round(avgWordCount * 1.2)));

    // 5. Build competitor context string
    const competitorContext = `COMPETITOR INTELLIGENCE for "${keyword}":
Top domains ranking: ${topDomains.join(', ')}
Target word count to beat competitors: ${targetWordCount} words

MUST COVER (topics all top results include — our baseline):
${(analysis.commonTopics || []).map((t: string) => `• ${t}`).join('\n')}

OUR CONTENT EDGE (gaps none of them cover well):
${(analysis.contentGaps || []).map((g: string) => `• ${g}`).join('\n')}

RECOMMENDED ANGLE: ${analysis.recommendedAngle || 'Original angle needed'}

COMPETITOR WEAKNESSES TO EXPLOIT:
${(analysis.weaknesses || []).map((w: string) => `• ${w}`).join('\n')}`;

    return {
      keyword,
      topDomains,
      commonTopics: analysis.commonTopics || [],
      contentGaps: analysis.contentGaps || [],
      competitorAngles: analysis.competitorAngles || [],
      recommendedAngle: analysis.recommendedAngle || '',
      targetWordCount,
      weaknesses: analysis.weaknesses || [],
      competitorContext,
    };
  } catch (err) {
    console.warn(`[analyzeCompetitors] Error analyzing "${keyword}":`, err);
    return null;
  }
}
