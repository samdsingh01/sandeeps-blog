import { createClient } from '@supabase/supabase-js';

// ── Lazy public client ─────────────────────────────────────────────────────
// Created on first use (not at module load) so build-time bundling never throws
let _publicClient: ReturnType<typeof createClient> | null = null;

export const supabase: ReturnType<typeof createClient> = new Proxy(
  {} as ReturnType<typeof createClient>,
  {
    get(_: unknown, prop: string) {
      if (!_publicClient) {
        _publicClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
      }
      return (_publicClient as any)[prop];
    },
  }
);

// ── Service client (agent only — full DB access) ───────────────────────────
// Also lazy — reads env vars only when called at runtime
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ── Database types ──────────────────────────────────────────────────────────
export interface DbPost {
  id:           string;
  slug:         string;
  title:        string;
  description:  string;
  content:      string;
  content_html: string;
  category:     string;
  tags:         string[];
  author:       string;
  author_role:  string;
  cover_image:  string;
  seo_keywords: string[];
  reading_time: string;
  featured:     boolean;
  status:       'draft' | 'published';
  published_at: string;
  created_at:   string;
  updated_at:   string;
}

export interface DbKeyword {
  id:            string;
  keyword:       string;
  search_volume: string | null;
  difficulty:    string | null;
  priority:      number;
  used:          boolean;
  used_at:       string | null;
  created_at:    string;
}

export interface DbAgentLog {
  id:          string;
  run_type:    string;
  status:      string;
  post_slug:   string | null;
  details:     Record<string, unknown>;
  error:       string | null;
  duration_ms: number | null;
  created_at:  string;
}
