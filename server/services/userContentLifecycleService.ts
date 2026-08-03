import bcrypt from "bcryptjs";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type UserContentInput = {
  userId: number;
  name: string;
  email: string;
  role: "administrador" | "empleado" | "vendedor" | "operario";
  avatar?: string | null;
  password?: string | null;
  motivo: string;
  expectedContentVersion: number;
  changedByUserId: number;
  changedByName: string;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeEmail = (value: unknown) => normalize(value).toLowerCase();
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const buildAvatar = (name: string) => normalize(name).substring(0, 2).toUpperCase() || "US";

const validateInput = (input: UserContentInput) => {
  if (!Number.isInteger(input.userId) || input.userId <= 0) throw new AppError("ID de usuario inválido", 400);
  if (!Number.isInteger(input.changedByUserId) || input.changedByUserId <= 0) {
    throw new AppError("Usuario ejecutor inválido", 400);
  }
  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de contenido inválida", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  if (reason.length > 500) throw new AppError("El motivo no puede superar los 500 caracteres", 400);

  const name = normalize(input.name);
  const email = normalizeEmail(input.email);
  const role = input.role;
  const password = normalize(input.password) || null;
  const avatar = input.avatar === undefined ? undefined : normalize(input.avatar);

  if (name.length < 2) throw new AppError("El nombre debe tener al menos 2 caracteres", 400);
  if (name.length > 150) throw new AppError("El nombre no puede superar los 150 caracteres", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Email inválido", 400);
  if (email.length > 250) throw new AppError("El email no puede superar los 250 caracteres", 400);
  if (!(["administrador", "empleado", "vendedor", "operario"] as const).includes(role)) {
    throw new AppError("Rol inválido", 400);
  }
  if (password && password.length < 6) throw new AppError("La contraseña debe tener al menos 6 caracteres", 400);
  if (password && password.length > 200) throw new AppError("La contraseña es demasiado larga", 400);
  if ((avatar || "").length > 20) throw new AppError("El avatar no puede superar los 20 caracteres", 400);

  return {
    reason,
    changedByName: normalize(input.changedByName) || "Sistema",
    name,
    email,
    role,
    avatar,
    password,
  };
};

const snapshot = (row: any, passwordChanged = false) => ({
  id: Math.trunc(toNumber(row.id)),
  name: normalize(row.name),
  email: normalizeEmail(row.email),
  role: normalize(row.role),
  avatar: normalize(row.avatar) || null,
  active: Math.trunc(toNumber(row.active, 1)),
  created_at: row.created_at ?? null,
  session_version: Math.trunc(toNumber(row.session_version, 1)),
  permissions_version: Math.trunc(toNumber(row.permissions_version, 0)),
  deactivated_at: row.deactivated_at ?? null,
  deactivated_by: row.deactivated_by ?? null,
  deactivation_reason: row.deactivation_reason ?? null,
  content_version: Math.trunc(toNumber(row.content_version, 0)),
  password_changed: passwordChanged,
});

const editableSnapshot = (row: ReturnType<typeof snapshot>) => ({
  name: row.name,
  email: row.email,
  role: row.role,
  avatar: row.avatar,
  password_changed: row.password_changed,
});

const assertEditable = (row: any, input: UserContentInput, nextRole: string) => {
  if (!row) throw new AppError("Usuario no encontrado", 404);
  if (Number(row.active ?? 0) !== 1) throw new AppError("El usuario está inactivo. Reactivalo antes de editarlo", 409);
  if (Math.trunc(toNumber(row.content_version, 0)) !== input.expectedContentVersion) {
    throw new AppError("El usuario cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
  }
  if (input.userId === input.changedByUserId && normalize(row.role) !== nextRole) {
    throw new AppError("No podés cambiar tu propio rol", 409);
  }
};

const handleSqlite = async (input: UserContentInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(input.userId) as any;
    assertEditable(current, input, validated.role);
    const finalAvatar = validated.avatar !== undefined
      ? (validated.avatar || buildAvatar(validated.name))
      : (normalize(current.avatar) || buildAvatar(validated.name));

    if (current.role === "administrador" && validated.role !== "administrador") {
      const row = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'administrador' AND active = 1").get() as any;
      if (Number(row?.total || 0) <= 1) throw new AppError("Debe quedar al menos un administrador activo", 409);
    }

    const duplicate = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ? LIMIT 1").get(validated.email, input.userId) as any;
    if (duplicate) throw new AppError("El email ya está registrado", 409);

    const nextVersion = input.expectedContentVersion + 1;
    const before = snapshot(current, false);
    const nextSessionVersion = Math.trunc(toNumber(current.session_version, 1)) + 1;
    const after = snapshot({
      ...current,
      name: validated.name,
      email: validated.email,
      role: validated.role,
      avatar: finalAvatar,
      content_version: nextVersion,
      session_version: nextSessionVersion,
    }, Boolean(validated.password));

    if (JSON.stringify(editableSnapshot(before)) === JSON.stringify(editableSnapshot(after))) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    db.prepare(`
      INSERT INTO user_content_history (
        user_id, version, reason, changed_by_user_id, changed_by,
        before_snapshot, after_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.userId,
      nextVersion,
      validated.reason,
      input.changedByUserId,
      validated.changedByName,
      JSON.stringify(before),
      JSON.stringify(after),
    );

    const passwordHash = validated.password ? bcrypt.hashSync(validated.password, 10) : null;
    const result = validated.password
      ? db.prepare(`
          UPDATE users
          SET name = ?, email = ?, role = ?, avatar = ?, password = ?,
              content_version = ?, content_changed_at = CURRENT_TIMESTAMP,
              content_changed_by = ?, content_change_reason = ?,
              session_version = COALESCE(session_version, 1) + 1
          WHERE id = ? AND active = 1 AND content_version = ?
        `).run(
          validated.name,
          validated.email,
          validated.role,
          finalAvatar,
          passwordHash,
          nextVersion,
          validated.changedByName,
          validated.reason,
          input.userId,
          input.expectedContentVersion,
        )
      : db.prepare(`
          UPDATE users
          SET name = ?, email = ?, role = ?, avatar = ?,
              content_version = ?, content_changed_at = CURRENT_TIMESTAMP,
              content_changed_by = ?, content_change_reason = ?,
              session_version = COALESCE(session_version, 1) + 1
          WHERE id = ? AND active = 1 AND content_version = ?
        `).run(
          validated.name,
          validated.email,
          validated.role,
          finalAvatar,
          nextVersion,
          validated.changedByName,
          validated.reason,
          input.userId,
          input.expectedContentVersion,
        );

    if (Number(result.changes) !== 1) {
      throw new AppError("El usuario cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    return db.prepare(`
      SELECT id, name, email, role, avatar, active, created_at, session_version,
             permissions_version, permissions_changed_at, permissions_changed_by, permissions_change_reason,
             deactivated_at, deactivated_by, deactivation_reason,
             content_version, content_changed_at, content_changed_by, content_change_reason
      FROM users WHERE id = ? LIMIT 1
    `).get(input.userId);
  })();
};

const handlePostgres = async (input: UserContentInput) => {
  const validated = validateInput(input);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const currentResult = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [input.userId]);
    const current = currentResult.rows[0];
    assertEditable(current, input, validated.role);
    const finalAvatar = validated.avatar !== undefined
      ? (validated.avatar || buildAvatar(validated.name))
      : (normalize(current.avatar) || buildAvatar(validated.name));

    if (current.role === "administrador" && validated.role !== "administrador") {
      await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const adminsResult = await client.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'administrador' AND active = 1");
      if (Number(adminsResult.rows[0]?.total || 0) <= 1) throw new AppError("Debe quedar al menos un administrador activo", 409);
    }

    const duplicate = await client.query(
      "SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1",
      [validated.email, input.userId],
    );
    if (duplicate.rowCount) throw new AppError("El email ya está registrado", 409);

    const nextVersion = input.expectedContentVersion + 1;
    const before = snapshot(current, false);
    const nextSessionVersion = Math.trunc(toNumber(current.session_version, 1)) + 1;
    const after = snapshot({
      ...current,
      name: validated.name,
      email: validated.email,
      role: validated.role,
      avatar: finalAvatar,
      content_version: nextVersion,
      session_version: nextSessionVersion,
    }, Boolean(validated.password));

    if (JSON.stringify(editableSnapshot(before)) === JSON.stringify(editableSnapshot(after))) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    await client.query(
      `INSERT INTO user_content_history (
         user_id, version, reason, changed_by_user_id, changed_by,
         before_snapshot, after_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        input.userId,
        nextVersion,
        validated.reason,
        input.changedByUserId,
        validated.changedByName,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );

    const passwordHash = validated.password ? bcrypt.hashSync(validated.password, 10) : null;
    const updated = validated.password
      ? await client.query(
          `UPDATE users
           SET name = $1, email = $2, role = $3, avatar = $4, password = $5,
               content_version = $6, content_changed_at = now(), content_changed_by = $7,
               content_change_reason = $8,
               session_version = COALESCE(session_version, 1) + 1
           WHERE id = $9 AND active = 1 AND content_version = $10
           RETURNING id, name, email, role, avatar, active, created_at, session_version,
                     permissions_version, permissions_changed_at, permissions_changed_by, permissions_change_reason,
                     deactivated_at, deactivated_by, deactivation_reason,
                     content_version, content_changed_at, content_changed_by, content_change_reason`,
          [
            validated.name,
            validated.email,
            validated.role,
            finalAvatar,
            passwordHash,
            nextVersion,
            validated.changedByName,
            validated.reason,
            input.userId,
            input.expectedContentVersion,
          ],
        )
      : await client.query(
          `UPDATE users
           SET name = $1, email = $2, role = $3, avatar = $4,
               content_version = $5, content_changed_at = now(), content_changed_by = $6,
               content_change_reason = $7,
               session_version = COALESCE(session_version, 1) + 1
           WHERE id = $8 AND active = 1 AND content_version = $9
           RETURNING id, name, email, role, avatar, active, created_at, session_version,
                     permissions_version, permissions_changed_at, permissions_changed_by, permissions_change_reason,
                     deactivated_at, deactivated_by, deactivation_reason,
                     content_version, content_changed_at, content_changed_by, content_change_reason`,
          [
            validated.name,
            validated.email,
            validated.role,
            finalAvatar,
            nextVersion,
            validated.changedByName,
            validated.reason,
            input.userId,
            input.expectedContentVersion,
          ],
        );

    if (!updated.rowCount) {
      throw new AppError("El usuario cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const userContentLifecycleService = {
  update(input: UserContentInput) {
    return isPostgresConfigured() ? handlePostgres(input) : handleSqlite(input);
  },
};
