BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

CREATE TABLE IF NOT EXISTS public.product_status_history (
  id bigserial PRIMARY KEY,
  product_id integer NOT NULL,
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
    WHERE conname = 'product_status_history_product_id_fkey'
  ) THEN
    ALTER TABLE public.product_status_history
      ADD CONSTRAINT product_status_history_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_status_history_action_check'
  ) THEN
    ALTER TABLE public.product_status_history
      ADD CONSTRAINT product_status_history_action_check
      CHECK (action IN ('deactivate', 'reactivate'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_product_status_history_product_id
  ON public.product_status_history (product_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_estado_visible
  ON public.products (estado, eliminado);

UPDATE public.products
SET active = CASE WHEN estado = 'activo' THEN 1 ELSE 0 END
WHERE eliminado = 0
  AND COALESCE(active, -1) <> CASE WHEN estado = 'activo' THEN 1 ELSE 0 END;

COMMIT;
