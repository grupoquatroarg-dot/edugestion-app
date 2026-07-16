import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type UserLifecycleAction = "deactivate" | "reactivate";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type UserLifecycleInput = {
  userId: number;
  action: UserLifecycleAction;
  motivo: string;
  performedByUserId: number;
  performedByName: string;
};

const normalize = (value: unknown) => String(value ?? "").trim();

const validateInput = (input: UserLifecycleInput) => {
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw new AppError("ID de usuario inválido", 400);
  }
  if (!Number.isInteger(input.performedByUserId) || input.performedByUserId <= 0) {
    throw new AppError("Usuario ejecutor inválido", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return reason;
};

const assertTransition = (target: any, action: UserLifecycleAction) => {
  if (!target) throw new AppError("Usuario no encontrado", 404);

  const active = Number(target.active ?? 0) === 1;
  if (action === "deactivate" && !active) throw new AppError("El usuario ya está dado de baja", 409);
  if (action === "reactivate" && active) throw new AppError("El usuario ya está activo", 409);

  return active;
};

const changeWithClient = async (input: UserLifecycleInput, client: TransactionClient) => {
  const reason = validateInput(input);
  const performerName = normalize(input.performedByName) || "Sistema";

  const targetResult = await client.query(
    `SELECT id, name, email, role, avatar, active, created_at, session_version,
            deactivated_at, deactivated_by, deactivation_reason
     FROM users
     WHERE id = $1
     FOR UPDATE`,
    [input.userId]
  );
  const target = targetResult.rows[0];
  const wasActive = assertTransition(target, input.action);

  if (input.action === "deactivate" && input.userId === input.performedByUserId) {
    throw new AppError("No podés dar de baja tu propia cuenta", 409);
  }

  if (input.action === "deactivate" && target.role === "administrador") {
    await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
    const adminsResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM users
       WHERE role = 'administrador' AND active = 1`,
      []
    );
    const totalAdmins = Number(adminsResult.rows[0]?.total || 0);
    if (totalAdmins <= 1) {
      throw new AppError("Debe quedar al menos un administrador activo", 409);
    }
  }

  const nextStatus = input.action === "deactivate" ? "inactive" : "active";
  const previousStatus = wasActive ? "active" : "inactive";
  const snapshot = JSON.stringify({ user: target });

  await client.query(
    `INSERT INTO user_status_history (
       user_id, action, reason, performed_by_user_id, performed_by,
       previous_status, new_status, snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.userId,
      input.action,
      reason,
      input.performedByUserId,
      performerName,
      previousStatus,
      nextStatus,
      snapshot,
    ]
  );

  const result = input.action === "deactivate"
    ? await client.query(
      `UPDATE users
       SET active = 0,
           deactivated_at = now(),
           deactivated_by = $1,
           deactivation_reason = $2,
           session_version = COALESCE(session_version, 1) + 1
       WHERE id = $3
       RETURNING id, name, email, role, avatar, active, created_at, session_version,
                 deactivated_at, deactivated_by, deactivation_reason`,
      [performerName, reason, input.userId]
    )
    : await client.query(
      `UPDATE users
       SET active = 1,
           deactivated_at = NULL,
           deactivated_by = NULL,
           deactivation_reason = NULL,
           session_version = COALESCE(session_version, 1) + 1
       WHERE id = $1
       RETURNING id, name, email, role, avatar, active, created_at, session_version,
                 deactivated_at, deactivated_by, deactivation_reason`,
      [input.userId]
    );

  return result.rows[0];
};

const changeWithSqlite = async (input: UserLifecycleInput) => {
  const reason = validateInput(input);
  const performerName = normalize(input.performedByName) || "Sistema";
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const target = db.prepare(`
      SELECT id, name, email, role, avatar, active, created_at, session_version,
             deactivated_at, deactivated_by, deactivation_reason
      FROM users WHERE id = ? LIMIT 1
    `).get(input.userId) as any;
    const wasActive = assertTransition(target, input.action);

    if (input.action === "deactivate" && input.userId === input.performedByUserId) {
      throw new AppError("No podés dar de baja tu propia cuenta", 409);
    }

    if (input.action === "deactivate" && target.role === "administrador") {
      const row = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'administrador' AND active = 1").get() as any;
      if (Number(row?.total || 0) <= 1) {
        throw new AppError("Debe quedar al menos un administrador activo", 409);
      }
    }

    const previousStatus = wasActive ? "active" : "inactive";
    const nextStatus = input.action === "deactivate" ? "inactive" : "active";

    db.prepare(`
      INSERT INTO user_status_history (
        user_id, action, reason, performed_by_user_id, performed_by,
        previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.userId,
      input.action,
      reason,
      input.performedByUserId,
      performerName,
      previousStatus,
      nextStatus,
      JSON.stringify({ user: target })
    );

    if (input.action === "deactivate") {
      db.prepare(`
        UPDATE users
        SET active = 0,
            deactivated_at = CURRENT_TIMESTAMP,
            deactivated_by = ?,
            deactivation_reason = ?,
            session_version = COALESCE(session_version, 1) + 1
        WHERE id = ?
      `).run(performerName, reason, input.userId);
    } else {
      db.prepare(`
        UPDATE users
        SET active = 1,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason = NULL,
            session_version = COALESCE(session_version, 1) + 1
        WHERE id = ?
      `).run(input.userId);
    }

    return db.prepare(`
      SELECT id, name, email, role, avatar, active, created_at, session_version,
             deactivated_at, deactivated_by, deactivation_reason
      FROM users WHERE id = ? LIMIT 1
    `).get(input.userId);
  })();
};

export const userLifecycleService = {
  async changeStatus(input: UserLifecycleInput, transactionClient?: TransactionClient) {
    if (!isPostgresConfigured() && !transactionClient) {
      return changeWithSqlite(input);
    }

    if (transactionClient) {
      return changeWithClient(input, transactionClient);
    }

    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await changeWithClient(input, client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
