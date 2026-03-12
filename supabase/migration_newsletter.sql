-- ============================================================
-- Migration: Newsletter Subscribers
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS subscribers (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email          TEXT        NOT NULL UNIQUE,
  subscribed_at  TIMESTAMPTZ DEFAULT NOW(),
  is_active      BOOLEAN     DEFAULT TRUE,
  source         TEXT        DEFAULT 'website',   -- 'website', 'blog-post', 'tool'
  tags           TEXT[]      DEFAULT '{}'         -- future: segment by interest
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS subscribers_email_idx ON subscribers (email);
CREATE INDEX IF NOT EXISTS subscribers_active_idx ON subscribers (is_active);

-- RLS: service role only (no public reads)
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Verify
SELECT
  'subscribers table' AS check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'subscribers'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status;
