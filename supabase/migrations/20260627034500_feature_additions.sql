-- Thumbnaily: Responses API feature additions
-- Additive migration. Adds tables + columns for prompt coach, templates,
-- styles, tags, multi-channel resize, prompt history, critic scores,
-- and conversation threads.

-- =========================================================
-- Columns on thumbnails
-- =========================================================

ALTER TABLE thumbnails
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mood TEXT,
  ADD COLUMN IF NOT EXISTS palette TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS critic_score INTEGER,
  ADD COLUMN IF NOT EXISTS critic_notes TEXT,
  ADD COLUMN IF NOT EXISTS critic_suggestions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS style TEXT,
  ADD COLUMN IF NOT EXISTS template TEXT;

CREATE INDEX IF NOT EXISTS idx_thumbnails_tags ON thumbnails USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_thumbnails_mood ON thumbnails (mood);
CREATE INDEX IF NOT EXISTS idx_thumbnails_palette ON thumbnails (palette);

-- =========================================================
-- Prompt templates (curated library)
-- =========================================================

CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  prefix TEXT NOT NULL,
  suffix TEXT,
  example_prompt TEXT,
  recommended_size TEXT DEFAULT '1536x1024',
  recommended_quality TEXT DEFAULT 'medium',
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read templates" ON prompt_templates;
CREATE POLICY "public read templates"
  ON prompt_templates FOR SELECT TO anon, authenticated
  USING (true);

-- =========================================================
-- Style presets
-- =========================================================

CREATE TABLE IF NOT EXISTS style_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prompt_fragment TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE style_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read styles" ON style_presets;
CREATE POLICY "public read styles"
  ON style_presets FOR SELECT TO anon, authenticated
  USING (true);

-- =========================================================
-- Channel variants (multi-platform resize)
-- =========================================================

CREATE TABLE IF NOT EXISTS channel_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thumbnail_id UUID NOT NULL REFERENCES thumbnails(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  size TEXT NOT NULL,
  link TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_variants_thumb ON channel_variants(thumbnail_id);

ALTER TABLE channel_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read channel variants" ON channel_variants;
CREATE POLICY "public read channel variants"
  ON channel_variants FOR SELECT TO anon, authenticated
  USING (true);

GRANT ALL ON channel_variants TO service_role;
GRANT SELECT, INSERT ON channel_variants TO anon;

-- =========================================================
-- Prompt history (anonymous, device-local via localStorage fallback;
--   server-side history requires auth which we don't have)
-- =========================================================
-- History is mostly client-side; we add a server-side table for shared
-- templates if user opts in later. Skipping for now to stay zero-cost.

-- =========================================================
-- Seed: prompt templates (curated defaults)
-- =========================================================

INSERT INTO prompt_templates (slug, name, category, description, prefix, suffix, example_prompt, recommended_size, sort_order) VALUES
  ('mrbeast', 'MrBeast Style', 'creator', 'High-contrast, oversized emoji, money & reactions', 'MrBeast-style YouTube thumbnail. Oversized expressive face filling 60% of frame, bright neon yellow or red background, big bold white text with thick black stroke, exaggerated emotion, money or object icons flying around. Hyper-saturated, daylight-sharp.', NULL, 'I quit my $1,000,000 job', '1536x1024', 10),
  ('documentary', 'Documentary', 'educational', 'Cinematic, dark, atmospheric, geopolitical', 'Cinematic documentary YouTube thumbnail. Moody dramatic lighting, deep shadows, intense facial close-up with serious expression, environmental context in background, color theory with desaturated palette and one accent color. Film-grain feel.', NULL, 'The fall of the Roman Empire', '1536x1024', 20),
  ('tech-review', 'Tech Review', 'tech', 'Clean, modern, product-forward, sleek', 'Modern tech review YouTube thumbnail. Clean composition, product or device prominently centered, soft studio lighting with one dramatic rim light, minimal background with subtle gradient, cool blue or warm orange accent, premium feel.', NULL, 'iPhone 16 Pro Review', '1024x1024', 30),
  ('explainer', 'Explainer', 'educational', 'Friendly, colorful, simple shapes', 'Friendly educational explainer YouTube thumbnail. Bright clean composition, illustrated character or simple shapes, flat colors with one bold accent, large readable headline space, approachable and curiosity-inducing.', NULL, 'How Black Holes Work', '1024x1024', 40),
  ('podcast', 'Podcast Clip', 'creator', 'Two-person split, expressive, casual', 'Podcast clip YouTube thumbnail. Two-person split composition, expressive casual reaction faces, warm indoor lighting, microphone subtly visible, conversational vibe, brand-color tinted background.', NULL, 'Reacting to the wildest AI news', '1024x1024', 50),
  ('gaming', 'Gaming', 'gaming', 'Action-packed, neon, dynamic', 'High-energy gaming YouTube thumbnail. Dynamic diagonal composition, neon lighting (cyan + magenta), character or weapon foreground, dramatic in-game moment, glowing effects, bold stylized text space.', NULL, 'I Found a SECRET Glitch', '1536x1024', 60),
  ('reaction', 'Reaction', 'creator', 'Big face, circle overlay, split-screen', 'YouTube reaction thumbnail. Large expressive face with circular highlight (shock, laugh, or disbelief), inset smaller image of the reacted-to content, bright punchy background, big bold text.', NULL, 'Reacting to the WORST TikToks', '1024x1024', 70),
  ('listicle', 'Top 10 / Listicle', 'general', 'Numbered, clean, recognizable subjects', 'Top-10 listicle YouTube thumbnail. Big bold number (1-10), recognizable subject or character preview, clean dark or gradient background, sharp typography, "TOP 10" or rank badge in corner.', NULL, 'Top 10 Best Movies of 2026', '1024x1536', 80)
ON CONFLICT (slug) DO NOTHING;

-- =========================================================
-- Seed: style presets
-- =========================================================

INSERT INTO style_presets (slug, name, description, prompt_fragment, sort_order) VALUES
  ('cinematic', 'Cinematic', 'Film-grade color and lighting', 'Cinematic color grading, anamorphic lens flare, shallow depth of field, film grain, teal-and-orange color grade.', 10),
  ('anime', 'Anime', 'Studio Ghibli / modern anime', 'Anime art style, clean linework, expressive characters, vibrant flat colors, Studio Ghibli inspired.', 20),
  ('cyberpunk', 'Cyberpunk', 'Neon noir, Blade Runner vibes', 'Cyberpunk neon-noir aesthetic, deep blacks, hot pink and electric blue neon, rain-slicked streets, holographic UI elements.', 30),
  ('oil-painting', 'Oil Painting', 'Classical fine-art feel', 'Oil painting in the style of classical portraiture, thick impasto brushstrokes, rich chiaroscuro lighting.', 40),
  ('3d-render', '3D Render', 'Pixar / Blender quality', 'High-quality 3D render, subsurface scattering, soft global illumination, Pixar-quality character design.', 50),
  ('pixel-art', 'Pixel Art', 'Retro 16-bit', '16-bit pixel art, SNES-era color palette, chunky pixels, retro game aesthetic.', 60),
  ('noir', 'Film Noir', 'Black & white, high contrast', 'Black and white film noir, dramatic venetian-blind shadows, femme fatale silhouette, detective atmosphere, hard contrast lighting.', 70),
  ('vaporwave', 'Vaporwave', 'Retro 80s aesthetic', 'Vaporwave aesthetic, sunset gradient, palm trees, marble statues, grid floor, retro 80s VHS scanlines.', 80),
  ('photorealistic', 'Photorealistic', 'DSLR photo look', 'Photorealistic, shot on Sony A7IV, 85mm f/1.4, natural lighting, ultra-detailed skin texture, magazine quality.', 90),
  ('comic', 'Comic Book', 'Marvel / DC style', 'American comic book style, halftone dots, bold ink lines, dynamic action pose, primary colors with strong shadows.', 100)
ON CONFLICT (slug) DO NOTHING;