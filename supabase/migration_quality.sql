-- ============================================================
-- Migration: Content Quality Tracking
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- Store quality score per post (for trending analysis in the daily report)
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT NULL;

-- Index for fast quality filtering
CREATE INDEX IF NOT EXISTS posts_quality_score_idx ON posts (quality_score);

-- Verify
SELECT
  'posts.quality_score' AS check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'quality_score'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status;
