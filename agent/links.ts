/**
 * agent/links.ts
 * ==============
 * Internal Linking Engine.
 *
 * Why it matters:
 *   - Internal links pass "link equity" between pages (boosts rankings)
 *   - Google uses them to understand site structure and topic authority
 *   - They keep readers on site longer (lower bounce rate)
 *   - No human does this consistently — perfect for automation
 *
 * Two passes on every new post:
 *   PASS 1 (OUTBOUND): Scan the new post and add links TO existing related posts
 *   PASS 2 (INBOUND):  Scan existing posts and add links pointing TO the new post
 *
 * Rules to avoid over-optimization:
 *   - Max 4 internal links added per post
 *   - Never link to the same post twice
 *   - Never link in headings (H1/H2/H3)
 *   - Don't add links to posts already linked within same run
 *   - Anchor text must be natural, not exact-match keyword stuffing
 */

import { getServiceClient }         from '../lib/supabase';
import { ask, stripJsonFences }     from './gemini';
import { renderMarkdown }           from './content';
import { logRun }                   from './logger';

const MAX_LINKS_PER_POST   = 4;
const MAX_INBOUND_UPDATES  = 3;  // max existing posts to update with a link back to new post

export interface LinkingResult {
  newPostSlug:      string;
  outboundAdded:    number;
  inboundAdded:     number;
  updatedSlugs:     string[];
}

/**
 * Main entry point — called after a new post is published.
 */
export async function runInternalLinking(newPostSlug: string): Promise<LinkingResult> {
  const db = getServiceClient();

  // Get the new post
  const { data: newPost } = await db
    .from('posts')
    .select('slug, title, content, category, tags, seo_keywords')
    .eq('slug', newPostSlug)
    .single();

  if (!newPost) {
    console.warn(`[Links] Post not found: ${newPostSlug}`);
    return { newPostSlug, outboundAdded: 0, inboundAdded: 0, updatedSlugs: [] };
  }

  // Get all other published posts (lightweight — just metadata for matching)
  const { data: allPosts } = await db
    .from('posts')
    .select('slug, title, content, category, tags, seo_keywords')
    .eq('status', 'published')
    .neq('slug', newPostSlug);

  if (!allPosts?.length) {
    return { newPostSlug, outboundAdded: 0, inboundAdded: 0, updatedSlugs: [] };
  }

  console.log(`[Links] Processing "${newPost.title}" against ${allPosts.length} existing posts`);

  const updatedSlugs: string[] = [];
  let outboundAdded = 0;
  let inboundAdded  = 0;

  // ── PASS 1: Add links FROM new post TO related existing posts ─────────────
  try {
    const outboundResult = await addOutboundLinks(newPost, allPosts);
    if (outboundResult.linksAdded > 0) {
      await db.from('posts').update({
        content:      outboundResult.updatedMarkdown,
        content_html: await renderMarkdown(outboundResult.updatedMarkdown),
        updated_at:   new Date().toISOString(),
      }).eq('slug', newPostSlug);

      outboundAdded = outboundResult.linksAdded;
      console.log(`[Links] Added ${outboundAdded} outbound links in "${newPost.title}"`);
    }
  } catch (err) {
    console.error('[Links] Outbound pass failed:', err);
  }

  // ── PASS 2: Add links FROM existing posts TO new post ─────────────────────
  // Find top N most relevant existing posts to update
  const relevantSlugs = findRelevantPosts(newPost, allPosts)
    .slice(0, MAX_INBOUND_UPDATES)
    .map((p) => p.slug);
  const relevantPosts = allPosts.filter((p) => relevantSlugs.includes(p.slug));

  for (const existingPost of relevantPosts) {
    try {
      const inboundResult = await addInboundLink(existingPost, newPost);
      if (inboundResult.linkAdded) {
        await db.from('posts').update({
          content:      inboundResult.updatedMarkdown,
          content_html: await renderMarkdown(inboundResult.updatedMarkdown),
          updated_at:   new Date().toISOString(),
        }).eq('slug', existingPost.slug);

        inboundAdded++;
        updatedSlugs.push(existingPost.slug);
        console.log(`[Links] Added inbound link in "${existingPost.title}" → "${newPost.title}"`);
      }
    } catch (err) {
      console.error(`[Links] Inbound pass failed for ${existingPost.slug}:`, err);
    }
  }

  // Log the run
  await logRun({
    runType:  'internal_linking',
    status:   'success',
    postSlug: newPostSlug,
    details:  { outboundAdded, inboundAdded, updatedSlugs },
  });

  console.log(`[Links] ✅ Complete — ${outboundAdded} outbound, ${inboundAdded} inbound links added`);

  return { newPostSlug, outboundAdded, inboundAdded, updatedSlugs };
}

// ── Outbound links (new post → existing posts) ────────────────────────────────

async function addOutboundLinks(
  newPost:   { slug: string; title: string; content: string; category: string; tags: string[]; seo_keywords: string[] },
  allPosts:  Array<{ slug: string; title: string; category: string; tags: string[]; seo_keywords: string[] }>,
): Promise<{ updatedMarkdown: string; linksAdded: number }> {

  // Find top related posts for the new post to link to
  const related = findRelevantPosts(newPost, allPosts).slice(0, MAX_LINKS_PER_POST);

  if (related.length === 0) return { updatedMarkdown: newPost.content, linksAdded: 0 };

  const relatedList = related.map((p) =>
    `  - Title: "${p.title}" | URL: /blog/${p.slug}`
  ).join('\n');

  const prompt = `
You are an SEO expert adding internal links to a blog post.

POST TITLE: "${newPost.title}"
POST CONTENT (markdown):
${newPost.content.slice(0, 5000)}

RELATED POSTS TO LINK TO:
${relatedList}

TASK: Add ${Math.min(3, related.length)} internal links to the post where they fit naturally.

RULES:
- Only add links inside paragraph text — NEVER in headings (##, ###)
- The anchor text must be a natural phrase from the existing sentence, not a forced keyword
- Each link target should be used only once
- The link should genuinely help the reader learn more
- Format: [anchor text](/blog/slug)
- Do NOT add links in the intro paragraph or conclusion

Return ONLY this JSON:
{
  "updatedMarkdown": "the full post markdown with links added",
  "linksAdded": 2,
  "changes": ["Added link to '/blog/slug-1' with anchor 'build your course'", "..."]
}`;

  const raw    = await ask(prompt, 4096, 0.3);
  const parsed = JSON.parse(stripJsonFences(raw));

  return {
    updatedMarkdown: parsed.updatedMarkdown ?? newPost.content,
    linksAdded:      parsed.linksAdded ?? 0,
  };
}

// ── Inbound links (existing post → new post) ──────────────────────────────────

async function addInboundLink(
  existingPost: { slug: string; title: string; content: string },
  newPost:      { slug: string; title: string },
): Promise<{ updatedMarkdown: string; linkAdded: boolean }> {

  const prompt = `
You are an SEO expert adding one internal link to an existing blog post.

EXISTING POST: "${existingPost.title}"
EXISTING CONTENT (markdown):
${existingPost.content.slice(0, 4000)}

NEW POST TO LINK TO:
  - Title: "${newPost.title}"
  - URL: /blog/${newPost.slug}

TASK: Find ONE natural place in the existing post to add a link to the new post.

RULES:
- Only add the link inside paragraph text — NEVER in headings
- The anchor text must be a natural phrase already in the sentence
- Only add if it genuinely helps the reader (don't force it)
- If no natural place exists, return linkAdded: false
- Format: [anchor text](/blog/${newPost.slug})

Return ONLY this JSON:
{
  "updatedMarkdown": "the full existing post markdown with one link added",
  "linkAdded": true,
  "anchorText": "the anchor text used"
}

If no natural place exists:
{
  "updatedMarkdown": "",
  "linkAdded": false,
  "anchorText": ""
}`;

  const raw    = await ask(prompt, 4096, 0.3);
  const parsed = JSON.parse(stripJsonFences(raw));

  return {
    updatedMarkdown: parsed.linkAdded ? parsed.updatedMarkdown : existingPost.content,
    linkAdded:       parsed.linkAdded ?? false,
  };
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

function findRelevantPosts(
  sourcePost: { category: string; tags: string[]; seo_keywords: string[]; title: string },
  candidates: Array<{ slug: string; title: string; category: string; tags: string[]; seo_keywords: string[] }>,
): Array<{ slug: string; title: string; category: string; tags: string[]; seo_keywords: string[]; score: number }> {

  return candidates
    .map((candidate) => {
      let score = 0;

      // Same category = strong signal
      if (candidate.category === sourcePost.category) score += 3;

      // Shared tags
      const sharedTags = (candidate.tags ?? []).filter((t) =>
        (sourcePost.tags ?? []).includes(t)
      );
      score += sharedTags.length;

      // Shared keywords
      const sharedKeywords = (candidate.seo_keywords ?? []).filter((k) =>
        (sourcePost.seo_keywords ?? []).some((sk) =>
          sk.toLowerCase().includes(k.toLowerCase().split(' ')[0]) ||
          k.toLowerCase().includes(sk.toLowerCase().split(' ')[0])
        )
      );
      score += sharedKeywords.length * 2;

      // Title word overlap
      const sourceTitleWords = sourcePost.title.toLowerCase().split(/\s+/);
      const candidateTitleWords = candidate.title.toLowerCase().split(/\s+/);
      const titleOverlap = sourceTitleWords.filter((w) =>
        w.length > 4 && candidateTitleWords.includes(w)
      ).length;
      score += titleOverlap;

      return { ...candidate, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
}
