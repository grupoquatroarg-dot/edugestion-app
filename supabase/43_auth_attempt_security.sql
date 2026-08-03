BEGIN;

CREATE TABLE IF NOT EXISTS public.auth_failed_login_attempts (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  identifier_hash char(64) NOT NULL,
  address_hash char(64) NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_failed_login_attempts_scope_check
    CHECK (scope IN ('staff', 'customer_portal')),
  CONSTRAINT auth_failed_login_attempts_identifier_hash_check
    CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_failed_login_attempts_address_hash_check
    CHECK (address_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_auth_failed_login_attempts_identifier
  ON public.auth_failed_login_attempts (scope, identifier_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_failed_login_attempts_address
  ON public.auth_failed_login_attempts (scope, address_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_failed_login_attempts_cleanup
  ON public.auth_failed_login_attempts (attempted_at);

COMMIT;
