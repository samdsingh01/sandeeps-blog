/**
 * agent/abtitle.ts
 * ================
 * A/B Title Testing — automatically tests two title variants per post,
 * measures GSC CTR for each, and keeps the winner permanently.
 *
 * HOW IT WORKS:
 *   Day 0:  Post publishes with title_a (original). title_b generated + stored.
 *   Day 7:  If CTR < 3% → swap to title_b, set title_swapped_at.
 *   Day 14: Compare CTR before/after swap.
 *           Winner (higher CTR) becomes the permanent title.
 *           title_test_winner set to 'a' or 'b'.
 *
 * GSC NOTE: GSC data lags 3-5 days. We use a 7-day window to ensure
 *           enough data before making decisions.
 *
 * Runs as part of /api/agent/sync (daily at 10 AM UTC).
 */

import { ask }             from './gemini';
import { getServiceClient } from '../lib/supabase';
import { getPageCTR }      from './gsc';

export interface ABTestResult {
  slug:         string;
  titleA:       string;
  titleB:       string;
  action:       'swapped_to_b' | 'kept_a' | 'kept_b' | 'too_early' | 'no_data';
  ctrA?:        number;
  ctrB?:        number;
  winner?:      'a' | 'b';
}

/**
 * Generate a title_b variant for a newly published post.
 * Called right after post is inserted into DB.
 */
export async function generateTitleVariant(titleA: string, topic: string, category: string): Promise<string> {
  const prompt = `
You are an expert SEO copywriter. Generate ONE alternative title for this blog post.

ORIGINAL TITLE: "${titleA}"
TOPIC: ${topic}
CATEGORY: ${category}

Rules for the alternative title:
- Target the SAME keyword but with a different angle
- Try a different format: if original is "How to X", try "X: The Complete Guide" or "X in 2025 (Step-by-Step)"
- If original uses a number, change the number or remove it
- Keep it 50-65 characters for Google display
- Must feel genuinely different — not just a word swap
- No clickbait. No "you won't believe" style.

Return ONLY the alternative title text. No quotes. No explanation.`;

  const variant = await ask(prompt, 200, 0.85);
  return variant.trim().replace(/^["']|["']$/g, ''); // strip any quotes
}

/**
 * Run the A/B title test evaluation loop.
 * Checks all posts with active tests and takes appropriate action.
 * Called daily by /api/agent/sync.
 */
export async function runABTitleTests(): Promise<ABTestResult[]> {
  const db      = getServiceClient();
  const results: ABTestResult[] = [];
  const now     = Date.now();

  // Find posts with active A/B tests (have title_b, no winner yet)
  const { data: posts, error } = await db
    .from('posts')
    .select('slug, title, title_b, title_test_started_at, title_swapped_at, title_test_winner')
    .not('title_b', 'is', null)
    .is('title_test_winner', null)
    .eq('status', 'published');

  if (error || !posts?.length) return [];

  console.log(`[ABTitle] Checking ${posts.length} active A/B title tests`);

  for (const post of posts) {
    const startedAt    = post.title_test_started_at ? new Date(post.title_test_started_at).getTime() : null;
    const swappedAt    = post.title_swapped_at       ? new Date(post.title_swapped_at).getTime()       : null;

    if (!startedAt) continue;

    const daysSinceStart = (now - startedAt) / 864e5;
    const daysSinceSwap  = swappedAt ? (now - swappedAt) / 864e5 : null;

    try {
      // ── Phase 1: Day 7 — evaluate title_a, consider swapping ──────────────
      if (!swappedAt && daysSinceStart >= 7) {
        const ctrA = await getPageCTR(post.slug, 7);

        if (ctrA === null) {
          // No GSC data yet — too early to decide
          results.push({ slug: post.slug, titleA: post.title, titleB: post.title_b, action: 'no_data' });
          continue;
        }

        console.log(`[ABTitle] "${post.slug}" — title_a CTR: ${(ctrA * 100).toFixed(2)}%`);

        if (ctrA < 0.03) {
          // CTR below 3% — swap to title_b for a 7-day trial
          await db.from('posts').update({
            title:            post.title_b,
            title_b:          post.title,  // swap so title_b always holds the variant
            title_swapped_at: new Date().toISOString(),
            updated_at:       new Date().toISOString(),
          }).eq('slug', post.slug);

          console.log(`[ABTitle] ↔️ Swapped to title_b for "${post.slug}" (CTR was ${(ctrA * 100).toFixed(2)}%)`);
          results.push({
            slug:   post.slug, titleA: post.title,  titleB: post.title_b,
            action: 'swapped_to_b', ctrA,
          });
        } else {
          // CTR is decent — title_a is performing, keep it, mark test complete
          await db.from('posts').update({
            title_test_winner: 'a',
            updated_at:        new Date().toISOString(),
          }).eq('slug', post.slug);

          console.log(`[ABTitle] ✅ title_a wins for "${post.slug}" (CTR: ${(ctrA * 100).toFixed(2)}%)`);
          results.push({
            slug:   post.slug, titleA: post.title, titleB: post.title_b,
            action: 'kept_a', ctrA, winner: 'a',
          });
        }
        continue;
      }

      // ── Phase 2: Day 14 — compare both, pick winner ────────────────────────
      if (swappedAt && daysSinceSwap !== null && daysSinceSwap >= 7) {
        const [ctrA, ctrB] = await Promise.all([
          getPageCTR(post.slug, 14),  // full period (both variants)
          getPageCTR(post.slug, 7),   // just the last 7 days (title_b period)
        ]);

        if (ctrB === null) {
          results.push({ slug: post.slug, titleA: post.title, titleB: post.title_b, action: 'no_data' });
          continue;
        }

        // Current title is title_b (was swapped), ctrB is its recent performance
        // ctrA is approximate from before — not exact but good enough directionally
        const winner: 'a' | 'b' = (ctrB ?? 0) > (ctrA ?? 0) ? 'b' : 'a';

        if (winner === 'a') {
          // title_b (currently active) lost — swap back to original
          await db.from('posts').update({
            title:             post.title_b,  // title_b holds the original (swapped earlier)
            title_test_winner: 'a',
            updated_at:        new Date().toISOString(),
          }).eq('slug', post.slug);
          console.log(`[ABTitle] 🏆 title_a wins final test for "${post.slug}"`);
        } else {
          // title_b wins — keep current title
          await db.from('posts').update({
            title_test_winner: 'b',
            updated_at:        new Date().toISOString(),
          }).eq('slug', post.slug);
          console.log(`[ABTitle] 🏆 title_b wins final test for "${post.slug}"`);
        }

        results.push({
          slug: post.slug, titleA: post.title, titleB: post.title_b,
          action: winner === 'b' ? 'kept_b' : 'kept_a',
          ctrA:   ctrA ?? 0, ctrB: ctrB ?? 0, winner,
        });
        continue;
      }

      // Too early to evaluate
      results.push({ slug: post.slug, titleA: post.title, titleB: post.title_b, action: 'too_early' });

    } catch (err) {
      console.warn(`[ABTitle] Error for "${post.slug}":`, err);
    }
  }

  return results;
}

/**
 * Summary of A/B test results for the daily email report.
 */
export function formatABResultsForEmail(results: ABTestResult[]): string {
  if (!results.length) return '';

  const swaps   = results.filter((r) => r.action === 'swapped_to_b');
  const winners = results.filter((r) => r.winner);
  const pending = results.filter((r) => r.action === 'too_early');

  let html = `
<div style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0">
  <h3 style="margin:0 0 12px;font-size:15px;color:#0369a1">🧪 A/B Title Tests</h3>`;

  if (winners.length) {
    html += `<p style="margin:4px 0;font-size:13px"><strong>Winners decided (${winners.length}):</strong></p>`;
    for (const r of winners) {
      const icon = r.winner === 'b' ? '🏆 New title won' : '✅ Original title won';
      html += `<p style="margin:4px 0 4px 12px;font-size:12px;color:#374151">${icon}: <em>${r.winner === 'b' ? r.titleB : r.titleA}</em>`;
      if (r.ctrA !== undefined && r.ctrB !== undefined) {
        html += ` (${(r.ctrA * 100).toFixed(1)}% vs ${(r.ctrB * 100).toFixed(1)}% CTR)`;
      }
      html += `</p>`;
    }
  }

  if (swaps.length) {
    html += `<p style="margin:8px 0 4px;font-size:13px"><strong>Swapped to variant (${swaps.length}):</strong></p>`;
    for (const r of swaps) {
      html += `<p style="margin:4px 0 4px 12px;font-size:12px;color:#374151">↔️ Testing: <em>${r.titleB}</em> (was: ${r.titleA.slice(0, 40)}…)</p>`;
    }
  }

  if (pending.length) {
    html += `<p style="margin:8px 0 4px;font-size:12px;color:#6b7280">${pending.length} test${pending.length > 1 ? 's' : ''} still gathering data…</p>`;
  }

  html += `</div>`;
  return html;
}
