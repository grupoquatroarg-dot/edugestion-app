BEGIN;

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_changed_by text,
  ADD COLUMN IF NOT EXISTS content_change_reason text;

CREATE TABLE IF NOT EXISTS public.provider_content_history (
  id bigserial PRIMARY KEY,
  provider_id integer NOT NULL,
  version integer NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT provider_content_history_provider_fkey
    FOREIGN KEY (provider_id)
    REFERENCES public.proveedores(id)
    ON DELETE RESTRICT,
  CONSTRAINT provider_content_history_provider_version_key
    UNIQUE (provider_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proveedores_content_version_check'
  ) THEN
    ALTER TABLE public.proveedores
      ADD CONSTRAINT proveedores_content_version_check CHECK (content_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proveedores_content_change_reason_check'
  ) THEN
    ALTER TABLE public.proveedores
      ADD CONSTRAINT proveedores_content_change_reason_check
      CHECK (
        content_change_reason IS NULL
        OR char_length(btrim(content_change_reason)) BETWEEN 3 AND 500
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_content_history_version_check'
  ) THEN
    ALTER TABLE public.provider_content_history
      ADD CONSTRAINT provider_content_history_version_check CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_content_history_reason_check'
  ) THEN
    ALTER TABLE public.provider_content_history
      ADD CONSTRAINT provider_content_history_reason_check
      CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_content_history_before_check'
  ) THEN
    ALTER TABLE public.provider_content_history
      ADD CONSTRAINT provider_content_history_before_check
      CHECK (jsonb_typeof(before_snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_content_history_after_check'
  ) THEN
    ALTER TABLE public.provider_content_history
      ADD CONSTRAINT provider_content_history_after_check
      CHECK (jsonb_typeof(after_snapshot) = 'object');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_provider_content_history_provider
  ON public.provider_content_history (provider_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_proveedores_content_changed_at
  ON public.proveedores (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

COMMIT;
