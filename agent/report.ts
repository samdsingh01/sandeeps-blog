/**
 * agent/report.ts
 * ===============
 * Gathers daily stats from Supabase and formats the email report.
 * Covers: new posts, agent activity, keyword pipeline, total blog health.
 */

import { getServiceClient }                          from '../lib/supabase';
import { getDailyStrategy, DailyStrategy }            from './strategy';
import { getPendingDistribution, formatDistributionForEmail, DistributionDrafts } from './distribute';

export interface DailyReport {
  date:                string;
  newPostsToday:       PostSummary[];
  postsThisWeek:       PostSummary[];
  totalPosts:          number;
  agentRunsToday:      AgentRunSummary[];
  keywordStats:        KeywordStats;
  topPosts:            PostSummary[];
  strategy?:           DailyStrategy;
  distributionDrafts?: DistributionDrafts[];
}

interface PostSummary {
  title:       string;
  slug:        string;
  category:    string;
  readingTime: string;
  publishedAt: string;
  url:         string;
}

interface AgentRunSummary {
  status:     string;
  runType:    string;
  postSlug:   string | null;
  durationMs: number | null;
  error:      string | null;
  createdAt:  string;
}

interface KeywordStats {
  total:     number;
  unused:    number;
  usedToday: number;
}

const SITE_URL = 'https://sandeeps.co';

export async function buildDailyReport(): Promise<DailyReport> {
  const db   = getServiceClient();
  const now  = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // ── Posts published today ─────────────────────────────────────────────────
  const { data: todayPosts } = await db
    .from('posts')
    .select('title, slug, category, reading_time, published_at')
    .eq('status', 'published')
    .gte('published_at', today.toISOString())
    .order('published_at', { ascending: false });

  // ── Posts this week ───────────────────────────────────────────────────────
  const { data: weekPosts } = await db
    .from('posts')
    .select('title, slug, category, reading_time, published_at')
    .eq('status', 'published')
    .gte('published_at', weekAgo.toISOString())
    .order('published_at', { ascending: false });

  // ── Total post count ──────────────────────────────────────────────────────
  const { count: totalPosts } = await db
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published');

  // ── Agent runs today ──────────────────────────────────────────────────────
  const { data: agentLogs } = await db
    .from('agent_logs')
    .select('status, run_type, post_slug, duration_ms, error, created_at')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false });

  // ── Keyword stats ─────────────────────────────────────────────────────────
  const { count: totalKeywords } = await db
    .from('keywords')
    .select('*', { count: 'exact', head: true });

  const { count: unusedKeywords } = await db
    .from('keywords')
    .select('*', { count: 'exact', head: true })
    .eq('used', false);

  const { count: usedToday } = await db
    .from('keywords')
    .select('*', { count: 'exact', head: true })
    .gte('used_at', today.toISOString());

  // ── Top 5 recent posts ────────────────────────────────────────────────────
  const { data: topPosts } = await db
    .from('posts')
    .select('title, slug, category, reading_time, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(5);

  function toSummary(p: any): PostSummary {
    return {
      title:       p.title,
      slug:        p.slug,
      category:    p.category,
      readingTime: p.reading_time,
      publishedAt: p.published_at,
      url:         `${SITE_URL}/blog/${p.slug}`,
    };
  }

  // Get daily strategy (non-blocking — if it fails, report still sends)
  let strategy: DailyStrategy | undefined;
  try {
    strategy = await getDailyStrategy();
  } catch (err) {
    console.error('[Report] Strategy generation failed (non-fatal):', err);
  }

  // Get distribution drafts for today's posts (non-blocking)
  let distributionDrafts: DistributionDrafts[] | undefined;
  try {
    distributionDrafts = await getPendingDistribution();
  } catch (err) {
    console.error('[Report] Distribution drafts failed (non-fatal):', err);
  }

  return {
    date:                now.toISOString(),
    newPostsToday:       (todayPosts ?? []).map(toSummary),
    postsThisWeek:       (weekPosts  ?? []).map(toSummary),
    totalPosts:          totalPosts  ?? 0,
    agentRunsToday:      (agentLogs  ?? []).map((l: any) => ({
      status:     l.status,
      runType:    l.run_type,
      postSlug:   l.post_slug,
      durationMs: l.duration_ms,
      error:      l.error,
      createdAt:  l.created_at,
    })),
    keywordStats: {
      total:     totalKeywords  ?? 0,
      unused:    unusedKeywords ?? 0,
      usedToday: usedToday      ?? 0,
    },
    topPosts:            (topPosts ?? []).map(toSummary),
    strategy,
    distributionDrafts,
  };
}

/**
 * Format the report as a clean HTML email
 */
export function formatReportEmail(report: DailyReport): { subject: string; html: string } {
  const dateStr = new Date(report.date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const agentSuccess = report.agentRunsToday.filter((r) => r.status === 'success').length;
  const agentErrors  = report.agentRunsToday.filter((r) => r.status === 'error').length;

  const statusEmoji =
    agentErrors > 0    ? '⚠️' :
    agentSuccess > 0   ? '✅' : '😴';

  const subject = `${statusEmoji} Sandeep's Blog Daily Report — ${dateStr}`;

  const postRow = (p: PostSummary) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">
        <a href="${p.url}" style="color:#7c3aed;font-weight:600;text-decoration:none;">${p.title}</a><br>
        <span style="color:#9ca3af;font-size:12px;">${p.category} · ${p.readingTime}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;white-space:nowrap;">
        ${new Date(p.publishedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
      </td>
    </tr>`;

  const agentRow = (r: AgentRunSummary) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;">
        ${r.status === 'success' ? '✅' : r.status === 'error' ? '❌' : '⏭️'} ${r.runType.replace(/_/g,' ')}
        ${r.postSlug ? `<br><span style="color:#7c3aed;">→ /blog/${r.postSlug}</span>` : ''}
        ${r.error    ? `<br><span style="color:#dc2626;font-size:11px;">${r.error.slice(0,100)}</span>` : ''}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#9ca3af;font-size:12px;">
        ${r.durationMs ? `${(r.durationMs/1000).toFixed(1)}s` : '—'}
      </td>
    </tr>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#5b21b6,#7c3aed);border-radius:16px;padding:32px;text-align:center;margin-bottom:24px;">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800;">📊 Daily Blog Report</h1>
      <p style="color:#ddd6fe;margin:8px 0 0;font-size:14px;">${dateStr}</p>
      <p style="color:#fff;margin:16px 0 0;font-size:36px;font-weight:900;">${report.totalPosts} <span style="font-size:16px;font-weight:400;color:#ddd6fe;">total posts published</span></p>
    </div>

    <!-- 🎯 Goal: 10K Monthly Traffic -->
    ${report.strategy ? (() => {
      const s          = report.strategy!.snapshot;
      const pct        = Math.min(100, s.percentToGoal);
      const barColor   = pct >= 75 ? '#059669' : pct >= 40 ? '#d97706' : '#7c3aed';
      const daysMsg    = s.daysToGoal
        ? `~${s.daysToGoal} days to go at current pace`
        : s.monthlyClicks >= 10000
          ? '🎉 Goal reached!'
          : 'Not enough data yet — keep publishing';
      return `
    <div style="background:#fff;border-radius:12px;border:2px solid #7c3aed;margin-bottom:24px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="margin:0;font-size:16px;font-weight:800;color:#374151;">🎯 Goal: 10,000 Monthly Visitors</h2>
        <span style="font-size:13px;color:#6b7280;">${daysMsg}</span>
      </div>
      <div style="background:#f3f4f6;border-radius:999px;height:16px;overflow:hidden;margin-bottom:12px;">
        <div style="background:${barColor};height:100%;width:${pct}%;border-radius:999px;transition:width 0.3s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:22px;font-weight:900;color:${barColor};">${s.monthlyClicks.toLocaleString()} <span style="font-size:13px;font-weight:400;color:#6b7280;">/ 10,000 monthly</span></span>
        <span style="font-size:13px;color:#6b7280;align-self:flex-end;">Projected: <strong style="color:#374151;">${s.projectedMonthly.toLocaleString()}/mo</strong></span>
      </div>
    </div>`;
    })() : ''}

    <!-- 🧠 Today's Focus (from strategic advisor) -->
    ${report.strategy ? `
    <div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:12px;padding:20px;margin-bottom:24px;">
      <h2 style="margin:0 0 8px;font-size:15px;font-weight:800;color:#92400e;">🧠 Today's Strategic Focus</h2>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.6;">${report.strategy.todaysFocus}</p>
      <div style="background:#fef3c7;border-radius:8px;padding:10px 12px;">
        <span style="font-size:12px;font-weight:700;color:#92400e;">⛔ BOTTLENECK: </span>
        <span style="font-size:12px;color:#92400e;">${report.strategy.bottleneck}</span>
      </div>
    </div>` : ''}

    <!-- 💡 Strategic Recommendations -->
    ${report.strategy && report.strategy.topRecommendations.length > 0 ? `
    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:20px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6;background:#f0fdf4;">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:#374151;">💡 Strategic Recommendations</h2>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">AI-generated daily — ranked by impact toward 10K goal</p>
      </div>
      ${report.strategy.topRecommendations.slice(0, 6).map((rec) => {
        const catColor: Record<string, string> = {
          content: '#7c3aed', distribution: '#2563eb', product: '#059669',
          gtm: '#dc2626', technical: '#d97706', budget: '#0891b2',
        };
        const catEmoji: Record<string, string> = {
          content: '✍️', distribution: '📣', product: '🛠️',
          gtm: '🤝', technical: '⚙️', budget: '💰',
        };
        const color = catColor[rec.category] ?? '#374151';
        const emoji = catEmoji[rec.category] ?? '💡';
        const impactDot = rec.impact === 'high' ? '🔴' : rec.impact === 'medium' ? '🟡' : '🟢';
        return `
        <div style="padding:14px 20px;border-bottom:1px solid #f9fafb;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="background:${color}20;color:${color};font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap;margin-top:2px;">${emoji} ${rec.category.toUpperCase()}</span>
            <div style="flex:1;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#111827;">${rec.action}</p>
              <p style="margin:0;font-size:12px;color:#6b7280;">${rec.why}</p>
              <div style="margin-top:6px;font-size:11px;color:#9ca3af;">${impactDot} ${rec.impact} impact · ${rec.effort} effort · ${rec.timeframe}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}

    <!-- 🎲 This Week's Milestone + Contrarian Move -->
    ${report.strategy ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
      <div style="background:#eff6ff;border-radius:12px;padding:16px;border:1px solid #bfdbfe;">
        <div style="font-size:13px;font-weight:700;color:#1d4ed8;margin-bottom:6px;">📅 This Week's Milestone</div>
        <p style="margin:0;font-size:12px;color:#1e40af;line-height:1.5;">${report.strategy.weeklyMilestone}</p>
      </div>
      <div style="background:#fdf2f8;border-radius:12px;padding:16px;border:1px solid #f0abfc;">
        <div style="font-size:13px;font-weight:700;color:#7e22ce;margin-bottom:6px;">⚡ Contrarian Move</div>
        <p style="margin:0;font-size:12px;color:#6b21a8;line-height:1.5;">${report.strategy.contrarian}</p>
      </div>
    </div>` : ''}

    <!-- 💰 Budget Allocation -->
    ${report.strategy && report.strategy.budgetAllocation.breakdown.length > 0 ? `
    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:20px;padding:20px;">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#374151;">💰 $500 Monthly Budget Allocation</h2>
      ${report.strategy.budgetAllocation.breakdown.map((item) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#374151;">${item.category}</div>
            <div style="font-size:11px;color:#9ca3af;">${item.description}</div>
          </div>
          <div style="font-size:15px;font-weight:800;color:#059669;">$${item.amount}</div>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;padding-top:10px;">
        <span style="font-size:13px;font-weight:700;color:#374151;">Total Allocated</span>
        <span style="font-size:15px;font-weight:900;color:#7c3aed;">$${report.strategy.budgetAllocation.breakdown.reduce((s, i) => s + i.amount, 0)} / $${report.strategy.budgetAllocation.total}</span>
      </div>
    </div>` : ''}

    <!-- 📢 Distribution Drafts -->
    ${report.distributionDrafts && report.distributionDrafts.length > 0
      ? formatDistributionForEmail(report.distributionDrafts)
      : ''}

    <!-- Stats Row -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;">
      <div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #e5e7eb;">
        <div style="font-size:28px;font-weight:900;color:#7c3aed;">${report.newPostsToday.length}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Posts Today</div>
      </div>
      <div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #e5e7eb;">
        <div style="font-size:28px;font-weight:900;color:#059669;">${report.postsThisWeek.length}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Posts This Week</div>
      </div>
      <div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #e5e7eb;">
        <div style="font-size:28px;font-weight:900;color:#d97706;">${report.keywordStats.unused}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Keywords Queued</div>
      </div>
    </div>

    <!-- Agent Activity -->
    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:20px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6;background:#faf5ff;">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:#374151;">🤖 Agent Activity Today</h2>
      </div>
      ${report.agentRunsToday.length === 0
        ? '<p style="padding:16px 20px;color:#9ca3af;margin:0;">No agent runs yet today — scheduled for 8 AM UTC</p>'
        : `<table style="width:100%;border-collapse:collapse;">
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">ACTION</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">DURATION</th>
            </tr>
            ${report.agentRunsToday.map(agentRow).join('')}
           </table>`
      }
    </div>

    <!-- New Posts Today -->
    ${report.newPostsToday.length > 0 ? `
    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:20px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6;background:#f0fdf4;">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:#374151;">✨ Published Today</h2>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="background:#f9fafb;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">POST</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">TIME</th>
        </tr>
        ${report.newPostsToday.map(postRow).join('')}
      </table>
    </div>` : ''}

    <!-- Recent Posts -->
    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:20px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:#374151;">📝 Recent Posts on the Blog</h2>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${report.topPosts.map(postRow).join('')}
      </table>
    </div>

    <!-- Keyword Pipeline -->
    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:20px;padding:20px;">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#374151;">🔑 Keyword Pipeline</h2>
      <div style="display:flex;gap:16px;">
        <div style="flex:1;background:#faf5ff;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:#7c3aed;">${report.keywordStats.total}</div>
          <div style="font-size:11px;color:#6b7280;">Total Keywords</div>
        </div>
        <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:#059669;">${report.keywordStats.unused}</div>
          <div style="font-size:11px;color:#6b7280;">Ready to Write</div>
        </div>
        <div style="flex:1;background:#fffbeb;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:#d97706;">${report.keywordStats.usedToday}</div>
          <div style="font-size:11px;color:#6b7280;">Used Today</div>
        </div>
      </div>
    </div>

    <!-- Traffic & Analytics Links -->
    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:20px;padding:20px;">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#374151;">📈 Traffic & Analytics</h2>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">Check real-time traffic and CTA click performance:</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="https://analytics.google.com/analytics/web/#/p/reports/realtime/overview" target="_blank"
           style="display:inline-block;background:#4285f4;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
          📊 GA4 Dashboard
        </a>
        <a href="https://analytics.google.com/analytics/web/#/p/reports/engagement/events" target="_blank"
           style="display:inline-block;background:#059669;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
          🖱️ CTA Click Events
        </a>
        <a href="https://search.google.com/search-console" target="_blank"
           style="display:inline-block;background:#ea4335;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
          🔍 Search Console
        </a>
      </div>
      <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;">
        CTA clicks are tracked as <strong>cta_click</strong> events in GA4. Filter by <em>event_label</em> to see which specific buttons (hero-cta, author-bio-cta, etc.) are converting.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px;">
      <p style="margin:0;">
        <a href="${SITE_URL}" style="color:#7c3aed;font-weight:600;text-decoration:none;">sandeeps.co</a>
        · Powered by Gemini + Supabase + Vercel
      </p>
      <p style="margin:8px 0 0;">This report is auto-generated daily at 9 AM UTC</p>
    </div>

  </div>
</body>
</html>`;

  return { subject, html };
}
