BEGIN;

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS finalization_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by text,
  ADD COLUMN IF NOT EXISTS finalization_reason text,
  ADD COLUMN IF NOT EXISTS finalized_from_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routes_finalization_version_check'
      AND conrelid = 'public.routes'::regclass
  ) THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_finalization_version_check
      CHECK (finalization_version IN (0, 1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routes_finalization_reason_check'
      AND conrelid = 'public.routes'::regclass
  ) THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_finalization_reason_check
      CHECK (finalization_reason IS NULL OR char_length(trim(finalization_reason)) BETWEEN 3 AND 500);
  END IF;
END
$$;

ALTER TABLE public.route_status_history
  DROP CONSTRAINT IF EXISTS route_status_history_action_check;

ALTER TABLE public.route_status_history
  ADD CONSTRAINT route_status_history_action_check
  CHECK (action IN ('finalize', 'cancel', 'reopen'));

COMMIT;
