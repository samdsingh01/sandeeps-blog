import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Lazy public client ─────────────────────────────────────────────────────
// Using a getter function so createClient() is never called at module load time.
// This prevents build-time failures when env vars aren't available yet.
let _publicClient: SupabaseClient | null = null;

export function getPublicClient(): SupabaseClient {
  if (!_publicClient) {
    _publicClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _publicClient;
}

// ── Service client (agent only — full DB access) ───────────────────────────
export function getServiceClient(): SupabaseClient {
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
