BEGIN;

CREATE TABLE IF NOT EXISTS public.auth_revoked_staff_tokens (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT auth_revoked_staff_tokens_hash_check CHECK (length(token_hash) = 64),
  CONSTRAINT auth_revoked_staff_tokens_expiry_check CHECK (expires_at > revoked_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_revoked_staff_tokens_user
  ON public.auth_revoked_staff_tokens (user_id, revoked_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_revoked_staff_tokens_cleanup
  ON public.auth_revoked_staff_tokens (expires_at);

DELETE FROM public.auth_revoked_staff_tokens
WHERE expires_at <= now();

COMMIT;
