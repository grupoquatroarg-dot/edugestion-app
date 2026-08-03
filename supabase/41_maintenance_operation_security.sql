BEGIN;

CREATE TABLE IF NOT EXISTS public.maintenance_operation_history (
  id bigserial PRIMARY KEY,
  operation text NOT NULL,
  reason text NOT NULL,
  performed_by_user_id integer NOT NULL,
  performed_by text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  affected_tables integer NOT NULL DEFAULT 0,
  affected_rows bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT maintenance_operation_history_user_fkey
    FOREIGN KEY (performed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_operation_history_operation_check
    CHECK (operation IN ('backup', 'restore', 'reset')),
  CONSTRAINT maintenance_operation_history_reason_check
    CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT maintenance_operation_history_actor_check
    CHECK (char_length(trim(performed_by)) BETWEEN 1 AND 250),
  CONSTRAINT maintenance_operation_history_affected_tables_check
    CHECK (affected_tables >= 0),
  CONSTRAINT maintenance_operation_history_affected_rows_check
    CHECK (affected_rows >= 0),
  CONSTRAINT maintenance_operation_history_details_check
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_maintenance_operation_history_performed_at
  ON public.maintenance_operation_history (performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_operation_history_actor
  ON public.maintenance_operation_history (performed_by_user_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_operation_history_operation
  ON public.maintenance_operation_history (operation, performed_at DESC);

COMMIT;
