BEGIN;

ALTER TABLE public.maintenance_operation_history
  ADD COLUMN IF NOT EXISTS artifact_schema_version integer,
  ADD COLUMN IF NOT EXISTS artifact_checksum_sha256 text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_operation_history_schema_version_check'
  ) THEN
    ALTER TABLE public.maintenance_operation_history
      ADD CONSTRAINT maintenance_operation_history_schema_version_check
      CHECK (artifact_schema_version IS NULL OR artifact_schema_version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_operation_history_checksum_check'
  ) THEN
    ALTER TABLE public.maintenance_operation_history
      ADD CONSTRAINT maintenance_operation_history_checksum_check
      CHECK (
        artifact_checksum_sha256 IS NULL
        OR artifact_checksum_sha256 ~ '^[a-f0-9]{64}$'
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_maintenance_operation_history_checksum
  ON public.maintenance_operation_history (artifact_checksum_sha256)
  WHERE artifact_checksum_sha256 IS NOT NULL;

COMMIT;
