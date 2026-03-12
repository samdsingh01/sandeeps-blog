-- ============================================================
-- Migration: Feedback Loop tables
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Add FAQ column to posts table (for AEO structured data)
--    Stores an array of { question, answer } objects as JSONB
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS faq JSONB DEFAULT NULL;

-- 2. Create page_performance table
--    Stores daily Google Search Console snapshots per page
CREATE TABLE IF NOT EXISTS page_performance (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT        NOT NULL,
  date         DATE        NOT NULL,
  impressions  INT         NOT NULL DEFAULT 0,
  clicks       INT         NOT NULL DEFAULT 0,
  ctr          NUMERIC(6,4) NOT NULL DEFAULT 0,
  avg_position NUMERIC(6,2) NOT NULL DEFAULT 0,
  top_queries  JSONB        NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One snapshot per page per day
  CONSTRAINT page_performance_slug_date_key UNIQUE (slug, date)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pp_slug ON page_performance (slug);
CREATE INDEX IF NOT EXISTS idx_pp_date ON page_performance (date DESC);
CREATE INDEX IF NOT EXISTS idx_pp_clicks ON page_performance (clicks DESC);

-- Enable Row Level Security
ALTER TABLE page_performance ENABLE ROW LEVEL SECURITY;

-- Allow public reads (for future dashboard/widgets)
CREATE POLICY IF NOT EXISTS "page_performance_read"
  ON page_performance FOR SELECT USING (true);

-- 3. Verify
SELECT
  'posts.faq column'          AS check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'faq'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status

UNION ALL

SELECT
  'page_performance table',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'page_performance'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END;
