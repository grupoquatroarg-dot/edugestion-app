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
    deactivated_at: row.deactivated_at ?? null,
    deactivated_by: row.deactivated_by ?? null,
    deactivation_reason: row.deactivation_reason ?? null,
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
        SELECT id, name, email, role, avatar, active, created_at, session_version,
               deactivated_at, deactivated_by, deactivation_reason
        FROM users WHERE id = ? LIMIT 1
      `).get(id));
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `SELECT id, name, email, role, avatar, active, created_at, session_version,
              deactivated_at, deactivated_by, deactivation_reason
       FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );

    return mapUserWithoutPassword(result.rows[0]);
  },

  async findAll() {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT id, name, email, role, avatar, active, created_at, session_version,
               deactivated_at, deactivated_by, deactivation_reason
        FROM users ORDER BY name ASC
      `).all().map(mapUserWithoutPassword);
    }

    const pool = getPostgresPool();
    const result = await pool.query(`
      SELECT id, name, email, role, avatar, active, created_at, session_version,
             deactivated_at, deactivated_by, deactivation_reason
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
       RETURNING id, name, email, role, avatar, active, created_at, session_version,
                 deactivated_at, deactivated_by, deactivation_reason`,
      [name, email, hashedPassword, role, finalAvatar]
    );

    return mapUserWithoutPassword(result.rows[0]);
  },

  async update(id: number, userData: any, actorUserId?: number) {
    const normalizedPassword = normalizePassword(userData.password);

    if (!isPostgresConfigured()) {
      return db.transaction(() => {
        const existingUser = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id) as any;
        if (!existingUser) throw new AppError("Usuario no encontrado", 404);

        const finalName = userData.name ?? existingUser.name;
        const finalEmail = userData.email ?? existingUser.email;
        const finalRole = userData.role ?? existingUser.role;
        const finalAvatar = userData.avatar ?? existingUser.avatar ?? buildAvatar(finalName);
        const roleChanged = finalRole !== existingUser.role;

        assertRoleChangeAllowedSqlite(existingUser, finalRole, actorUserId);

        if (normalizedPassword) {
          const hashedPassword = bcrypt.hashSync(normalizedPassword, 10);
          db.prepare(`
            UPDATE users
            SET name = ?, email = ?, role = ?, avatar = ?, password = ?,
                session_version = COALESCE(session_version, 1) + 1
            WHERE id = ?
          `).run(finalName, finalEmail, finalRole, finalAvatar, hashedPassword, id);
        } else if (roleChanged) {
          db.prepare(`
            UPDATE users
            SET name = ?, email = ?, role = ?, avatar = ?,
                session_version = COALESCE(session_version, 1) + 1
            WHERE id = ?
          `).run(finalName, finalEmail, finalRole, finalAvatar, id);
        } else {
          db.prepare("UPDATE users SET name = ?, email = ?, avatar = ? WHERE id = ?")
            .run(finalName, finalEmail, finalAvatar, id);
        }

        return mapUserWithoutPassword(db.prepare(`
          SELECT id, name, email, role, avatar, active, created_at, session_version,
                 deactivated_at, deactivated_by, deactivation_reason
          FROM users WHERE id = ? LIMIT 1
        `).get(id));
      })();
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const existingResult = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [id]);
      const existingUser = existingResult.rows[0];
      if (!existingUser) throw new AppError("Usuario no encontrado", 404);

      const finalName = userData.name ?? existingUser.name;
      const finalEmail = userData.email ?? existingUser.email;
      const finalRole = userData.role ?? existingUser.role;
      const finalAvatar = userData.avatar ?? existingUser.avatar ?? buildAvatar(finalName);
      const roleChanged = finalRole !== existingUser.role;

      await assertRoleChangeAllowedPostgres(client, existingUser, finalRole, actorUserId);

      let result;
      if (normalizedPassword) {
        const hashedPassword = bcrypt.hashSync(normalizedPassword, 10);
        result = await client.query(
          `UPDATE users
           SET name = $1, email = $2, role = $3, avatar = $4, password = $5,
               session_version = COALESCE(session_version, 1) + 1
           WHERE id = $6
           RETURNING id, name, email, role, avatar, active, created_at, session_version,
                     deactivated_at, deactivated_by, deactivation_reason`,
          [finalName, finalEmail, finalRole, finalAvatar, hashedPassword, id]
        );
      } else if (roleChanged) {
        result = await client.query(
          `UPDATE users
           SET name = $1, email = $2, role = $3, avatar = $4,
               session_version = COALESCE(session_version, 1) + 1
           WHERE id = $5
           RETURNING id, name, email, role, avatar, active, created_at, session_version,
                     deactivated_at, deactivated_by, deactivation_reason`,
          [finalName, finalEmail, finalRole, finalAvatar, id]
        );
      } else {
        result = await client.query(
          `UPDATE users
           SET name = $1, email = $2, avatar = $3
           WHERE id = $4
           RETURNING id, name, email, role, avatar, active, created_at, session_version,
                     deactivated_at, deactivated_by, deactivation_reason`,
          [finalName, finalEmail, finalAvatar, id]
        );
      }

      await client.query("COMMIT");
      return mapUserWithoutPassword(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
