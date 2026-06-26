-- Thumbnaily: Bootstrap schema + Responses API enhancements
-- Creates the base tables (thumbnails, waitlist_users) and the
-- Responses API enhancements (parent_id, openai_response_id, etc.)
-- Safe to run on a fresh Supabase project. Idempotent on a partially
-- initialized one (uses IF NOT EXISTS / CREATE OR REPLACE where possible).

-- =========================================================
-- Base tables
-- =========================================================

CREATE TABLE IF NOT EXISTS thumbnails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link TEXT NOT NULL,
  prompt TEXT,
  isPublic BOOLEAN DEFAULT true,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Responses API enhancements (additive columns + indexes)
-- =========================================================

ALTER TABLE thumbnails
  ADD COLUMN IF NOT EXISTS openai_response_id TEXT,
  ADD COLUMN IF NOT EXISTS openai_image_call_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES thumbnails(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS size TEXT DEFAULT '1024x1024',
  ADD COLUMN IF NOT EXISTS quality TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'png',
  ADD COLUMN IF NOT EXISTS revised_prompt TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'generate';

CREATE INDEX IF NOT EXISTS idx_thumbnails_parent ON thumbnails(parent_id);
CREATE INDEX IF NOT EXISTS idx_thumbnails_openai_response ON thumbnails(openai_response_id);
CREATE INDEX IF NOT EXISTS idx_thumbnails_ispublic_created ON thumbnails(isPublic, createdAt DESC);

-- =========================================================
-- Row Level Security
-- =========================================================

ALTER TABLE thumbnails ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_users ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (bypasses RLS by default; explicit for clarity)
GRANT ALL ON thumbnails TO service_role;
GRANT ALL ON waitlist_users TO service_role;

-- Allow anon to insert/select for the public explore + waitlist flows
GRANT INSERT, SELECT ON thumbnails TO anon;
GRANT INSERT ON waitlist_users TO anon;

-- thumbnaily: anon can read public thumbnails
DROP POLICY IF EXISTS "anon read public thumbnails" ON thumbnails;
CREATE POLICY "anon read public thumbnails"
  ON thumbnails FOR SELECT TO anon
  USING (isPublic = true);

-- thumbnaily: anon can submit a generation (insert with isPublic flag)
DROP POLICY IF EXISTS "anon insert thumbnails" ON thumbnails;
CREATE POLICY "anon insert thumbnails"
  ON thumbnails FOR INSERT TO anon
  WITH CHECK (true);

-- thumbnaily: anon can join the waitlist
DROP POLICY IF EXISTS "anon insert waitlist" ON waitlist_users;
CREATE POLICY "anon insert waitlist"
  ON waitlist_users FOR INSERT TO anon
  WITH CHECK (true);

-- =========================================================
-- Storage bucket + policies
-- =========================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('thumbnails', 'thumbnails', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Anonymous users can upload to the thumbnails bucket
DROP POLICY IF EXISTS "anon upload to thumbnails" ON storage.objects;
CREATE POLICY "anon upload to thumbnails"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'thumbnails');

-- Anonymous users can read from the thumbnails bucket (it is public)
DROP POLICY IF EXISTS "anon read thumbnails" ON storage.objects;
CREATE POLICY "anon read thumbnails"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'thumbnails');
