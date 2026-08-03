import db from "../db.js";
import bcrypt from "bcryptjs";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

const toBool = (value: any) => value === true || value === 1 || value === '1';

const normalizePassword = (value: any) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildAvatar = (name: string) => {
  return (name || "US").trim().substring(0, 2).toUpperCase() || "US";
};

const mapUser = (row: any) => {
  if (!row) return null;

  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role,
    avatar: row.avatar,
    active: Number(row.active ?? 1),
    created_at: row.created_at,
    session_version: Number(row.session_version ?? 1),
    permissions_version: Number(row.permissions_version ?? 0),
    permissions_changed_at: row.permissions_changed_at ?? null,
    permissions_changed_by: row.permissions_changed_by ?? null,
    permissions_change_reason: row.permissions_change_reason ?? null,
    deactivated_at: row.deactivated_at ?? null,
    deactivated_by: row.deactivated_by ?? null,
    deactivation_reason: row.deactivation_reason ?? null,
    content_version: Number(row.content_version ?? 0),
    content_changed_at: row.content_changed_at ?? null,
    content_changed_by: row.content_changed_by ?? null,
    content_change_reason: row.content_change_reason ?? null,
  };
};

const mapUserWithoutPassword = (row: any) => {
  const mapped = mapUser(row);
  if (!mapped) return null;
  const { password: _password, ...withoutPassword } = mapped;
  return withoutPassword;
};

const mapPermissions = (rows: any[] = []) => {
  return rows.reduce((acc, p) => {
    acc[p.module] = {
      module: p.module,
      can_view: toBool(p.can_view),
      can_create: toBool(p.can_create),
      can_edit: toBool(p.can_edit),
      can_delete: toBool(p.can_delete),
    };
    return acc;
  }, {} as Record<string, any>);
};

const assertRoleChangeAllowedSqlite = (existingUser: any, nextRole: string, actorUserId?: number) => {
  if (actorUserId && Number(existingUser.id) === actorUserId && existingUser.role !== nextRole) {
    throw new AppError("No podés cambiar tu propio rol", 409);
  }

  if (
    existingUser.role === "administrador" &&
    nextRole !== "administrador" &&
    Number(existingUser.active ?? 0) === 1
  ) {
    const row = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'administrador' AND active = 1").get() as any;
    if (Number(row?.total || 0) <= 1) {
      throw new AppError("Debe quedar al menos un administrador activo", 409);
    }
  }
};

const assertRoleChangeAllowedPostgres = async (
  client: any,
  existingUser: any,
  nextRole: string,
  actorUserId?: number
) => {
  if (actorUserId && Number(existingUser.id) === actorUserId && existingUser.role !== nextRole) {
    throw new AppError("No podés cambiar tu propio rol", 409);
  }

  if (
    existingUser.role === "administrador" &&
    nextRole !== "administrador" &&
    Number(existingUser.active ?? 0) === 1
  ) {
    await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
    const result = await client.query(
      "SELECT COUNT(*)::int AS total FROM users WHERE role = 'administrador' AND active = 1"
    );
    if (Number(result.rows[0]?.total || 0) <= 1) {
      throw new AppError("Debe quedar al menos un administrador activo", 409);
    }
  }
};

export const UserRepository = {
  async findByEmail(email: string) {
    if (!isPostgresConfigured()) {
      return mapUser(db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email));
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND active = 1 LIMIT 1",
      [email]
    );

    return mapUser(result.rows[0]);
  },

  async findById(id: number) {
    if (!isPostgresConfigured()) {
      return mapUserWithoutPassword(db.prepare(`
        SELECT id, name, email, role, avatar, active, created_at, session_version, permissions_version,
               permissions_changed_at, permissions_changed_by, permissions_change_reason,
               deactivated_at, deactivated_by, deactivation_reason,
               content_version, content_changed_at, content_changed_by, content_change_reason
        FROM users WHERE id = ? LIMIT 1
      `).get(id));
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `SELECT id, name, email, role, avatar, active, created_at, session_version, permissions_version,
              permissions_changed_at, permissions_changed_by, permissions_change_reason,
              deactivated_at, deactivated_by, deactivation_reason,
              content_version, content_changed_at, content_changed_by, content_change_reason
       FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );

    return mapUserWithoutPassword(result.rows[0]);
  },

  async findAll() {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT id, name, email, role, avatar, active, created_at, session_version, permissions_version,
               permissions_changed_at, permissions_changed_by, permissions_change_reason,
               deactivated_at, deactivated_by, deactivation_reason,
               content_version, content_changed_at, content_changed_by, content_change_reason
        FROM users ORDER BY name ASC
      `).all().map(mapUserWithoutPassword);
    }

    const pool = getPostgresPool();
    const result = await pool.query(`
      SELECT id, name, email, role, avatar, active, created_at, session_version, permissions_version,
             permissions_changed_at, permissions_changed_by, permissions_change_reason,
             deactivated_at, deactivated_by, deactivation_reason,
             content_version, content_changed_at, content_changed_by, content_change_reason
      FROM users ORDER BY name ASC
    `);

    return result.rows.map(mapUserWithoutPassword);
  },

  async create(userData: any) {
    const { name, email, password, role, avatar } = userData;
    const normalizedPassword = normalizePassword(password);

    if (!normalizedPassword) {
      throw new AppError("La contraseña es obligatoria", 400);
    }

    const hashedPassword = bcrypt.hashSync(normalizedPassword, 10);
    const finalAvatar = avatar || buildAvatar(name);

    if (!isPostgresConfigured()) {
      const info = db.prepare(`
        INSERT INTO users (name, email, password, role, avatar, active, session_version)
        VALUES (?, ?, ?, ?, ?, 1, 1)
      `).run(name, email, hashedPassword, role, finalAvatar);
      return this.findById(Number(info.lastInsertRowid));
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, avatar, active, session_version)
       VALUES ($1, $2, $3, $4, $5, 1, 1)
       RETURNING id, name, email, role, avatar, active, created_at, session_version, permissions_version,
                 permissions_changed_at, permissions_changed_by, permissions_change_reason,
                 deactivated_at, deactivated_by, deactivation_reason,
                 content_version, content_changed_at, content_changed_by, content_change_reason`,
      [name, email, hashedPassword, role, finalAvatar]
    );

    return mapUserWithoutPassword(result.rows[0]);
  },

  async update(_id: number, _userData: any, _actorUserId?: number) {
    throw new AppError(
      "La actualización directa de usuarios está deshabilitada. Usá el servicio auditado de contenido.",
      405
    );
  },

  async getPermissions(userId: number) {
    if (!isPostgresConfigured()) {
      const perms = db.prepare("SELECT * FROM user_permissions WHERE user_id = ?").all(userId) as any[];
      return mapPermissions(perms);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      "SELECT * FROM user_permissions WHERE user_id = $1",
      [userId]
    );

    return mapPermissions(result.rows);
  },

  async updatePermissions(_userId: number, _permissions: any) {
    throw new AppError(
      "La actualización directa de permisos está deshabilitada. Usá el servicio auditado de permisos.",
      405
    );

  }
};
