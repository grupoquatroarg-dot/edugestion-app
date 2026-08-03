BEGIN;

CREATE TABLE IF NOT EXISTS public.general_settings_content_state (
  id smallint PRIMARY KEY,
  content_version integer NOT NULL DEFAULT 0,
  content_changed_at timestamptz,
  content_changed_by text,
  content_change_reason text,
  CONSTRAINT general_settings_content_state_singleton_check CHECK (id = 1),
  CONSTRAINT general_settings_content_state_version_check CHECK (content_version >= 0)
);

INSERT INTO public.general_settings_content_state (id, content_version)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.general_settings_content_history (
  id bigserial PRIMARY KEY,
  version integer NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT general_settings_content_history_version_key UNIQUE (version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'general_settings_content_history_version_check'
  ) THEN
    ALTER TABLE public.general_settings_content_history
      ADD CONSTRAINT general_settings_content_history_version_check CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'general_settings_content_history_reason_check'
  ) THEN
    ALTER TABLE public.general_settings_content_history
      ADD CONSTRAINT general_settings_content_history_reason_check
      CHECK (char_length(trim(reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'general_settings_content_history_before_check'
  ) THEN
    ALTER TABLE public.general_settings_content_history
      ADD CONSTRAINT general_settings_content_history_before_check
      CHECK (jsonb_typeof(before_snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'general_settings_content_history_after_check'
  ) THEN
    ALTER TABLE public.general_settings_content_history
      ADD CONSTRAINT general_settings_content_history_after_check
      CHECK (jsonb_typeof(after_snapshot) = 'object');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_general_settings_content_history_changed_at
  ON public.general_settings_content_history (changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_general_settings_content_state_changed_at
  ON public.general_settings_content_state (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

COMMIT;
