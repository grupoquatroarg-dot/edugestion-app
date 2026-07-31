BEGIN;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_changed_by text,
  ADD COLUMN IF NOT EXISTS content_change_reason text;

CREATE TABLE IF NOT EXISTS public.customer_content_history (
  id bigserial PRIMARY KEY,
  customer_id integer NOT NULL,
  version integer NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT customer_content_history_customer_fkey
    FOREIGN KEY (customer_id)
    REFERENCES public.clientes(id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_content_history_customer_version_key
    UNIQUE (customer_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clientes_content_version_check'
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_content_version_check CHECK (content_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clientes_content_change_reason_check'
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_content_change_reason_check
      CHECK (
        content_change_reason IS NULL
        OR char_length(btrim(content_change_reason)) BETWEEN 3 AND 500
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_content_history_version_check'
  ) THEN
    ALTER TABLE public.customer_content_history
      ADD CONSTRAINT customer_content_history_version_check CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_content_history_reason_check'
  ) THEN
    ALTER TABLE public.customer_content_history
      ADD CONSTRAINT customer_content_history_reason_check
      CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_content_history_before_check'
  ) THEN
    ALTER TABLE public.customer_content_history
      ADD CONSTRAINT customer_content_history_before_check
      CHECK (jsonb_typeof(before_snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_content_history_after_check'
  ) THEN
    ALTER TABLE public.customer_content_history
      ADD CONSTRAINT customer_content_history_after_check
      CHECK (jsonb_typeof(after_snapshot) = 'object');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_customer_content_history_customer
  ON public.customer_content_history (customer_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_clientes_content_changed_at
  ON public.clientes (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

COMMIT;
