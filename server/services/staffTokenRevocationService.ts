import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { verifyToken } from "../utils/jwt.js";
import { hashAuthToken } from "../utils/tokenHash.js";
import { getBearerToken, validateStaffToken } from "./currentUserAuthService.js";

const getExpiry = (exp: unknown) => {
  const parsed = Number(exp);
  const expiresAt = Number.isFinite(parsed) && parsed > 0
    ? new Date(parsed * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  return expiresAt.getTime() > Date.now() ? expiresAt : null;
};

const revokePostgres = async (tokenHash: string, userId: number, expiresAt: Date) => {
  const pool = getPostgresPool();
  await pool.query("DELETE FROM auth_revoked_staff_tokens WHERE expires_at <= now()");
  await pool.query(
    `INSERT INTO auth_revoked_staff_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at`,
    [tokenHash, userId, expiresAt.toISOString()]
  );
};

const revokeSqlite = async (tokenHash: string, userId: number, expiresAt: Date) => {
  const { default: db } = await import("../db.js");
  db.transaction(() => {
    db.prepare("DELETE FROM auth_revoked_staff_tokens WHERE datetime(expires_at) <= CURRENT_TIMESTAMP").run();
    db.prepare(`
      INSERT INTO auth_revoked_staff_tokens (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET
        user_id = excluded.user_id,
        expires_at = excluded.expires_at
    `).run(tokenHash, userId, expiresAt.toISOString());
  })();
};

export const staffTokenRevocationService = {
  async revoke(token: string, expectedUserId?: number) {
    const decoded = verifyToken(token);
    const userId = Number(decoded?.userId);
    const expiresAt = getExpiry(decoded?.exp);

    if (!Number.isInteger(userId) || userId <= 0 || !expiresAt) return false;
    if (expectedUserId && userId !== expectedUserId) return false;

    const tokenHash = hashAuthToken(token);
    if (isPostgresConfigured()) await revokePostgres(tokenHash, userId, expiresAt);
    else await revokeSqlite(tokenHash, userId, expiresAt);
    return true;
  },

  async revokeBearerTokenIfValid(req: any) {
    const token = getBearerToken(req);
    if (!token) return false;

    const user = await validateStaffToken(token);
    if (!user) return false;

    return this.revoke(token, user.userId);
  },
};
