BEGIN;

ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_changed_by text,
  ADD COLUMN IF NOT EXISTS content_change_reason text;

ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_changed_by text,
  ADD COLUMN IF NOT EXISTS content_change_reason text;

ALTER TABLE public.product_families
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_changed_by text,
  ADD COLUMN IF NOT EXISTS content_change_reason text;

CREATE TABLE IF NOT EXISTS public.configuration_item_content_history (
  id bigserial PRIMARY KEY,
  item_type text NOT NULL,
  item_id integer NOT NULL,
  version integer NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT configuration_item_content_history_item_version_key
    UNIQUE (item_type, item_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_methods_content_version_check'
  ) THEN
    ALTER TABLE public.payment_methods
      ADD CONSTRAINT payment_methods_content_version_check CHECK (content_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_categories_content_version_check'
  ) THEN
    ALTER TABLE public.product_categories
      ADD CONSTRAINT product_categories_content_version_check CHECK (content_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_families_content_version_check'
  ) THEN
    ALTER TABLE public.product_families
      ADD CONSTRAINT product_families_content_version_check CHECK (content_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configuration_item_content_history_type_check'
  ) THEN
    ALTER TABLE public.configuration_item_content_history
      ADD CONSTRAINT configuration_item_content_history_type_check
      CHECK (item_type IN ('payment_method', 'product_category', 'product_family'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configuration_item_content_history_version_check'
  ) THEN
    ALTER TABLE public.configuration_item_content_history
      ADD CONSTRAINT configuration_item_content_history_version_check
      CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configuration_item_content_history_reason_check'
  ) THEN
    ALTER TABLE public.configuration_item_content_history
      ADD CONSTRAINT configuration_item_content_history_reason_check
      CHECK (char_length(trim(reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configuration_item_content_history_before_check'
  ) THEN
    ALTER TABLE public.configuration_item_content_history
      ADD CONSTRAINT configuration_item_content_history_before_check
      CHECK (jsonb_typeof(before_snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configuration_item_content_history_after_check'
  ) THEN
    ALTER TABLE public.configuration_item_content_history
      ADD CONSTRAINT configuration_item_content_history_after_check
      CHECK (jsonb_typeof(after_snapshot) = 'object');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_configuration_item_content_history_item
  ON public.configuration_item_content_history (item_type, item_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_methods_content_changed_at
  ON public.payment_methods (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_categories_content_changed_at
  ON public.product_categories (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_families_content_changed_at
  ON public.product_families (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

COMMIT;
