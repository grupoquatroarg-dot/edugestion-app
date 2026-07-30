import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export const USER_PERMISSION_MODULES = [
  "dashboard",
  "sales",
  "customers",
  "products",
  "suppliers",
  "current_accounts",
  "checklist",
  "routes",
  "settings",
  "users",
] as const;

type PermissionModule = typeof USER_PERMISSION_MODULES[number];

export type UserPermissionInput = {
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

type UpdatePermissionsInput = {
  userId: number;
  permissions: Record<string, UserPermissionInput>;
  motivo: string;
  changedByUserId?: number | null;
  changedByName: string;
  expectedVersion: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: unknown) => value === true || value === 1 || value === "1";
const normalizeText = (value: unknown) => String(value ?? "").trim();

const normalizePermissionRows = (rows: any[] = []) => {
  const byModule = new Map<string, any>();
  for (const row of rows) byModule.set(String(row.module), row);

  return USER_PERMISSION_MODULES.map((module) => {
    const row = byModule.get(module);
    return {
      module,
      can_view: toBool(row?.can_view),
      can_create: toBool(row?.can_create),
      can_edit: toBool(row?.can_edit),
      can_delete: toBool(row?.can_delete),
    };
  });
};

const validateInput = (input: UpdatePermissionsInput) => {
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw new AppError("ID de usuario inválido", 400);
  }

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new AppError("Versión de permisos inválida", 400);
  }

  const reason = normalizeText(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  const changedByName = normalizeText(input.changedByName) || "Sistema";
  const source = input.permissions && typeof input.permissions === "object"
    ? input.permissions
    : {};
  const receivedModules = Object.keys(source).sort();
  const expectedModules = [...USER_PERMISSION_MODULES].sort();

  if (
    receivedModules.length !== expectedModules.length
    || receivedModules.some((module, index) => module !== expectedModules[index])
  ) {
    throw new AppError("La configuración debe incluir exactamente todos los módulos permitidos", 400);
  }

  const permissions = USER_PERMISSION_MODULES.map((module) => {
    const permission = source[module];
    if (!permission || permission.module !== module) {
      throw new AppError(`La configuración del módulo ${module} es inválida`, 400);
    }

    const normalized = {
      module,
      can_view: permission.can_view === true,
      can_create: permission.can_create === true,
      can_edit: permission.can_edit === true,
      can_delete: permission.can_delete === true,
    };

    if (
      (normalized.can_create || normalized.can_edit || normalized.can_delete)
      && !normalized.can_view
    ) {
      throw new AppError(`El módulo ${module} debe permitir ver antes de crear, editar o eliminar`, 400);
    }

    return normalized;
  });

  return {
    reason,
    changedByName,
    changedByUserId: Number.isInteger(input.changedByUserId) && Number(input.changedByUserId) > 0
      ? Number(input.changedByUserId)
      : null,
    permissions,
  };
};

const assertEditableUser = (user: any, input: UpdatePermissionsInput) => {
  if (!user) throw new AppError("Usuario no encontrado", 404);
  if (Number(user.active ?? 0) !== 1) {
    throw new AppError("Reactivá al usuario antes de modificar sus permisos", 409);
  }
  if (String(user.role) === "administrador") {
    throw new AppError("Los administradores tienen acceso completo y no admiten permisos individuales", 409);
  }
  if (toNumber(user.permissions_version) !== input.expectedVersion) {
    throw new AppError(
      "Los permisos cambiaron mientras la pantalla estaba abierta. Actualizá la información e intentá nuevamente",
      409,
    );
  }
};

const areEqual = (left: any[], right: any[]) => JSON.stringify(left) === JSON.stringify(right);

const updatePostgres = async (
  input: UpdatePermissionsInput,
  validated: ReturnType<typeof validateInput>,
  executor?: TransactionClient,
) => {
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || await pool!.connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, name, email, role, active, session_version,
              permissions_version, permissions_changed_at,
              permissions_changed_by, permissions_change_reason
       FROM users
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [input.userId],
    );
    const user = userResult.rows[0];
    assertEditableUser(user, input);

    const currentPermissionsResult = await client.query(
      `SELECT module, can_view, can_create, can_edit, can_delete
       FROM user_permissions
       WHERE user_id = $1
       ORDER BY module ASC
       FOR UPDATE`,
      [input.userId],
    );

    const beforeSnapshot = normalizePermissionRows(currentPermissionsResult.rows);
    const afterSnapshot = validated.permissions;
    if (areEqual(beforeSnapshot, afterSnapshot)) {
      throw new AppError("No se detectaron cambios en los permisos", 409);
    }

    const nextVersion = input.expectedVersion + 1;
    const updatedUserResult = await client.query(
      `UPDATE users
       SET permissions_version = $1,
           permissions_changed_at = now(),
           permissions_changed_by = $2,
           permissions_change_reason = $3,
           session_version = COALESCE(session_version, 1) + 1
       WHERE id = $4
         AND permissions_version = $5
         AND active = 1
         AND role <> 'administrador'
       RETURNING permissions_version, permissions_changed_at,
                 permissions_changed_by, permissions_change_reason,
                 session_version`,
      [
        nextVersion,
        validated.changedByName,
        validated.reason,
        input.userId,
        input.expectedVersion,
      ],
    );
    if (!updatedUserResult.rowCount) {
      throw new AppError(
        "Los permisos cambiaron mientras la pantalla estaba abierta. Actualizá la información e intentá nuevamente",
        409,
      );
    }
    const updatedUser = updatedUserResult.rows[0];

    await client.query("DELETE FROM user_permissions WHERE user_id = $1", [input.userId]);
    for (const permission of afterSnapshot) {
      await client.query(
        `INSERT INTO user_permissions
          (user_id, module, can_view, can_create, can_edit, can_delete)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.userId,
          permission.module,
          permission.can_view ? 1 : 0,
          permission.can_create ? 1 : 0,
          permission.can_edit ? 1 : 0,
          permission.can_delete ? 1 : 0,
        ],
      );
    }

    await client.query(
      `INSERT INTO user_permission_history
        (user_id, version, reason, changed_by_user_id, changed_by, changed_at,
         permissions_before_snapshot, permissions_after_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        input.userId,
        nextVersion,
        validated.reason,
        validated.changedByUserId,
        validated.changedByName,
        updatedUser.permissions_changed_at,
        JSON.stringify(beforeSnapshot),
        JSON.stringify(afterSnapshot),
      ],
    );

    if (ownsTransaction) await client.query("COMMIT");

    return {
      permissions: afterSnapshot.reduce<Record<string, any>>((acc, permission) => {
        acc[permission.module] = permission;
        return acc;
      }, {}),
      version: nextVersion,
      changed_at: updatedUser.permissions_changed_at,
      changed_by: updatedUser.permissions_changed_by,
      change_reason: updatedUser.permissions_change_reason,
      session_version: toNumber(updatedUser.session_version, 1),
    };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

const updateSqlite = async (
  input: UpdatePermissionsInput,
  validated: ReturnType<typeof validateInput>,
) => {
  const { default: db } = await import("../db.js");
  return db.transaction(() => {
  const user = db.prepare(
    `SELECT id, name, email, role, active, session_version,
            permissions_version, permissions_changed_at,
            permissions_changed_by, permissions_change_reason
     FROM users
     WHERE id = ?
     LIMIT 1`,
  ).get(input.userId) as any;
  assertEditableUser(user, input);

  const currentRows = db.prepare(
    `SELECT module, can_view, can_create, can_edit, can_delete
     FROM user_permissions
     WHERE user_id = ?
     ORDER BY module ASC`,
  ).all(input.userId) as any[];
  const beforeSnapshot = normalizePermissionRows(currentRows);
  const afterSnapshot = validated.permissions;

  if (areEqual(beforeSnapshot, afterSnapshot)) {
    throw new AppError("No se detectaron cambios en los permisos", 409);
  }

  const nextVersion = input.expectedVersion + 1;
  const updateResult = db.prepare(
    `UPDATE users
     SET permissions_version = ?,
         permissions_changed_at = CURRENT_TIMESTAMP,
         permissions_changed_by = ?,
         permissions_change_reason = ?,
         session_version = COALESCE(session_version, 1) + 1
     WHERE id = ?
       AND permissions_version = ?
       AND active = 1
       AND role <> 'administrador'`,
  ).run(
    nextVersion,
    validated.changedByName,
    validated.reason,
    input.userId,
    input.expectedVersion,
  );
  if (Number(updateResult.changes || 0) !== 1) {
    throw new AppError(
      "Los permisos cambiaron mientras la pantalla estaba abierta. Actualizá la información e intentá nuevamente",
      409,
    );
  }

  db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(input.userId);
  const insertPermission = db.prepare(
    `INSERT INTO user_permissions
      (user_id, module, can_view, can_create, can_edit, can_delete)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const permission of afterSnapshot) {
    insertPermission.run(
      input.userId,
      permission.module,
      permission.can_view ? 1 : 0,
      permission.can_create ? 1 : 0,
      permission.can_edit ? 1 : 0,
      permission.can_delete ? 1 : 0,
    );
  }

  const updatedUser = db.prepare(
    `SELECT permissions_version, permissions_changed_at,
            permissions_changed_by, permissions_change_reason,
            session_version
     FROM users
     WHERE id = ?`,
  ).get(input.userId) as any;

  db.prepare(
    `INSERT INTO user_permission_history
      (user_id, version, reason, changed_by_user_id, changed_by, changed_at,
       permissions_before_snapshot, permissions_after_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId,
    nextVersion,
    validated.reason,
    validated.changedByUserId,
    validated.changedByName,
    updatedUser.permissions_changed_at,
    JSON.stringify(beforeSnapshot),
    JSON.stringify(afterSnapshot),
  );

    return {
      permissions: afterSnapshot.reduce<Record<string, any>>((acc, permission) => {
        acc[permission.module] = permission;
        return acc;
      }, {}),
      version: nextVersion,
      changed_at: updatedUser.permissions_changed_at,
      changed_by: updatedUser.permissions_changed_by,
      change_reason: updatedUser.permissions_change_reason,
      session_version: toNumber(updatedUser.session_version, 1),
    };
  })();
};

export const userPermissionLifecycleService = {
  async update(input: UpdatePermissionsInput, executor?: TransactionClient) {
    const validated = validateInput(input);
    if (executor || isPostgresConfigured()) {
      return updatePostgres(input, validated, executor);
    }
    return updateSqlite(input, validated);
  },
};
