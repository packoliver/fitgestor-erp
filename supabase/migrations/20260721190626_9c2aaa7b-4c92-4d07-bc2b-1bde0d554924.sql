
ALTER TABLE public.olist_sync_state
  ADD COLUMN IF NOT EXISTS resume_page integer,
  ADD COLUMN IF NOT EXISTS resume_index integer,
  ADD COLUMN IF NOT EXISTS resume_processed integer,
  ADD COLUMN IF NOT EXISTS resume_total integer,
  ADD COLUMN IF NOT EXISTS resume_updated_at timestamptz;
