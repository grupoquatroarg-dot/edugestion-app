BEGIN;

ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

ALTER TABLE public.product_families
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

CREATE TABLE IF NOT EXISTS public.configuration_item_status_history (
  id bigserial PRIMARY KEY,
  item_type text NOT NULL,
  item_id integer NOT NULL,
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
    WHERE conname = 'configuration_item_status_history_item_type_check'
  ) THEN
    ALTER TABLE public.configuration_item_status_history
      ADD CONSTRAINT configuration_item_status_history_item_type_check
      CHECK (item_type IN ('payment_method', 'product_category', 'product_family'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configuration_item_status_history_action_check'
  ) THEN
    ALTER TABLE public.configuration_item_status_history
      ADD CONSTRAINT configuration_item_status_history_action_check
      CHECK (action IN ('deactivate', 'reactivate'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_configuration_item_status_history_item
  ON public.configuration_item_status_history (item_type, item_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_methods_activo
  ON public.payment_methods (activo, name);

CREATE INDEX IF NOT EXISTS idx_product_categories_estado
  ON public.product_categories (estado, name);

CREATE INDEX IF NOT EXISTS idx_product_families_estado
  ON public.product_families (estado, name);

UPDATE public.payment_methods SET activo = 1 WHERE activo IS NULL;
UPDATE public.product_categories SET estado = 'activo' WHERE estado IS NULL OR btrim(estado) = '';
UPDATE public.product_families SET estado = 'activo' WHERE estado IS NULL OR btrim(estado) = '';

COMMIT;
