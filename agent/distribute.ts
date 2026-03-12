/**
 * agent/distribute.ts
 * ====================
 * Distribution Drafter — generates ready-to-post content for every article.
 *
 * Why this beats manual distribution:
 *   - 80% of SEO traffic comes from distribution, not just publishing
 *   - Reddit + Twitter/X are where creators discover content
 *   - Takes 2 min to review and post, vs 30 min to write from scratch
 *
 * What it generates per post:
 *   → Reddit: Title + body for 3 relevant subreddits
 *   → Twitter/X: 5-tweet thread with hook, value, and CTA
 *   → LinkedIn: 1 long-form post for professional reach
 *
 * Output is included in the daily email report so Sandeep can copy-paste.
 * No Reddit/Twitter API keys needed — drafts are for manual posting.
 *
 * Called from: agent/index.ts (after publish) + included in report.
 */

import { ask, stripJsonFences }  from './gemini';
import { getServiceClient }      from '../lib/supabase';
import { logRun }                from './logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RedditDraft {
  subreddit:    string;
  title:        string;
  body:         string;
  flair?:       string;
  bestTime:     string;  // e.g. "Tuesday 9 AM EST"
}

export interface TwitterThread {
  hook:       string;    // Tweet 1 — the attention-grabber
  tweets:     string[];  // Tweets 2-4 — the value
  cta:        string;    // Tweet 5 — call to action + link
}

export interface DistributionDrafts {
  postSlug:       string;
  postTitle:      string;
  reddit:         RedditDraft[];
  twitter:        TwitterThread;
  linkedin:       string;
  generatedAt:    string;
}

// Subreddits by content category
const SUBREDDIT_MAP: Record<string, string[]> = {
  'youtube-growth':     ['r/NewTubers', 'r/youtubers', 'r/Creator', 'r/youtube'],
  'monetization':       ['r/NewTubers', 'r/Entrepreneur', 'r/sidehustle', 'r/passive_income'],
  'online-courses':     ['r/Entrepreneur', 'r/digitalnomad', 'r/elearning', 'r/instructionaldesign'],
  'creator-economy':    ['r/Creator', 'r/Entrepreneur', 'r/content_marketing'],
  'video-production':   ['r/videography', 'r/NewTubers', 'r/editors'],
  'social-media':       ['r/socialmedia', 'r/marketing', 'r/content_marketing'],
  'coaching':           ['r/Entrepreneur', 'r/coaching', 'r/lifecoaching'],
  'default':            ['r/NewTubers', 'r/Entrepreneur', 'r/Creator'],
};

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateDistributionDrafts(postSlug: string): Promise<DistributionDrafts | null> {
  const db = getServiceClient();

  const { data: post } = await db
    .from('posts')
    .select('slug, title, excerpt, content, category, tags, seo_keywords')
    .eq('slug', postSlug)
    .single();

  if (!post) {
    console.warn(`[Distribute] Post not found: ${postSlug}`);
    return null;
  }

  const subreddits = SUBREDDIT_MAP[post.category] ?? SUBREDDIT_MAP['default'];

  const prompt = `You are a content distribution expert helping Sandeep Singh (Co-founder of Graphy.com) promote a blog post to YouTube creators and online coaches.

BLOG POST:
Title: "${post.title}"
Category: ${post.category}
Excerpt: ${post.excerpt ?? ''}
Keywords: ${(post.seo_keywords ?? []).slice(0, 5).join(', ')}
Content preview:
${(post.content ?? '').slice(0, 800)}

SITE URL: https://sandeeps.co/blog/${post.slug}
SUBREDDITS TO TARGET: ${subreddits.slice(0, 3).join(', ')}

YOUR TASK: Generate distribution content in this exact JSON format:

{
  "reddit": [
    {
      "subreddit": "r/NewTubers",
      "title": "post title (no quotes, no ALL CAPS, sounds natural — NOT like an ad)",
      "body": "2-3 paragraph post body. Share the insight from the article genuinely. Add value first, link at the end naturally. Redditors hate spam — be helpful.",
      "flair": "Discussion",
      "bestTime": "Tuesday or Wednesday, 9-11 AM EST"
    }
  ],
  "twitter": {
    "hook": "Tweet 1: A surprising insight or counterintuitive stat that stops scrolling. Max 240 chars. No hashtag spam. End with a hook that makes them want to read on.",
    "tweets": [
      "Tweet 2: Core insight #1 from the post. Specific and actionable.",
      "Tweet 3: Core insight #2. Could be a framework or numbered list.",
      "Tweet 4: A mistake most creators make (contrast makes people nod)."
    ],
    "cta": "Tweet 5: Soft CTA — 'I wrote a full guide on this:' + article URL. No hard sell."
  },
  "linkedin": "A 150-200 word LinkedIn post version. Professional tone but still conversational. Start with a strong first line (no 'I am excited to share'). Share the key insight, then link to the full article. Avoid bullet points — write in short punchy paragraphs."
}

Generate a Reddit post for each of the 3 subreddits. Make each one slightly different and native to that community's culture. Return ONLY the JSON.`;

  try {
    const raw    = await ask(prompt, 2000, 0.8);
    const parsed = JSON.parse(stripJsonFences(raw));

    const drafts: DistributionDrafts = {
      postSlug:    post.slug,
      postTitle:   post.title,
      reddit:      parsed.reddit      ?? [],
      twitter:     parsed.twitter     ?? { hook: '', tweets: [], cta: '' },
      linkedin:    parsed.linkedin    ?? '',
      generatedAt: new Date().toISOString(),
    };

    // Store in Supabase for the report to pick up
    await db.from('posts').update({
      distribution_drafts: drafts,
    }).eq('slug', postSlug);

    await logRun({
      runType:  'content_generation',
      status:   'success',
      postSlug,
      details:  {
        type:            'distribution_drafts',
        redditPosts:     drafts.reddit.length,
        twitterTweets:   (drafts.twitter.tweets?.length ?? 0) + 2,
      },
    });

    console.log(`[Distribute] ✅ Generated drafts for "${post.title}" — ${drafts.reddit.length} Reddit + Twitter thread + LinkedIn`);
    return drafts;

  } catch (err) {
    console.error('[Distribute] Failed to generate drafts:', err);
    return null;
  }
}

// ── Get pending distribution (posts published today without drafts) ────────────

export async function getPendingDistribution(): Promise<DistributionDrafts[]> {
  const db       = getServiceClient();
  const today    = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: posts } = await db
    .from('posts')
    .select('slug, title, excerpt, distribution_drafts')
    .eq('status', 'published')
    .gte('published_at', today.toISOString())
    .is('distribution_drafts', null)
    .limit(5);

  if (!posts?.length) return [];

  const results: DistributionDrafts[] = [];

  for (const post of posts) {
    if (!post.distribution_drafts) {
      const drafts = await generateDistributionDrafts(post.slug);
      if (drafts) results.push(drafts);
    } else {
      results.push(post.distribution_drafts as DistributionDrafts);
    }
  }

  return results;
}

// ── Format for email report ───────────────────────────────────────────────────

export function formatDistributionForEmail(drafts: DistributionDrafts[]): string {
  if (!drafts.length) return '';

  const sections = drafts.map((d) => {
    const redditSection = d.reddit.map((r) => `
      <div style="border-left: 3px solid #ff4500; padding-left: 12px; margin-bottom: 16px;">
        <p style="font-weight: 600; color: #ff4500; margin: 0 0 4px;">${r.subreddit}</p>
        <p style="font-weight: 600; margin: 0 0 4px;">📌 ${r.title}</p>
        <p style="color: #6b7280; font-size: 13px; margin: 0 0 4px; white-space: pre-wrap;">${r.body}</p>
        <p style="color: #9ca3af; font-size: 12px;">🕐 Best time: ${r.bestTime}</p>
      </div>
    `).join('');

    const twitterSection = `
      <div style="border-left: 3px solid #1da1f2; padding-left: 12px;">
        <p style="font-weight: 600; color: #1da1f2; margin: 0 0 8px;">Twitter/X Thread (copy & post as thread)</p>
        <p style="background: #f0f9ff; border-radius: 8px; padding: 10px; font-size: 13px; margin-bottom: 6px;">1/ ${d.twitter.hook}</p>
        ${d.twitter.tweets.map((t, i) => `<p style="background: #f0f9ff; border-radius: 8px; padding: 10px; font-size: 13px; margin-bottom: 6px;">${i + 2}/ ${t}</p>`).join('')}
        <p style="background: #f0f9ff; border-radius: 8px; padding: 10px; font-size: 13px;">${d.twitter.tweets.length + 2}/ ${d.twitter.cta}</p>
      </div>
    `;

    return `
      <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
        <h4 style="margin: 0 0 16px; color: #111827;">📢 Distribution for: "${d.postTitle}"</h4>
        <p style="font-weight: 600; color: #ff4500; margin: 0 0 12px; font-size: 14px;">Reddit Posts</p>
        ${redditSection}
        <p style="font-weight: 600; color: #1da1f2; margin: 16px 0 12px; font-size: 14px;">Twitter/X Thread</p>
        ${twitterSection}
        ${d.linkedin ? `
          <p style="font-weight: 600; color: #0077b5; margin: 16px 0 8px; font-size: 14px;">LinkedIn</p>
          <div style="border-left: 3px solid #0077b5; padding-left: 12px;">
            <p style="color: #374151; font-size: 13px; white-space: pre-wrap;">${d.linkedin}</p>
          </div>
        ` : ''}
      </div>
    `;
  });

  return `
    <div style="margin-top: 32px;">
      <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px;">📢 Distribution Drafts — Ready to Post</h3>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 20px;">Copy & paste to Reddit, Twitter, and LinkedIn. Review before posting.</p>
      ${sections.join('')}
    </div>
  `;
}
