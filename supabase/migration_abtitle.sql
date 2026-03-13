-- ============================================================
-- Migration: A/B Title Testing columns
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS title_b              TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS title_test_started_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS title_swapped_at      TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS title_test_winner     TEXT        DEFAULT NULL
    CHECK (title_test_winner IN ('a', 'b'));

-- Index for fast lookup of active tests
CREATE INDEX IF NOT EXISTS idx_posts_abtitle_active
  ON posts (title_test_winner, status)
  WHERE title_b IS NOT NULL AND title_test_winner IS NULL;

-- Verify
SELECT
  column_name,
  data_type,
  CASE WHEN column_name IN ('title_b','title_test_started_at','title_swapped_at','title_test_winner')
    THEN '✅' ELSE '—' END AS added
FROM information_schema.columns
WHERE table_name = 'posts'
  AND column_name IN ('title_b','title_test_started_at','title_swapped_at','title_test_winner')
ORDER BY column_name;
