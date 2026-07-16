BEGIN;

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

CREATE TABLE IF NOT EXISTS public.provider_status_history (
  id bigserial PRIMARY KEY,
  provider_id integer NOT NULL,
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
    WHERE conname = 'provider_status_history_provider_id_fkey'
  ) THEN
    ALTER TABLE public.provider_status_history
      ADD CONSTRAINT provider_status_history_provider_id_fkey
      FOREIGN KEY (provider_id) REFERENCES public.proveedores(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_status_history_action_check'
  ) THEN
    ALTER TABLE public.provider_status_history
      ADD CONSTRAINT provider_status_history_action_check
      CHECK (action IN ('deactivate', 'reactivate'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_provider_status_history_provider_id
  ON public.provider_status_history (provider_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_proveedores_estado
  ON public.proveedores (estado, nombre);

UPDATE public.proveedores
SET estado = 'activo'
WHERE estado IS NULL OR btrim(estado) = '';

COMMIT;
