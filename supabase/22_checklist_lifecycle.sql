BEGIN;

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_by text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_from_status text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by text,
  ADD COLUMN IF NOT EXISTS reopen_reason text;

UPDATE public.checklists
SET lifecycle_version = 1
WHERE lower(COALESCE(status, 'pendiente')) = 'pendiente'
  AND lifecycle_version = 0;

ALTER TABLE public.checklists
  DROP CONSTRAINT IF EXISTS checklists_lifecycle_version_check;
ALTER TABLE public.checklists
  ADD CONSTRAINT checklists_lifecycle_version_check
  CHECK (lifecycle_version IN (0, 1));

ALTER TABLE public.checklists
  DROP CONSTRAINT IF EXISTS checklists_cancel_reason_check;
ALTER TABLE public.checklists
  ADD CONSTRAINT checklists_cancel_reason_check
  CHECK (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 3 AND 500);

ALTER TABLE public.checklists
  DROP CONSTRAINT IF EXISTS checklists_reopen_reason_check;
ALTER TABLE public.checklists
  ADD CONSTRAINT checklists_reopen_reason_check
  CHECK (reopen_reason IS NULL OR char_length(btrim(reopen_reason)) BETWEEN 3 AND 500);

CREATE TABLE IF NOT EXISTS public.checklist_status_history (
  id bigserial PRIMARY KEY,
  checklist_id bigint NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  performed_by text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  previous_status text NOT NULL,
  new_status text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT checklist_status_history_checklist_fkey
    FOREIGN KEY (checklist_id) REFERENCES public.checklists(id),
  CONSTRAINT checklist_status_history_action_check
    CHECK (action IN ('finalize', 'cancel', 'reopen')),
  CONSTRAINT checklist_status_history_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_checklist_status_history_checklist
  ON public.checklist_status_history (checklist_id, performed_at DESC, id DESC);

COMMIT;
