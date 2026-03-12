import { createClient } from '@supabase/supabase-js';

// ── Public client (used by Next.js pages — read-only via RLS) ──────────────
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnon);

// ── Service client (used by agent API route — full access) ─────────────────
// Only available server-side; never exposed to the browser
export function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
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
  id:           string;
  keyword:      string;
  search_volume: string | null;
  difficulty:   string | null;
  priority:     number;
  used:         boolean;
  used_at:      string | null;
  created_at:   string;
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
