import bcrypt from "bcryptjs";
import { AppError } from "../utils/response.js";

export type MaintenanceOperation = "backup" | "restore" | "reset";

export type MaintenanceAuthorizationInput = {
  operation: MaintenanceOperation;
  actorUserId: number;
  actorName?: string | null;
  password: string;
  motivo: string;
  confirmation: string;
};

export type MaintenanceRecordInput = {
  operation: MaintenanceOperation;
  actorUserId: number;
  actorName: string;
  motivo: string;
  affectedTables?: number;
  affectedRows?: number;
  details?: Record<string, unknown>;
  artifactSchemaVersion?: number | null;
  artifactChecksumSha256?: string | null;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const CONFIRMATIONS: Record<MaintenanceOperation, string> = {
  backup: "RESPALDAR",
  restore: "RESTAURAR",
  reset: "REESTABLECER",
};

const normalize = (value: unknown) => String(value ?? "").trim();
const toSafeInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
};

const sanitizeDetails = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeDetails);
  if (!value || typeof value !== "object") return value;

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
    (acc, [key, item]) => {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.includes("password") ||
        normalizedKey.includes("contraseña") ||
        normalizedKey.includes("token") ||
        normalizedKey.includes("secret") ||
        normalizedKey === "backup" ||
        normalizedKey === "tables"
      ) {
        return acc;
      }
      acc[key] = sanitizeDetails(item);
      return acc;
    },
    {}
  );
};

const validateAuthorization = (input: MaintenanceAuthorizationInput) => {
  if (!["backup", "restore", "reset"].includes(input.operation)) {
    throw new AppError("Operación de mantenimiento inválida", 400);
  }
  if (!Number.isInteger(input.actorUserId) || input.actorUserId <= 0) {
    throw new AppError("Usuario administrador inválido", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  const password = typeof input.password === "string" ? input.password : "";
  if (!password) {
    throw new AppError("La contraseña actual del administrador es obligatoria", 400);
  }

  const expectedConfirmation = CONFIRMATIONS[input.operation];
  if (normalize(input.confirmation) !== expectedConfirmation) {
    throw new AppError(`Debe escribir ${expectedConfirmation} para confirmar`, 400);
  }

  return {
    reason,
    password,
    expectedConfirmation,
  };
};

const assertAdministrator = (row: any, password: string) => {
  const active = Number(row?.active ?? 0) === 1;
  const administrator = String(row?.role || "") === "administrador";
  const passwordHash = String(row?.password || "");
  const passwordMatches = Boolean(passwordHash) && bcrypt.compareSync(password, passwordHash);

  if (!row || !active || !administrator || !passwordMatches) {
    throw new AppError("Reautenticación inválida. Verificá tu contraseña actual", 403);
  }
};

export const maintenanceOperationSecurityService = {
  async authorize(input: MaintenanceAuthorizationInput, executor: TransactionClient) {
    const validated = validateAuthorization(input);

    const result = await executor.query(
      `SELECT id, name, role, active, password
       FROM users
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [input.actorUserId]
    );
    const user = result.rows[0];
    assertAdministrator(user, validated.password);

    return {
      operation: input.operation,
      actorUserId: Number(user.id),
      actorName: normalize(user.name || input.actorName) || "Administrador",
      motivo: validated.reason,
    };
  },

  async record(input: MaintenanceRecordInput, executor: TransactionClient) {
    const reason = normalize(input.motivo);
    if (reason.length < 3 || reason.length > 500) {
      throw new AppError("El motivo de auditoría es inválido", 400);
    }

    const details = sanitizeDetails(input.details || {}) as Record<string, unknown>;
    const result = await executor.query(
      `INSERT INTO maintenance_operation_history (
         operation,
         reason,
         performed_by_user_id,
         performed_by,
         affected_tables,
         affected_rows,
         details,
         artifact_schema_version,
         artifact_checksum_sha256
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING id, performed_at`,
      [
        input.operation,
        reason,
        input.actorUserId,
        normalize(input.actorName) || "Administrador",
        toSafeInteger(input.affectedTables),
        toSafeInteger(input.affectedRows),
        JSON.stringify(details),
        input.artifactSchemaVersion ?? null,
        input.artifactChecksumSha256
          ? String(input.artifactChecksumSha256).toLowerCase()
          : null,
      ]
    );

    return result.rows[0];
  },
};
