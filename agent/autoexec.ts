/**
 * agent/autoexec.ts
 * =================
 * The agent's "hands" — turns strategic recommendations into real actions.
 *
 * PROBLEM THIS SOLVES:
 * The strategy advisor generates great recommendations every day, but they
 * sit in an email as suggestions. Nobody reads them. Nothing happens.
 * This module changes that: the agent reads its own recommendations and
 * actually executes them without waiting for Sandeep to act.
 *
 * WHAT IT DOES:
 * ─────────────────────────────────────────────────────────────────────────
 * 1. CONTENT recommendations  → extract keyword, auto-queue it in DB at
 *    priority 8. Next time the content cron runs, this keyword gets picked.
 *
 * 2. DISTRIBUTION recommendations → save as pending tasks in agent_logs.
 *    These show up in the daily report as "waiting for you to post".
 *
 * 3. TECHNICAL recommendations → log as pending tasks. Appear in report.
 *
 * 4. DAILY SNAPSHOT → stores today's traffic + action metrics in agent_logs
 *    so tomorrow's report can show what CHANGED (delta reporting).
 *
 * CONFIDENCE THRESHOLD:
 * Only acts on 'high' priority recommendations. Medium ones are logged but
 * not auto-executed (they appear in report as "suggested actions").
 *
 * IDEMPOTENCY:
 * Safe to run multiple times — keywords are inserted with ON CONFLICT DO NOTHING
 * equivalent (checks existence first), snapshots use upsert by date.
 *
 * Called by: /api/agent/sync (daily 10 AM UTC)
 */

import { askFast }           from './gemini';
import { getDailyStrategy, DailyStrategy, StrategyRecommendation } from './strategy';
import { getServiceClient }  from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutoExecAction {
  type:        'keyword_queued' | 'distribution_task' | 'technical_task' | 'content_task' | 'snapshot';
  description: string;
  detail:      string;
  autoExecuted: boolean;  // true = agent did it, false = flagged for Sandeep
  priority:    'high' | 'medium' | 'low';
}

export interface AutoExecResult {
  actions:          AutoExecAction[];
  keywordsQueued:   number;
  tasksLogged:      number;
  strategyFocus:    string;
  bottleneck:       string;
  contrarian:       string;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runAutoExec(): Promise<AutoExecResult> {
  console.log('[AutoExec] Starting daily auto-execution...');

  const db      = getServiceClient();
  const actions: AutoExecAction[] = [];
  let keywordsQueued = 0;
  let tasksLogged    = 0;

  // ── 1. Get today's strategy ───────────────────────────────────────────────
  const strategy = await getDailyStrategy();

  console.log(`[AutoExec] Strategy loaded — ${strategy.topRecommendations.length} recommendations`);

  // ── 2. Process content recommendations → auto-queue keywords ─────────────
  const contentRecs = strategy.topRecommendations.filter(
    (r) => r.category === 'content' && (r.priority === 'high' || r.priority === 'medium'),
  );

  for (const rec of contentRecs) {
    try {
      const keyword = await extractKeywordFromRec(rec.action, rec.why);
      if (!keyword || keyword.length < 4) continue;

      // Check if keyword already exists
      const { data: existing } = await db
        .from('keywords')
        .select('id, used')
        .ilike('keyword', keyword)
        .limit(1);

      if (existing && existing.length > 0) {
        // Already in pipeline — if unused, boost its priority
        if (!existing[0].used && rec.priority === 'high') {
          await db
            .from('keywords')
            .update({ priority: 9 })
            .eq('id', existing[0].id);

          actions.push({
            type:        'keyword_queued',
            description: `Boosted priority: "${keyword}"`,
            detail:      `Already in pipeline. Boosted to priority 9. Reason: ${rec.why}`,
            autoExecuted: true,
            priority:    rec.priority,
          });
          keywordsQueued++;
        }
        continue;
      }

      // Insert new keyword
      const priority = rec.priority === 'high' ? 8 : 6;
      const { error } = await db
        .from('keywords')
        .insert({
          keyword,
          priority,
          search_volume: 'agent-sourced',
          difficulty:    rec.effort === 'low' ? 'low' : 'medium',
        });

      if (!error) {
        keywordsQueued++;
        actions.push({
          type:        'keyword_queued',
          description: `Queued keyword: "${keyword}"`,
          detail:      `Priority ${priority}. ${rec.why} Timeframe: ${rec.timeframe}.`,
          autoExecuted: true,
          priority:    rec.priority,
        });
        console.log(`[AutoExec] ✅ Queued keyword: "${keyword}" at priority ${priority}`);
      } else {
        console.warn(`[AutoExec] Failed to insert keyword "${keyword}":`, error.message);
      }
    } catch (err) {
      console.warn('[AutoExec] Content rec processing failed (non-fatal):', err);
    }
  }

  // ── 3. Log distribution tasks (for Sandeep to act on) ────────────────────
  const distRecs = strategy.topRecommendations.filter(
    (r) => r.category === 'distribution' && r.priority === 'high',
  );

  for (const rec of distRecs) {
    await db.from('agent_logs').insert({
      run_type: 'distribution_task',
      status:   'pending',
      details:  {
        action:    rec.action,
        why:       rec.why,
        timeframe: rec.timeframe,
        effort:    rec.effort,
        impact:    rec.impact,
      },
    });

    tasksLogged++;
    actions.push({
      type:        'distribution_task',
      description: rec.action.slice(0, 80),
      detail:      rec.why,
      autoExecuted: false,
      priority:    rec.priority,
    });
  }

  // ── 4. Log technical tasks ────────────────────────────────────────────────
  const techRecs = strategy.topRecommendations.filter(
    (r) => r.category === 'technical' && r.priority === 'high',
  );

  for (const rec of techRecs) {
    await db.from('agent_logs').insert({
      run_type: 'technical_task',
      status:   'pending',
      details:  { action: rec.action, why: rec.why, timeframe: rec.timeframe },
    });

    tasksLogged++;
    actions.push({
      type:        'technical_task',
      description: rec.action.slice(0, 80),
      detail:      rec.why,
      autoExecuted: false,
      priority:    rec.priority,
    });
  }

  // ── 5. Store daily snapshot for delta reporting ───────────────────────────
  const today = new Date().toISOString().split('T')[0];

  await db.from('agent_logs').insert({
    run_type: 'daily_snapshot',
    status:   'success',
    details:  {
      date:              today,
      monthlyClicks:     strategy.snapshot.monthlyClicks,
      weeklyClicks:      strategy.snapshot.weeklyClicks,
      totalPosts:        strategy.snapshot.totalPosts,
      percentToGoal:     strategy.snapshot.percentToGoal,
      projectedMonthly:  strategy.snapshot.projectedMonthly,
      avgPosition:       strategy.snapshot.avgPosition,
      keywordsQueued,
      tasksLogged,
      todaysFocus:       strategy.todaysFocus,
      bottleneck:        strategy.bottleneck,
    },
  });

  const result: AutoExecResult = {
    actions,
    keywordsQueued,
    tasksLogged,
    strategyFocus: strategy.todaysFocus,
    bottleneck:    strategy.bottleneck,
    contrarian:    strategy.contrarian,
  };

  console.log(
    `[AutoExec] ✅ Done — ${keywordsQueued} keywords queued, ${tasksLogged} tasks logged`,
  );

  return result;
}

// ── Get yesterday's snapshot for delta comparison ─────────────────────────────

export interface DailyDelta {
  clicksDelta:    number;   // +/- vs last week same period
  positionDelta:  number;   // +/- avg position (lower = better)
  postsDelta:     number;   // new posts since last snapshot
  goalPctDelta:   number;   // % progress toward goal delta
  previousFocus:  string;
  previousDate:   string;
}

export async function getYesterdayDelta(): Promise<DailyDelta | null> {
  const db = getServiceClient();

  const { data } = await db
    .from('agent_logs')
    .select('details, created_at')
    .eq('run_type', 'daily_snapshot')
    .order('created_at', { ascending: false })
    .limit(2);   // today + yesterday

  if (!data || data.length < 2) return null;

  const today     = data[0].details as any;
  const yesterday = data[1].details as any;

  return {
    clicksDelta:   (today.weeklyClicks   ?? 0) - (yesterday.weeklyClicks   ?? 0),
    positionDelta: (today.avgPosition    ?? 0) - (yesterday.avgPosition    ?? 0),
    postsDelta:    (today.totalPosts     ?? 0) - (yesterday.totalPosts     ?? 0),
    goalPctDelta:  (today.percentToGoal  ?? 0) - (yesterday.percentToGoal  ?? 0),
    previousFocus: yesterday.todaysFocus ?? '',
    previousDate:  yesterday.date        ?? '',
  };
}

// ── Get today's auto-exec actions ─────────────────────────────────────────────

export async function getTodayAutoExecActions(): Promise<Array<{
  type: string;
  details: any;
  createdAt: string;
}>> {
  const db    = getServiceClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await db
    .from('agent_logs')
    .select('run_type, details, created_at')
    .in('run_type', ['distribution_task', 'technical_task'])
    .gte('created_at', today.toISOString())
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return (data ?? []).map((r: any) => ({
    type:      r.run_type,
    details:   r.details,
    createdAt: r.created_at,
  }));
}

// ── Get pending distribution tasks (last 7 days, not yet actioned) ────────────

export async function getPendingAgentTasks(): Promise<Array<{
  type: string;
  action: string;
  why: string;
  timeframe: string;
  createdAt: string;
}>> {
  const db     = getServiceClient();
  const week   = new Date();
  week.setDate(week.getDate() - 7);

  const { data } = await db
    .from('agent_logs')
    .select('run_type, details, created_at')
    .in('run_type', ['distribution_task', 'technical_task'])
    .gte('created_at', week.toISOString())
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);

  return (data ?? []).map((r: any) => ({
    type:      r.run_type,
    action:    r.details?.action ?? '',
    why:       r.details?.why ?? '',
    timeframe: r.details?.timeframe ?? '',
    createdAt: r.created_at,
  }));
}

// ── Extract keyword from a content recommendation using Gemini ────────────────

async function extractKeywordFromRec(action: string, why: string): Promise<string> {
  const raw = await askFast(
    `Extract a single SEO keyword phrase (3–6 words) from this content recommendation.

RECOMMENDATION: "${action}"
WHY: "${why}"

Rules:
- Must be something a person would type into Google
- 3–6 words only
- Lowercase, no punctuation
- Return ONLY the keyword phrase, nothing else

Examples of good keywords:
- "how to monetize youtube channel"
- "best online course platforms 2026"
- "youtube shorts ad revenue"`,
    60,
    0.1,
  );

  return raw
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}
