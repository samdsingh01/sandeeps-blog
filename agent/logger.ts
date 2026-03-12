/**
 * agent/logger.ts
 * ===============
 * Logs every agent run to the Supabase agent_logs table.
 */

import { getServiceClient } from '../lib/supabase';

export type RunType = 'content_generation' | 'keyword_research' | 'seo_check' | 'health_check';
export type RunStatus = 'success' | 'error' | 'skipped';

export async function logRun(params: {
  runType:    RunType;
  status:     RunStatus;
  postSlug?:  string;
  details?:   Record<string, unknown>;
  error?:     string;
  durationMs?: number;
}): Promise<void> {
  try {
    const db = getServiceClient();
    await db.from('agent_logs').insert({
      run_type:    params.runType,
      status:      params.status,
      post_slug:   params.postSlug ?? null,
      details:     params.details ?? {},
      error:       params.error ?? null,
      duration_ms: params.durationMs ?? null,
    });
  } catch (err) {
    // Never let logging failures break the agent
    console.error('Failed to write agent log:', err);
  }
}
