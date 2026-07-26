BEGIN;

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text,
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS reactivated_by text,
  ADD COLUMN IF NOT EXISTS reactivation_reason text;

CREATE TABLE IF NOT EXISTS public.checklist_template_status_history (
  id bigserial PRIMARY KEY,
  template_id integer NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  performed_by text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  previous_status text NOT NULL,
  new_status text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_history_template_id_fkey'
  ) THEN
    ALTER TABLE public.checklist_template_status_history
      ADD CONSTRAINT checklist_template_history_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES public.checklist_templates(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_history_action_check'
  ) THEN
    ALTER TABLE public.checklist_template_status_history
      ADD CONSTRAINT checklist_template_history_action_check
      CHECK (action IN ('deactivate', 'reactivate'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_template_history_reason_check'
  ) THEN
    ALTER TABLE public.checklist_template_status_history
      ADD CONSTRAINT checklist_template_history_reason_check
      CHECK (char_length(trim(reason)) BETWEEN 3 AND 500);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_checklist_template_history_template_id
  ON public.checklist_template_status_history (template_id, performed_at DESC);

DO $$
DECLARE
  compatible_index_exists boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class idx
    JOIN pg_index i ON i.indexrelid = idx.oid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'public'
      AND tbl.relname = 'checklist_templates'
      AND idx.relname = 'idx_checklist_templates_active'
      AND i.indisvalid
      AND i.indisready
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 2
      AND regexp_replace(lower(replace(pg_get_indexdef(idx.oid, 1, true), '"', '')), '\s+', ' ', 'g') = 'active'
      AND regexp_replace(lower(replace(pg_get_indexdef(idx.oid, 2, true), '"', '')), '\s+', ' ', 'g') LIKE 'created_at desc%'
  ) INTO compatible_index_exists;

  IF compatible_index_exists THEN
    RAISE NOTICE 'Se reutiliza idx_checklist_templates_active.';
  ELSIF to_regclass('public.idx_checklist_templates_active') IS NULL THEN
    CREATE INDEX idx_checklist_templates_active
      ON public.checklist_templates (active, created_at DESC);
  ELSE
    CREATE INDEX IF NOT EXISTS idx_ct_active_created_at
      ON public.checklist_templates (active, created_at DESC);
  END IF;
END
$$;

COMMIT;
