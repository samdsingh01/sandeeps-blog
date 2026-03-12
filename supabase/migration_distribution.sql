-- ============================================================
-- Migration: Distribution drafts column + Newsletter subscribers table
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- Store generated Reddit/Twitter/LinkedIn drafts on each post
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS distribution_drafts JSONB DEFAULT NULL;

-- Verify
SELECT
  'posts.distribution_drafts' AS check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'distribution_drafts'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status;
