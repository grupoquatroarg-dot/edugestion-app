BEGIN;

ALTER TABLE public.route_items
  ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by text,
  ADD COLUMN IF NOT EXISTS status_changed_from text,
  ADD COLUMN IF NOT EXISTS status_last_action text,
  ADD COLUMN IF NOT EXISTS status_last_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_items_lifecycle_version_check'
      AND conrelid = 'public.route_items'::regclass
  ) THEN
    ALTER TABLE public.route_items
      ADD CONSTRAINT route_items_lifecycle_version_check
      CHECK (lifecycle_version >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_items_status_last_action_check'
      AND conrelid = 'public.route_items'::regclass
  ) THEN
    ALTER TABLE public.route_items
      ADD CONSTRAINT route_items_status_last_action_check
      CHECK (status_last_action IS NULL OR status_last_action IN ('visit', 'omit', 'reopen'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_items_status_last_reason_check'
      AND conrelid = 'public.route_items'::regclass
  ) THEN
    ALTER TABLE public.route_items
      ADD CONSTRAINT route_items_status_last_reason_check
      CHECK (status_last_reason IS NULL OR char_length(btrim(status_last_reason)) BETWEEN 3 AND 500);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.route_item_status_history (
  id bigserial PRIMARY KEY,
  route_item_id integer NOT NULL,
  route_id integer NOT NULL,
  version integer NOT NULL,
  action text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT route_item_status_history_item_fkey
    FOREIGN KEY (route_item_id) REFERENCES public.route_items(id),
  CONSTRAINT route_item_status_history_route_fkey
    FOREIGN KEY (route_id) REFERENCES public.routes(id),
  CONSTRAINT route_item_status_history_version_check
    CHECK (version > 0),
  CONSTRAINT route_item_status_history_action_check
    CHECK (action IN ('visit', 'omit', 'reopen')),
  CONSTRAINT route_item_status_history_transition_check
    CHECK (
      (action = 'visit' AND from_status = 'pendiente' AND to_status = 'visitado')
      OR (action = 'omit' AND from_status = 'pendiente' AND to_status = 'omitido')
      OR (action = 'reopen' AND from_status IN ('visitado', 'omitido') AND to_status = 'pendiente')
    ),
  CONSTRAINT route_item_status_history_reason_check
    CHECK (
      (action <> 'reopen' AND reason IS NULL)
      OR (action = 'reopen' AND reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 3 AND 500)
    ),
  CONSTRAINT route_item_status_history_snapshot_check
    CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS route_item_status_history_unique_version
  ON public.route_item_status_history (route_item_id, version);

CREATE INDEX IF NOT EXISTS idx_route_item_status_history_item
  ON public.route_item_status_history (route_item_id, changed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_route_item_status_history_route
  ON public.route_item_status_history (route_id, changed_at DESC, id DESC);

COMMIT;
