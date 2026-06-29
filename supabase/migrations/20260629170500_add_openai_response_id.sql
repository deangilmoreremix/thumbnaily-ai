-- Add openai_response_id column to thumbnails table for multi-turn Responses API support.
ALTER TABLE public.thumbnails
  ADD COLUMN IF NOT EXISTS openai_response_id TEXT;
