BEGIN;

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_from_status text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by text,
  ADD COLUMN IF NOT EXISTS reopen_reason text;

CREATE TABLE IF NOT EXISTS public.route_status_history (
  id bigserial PRIMARY KEY,
  route_id integer NOT NULL,
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
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_status_history_route_id_fkey'
      AND conrelid = 'public.route_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_status_history
      ADD CONSTRAINT route_status_history_route_id_fkey
      FOREIGN KEY (route_id)
      REFERENCES public.routes(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_status_history_action_check'
      AND conrelid = 'public.route_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_status_history
      ADD CONSTRAINT route_status_history_action_check
      CHECK (action IN ('cancel', 'reopen'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_status_history_reason_check'
      AND conrelid = 'public.route_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_status_history
      ADD CONSTRAINT route_status_history_reason_check
      CHECK (char_length(trim(reason)) BETWEEN 3 AND 500);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_route_status_history_route
  ON public.route_status_history (route_id, performed_at DESC);

COMMIT;
