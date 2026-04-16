import db from "../db.js";
import bcrypt from "bcryptjs";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

const toBool = (value: any) => value === true || value === 1 || value === '1';

const normalizeActive = (value: any, fallback: number = 1) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

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
  };
};

const mapUserWithoutPassword = (row: any) => {
  if (!row) return null;

  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    avatar: row.avatar,
    active: Number(row.active ?? 1),
    created_at: row.created_at,
  };
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

export const UserRepository = {
  async findByEmail(email: string) {
    if (!isPostgresConfigured()) {
      return db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email);
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
      return db.prepare("SELECT id, name, email, role, avatar, active, created_at FROM users WHERE id = ?").get(id);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      "SELECT id, name, email, role, avatar, active, created_at FROM users WHERE id = $1 LIMIT 1",
      [id]
    );

    return mapUserWithoutPassword(result.rows[0]);
  },

  async findAll() {
    if (!isPostgresConfigured()) {
      return db.prepare("SELECT id, name, email, role, avatar, active, created_at FROM users ORDER BY name ASC").all();
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      "SELECT id, name, email, role, avatar, active, created_at FROM users ORDER BY name ASC"
    );

    return result.rows.map(mapUserWithoutPassword);
  },

  async create(userData: any) {
    const { name, email, password, role, avatar, active } = userData;
    const normalizedPassword = normalizePassword(password);

    if (!normalizedPassword) {
      throw new AppError("La contraseña es obligatoria", 400);
    }

    const hashedPassword = bcrypt.hashSync(normalizedPassword, 10);
    const finalAvatar = avatar || buildAvatar(name);
    const finalActive = normalizeActive(active, 1);

    if (!isPostgresConfigured()) {
      const info = db.prepare("INSERT INTO users (name, email, password, role, avatar, active) VALUES (?, ?, ?, ?, ?, ?)").run(
        name,
        email,
        hashedPassword,
        role,
        finalAvatar,
        finalActive
      );
      return this.findById(Number(info.lastInsertRowid));
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, avatar, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, avatar, active, created_at`,
      [name, email, hashedPassword, role, finalAvatar, finalActive]
    );

    return mapUserWithoutPassword(result.rows[0]);
  },

  async update(id: number, userData: any) {
    const existingUser = await this.findById(id);

    if (!existingUser) {
      throw new AppError("Usuario no encontrado", 404);
    }

    const finalName = userData.name ?? existingUser.name;
    const finalEmail = userData.email ?? existingUser.email;
    const finalRole = userData.role ?? existingUser.role;
    const finalActive = normalizeActive(userData.active, Number(existingUser.active ?? 1));
    const finalAvatar = userData.avatar ?? existingUser.avatar ?? buildAvatar(finalName);
    const normalizedPassword = normalizePassword(userData.password);

    if (!isPostgresConfigured()) {
      if (normalizedPassword) {
        const hashedPassword = bcrypt.hashSync(normalizedPassword, 10);
        db.prepare(
          "UPDATE users SET name = ?, email = ?, role = ?, avatar = ?, active = ?, password = ? WHERE id = ?"
        ).run(finalName, finalEmail, finalRole, finalAvatar, finalActive, hashedPassword, id);
      } else {
        db.prepare(
          "UPDATE users SET name = ?, email = ?, role = ?, avatar = ?, active = ? WHERE id = ?"
        ).run(finalName, finalEmail, finalRole, finalAvatar, finalActive, id);
      }
      return this.findById(id);
    }

    const pool = getPostgresPool();

    if (normalizedPassword) {
      const hashedPassword = bcrypt.hashSync(normalizedPassword, 10);
      const result = await pool.query(
        `UPDATE users
         SET name = $1, email = $2, role = $3, avatar = $4, active = $5, password = $6
         WHERE id = $7
         RETURNING id, name, email, role, avatar, active, created_at`,
        [finalName, finalEmail, finalRole, finalAvatar, finalActive, hashedPassword, id]
      );

      if (result.rowCount === 0) {
        throw new AppError("Usuario no encontrado", 404);
      }

      return mapUserWithoutPassword(result.rows[0]);
    }

    const result = await pool.query(
      `UPDATE users
       SET name = $1, email = $2, role = $3, avatar = $4, active = $5
       WHERE id = $6
       RETURNING id, name, email, role, avatar, active, created_at`,
      [finalName, finalEmail, finalRole, finalAvatar, finalActive, id]
    );

    if (result.rowCount === 0) {
      throw new AppError("Usuario no encontrado", 404);
    }

    return mapUserWithoutPassword(result.rows[0]);
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

  async updatePermissions(userId: number, permissions: any) {
    if (!isPostgresConfigured()) {
      const deleteOld = db.prepare("DELETE FROM user_permissions WHERE user_id = ?");
      const insertNew = db.prepare("INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)");

      db.transaction(() => {
        deleteOld.run(userId);
        Object.values(permissions).forEach((p: any) => {
          insertNew.run(userId, p.module, p.can_view ? 1 : 0, p.can_create ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0);
        });
      })();
      return;
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM user_permissions WHERE user_id = $1", [userId]);

      for (const p of Object.values(permissions) as any[]) {
        await client.query(
          `INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            p.module,
            p.can_view ? 1 : 0,
            p.can_create ? 1 : 0,
            p.can_edit ? 1 : 0,
            p.can_delete ? 1 : 0,
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};
