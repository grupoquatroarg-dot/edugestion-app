BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_changed_by text,
  ADD COLUMN IF NOT EXISTS content_change_reason text;

CREATE TABLE IF NOT EXISTS public.product_content_history (
  id bigserial PRIMARY KEY,
  product_id integer NOT NULL,
  version integer NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT product_content_history_product_fkey
    FOREIGN KEY (product_id)
    REFERENCES public.products(id)
    ON DELETE RESTRICT,
  CONSTRAINT product_content_history_product_version_key
    UNIQUE (product_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_content_version_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_content_version_check CHECK (content_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_content_change_reason_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_content_change_reason_check
      CHECK (
        content_change_reason IS NULL
        OR char_length(btrim(content_change_reason)) BETWEEN 3 AND 500
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_content_history_version_check'
  ) THEN
    ALTER TABLE public.product_content_history
      ADD CONSTRAINT product_content_history_version_check CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_content_history_reason_check'
  ) THEN
    ALTER TABLE public.product_content_history
      ADD CONSTRAINT product_content_history_reason_check
      CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_content_history_before_check'
  ) THEN
    ALTER TABLE public.product_content_history
      ADD CONSTRAINT product_content_history_before_check
      CHECK (jsonb_typeof(before_snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_content_history_after_check'
  ) THEN
    ALTER TABLE public.product_content_history
      ADD CONSTRAINT product_content_history_after_check
      CHECK (jsonb_typeof(after_snapshot) = 'object');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_product_content_history_product
  ON public.product_content_history (product_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_content_changed_at
  ON public.products (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

COMMIT;
