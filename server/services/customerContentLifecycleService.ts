import bcrypt from "bcryptjs";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type CustomerContentInput = {
  customerId: number;
  nombreApellido: string;
  razonSocial?: string | null;
  cuit?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  codigoPostal?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  observaciones?: string | null;
  tipoCliente: "minorista" | "mayorista";
  listaPrecio?: string | null;
  limiteCredito?: number | null;
  portalEnabled?: boolean | number | null;
  portalUsername?: string | null;
  portalPassword?: string | null;
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const nullableText = (value: unknown) => normalize(value) || null;
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const toNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const toBoolean = (value: unknown) => value === true || value === 1 || String(value) === "1";
const toPortalSessionVersion = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};
const money = (value: unknown) => Math.round(toNumber(value) * 100) / 100;
const normalizeEmail = (value: unknown) => nullableText(value)?.toLowerCase() || null;

const validateInput = (input: CustomerContentInput) => {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new AppError("ID de cliente inválido", 400);
  }
  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de contenido inválida", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  const nombreApellido = normalize(input.nombreApellido);
  const razonSocial = nullableText(input.razonSocial);
  const cuit = nullableText(input.cuit);
  const telefono = nullableText(input.telefono);
  const email = normalizeEmail(input.email);
  const direccion = nullableText(input.direccion);
  const localidad = nullableText(input.localidad);
  const provincia = nullableText(input.provincia);
  const codigoPostal = nullableText(input.codigoPostal);
  const observaciones = nullableText(input.observaciones);
  const tipoCliente = normalize(input.tipoCliente);
  const listaPrecio = normalize(input.listaPrecio || "lista1");
  const limiteCredito = money(input.limiteCredito);
  const portalEnabled = toBoolean(input.portalEnabled);
  const portalUsername = nullableText(input.portalUsername);
  const portalPassword = nullableText(input.portalPassword);
  const latitud = toNullableNumber(input.latitud);
  const longitud = toNullableNumber(input.longitud);

  if (nombreApellido.length < 2) throw new AppError("El nombre debe tener al menos 2 caracteres", 400);
  if (nombreApellido.length > 250) throw new AppError("El nombre no puede superar los 250 caracteres", 400);
  if ((razonSocial || "").length > 250) throw new AppError("La razón social no puede superar los 250 caracteres", 400);
  if ((cuit || "").length > 30) throw new AppError("El CUIT/CUIL no puede superar los 30 caracteres", 400);
  if ((telefono || "").length > 40) throw new AppError("El teléfono no puede superar los 40 caracteres", 400);
  if ((email || "").length > 250) throw new AppError("El email no puede superar los 250 caracteres", 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Email inválido", 400);
  if ((direccion || "").length > 500) throw new AppError("La dirección no puede superar los 500 caracteres", 400);
  if ((localidad || "").length > 150) throw new AppError("La localidad no puede superar los 150 caracteres", 400);
  if ((provincia || "").length > 150) throw new AppError("La provincia no puede superar los 150 caracteres", 400);
  if ((codigoPostal || "").length > 20) throw new AppError("El código postal no puede superar los 20 caracteres", 400);
  if ((observaciones || "").length > 4000) throw new AppError("Las observaciones no pueden superar los 4000 caracteres", 400);
  if (tipoCliente !== "minorista" && tipoCliente !== "mayorista") throw new AppError("Tipo de cliente inválido", 400);
  if (!["lista1", "lista2", "lista3"].includes(listaPrecio)) throw new AppError("Lista de precios inválida", 400);
  if (!Number.isFinite(limiteCredito) || limiteCredito < 0) throw new AppError("El límite de crédito no puede ser negativo", 400);
  if ((latitud === null) !== (longitud === null)) throw new AppError("Latitud y longitud deben informarse juntas", 400);
  if (latitud !== null && (latitud < -90 || latitud > 90)) throw new AppError("Latitud inválida", 400);
  if (longitud !== null && (longitud < -180 || longitud > 180)) throw new AppError("Longitud inválida", 400);
  if ((portalUsername || "").length > 100) throw new AppError("El usuario del portal no puede superar los 100 caracteres", 400);
  if (portalPassword && portalPassword.length < 6) throw new AppError("La contraseña del portal debe tener al menos 6 caracteres", 400);
  if (portalPassword && portalPassword.length > 200) throw new AppError("La contraseña del portal es demasiado extensa", 400);
  if (portalEnabled && (!portalUsername || portalUsername.length < 3)) {
    throw new AppError("El usuario del portal debe tener al menos 3 caracteres", 400);
  }

  return {
    reason,
    user: normalize(input.usuario) || "Sistema",
    nombreApellido,
    razonSocial,
    cuit,
    telefono,
    email,
    direccion,
    localidad,
    provincia,
    codigoPostal,
    latitud,
    longitud,
    observaciones,
    tipoCliente: tipoCliente as "minorista" | "mayorista",
    listaPrecio,
    limiteCredito,
    portalEnabled,
    portalUsername,
    portalPassword,
  };
};

const snapshot = (row: any, portalPasswordChanged = false) => ({
  id: toNumber(row.id),
  nombre_apellido: normalize(row.nombre_apellido),
  razon_social: nullableText(row.razon_social),
  cuit: nullableText(row.cuit),
  telefono: nullableText(row.telefono),
  email: normalizeEmail(row.email),
  direccion: nullableText(row.direccion),
  localidad: nullableText(row.localidad),
  provincia: nullableText(row.provincia),
  codigo_postal: nullableText(row.codigo_postal),
  latitud: toNullableNumber(row.latitud),
  longitud: toNullableNumber(row.longitud),
  observaciones: nullableText(row.observaciones),
  tipo_cliente: normalize(row.tipo_cliente || "minorista"),
  lista_precio: normalize(row.lista_precio || "lista1"),
  limite_credito: money(row.limite_credito),
  portal_enabled: toBoolean(row.portal_enabled),
  portal_username: nullableText(row.portal_username),
  portal_password_configured: Boolean(row.portal_password_hash),
  portal_password_changed: portalPasswordChanged,
  portal_session_version: toPortalSessionVersion(row.portal_session_version),
  activo: toBoolean(row.activo ?? 1),
  content_version: Math.trunc(toNumber(row.content_version)),
});

const editableSnapshot = (row: ReturnType<typeof snapshot>) => ({
  nombre_apellido: row.nombre_apellido,
  razon_social: row.razon_social,
  cuit: row.cuit,
  telefono: row.telefono,
  email: row.email,
  direccion: row.direccion,
  localidad: row.localidad,
  provincia: row.provincia,
  codigo_postal: row.codigo_postal,
  latitud: row.latitud,
  longitud: row.longitud,
  observaciones: row.observaciones,
  tipo_cliente: row.tipo_cliente,
  lista_precio: row.lista_precio,
  limite_credito: row.limite_credito,
  portal_enabled: row.portal_enabled,
  portal_username: row.portal_username,
});

const assertEditable = (row: any, expectedContentVersion: number) => {
  if (!row) throw new AppError("Cliente no encontrado", 404);
  if (!toBoolean(row.activo ?? 1)) {
    throw new AppError("El cliente está inactivo. Reactivalo antes de editarlo", 409);
  }
  if (Math.trunc(toNumber(row.content_version)) !== expectedContentVersion) {
    throw new AppError(
      "El cliente cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente",
      409
    );
  }
};

const sanitizeRow = (row: any) => {
  if (!row) return row;
  const { portal_password_hash: _passwordHash, ...safe } = row;
  return safe;
};

const assertPortalAccess = (current: any, validated: ReturnType<typeof validateInput>) => {
  if (validated.portalEnabled && !current.portal_password_hash && !validated.portalPassword) {
    throw new AppError("Definí una contraseña para habilitar el portal del cliente", 400);
  }
};

const portalCredentialsChanged = (current: any, validated: ReturnType<typeof validateInput>) =>
  toBoolean(current.portal_enabled) !== validated.portalEnabled
  || nullableText(current.portal_username) !== validated.portalUsername
  || Boolean(validated.portalPassword);

const assertPortalUsernameSqlite = (db: any, customerId: number, portalUsername: string | null, currentUsername: unknown) => {
  if (!portalUsername || portalUsername.toLowerCase() === normalize(currentUsername).toLowerCase()) return;
  const duplicate = db.prepare(
    "SELECT id FROM clientes WHERE lower(portal_username) = lower(?) AND id <> ? LIMIT 1"
  ).get(portalUsername, customerId) as any;
  if (duplicate) throw new AppError("El usuario del portal ya está asignado a otro cliente", 409);
};

const assertPortalUsernamePostgres = async (
  client: TransactionClient,
  customerId: number,
  portalUsername: string | null,
  currentUsername: unknown
) => {
  if (!portalUsername || portalUsername.toLowerCase() === normalize(currentUsername).toLowerCase()) return;
  const duplicate = await client.query(
    "SELECT id FROM clientes WHERE lower(portal_username) = lower($1) AND id <> $2 LIMIT 1",
    [portalUsername, customerId]
  );
  if (duplicate.rowCount) throw new AppError("El usuario del portal ya está asignado a otro cliente", 409);
};

const handleSqlite = async (input: CustomerContentInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM clientes WHERE id = ? LIMIT 1").get(input.customerId) as any;
    assertEditable(current, input.expectedContentVersion);
    assertPortalAccess(current, validated);
    assertPortalUsernameSqlite(db, input.customerId, validated.portalUsername, current.portal_username);

    const passwordHash = validated.portalPassword ? bcrypt.hashSync(validated.portalPassword, 10) : null;
    const nextPortalSessionVersion = toPortalSessionVersion(current.portal_session_version)
      + (portalCredentialsChanged(current, validated) ? 1 : 0);
    const before = snapshot(current, false);
    const nextVersion = input.expectedContentVersion + 1;
    const afterRow = {
      ...current,
      nombre_apellido: validated.nombreApellido,
      razon_social: validated.razonSocial,
      cuit: validated.cuit,
      telefono: validated.telefono,
      email: validated.email,
      direccion: validated.direccion,
      localidad: validated.localidad,
      provincia: validated.provincia,
      codigo_postal: validated.codigoPostal,
      latitud: validated.latitud,
      longitud: validated.longitud,
      observaciones: validated.observaciones,
      tipo_cliente: validated.tipoCliente,
      lista_precio: validated.listaPrecio,
      limite_credito: validated.limiteCredito,
      portal_enabled: validated.portalEnabled ? 1 : 0,
      portal_username: validated.portalUsername,
      portal_password_hash: passwordHash || current.portal_password_hash,
      portal_session_version: nextPortalSessionVersion,
      content_version: nextVersion,
    };
    const after = snapshot(afterRow, Boolean(validated.portalPassword));

    const changed = JSON.stringify(editableSnapshot(before)) !== JSON.stringify(editableSnapshot(after));
    if (!changed && !validated.portalPassword) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    db.prepare(`
      INSERT INTO customer_content_history (
        customer_id, version, reason, changed_by, before_snapshot, after_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.customerId,
      nextVersion,
      validated.reason,
      validated.user,
      JSON.stringify(before),
      JSON.stringify(after)
    );

    const result = db.prepare(`
      UPDATE clientes
      SET nombre_apellido = ?, razon_social = ?, cuit = ?, telefono = ?, email = ?,
          direccion = ?, localidad = ?, provincia = ?, codigo_postal = ?, latitud = ?, longitud = ?,
          observaciones = ?, tipo_cliente = ?, lista_precio = ?, limite_credito = ?,
          portal_enabled = ?, portal_username = ?, portal_password_hash = COALESCE(?, portal_password_hash),
          portal_session_version = ?, content_version = ?, content_changed_at = CURRENT_TIMESTAMP,
          content_changed_by = ?, content_change_reason = ?
      WHERE id = ? AND COALESCE(activo, 1) <> 0 AND content_version = ?
    `).run(
      validated.nombreApellido,
      validated.razonSocial,
      validated.cuit,
      validated.telefono,
      validated.email,
      validated.direccion,
      validated.localidad,
      validated.provincia,
      validated.codigoPostal,
      validated.latitud,
      validated.longitud,
      validated.observaciones,
      validated.tipoCliente,
      validated.listaPrecio,
      validated.limiteCredito,
      validated.portalEnabled ? 1 : 0,
      validated.portalUsername,
      passwordHash,
      nextPortalSessionVersion,
      nextVersion,
      validated.user,
      validated.reason,
      input.customerId,
      input.expectedContentVersion
    );

    if (toNumber(result.changes) !== 1) {
      throw new AppError("El cliente cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    return sanitizeRow(db.prepare("SELECT * FROM clientes WHERE id = ? LIMIT 1").get(input.customerId));
  })();
};

const handlePostgres = async (input: CustomerContentInput) => {
  const validated = validateInput(input);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM clientes WHERE id = $1 LIMIT 1 FOR UPDATE",
      [input.customerId]
    );
    const current = currentResult.rows[0];
    assertEditable(current, input.expectedContentVersion);
    assertPortalAccess(current, validated);
    await assertPortalUsernamePostgres(client, input.customerId, validated.portalUsername, current.portal_username);

    const passwordHash = validated.portalPassword ? bcrypt.hashSync(validated.portalPassword, 10) : null;
    const nextPortalSessionVersion = toPortalSessionVersion(current.portal_session_version)
      + (portalCredentialsChanged(current, validated) ? 1 : 0);
    const before = snapshot(current, false);
    const nextVersion = input.expectedContentVersion + 1;
    const afterRow = {
      ...current,
      nombre_apellido: validated.nombreApellido,
      razon_social: validated.razonSocial,
      cuit: validated.cuit,
      telefono: validated.telefono,
      email: validated.email,
      direccion: validated.direccion,
      localidad: validated.localidad,
      provincia: validated.provincia,
      codigo_postal: validated.codigoPostal,
      latitud: validated.latitud,
      longitud: validated.longitud,
      observaciones: validated.observaciones,
      tipo_cliente: validated.tipoCliente,
      lista_precio: validated.listaPrecio,
      limite_credito: validated.limiteCredito,
      portal_enabled: validated.portalEnabled ? 1 : 0,
      portal_username: validated.portalUsername,
      portal_password_hash: passwordHash || current.portal_password_hash,
      portal_session_version: nextPortalSessionVersion,
      content_version: nextVersion,
    };
    const after = snapshot(afterRow, Boolean(validated.portalPassword));

    const changed = JSON.stringify(editableSnapshot(before)) !== JSON.stringify(editableSnapshot(after));
    if (!changed && !validated.portalPassword) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    await client.query(
      `INSERT INTO customer_content_history (
         customer_id, version, reason, changed_by, before_snapshot, after_snapshot
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        input.customerId,
        nextVersion,
        validated.reason,
        validated.user,
        JSON.stringify(before),
        JSON.stringify(after),
      ]
    );

    const updated = await client.query(
      `UPDATE clientes
       SET nombre_apellido = $1, razon_social = $2, cuit = $3, telefono = $4, email = $5,
           direccion = $6, localidad = $7, provincia = $8, codigo_postal = $9,
           latitud = $10, longitud = $11, observaciones = $12, tipo_cliente = $13,
           lista_precio = $14, limite_credito = $15, portal_enabled = $16,
           portal_username = $17, portal_password_hash = COALESCE($18, portal_password_hash),
           portal_session_version = $19, content_version = $20, content_changed_at = now(),
           content_changed_by = $21, content_change_reason = $22
       WHERE id = $23 AND COALESCE(activo, 1) <> 0 AND content_version = $24
       RETURNING *`,
      [
        validated.nombreApellido,
        validated.razonSocial,
        validated.cuit,
        validated.telefono,
        validated.email,
        validated.direccion,
        validated.localidad,
        validated.provincia,
        validated.codigoPostal,
        validated.latitud,
        validated.longitud,
        validated.observaciones,
        validated.tipoCliente,
        validated.listaPrecio,
        validated.limiteCredito,
        validated.portalEnabled ? 1 : 0,
        validated.portalUsername,
        passwordHash,
        nextPortalSessionVersion,
        nextVersion,
        validated.user,
        validated.reason,
        input.customerId,
        input.expectedContentVersion,
      ]
    );

    if (!updated.rowCount) {
      throw new AppError("El cliente cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    await client.query("COMMIT");
    return sanitizeRow(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const customerContentLifecycleService = {
  update(input: CustomerContentInput) {
    return isPostgresConfigured() ? handlePostgres(input) : handleSqlite(input);
  },
};
