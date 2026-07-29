BEGIN;

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS operational_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS operational_last_action text,
  ADD COLUMN IF NOT EXISTS operational_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS operational_changed_by text,
  ADD COLUMN IF NOT EXISTS operational_reason text,
  ADD COLUMN IF NOT EXISTS operational_from_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routes_operational_version_check'
      AND conrelid = 'public.routes'::regclass
  ) THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_operational_version_check
      CHECK (operational_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routes_operational_last_action_check'
      AND conrelid = 'public.routes'::regclass
  ) THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_operational_last_action_check
      CHECK (operational_last_action IS NULL OR operational_last_action IN ('start', 'reopen'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routes_operational_reason_check'
      AND conrelid = 'public.routes'::regclass
  ) THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_operational_reason_check
      CHECK (operational_reason IS NULL OR char_length(trim(operational_reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routes_operational_from_status_check'
      AND conrelid = 'public.routes'::regclass
  ) THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_operational_from_status_check
      CHECK (operational_from_status IS NULL OR operational_from_status IN ('planificada', 'pendiente'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.route_operational_status_history (
  id bigserial PRIMARY KEY,
  route_id integer NOT NULL,
  version integer NOT NULL,
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
    WHERE conname = 'route_operational_status_history_route_id_fkey'
      AND conrelid = 'public.route_operational_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_operational_status_history
      ADD CONSTRAINT route_operational_status_history_route_id_fkey
      FOREIGN KEY (route_id)
      REFERENCES public.routes(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_operational_status_history_version_check'
      AND conrelid = 'public.route_operational_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_operational_status_history
      ADD CONSTRAINT route_operational_status_history_version_check
      CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_operational_status_history_action_check'
      AND conrelid = 'public.route_operational_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_operational_status_history
      ADD CONSTRAINT route_operational_status_history_action_check
      CHECK (action IN ('start', 'reopen'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_operational_status_history_reason_check'
      AND conrelid = 'public.route_operational_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_operational_status_history
      ADD CONSTRAINT route_operational_status_history_reason_check
      CHECK (char_length(trim(reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_operational_status_history_transition_check'
      AND conrelid = 'public.route_operational_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_operational_status_history
      ADD CONSTRAINT route_operational_status_history_transition_check
      CHECK (
        (action = 'start' AND previous_status IN ('planificada', 'pendiente') AND new_status = 'en curso')
        OR
        (action = 'reopen' AND previous_status = 'en curso' AND new_status IN ('planificada', 'pendiente'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_operational_status_history_snapshot_check'
      AND conrelid = 'public.route_operational_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_operational_status_history
      ADD CONSTRAINT route_operational_status_history_snapshot_check
      CHECK (jsonb_typeof(snapshot) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_operational_status_history_unique_version'
      AND conrelid = 'public.route_operational_status_history'::regclass
  ) THEN
    ALTER TABLE public.route_operational_status_history
      ADD CONSTRAINT route_operational_status_history_unique_version
      UNIQUE (route_id, version);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_route_operational_history_route
  ON public.route_operational_status_history (route_id, performed_at DESC, id DESC);

COMMIT;
