BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

UPDATE public.users
SET session_version = 1
WHERE session_version IS NULL OR session_version < 1;

CREATE TABLE IF NOT EXISTS public.user_status_history (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id),
  action text NOT NULL,
  reason text NOT NULL,
  performed_by_user_id integer REFERENCES public.users(id),
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
    WHERE conname = 'user_status_history_action_check'
  ) THEN
    ALTER TABLE public.user_status_history
      ADD CONSTRAINT user_status_history_action_check
      CHECK (action IN ('deactivate', 'reactivate'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_status_history_previous_status_check'
  ) THEN
    ALTER TABLE public.user_status_history
      ADD CONSTRAINT user_status_history_previous_status_check
      CHECK (previous_status IN ('active', 'inactive'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_status_history_new_status_check'
  ) THEN
    ALTER TABLE public.user_status_history
      ADD CONSTRAINT user_status_history_new_status_check
      CHECK (new_status IN ('active', 'inactive'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_users_active_role
  ON public.users (active, role);

CREATE INDEX IF NOT EXISTS idx_user_status_history_user
  ON public.user_status_history (user_id, performed_at DESC);

COMMIT;
