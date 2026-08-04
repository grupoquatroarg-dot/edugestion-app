BEGIN;

-- Cada cambio de acceso del portal incrementa esta versión. Los tokens emitidos
-- con una versión anterior quedan revocados de inmediato.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS portal_session_version integer;

UPDATE public.clientes
SET portal_session_version = 1
WHERE portal_session_version IS NULL OR portal_session_version < 1;

ALTER TABLE public.clientes
  ALTER COLUMN portal_session_version SET DEFAULT 1,
  ALTER COLUMN portal_session_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clientes_portal_session_version_check'
      AND conrelid = 'public.clientes'::regclass
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_portal_session_version_check
      CHECK (portal_session_version > 0);
  END IF;
END
$$;

COMMIT;
