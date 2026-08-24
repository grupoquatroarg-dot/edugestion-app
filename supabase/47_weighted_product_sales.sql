BEGIN;

-- Un producto normal conserva exactamente el comportamiento histórico:
-- una unidad de stock, una unidad vendida y precio por una unidad.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS quantity_mode text NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS measurement_unit text NOT NULL DEFAULT 'unidad',
  ADD COLUMN IF NOT EXISTS price_reference_quantity numeric NOT NULL DEFAULT 1;

UPDATE public.products
SET quantity_mode = CASE WHEN quantity_mode = 'measure' THEN 'measure' ELSE 'unit' END,
    measurement_unit = CASE
      WHEN measurement_unit IN ('unidad', 'kg', 'g', 'l', 'ml', 'm') THEN measurement_unit
      ELSE 'unidad'
    END,
    price_reference_quantity = CASE
      WHEN COALESCE(price_reference_quantity, 0) > 0 THEN price_reference_quantity
      ELSE 1
    END;

ALTER TABLE public.products
  ALTER COLUMN stock TYPE numeric USING stock::numeric,
  ALTER COLUMN stock_minimo TYPE numeric USING stock_minimo::numeric,
  ALTER COLUMN price_reference_quantity TYPE numeric USING price_reference_quantity::numeric,
  ALTER COLUMN quantity_mode SET DEFAULT 'unit',
  ALTER COLUMN quantity_mode SET NOT NULL,
  ALTER COLUMN measurement_unit SET DEFAULT 'unidad',
  ALTER COLUMN measurement_unit SET NOT NULL,
  ALTER COLUMN price_reference_quantity SET DEFAULT 1,
  ALTER COLUMN price_reference_quantity SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_quantity_mode_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_quantity_mode_check
      CHECK (quantity_mode IN ('unit', 'measure')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_measurement_unit_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_measurement_unit_check
      CHECK (measurement_unit IN ('unidad', 'kg', 'g', 'l', 'ml', 'm')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_price_reference_quantity_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_price_reference_quantity_check
      CHECK (price_reference_quantity > 0) NOT VALID;
  END IF;
END
$$;

-- La unidad se guarda también en la línea de venta. De esa forma un comprobante
-- histórico no cambia si luego se edita la configuración del producto.
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS quantity_mode text NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS measurement_unit text NOT NULL DEFAULT 'unidad',
  ADD COLUMN IF NOT EXISTS price_reference_quantity numeric NOT NULL DEFAULT 1;

UPDATE public.sale_items
SET quantity_mode = CASE WHEN quantity_mode = 'measure' THEN 'measure' ELSE 'unit' END,
    measurement_unit = CASE
      WHEN measurement_unit IN ('unidad', 'kg', 'g', 'l', 'ml', 'm') THEN measurement_unit
      ELSE 'unidad'
    END,
    price_reference_quantity = CASE
      WHEN COALESCE(price_reference_quantity, 0) > 0 THEN price_reference_quantity
      ELSE 1
    END;

ALTER TABLE public.sale_items
  ALTER COLUMN cantidad TYPE numeric USING cantidad::numeric,
  ALTER COLUMN price_reference_quantity TYPE numeric USING price_reference_quantity::numeric,
  ALTER COLUMN quantity_mode SET DEFAULT 'unit',
  ALTER COLUMN quantity_mode SET NOT NULL,
  ALTER COLUMN measurement_unit SET DEFAULT 'unidad',
  ALTER COLUMN measurement_unit SET NOT NULL,
  ALTER COLUMN price_reference_quantity SET DEFAULT 1,
  ALTER COLUMN price_reference_quantity SET NOT NULL;

-- El mismo decimal debe sobrevivir en todo el circuito de stock y PEPS.
ALTER TABLE public.stock_movimientos
  ALTER COLUMN cantidad TYPE numeric USING cantidad::numeric,
  ALTER COLUMN cantidad_restante TYPE numeric USING cantidad_restante::numeric;

ALTER TABLE public.purchase_invoice_items
  ALTER COLUMN cantidad TYPE numeric USING cantidad::numeric,
  ALTER COLUMN cantidad_restante TYPE numeric USING cantidad_restante::numeric;

ALTER TABLE public.supplier_order_items
  ALTER COLUMN cantidad TYPE numeric USING cantidad::numeric;

DO $$
BEGIN
  IF to_regclass('public.customer_order_items') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.customer_order_items ALTER COLUMN cantidad TYPE numeric USING cantidad::numeric';
  END IF;
END
$$;

COMMIT;
