import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { verifyToken, type TokenPayload } from "../utils/jwt.js";
import { sendError } from "../utils/response.js";

export type CurrentUserAuth = Required<Pick<TokenPayload, "userId" | "role" | "userName" | "sessionVersion">>;

type CurrentUserRecord = {
  id: number;
  name: string;
  role: string;
  active: number | boolean;
  session_version: number;
};

export const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

const toSessionVersion = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const findCurrentUserById = async (userId: number): Promise<CurrentUserRecord | null> => {
  if (isPostgresConfigured()) {
    const pool = getPostgresPool();
    const result = await pool.query(
      `SELECT id, name, role, active, session_version
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    return (result.rows[0] as CurrentUserRecord | undefined) ?? null;
  }

  // SQLite solo se carga en el servidor local cuando realmente se necesita.
  // Así las auditorías y funciones Vercel que usan PostgreSQL no inicializan
  // innecesariamente el módulo nativo better-sqlite3.
  const { UserRepository } = await import("../repositories/userRepository.js");
  return (await UserRepository.findById(userId)) as CurrentUserRecord | null;
};

export const validateStaffToken = async (token: string | null | undefined): Promise<CurrentUserAuth | null> => {
  if (!token) return null;

  const decoded = verifyToken(token);
  if (!decoded?.userId) return null;

  const tokenSessionVersion = toSessionVersion(decoded.sessionVersion);
  if (!tokenSessionVersion) return null;

  const user = await findCurrentUserById(Number(decoded.userId));
  if (!user || Number(user.active ?? 0) !== 1) return null;

  const currentSessionVersion = toSessionVersion(user.session_version);
  if (!currentSessionVersion || currentSessionVersion !== tokenSessionVersion) return null;

  return {
    userId: Number(user.id),
    role: String(user.role),
    userName: String(user.name),
    sessionVersion: currentSessionVersion,
  };
};

export const validateStaffSession = async (
  userId: unknown,
  sessionVersion: unknown
): Promise<CurrentUserAuth | null> => {
  const normalizedUserId = Number(userId);
  const normalizedVersion = toSessionVersion(sessionVersion);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedVersion) return null;

  const user = await findCurrentUserById(normalizedUserId);
  if (!user || Number(user.active ?? 0) !== 1) return null;

  const currentSessionVersion = toSessionVersion(user.session_version);
  if (!currentSessionVersion || currentSessionVersion !== normalizedVersion) return null;

  return {
    userId: Number(user.id),
    role: String(user.role),
    userName: String(user.name),
    sessionVersion: currentSessionVersion,
  };
};

export const requireBearerUser = async (req: any, res: any): Promise<CurrentUserAuth | null> => {
  const user = await validateStaffToken(getBearerToken(req));
  if (!user) {
    sendError(res, "Sesión inválida o vencida. Iniciá sesión nuevamente.", 401);
    return null;
  }
  return user;
};
