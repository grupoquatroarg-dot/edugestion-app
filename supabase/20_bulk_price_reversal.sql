BEGIN;

ALTER TABLE public.price_update_history
  ADD COLUMN IF NOT EXISTS reversion_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reverted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reverted_by text,
  ADD COLUMN IF NOT EXISTS revert_reason text,
  ADD COLUMN IF NOT EXISTS reverted_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.price_update_history
  DROP CONSTRAINT IF EXISTS price_update_history_revert_reason_check;

ALTER TABLE public.price_update_history
  ADD CONSTRAINT price_update_history_revert_reason_check
  CHECK (
    revert_reason IS NULL
    OR char_length(btrim(revert_reason)) BETWEEN 3 AND 500
  );

CREATE TABLE IF NOT EXISTS public.price_update_history_items (
  id bigserial PRIMARY KEY,
  price_update_history_id integer NOT NULL,
  product_id integer NOT NULL,
  previous_cost numeric NOT NULL,
  previous_sale_price numeric NOT NULL,
  new_cost numeric NOT NULL,
  new_sale_price numeric NOT NULL,
  reverted_at timestamp with time zone,
  CONSTRAINT price_update_items_history_fkey
    FOREIGN KEY (price_update_history_id)
    REFERENCES public.price_update_history(id)
    ON DELETE RESTRICT,
  CONSTRAINT price_update_items_product_fkey
    FOREIGN KEY (product_id)
    REFERENCES public.products(id)
    ON DELETE RESTRICT,
  CONSTRAINT price_update_items_unique_product
    UNIQUE (price_update_history_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_price_update_items_history
  ON public.price_update_history_items (price_update_history_id, product_id);

COMMIT;
