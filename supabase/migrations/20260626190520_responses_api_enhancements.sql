-- Thumbnaily: Responses API enhancements
-- Additive migration. Safe to run on existing data; new columns default to NULL.

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

-- Public read of variation tree on /public pages
DROP POLICY IF EXISTS "Public read thumbnails" ON thumbnails;
CREATE POLICY "Public read thumbnails" ON thumbnails
  FOR SELECT TO anon, authenticated
  USING (true);

-- Anonymous write remains permitted (existing policy)
