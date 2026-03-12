-- ============================================================
-- Sandeep's Blog — Supabase Schema
-- Run this once in your Supabase SQL editor
-- ============================================================

-- Posts table — stores all blog content written by the agent
CREATE TABLE IF NOT EXISTS posts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT        UNIQUE NOT NULL,
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL DEFAULT '',
  content         TEXT        NOT NULL DEFAULT '',   -- raw markdown
  content_html    TEXT        NOT NULL DEFAULT '',   -- pre-rendered HTML
  category        TEXT        NOT NULL DEFAULT 'General',
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  author          TEXT        NOT NULL DEFAULT 'Sandeep Singh',
  author_role     TEXT        NOT NULL DEFAULT 'Co-founder, Graphy.com',
  cover_image     TEXT        NOT NULL DEFAULT '/images/default-cover.svg',
  seo_keywords    TEXT[]      NOT NULL DEFAULT '{}',
  reading_time    TEXT        NOT NULL DEFAULT '5 min read',
  featured        BOOLEAN     NOT NULL DEFAULT false,
  status          TEXT        NOT NULL DEFAULT 'published'
                              CHECK (status IN ('draft', 'published')),
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keywords table — agent stores researched keywords here
CREATE TABLE IF NOT EXISTS keywords (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword       TEXT        UNIQUE NOT NULL,
  search_volume TEXT,
  difficulty    TEXT,
  priority      INTEGER     NOT NULL DEFAULT 5,
  used          BOOLEAN     NOT NULL DEFAULT false,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent logs — every agent run is recorded here
CREATE TABLE IF NOT EXISTS agent_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type    TEXT        NOT NULL,  -- 'content_generation' | 'keyword_research' | 'seo_check'
  status      TEXT        NOT NULL,  -- 'success' | 'error' | 'skipped'
  post_slug   TEXT        REFERENCES posts(slug) ON DELETE SET NULL,
  details     JSONB       NOT NULL DEFAULT '{}',
  error       TEXT,
  duration_ms INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on posts
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS posts_status_published_at ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_category ON posts (category);
CREATE INDEX IF NOT EXISTS posts_featured ON posts (featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS keywords_used_priority ON keywords (used, priority DESC);

-- Enable Row Level Security (public read, no public write)
ALTER TABLE posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read of published posts
CREATE POLICY "Public can read published posts"
  ON posts FOR SELECT
  USING (status = 'published');

-- Allow service role full access (used by the agent via service key)
CREATE POLICY "Service role full access to posts"
  ON posts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to keywords"
  ON keywords FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to logs"
  ON agent_logs FOR ALL
  USING (auth.role() = 'service_role');
