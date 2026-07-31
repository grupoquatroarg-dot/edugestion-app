BEGIN;

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_changed_by text,
  ADD COLUMN IF NOT EXISTS content_change_reason text;

CREATE TABLE IF NOT EXISTS public.checklist_template_content_history (
  id bigserial PRIMARY KEY,
  template_id integer NOT NULL,
  version integer NOT NULL,
  status_at_change text NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  template_before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  items_before_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  items_after_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT checklist_template_content_history_version_key UNIQUE (template_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_templates_content_version_check'
  ) THEN
    ALTER TABLE public.checklist_templates
      ADD CONSTRAINT checklist_templates_content_version_check
      CHECK (content_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_templates_content_change_reason_check'
  ) THEN
    ALTER TABLE public.checklist_templates
      ADD CONSTRAINT checklist_templates_content_change_reason_check
      CHECK (
        content_change_reason IS NULL
        OR char_length(trim(content_change_reason)) BETWEEN 3 AND 500
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_template_id_fkey'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES public.checklist_templates(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_version_key'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_version_key
      UNIQUE (template_id, version);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_version_check'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_version_check
      CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_status_check'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_status_check
      CHECK (status_at_change = 'activa');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_reason_check'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_reason_check
      CHECK (char_length(trim(reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_before_template_check'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_before_template_check
      CHECK (jsonb_typeof(template_before_snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_before_items_check'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_before_items_check
      CHECK (jsonb_typeof(items_before_snapshot) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_after_template_check'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_after_template_check
      CHECK (jsonb_typeof(template_after_snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_content_history_after_items_check'
  ) THEN
    ALTER TABLE public.checklist_template_content_history
      ADD CONSTRAINT checklist_template_content_history_after_items_check
      CHECK (jsonb_typeof(items_after_snapshot) = 'array');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_checklist_template_content_history_template
  ON public.checklist_template_content_history (template_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_checklist_templates_content_changed_at
  ON public.checklist_templates (content_changed_at DESC)
  WHERE content_changed_at IS NOT NULL;

COMMIT;
