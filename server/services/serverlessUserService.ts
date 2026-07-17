import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";

const toBool = (value: unknown) => value === true || value === 1 || value === "1";

const mapUser = (row: any, includePassword = false) => {
  if (!row) return null;

  const user: Record<string, any> = {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    avatar: row.avatar,
    active: Number(row.active ?? 1),
    created_at: row.created_at,
    session_version: Number(row.session_version ?? 1),
    deactivated_at: row.deactivated_at ?? null,
    deactivated_by: row.deactivated_by ?? null,
    deactivation_reason: row.deactivation_reason ?? null,
  };

  if (includePassword) {
    user.password = row.password;
  }

  return user;
};

const mapPermissions = (rows: any[] = []) => {
  return rows.reduce((acc, permission) => {
    acc[permission.module] = {
      module: permission.module,
      can_view: toBool(permission.can_view),
      can_create: toBool(permission.can_create),
      can_edit: toBool(permission.can_edit),
      can_delete: toBool(permission.can_delete),
    };
    return acc;
  }, {} as Record<string, any>);
};

const getLocalRepository = async () => {
  // SQLite se importa solo en desarrollo local. De esta manera las funciones
  // serverless que usan PostgreSQL no cargan el binario nativo better-sqlite3.
  const { UserRepository } = await import("../repositories/userRepository.js");
  return UserRepository;
};

export const serverlessUserService = {
  async findActiveByEmail(email: string) {
    if (!isPostgresConfigured()) {
      const repository = await getLocalRepository();
      return repository.findByEmail(email);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `SELECT id, name, email, password, role, avatar, active, created_at,
              session_version, deactivated_at, deactivated_by, deactivation_reason
       FROM users
       WHERE email = $1 AND active = 1
       LIMIT 1`,
      [email]
    );

    return mapUser(result.rows[0], true);
  },

  async findById(userId: number) {
    if (!isPostgresConfigured()) {
      const repository = await getLocalRepository();
      return repository.findById(userId);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `SELECT id, name, email, role, avatar, active, created_at,
              session_version, deactivated_at, deactivated_by, deactivation_reason
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    return mapUser(result.rows[0]);
  },

  async getPermissions(userId: number) {
    if (!isPostgresConfigured()) {
      const repository = await getLocalRepository();
      return repository.getPermissions(userId);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `SELECT module, can_view, can_create, can_edit, can_delete
       FROM user_permissions
       WHERE user_id = $1`,
      [userId]
    );

    return mapPermissions(result.rows);
  },
};
