BEGIN;

-- 1) Reparación idempotente del ciclo de vida de productos.
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

ALTER TABLE public.product_status_history
  ADD COLUMN IF NOT EXISTS product_id integer,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS performed_by text,
  ADD COLUMN IF NOT EXISTS performed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS previous_status text,
  ADD COLUMN IF NOT EXISTS new_status text,
  ADD COLUMN IF NOT EXISTS snapshot jsonb DEFAULT '{}'::jsonb;

UPDATE public.product_status_history
SET performed_at = COALESCE(performed_at, now()),
    snapshot = COALESCE(snapshot, '{}'::jsonb)
WHERE performed_at IS NULL OR snapshot IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_status_history_product_id_fkey'
      AND conrelid = 'public.product_status_history'::regclass
  ) THEN
    ALTER TABLE public.product_status_history
      ADD CONSTRAINT product_status_history_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_status_history_action_check'
      AND conrelid = 'public.product_status_history'::regclass
  ) THEN
    ALTER TABLE public.product_status_history
      ADD CONSTRAINT product_status_history_action_check
      CHECK (action IN ('deactivate', 'reactivate')) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_product_status_history_product_id
  ON public.product_status_history (product_id, performed_at DESC);

-- 2) Reparación idempotente del ciclo de vida de clientes.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

CREATE TABLE IF NOT EXISTS public.customer_status_history (
  id bigserial PRIMARY KEY,
  customer_id integer NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  performed_by text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  previous_status text NOT NULL,
  new_status text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.customer_status_history
  ADD COLUMN IF NOT EXISTS customer_id integer,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS performed_by text,
  ADD COLUMN IF NOT EXISTS performed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS previous_status text,
  ADD COLUMN IF NOT EXISTS new_status text,
  ADD COLUMN IF NOT EXISTS snapshot jsonb DEFAULT '{}'::jsonb;

UPDATE public.customer_status_history
SET performed_at = COALESCE(performed_at, now()),
    snapshot = COALESCE(snapshot, '{}'::jsonb)
WHERE performed_at IS NULL OR snapshot IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_status_history_customer_id_fkey'
      AND conrelid = 'public.customer_status_history'::regclass
  ) THEN
    ALTER TABLE public.customer_status_history
      ADD CONSTRAINT customer_status_history_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.clientes(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_status_history_action_check'
      AND conrelid = 'public.customer_status_history'::regclass
  ) THEN
    ALTER TABLE public.customer_status_history
      ADD CONSTRAINT customer_status_history_action_check
      CHECK (action IN ('deactivate', 'reactivate')) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_customer_status_history_customer_id
  ON public.customer_status_history (customer_id, performed_at DESC);

-- 3) Unificación del esquema que utiliza el registro de ventas.
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS costo_total_peps numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precio_unitario_original numeric,
  ADD COLUMN IF NOT EXISTS bonificacion_tipo text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS bonificacion_valor numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precio_unitario_bonificado numeric;

UPDATE public.sale_items
SET costo_total_peps = COALESCE(costo_total_peps, 0),
    precio_unitario_original = COALESCE(precio_unitario_original, precio_venta, 0),
    bonificacion_tipo = CASE
      WHEN bonificacion_tipo IN ('none', 'percentage', 'fixed') THEN bonificacion_tipo
      ELSE 'none'
    END,
    bonificacion_valor = GREATEST(COALESCE(bonificacion_valor, 0), 0),
    precio_unitario_bonificado = COALESCE(precio_unitario_bonificado, precio_venta, 0);

ALTER TABLE public.sale_items
  ALTER COLUMN costo_total_peps SET DEFAULT 0,
  ALTER COLUMN costo_total_peps SET NOT NULL,
  ALTER COLUMN precio_unitario_original SET NOT NULL,
  ALTER COLUMN bonificacion_tipo SET DEFAULT 'none',
  ALTER COLUMN bonificacion_tipo SET NOT NULL,
  ALTER COLUMN bonificacion_valor SET DEFAULT 0,
  ALTER COLUMN bonificacion_valor SET NOT NULL,
  ALTER COLUMN precio_unitario_bonificado SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sale_items_bonificacion_tipo_check'
      AND conrelid = 'public.sale_items'::regclass
  ) THEN
    ALTER TABLE public.sale_items
      ADD CONSTRAINT sale_items_bonificacion_tipo_check
      CHECK (bonificacion_tipo IN ('none', 'percentage', 'fixed')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sale_items_bonificacion_valor_check'
      AND conrelid = 'public.sale_items'::regclass
  ) THEN
    ALTER TABLE public.sale_items
      ADD CONSTRAINT sale_items_bonificacion_valor_check
      CHECK (bonificacion_valor >= 0) NOT VALID;
  END IF;
END
$$;

-- 4) Los pedidos manuales o generales deben poder crearse sin asociar un cliente real.
ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS cliente text,
  ADD COLUMN IF NOT EXISTS cliente_id integer,
  ADD COLUMN IF NOT EXISTS notes text;

UPDATE public.supplier_orders
SET cliente = 'Pedido a proveedor'
WHERE NULLIF(btrim(cliente), '') IS NULL;

ALTER TABLE public.supplier_orders
  ALTER COLUMN cliente SET DEFAULT 'Pedido a proveedor',
  ALTER COLUMN cliente SET NOT NULL;

COMMIT;
