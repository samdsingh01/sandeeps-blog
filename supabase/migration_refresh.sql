-- ============================================================
-- Migration: Content Refresh + CTR tracking columns
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- Track when each post was last refreshed
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ DEFAULT NULL;

-- Verify
SELECT
  'posts.last_refreshed_at' AS check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'last_refreshed_at'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status;
