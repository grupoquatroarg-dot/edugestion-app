import { z } from "zod";
import { clientRepository } from "../server/repositories/clientRepository.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { verifyToken, generateToken } from "../server/utils/jwt.js";
import bcrypt from "bcryptjs";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { getPostgresPool } from "../server/utils/postgres.js";
import { salesService } from "../server/services/salesService.js";
import { customerOrderCancellationService } from "../server/services/customerOrderCancellationService.js";
import { customerLifecycleService, type CustomerLifecycleAction } from "../server/services/customerLifecycleService.js";
import { customerContentLifecycleService } from "../server/services/customerContentLifecycleService.js";
import { userLifecycleService, type UserLifecycleAction } from "../server/services/userLifecycleService.js";
import { userPermissionLifecycleService } from "../server/services/userPermissionLifecycleService.js";
import { userContentLifecycleService } from "../server/services/userContentLifecycleService.js";
import { requireBearerUser } from "../server/services/currentUserAuthService.js";
import { checklistTemplateLifecycleService, type ChecklistTemplateLifecycleAction } from "../server/services/checklistTemplateLifecycleService.js";
import { checklistTemplateContentLifecycleService } from "../server/services/checklistTemplateContentLifecycleService.js";
import { routeLifecycleService, type RouteLifecycleAction } from "../server/services/routeLifecycleService.js";
import { routeItemLifecycleService, type RouteItemLifecycleAction } from "../server/services/routeItemLifecycleService.js";
import { routeOperationalLifecycleService, type RouteOperationalAction } from "../server/services/routeOperationalLifecycleService.js";
import { checklistLifecycleService, type ChecklistLifecycleAction } from "../server/services/checklistLifecycleService.js";

const clientSchema = z.object({
  nombre_apellido: z.string().min(2, "El nombre es requerido"),
  razon_social: z.string().optional().nullable(),
  cuit: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  localidad: z.string().optional().nullable(),
  provincia: z.string().optional().nullable(),
  codigo_postal: z.string().optional().nullable(),
  latitud: z.number().optional().nullable(),
  longitud: z.number().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  tipo_cliente: z.enum(["minorista", "mayorista"]).optional(),
  lista_precio: z.string().optional().nullable(),
  limite_credito: z.number().optional().nullable(),
  portal_enabled: z.union([z.boolean(), z.number()]).optional().nullable(),
  portal_username: z.string().optional().nullable(),
  portal_password: z.string().optional().nullable(),
});


const customerContentSchema = clientSchema.extend({
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  expectedContentVersion: z.number().int().min(0),
});

const customerLifecycleSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

const baseUserSchema = z.object({
  name: z.string().min(2, "Nombre demasiado corto"),
  email: z.string().email("Email inválido"),
  role: z.enum(["administrador", "empleado", "vendedor", "operario"]),
  avatar: z.string().optional(),
});

const createUserSchema = baseUserSchema.extend({
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

const updateUserSchema = baseUserSchema.extend({
  password: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || value === "" || value.length >= 6,
      "La contraseña debe tener al menos 6 caracteres"
    ),
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  expectedContentVersion: z.number().int().min(0),
});

const userLifecycleSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

const permissionEntrySchema = z.object({
  module: z.string(),
  can_view: z.boolean(),
  can_create: z.boolean(),
  can_edit: z.boolean(),
  can_delete: z.boolean(),
});

const permissionsSchema = z.object({
  permissions: z.record(z.string(), permissionEntrySchema),
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  expectedVersion: z.number().int().min(0),
});

const getBody = (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
};

const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

const permissionKeyByAction = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
} as const;

const requireClientPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const permissionKey = permissionKeyByAction[action];
  const clientPermissions = permissions?.clients || permissions?.customers;

  if (!clientPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for clients", 403);
    return null;
  }

  return decoded;
};

const requireAdmin = async (req: any, res: any) => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role !== "administrador") {
    sendError(res, "Forbidden: Solo administrador", 403);
    return null;
  }

  return decoded;
};

const getId = (req: any) => {
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const getEndpoint = (req: any) => {
  const rawEndpoint = Array.isArray(req.query?.endpoint) ? req.query.endpoint[0] : req.query?.endpoint;
  return String(rawEndpoint || "");
};

const getAction = (req: any) => {
  const rawAction = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
  return String(rawAction || "");
};

const isCustomerLifecycleAction = (action: string): action is CustomerLifecycleAction =>
  (["deactivate", "reactivate"] as const).includes(action as CustomerLifecycleAction);

const normalizeArgentinaPhone = (rawPhone: any) => {
  let digits = String(rawPhone || "").replace(/\D/g, "");

  if (!digits) return null;

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("549")) {
    return `+${digits}`;
  }

  if (digits.startsWith("54")) {
    return `+54${digits.slice(2)}`;
  }

  if (digits.startsWith("9") && digits.length === 11) {
    return `+54${digits}`;
  }

  return `+549${digits}`;
};

const normalizeClientBody = (body: any) => ({
  ...body,
  telefono: normalizeArgentinaPhone(body.telefono),
  tipo_cliente: body.tipo_cliente || "minorista",
  limite_credito: Number(body.limite_credito || 0),
  portal_enabled: body.portal_enabled === true || body.portal_enabled === 1 || body.portal_enabled === '1',
  portal_username: body.portal_username || null,
  portal_password: body.portal_password || null,
});

const handleUsers = async (req: any, res: any) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = getId(req);

  if (req.method === "GET") {
    try {
      if (id) {
        const user = await UserRepository.findById(id);
        if (!user) return sendError(res, "Usuario no encontrado", 404);
        return sendSuccess(res, user);
      }

      const users = await UserRepository.findAll();
      return sendSuccess(res, users);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener usuarios", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST") {
    const parsed = createUserSchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const newUser = await UserRepository.create(parsed.data);
      return sendSuccess(res, newUser, "Usuario creado exitosamente", 201);
    } catch (error: any) {
      if (error?.code === "SQLITE_CONSTRAINT" || error?.code === "23505") {
        return sendError(res, "El email ya está registrado", 400);
      }

      return sendError(res, error?.message || "Error al crear usuario", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "PUT") {
    if (!id) return sendError(res, "ID de usuario inválido", 400);

    const parsed = updateUserSchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const updatedUser = await userContentLifecycleService.update({
        userId: id,
        ...parsed.data,
        changedByUserId: Number(admin.userId),
        changedByName: admin.userName || "Sistema",
      });
      return sendSuccess(res, updatedUser, "Usuario actualizado. Sus sesiones anteriores fueron invalidadas.");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar usuario", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "DELETE") {
    return sendError(
      res,
      "La eliminación física de usuarios está deshabilitada. Usá Dar de baja para conservar el historial.",
      409
    );
  }

  return sendError(res, "Method not allowed", 405);
};

const handleUserLifecycle = async (req: any, res: any) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

  const id = getId(req);
  if (!id) return sendError(res, "ID de usuario inválido", 400);

  const action = getAction(req);
  if (!["deactivate", "reactivate"].includes(action)) {
    return sendError(res, "Acción de usuario inválida", 400);
  }

  const parsed = userLifecycleSchema.safeParse(getBody(req));
  if (!parsed.success) {
    return sendError(
      res,
      "Validation failed",
      400,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  try {
    const result = await userLifecycleService.changeStatus({
      userId: id,
      action: action as UserLifecycleAction,
      motivo: parsed.data.motivo,
      performedByUserId: Number(admin.userId),
      performedByName: admin.userName || "Sistema",
    });

    return sendSuccess(
      res,
      result,
      action === "deactivate"
        ? "Usuario dado de baja correctamente"
        : "Usuario reactivado correctamente"
    );
  } catch (error: any) {
    return sendError(
      res,
      error?.message || "No se pudo actualizar el estado del usuario",
      error?.statusCode || 400,
      error?.errors || []
    );
  }
};

const handleUserPermissions = async (req: any, res: any) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = getId(req);
  if (!id) return sendError(res, "ID de usuario inválido", 400);

  if (req.method === "GET") {
    try {
      const target = await UserRepository.findById(id);
      if (!target) return sendError(res, "Usuario no encontrado", 404);

      const permissions = await UserRepository.getPermissions(id);
      return sendSuccess(res, {
        permissions,
        version: Number(target.permissions_version || 0),
        changed_at: target.permissions_changed_at || null,
        changed_by: target.permissions_changed_by || null,
        change_reason: target.permissions_change_reason || null,
      });
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener permisos", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "PUT") {
    const parsed = permissionsSchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const result = await userPermissionLifecycleService.update({
        userId: id,
        permissions: parsed.data.permissions,
        motivo: parsed.data.motivo,
        expectedVersion: parsed.data.expectedVersion,
        changedByUserId: Number(admin.userId),
        changedByName: admin.userName || "Sistema",
      });
      return sendSuccess(
        res,
        result,
        "Permisos actualizados. Las sesiones anteriores del usuario fueron invalidadas."
      );
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar permisos", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
};


const routeSchema = z.object({
  name: z.string().min(2, "Nombre de ruta requerido"),
  date: z.string().min(10, "Fecha requerida"),
  customerIds: z.array(z.number()).optional(),
  clientIds: z.array(z.number()).optional(),
});

const routeStatusSchema = z.object({
  status: z.enum(["planificada", "en curso", "pendiente"]),
}).strict();

const routeOperationalLifecycleSchema = z.object({
  action: z.enum(["start", "reopen"]),
  motivo: z.string().trim().max(500).optional().nullable(),
  expectedVersion: z.number().int().min(0),
}).strict();

const routeLifecycleSchema = z.object({
  action: z.enum(["finalize", "cancel", "reopen"]),
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

const routeItemLifecycleSchema = z.object({
  action: z.enum(["visit", "omit", "reopen"]),
  motivo: z.string().trim().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
}).strict();

const routeReorderSchema = z.object({
  items: z.array(z.object({
    id: z.number(),
    order_index: z.number(),
  })),
});

const routeSupplierOrderSchema = z.object({
  route_item_id: z.number().int().positive(),
  cliente: z.string().optional(),
  cliente_id: z.number().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    product_id: z.number(),
    cantidad: z.number().positive(),
  })).min(1, "Debe incluir al menos un producto"),
});

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getSalePaymentStatus = (row: any): "pending" | "partial" | "paid" | "cancelled" => {
  if (String(row?.estado || "").toLowerCase() === "anulada") return "cancelled";
  const total = toNumber(row?.total);
  const paid = toNumber(row?.monto_pagado);
  const pending = toNumber(row?.monto_pendiente, Math.max(0, total - paid));

  if (pending <= 0) return "paid";
  if (paid > 0) return "partial";
  return "pending";
};

const toIntFlag = (value: any) => {
  if (value === true) return 1;
  if (value === false) return 0;
  return Number(value || 0) ? 1 : 0;
};

const requireRoutePermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const permissionKey = permissionKeyByAction[action];
  const routePermissions = permissions?.routes;

  if (!routePermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for routes", 403);
    return null;
  }

  return decoded;
};

const mapRouteItem = (row: any) => ({
  id: toNumber(row.id),
  route_id: toNumber(row.route_id),
  cliente_id: toNumber(row.cliente_id ?? row.client_id),
  order_index: toNumber(row.order_index),
  status: row.status || (toNumber(row.visitado) ? "visitado" : "pendiente"),
  visitado: toNumber(row.visitado),
  venta_registrada: toNumber(row.venta_registrada),
  pedido_generado: toNumber(row.pedido_generado),
  cobranza_realizada: toNumber(row.cobranza_realizada),
  notes: row.notes || null,
  visited_at: row.visited_at || null,
  lifecycle_version: toNumber(row.lifecycle_version),
  status_changed_at: row.status_changed_at || null,
  status_changed_by: row.status_changed_by || null,
  status_changed_from: row.status_changed_from || null,
  status_last_action: row.status_last_action || null,
  status_last_reason: row.status_last_reason || null,
  nombre_apellido: row.nombre_apellido || row.client_name || "",
  razon_social: row.razon_social || "",
  localidad: row.localidad || "",
  direccion: row.direccion || "",
  latitud: row.latitud === null || row.latitud === undefined ? null : toNumber(row.latitud),
  longitud: row.longitud === null || row.longitud === undefined ? null : toNumber(row.longitud),
  telefono: row.telefono || "",
  tipo_cliente: row.tipo_cliente || "minorista",
  saldo_cta_cte: toNumber(row.saldo_cta_cte),
});

const mapRoute = (row: any) => ({
  id: toNumber(row.id),
  name: row.name || "",
  date: typeof row.date === "string" ? row.date.slice(0, 10) : row.date,
  status: row.status || "planificada",
  created_at: row.created_at || null,
  cancelled_at: row.cancelled_at || null,
  cancelled_by: row.cancelled_by || null,
  cancel_reason: row.cancel_reason || null,
  cancelled_from_status: row.cancelled_from_status || null,
  reopened_at: row.reopened_at || null,
  reopened_by: row.reopened_by || null,
  reopen_reason: row.reopen_reason || null,
  finalization_version: toNumber(row.finalization_version),
  finalized_at: row.finalized_at || null,
  finalized_by: row.finalized_by || null,
  finalization_reason: row.finalization_reason || null,
  finalized_from_status: row.finalized_from_status || null,
  total_customers: toNumber(row.total_customers),
  visited_customers: toNumber(row.visited_customers),
  sales_count: toNumber(row.sales_count),
  orders_count: toNumber(row.orders_count),
  has_activity: row.has_activity === true || row.has_activity === 1 || row.has_activity === "true",
});

const getRouteItems = async (routeId: number) => {
  const pool = getPostgresPool();
  const result = await pool.query(
    `
      SELECT
        ri.id,
        ri.route_id,
        ri.client_id AS cliente_id,
        ri.order_index,
        COALESCE(ri.status, CASE WHEN COALESCE(ri.visitado, 0) <> 0 THEN 'visitado' ELSE 'pendiente' END) AS status,
        COALESCE(ri.visitado, 0) AS visitado,
        COALESCE(ri.venta_registrada, 0) AS venta_registrada,
        COALESCE(ri.pedido_generado, 0) AS pedido_generado,
        COALESCE(ri.cobranza_realizada, 0) AS cobranza_realizada,
        ri.notes,
        ri.visited_at,
        COALESCE(ri.lifecycle_version, 0) AS lifecycle_version,
        ri.status_changed_at,
        ri.status_changed_by,
        ri.status_changed_from,
        ri.status_last_action,
        ri.status_last_reason,
        c.nombre_apellido,
        c.razon_social,
        c.localidad,
        c.direccion,
        c.latitud,
        c.longitud,
        c.telefono,
        c.tipo_cliente,
        COALESCE(c.saldo_cta_cte, 0) AS saldo_cta_cte
      FROM route_items ri
      JOIN clientes c ON ri.client_id = c.id
      WHERE ri.route_id = $1
      ORDER BY ri.order_index ASC, ri.id ASC
    `,
    [routeId]
  );

  return result.rows.map(mapRouteItem);
};

const handleRoutes = async (req: any, res: any) => {
  const endpoint = getEndpoint(req);
  const id = getId(req);
  const pool = getPostgresPool();

  if (endpoint === "route-supplier-order") {
    const user = await requireRoutePermission(req, res, "edit");
    if (!user) return;

    if (user.role !== "administrador") {
      const permissions = await UserRepository.getPermissions(Number(user.userId));
      if (!permissions?.suppliers?.can_create) {
        return sendError(res, "Forbidden: No permission to create supplier orders", 403);
      }
    }

    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

    const parsed = routeSupplierOrderSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const routeItemResult = await client.query(
        `SELECT ri.id, ri.client_id, ri.route_id, r.status AS route_status
         FROM route_items ri
         JOIN routes r ON r.id = ri.route_id
         WHERE ri.id = $1
         LIMIT 1
         FOR UPDATE OF r, ri`,
        [parsed.data.route_item_id]
      );

      if (!routeItemResult.rowCount) {
        throw new Error("El ítem de ruta no existe");
      }

      const routeItem = routeItemResult.rows[0];
      const routeStatus = String(routeItem.route_status || "planificada").toLowerCase();
      if (["cancelada", "finalizada"].includes(routeStatus)) {
        throw new Error(`La ruta está ${routeStatus} y no admite nuevos pedidos`);
      }
      if (parsed.data.cliente_id && toNumber(routeItem.client_id) !== toNumber(parsed.data.cliente_id)) {
        throw new Error("El ítem de ruta no pertenece al cliente seleccionado");
      }

      const nextNumberResult = await client.query("SELECT COALESCE(MAX(numero_pedido), 0) + 1 AS next_number FROM supplier_orders");
      const nextNumber = toNumber(nextNumberResult.rows[0]?.next_number, 1);
      const orderResult = await client.query(
        `
          INSERT INTO supplier_orders (numero_pedido, cliente, cliente_id, estado, notes)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, numero_pedido
        `,
        [nextNumber, parsed.data.cliente || "Cliente de ruta", parsed.data.cliente_id || null, "pendiente", parsed.data.notes || null]
      );
      const orderId = toNumber(orderResult.rows[0]?.id);
      for (const item of parsed.data.items) {
        await client.query(
          `INSERT INTO supplier_order_items (order_id, product_id, cantidad) VALUES ($1, $2, $3)`,
          [orderId, item.product_id, item.cantidad]
        );
      }

      const auditNote = `Pedido a proveedor #${nextNumber} registrado desde la ruta`;
      await client.query(
        `UPDATE route_items
         SET status = 'pedido tomado',
             visitado = 1,
             pedido_generado = 1,
             visited_at = COALESCE(visited_at, now()),
             notes = CASE
               WHEN BTRIM(COALESCE(notes, '')) = '' THEN $1
               ELSE notes || E'\n' || $1
             END
         WHERE id = $2`,
        [auditNote, parsed.data.route_item_id]
      );
      await client.query(
        `UPDATE routes
         SET status = 'en curso'
         WHERE id = $1 AND status IN ('planificada', 'pendiente')`,
        [toNumber(routeItem.route_id)]
      );

      await client.query("COMMIT");
      return sendSuccess(res, { orderId, numero_pedido: nextNumber }, "Pedido creado exitosamente", 201);
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al crear pedido", 400);
    } finally {
      client.release();
    }
  }

  if (endpoint === "route-item") {
    const user = await requireRoutePermission(req, res, "edit");
    if (!user) return;
    return sendError(
      res,
      "El cambio directo de estado e indicadores de la visita fue deshabilitado. Usá las acciones auditadas.",
      409
    );
  }

  if (endpoint === "route-item-lifecycle") {
    const user = await requireRoutePermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de visita inválido", 400);
    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

    const parsed = routeItemLifecycleSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const result = await routeItemLifecycleService.changeStatus({
        routeItemId: id,
        action: parsed.data.action as RouteItemLifecycleAction,
        motivo: parsed.data.motivo,
        notes: parsed.data.notes,
        usuario: user.userName || "Sistema",
      });

      const message = parsed.data.action === "visit"
        ? "Visita marcada correctamente"
        : parsed.data.action === "omit"
          ? "Visita omitida correctamente"
          : "Visita reabierta correctamente";
      return sendSuccess(res, result, message);
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo actualizar la visita",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "routes-reorder") {
    const user = await requireRoutePermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de ruta inválido", 400);
    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

    const parsed = routeReorderSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const routeResult = await client.query(
        `SELECT id, status
         FROM routes
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [id]
      );
      if (!routeResult.rowCount) throw new Error("Ruta no encontrada");

      const routeStatus = String(routeResult.rows[0]?.status || "planificada").toLowerCase();
      if (["cancelada", "finalizada"].includes(routeStatus)) {
        throw new Error(`La ruta está ${routeStatus} y no puede reordenarse`);
      }

      for (const item of parsed.data.items) {
        const updateResult = await client.query(
          `UPDATE route_items SET order_index = $1 WHERE id = $2 AND route_id = $3`,
          [item.order_index, item.id, id]
        );
        if (!updateResult.rowCount) throw new Error(`El ítem ${item.id} no pertenece a la ruta`);
      }
      await client.query("COMMIT");
      return sendSuccess(res, null, "Ruta reordenada");
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al reordenar ruta", 409);
    } finally {
      client.release();
    }
  }

  if (endpoint === "routes-today") {
    const user = await requireRoutePermission(req, res, "view");
    if (!user) return;
    if (req.method !== "GET") return sendError(res, "Method not allowed", 405);

    const routeResult = await pool.query(
      `
        SELECT r.*,
          COUNT(ri.id)::int AS total_customers,
          COALESCE(SUM(CASE WHEN COALESCE(ri.visitado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS visited_customers,
          COALESCE(SUM(CASE WHEN COALESCE(ri.venta_registrada, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS sales_count,
          COALESCE(SUM(CASE WHEN COALESCE(ri.pedido_generado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS orders_count,
          (
            COALESCE(r.status, 'planificada') NOT IN ('planificada', 'pendiente')
            OR COALESCE(BOOL_OR(
              ri.id IS NOT NULL AND (
                COALESCE(ri.visitado, 0) <> 0
                OR COALESCE(ri.venta_registrada, 0) <> 0
                OR COALESCE(ri.pedido_generado, 0) <> 0
                OR COALESCE(ri.cobranza_realizada, 0) <> 0
                OR COALESCE(ri.status, 'pendiente') <> 'pendiente'
                OR ri.visited_at IS NOT NULL
                OR NULLIF(BTRIM(COALESCE(ri.notes, '')), '') IS NOT NULL
              )
            ), FALSE)
          ) AS has_activity
        FROM routes r
        LEFT JOIN route_items ri ON ri.route_id = r.id
        WHERE r.date::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
          AND COALESCE(r.status, 'planificada') <> 'cancelada'
        GROUP BY r.id
        ORDER BY r.id DESC
        LIMIT 1
      `
    );

    const route = routeResult.rows[0];
    if (!route) return sendSuccess(res, null, "No hay ruta para hoy");
    const items = await getRouteItems(toNumber(route.id));
    return sendSuccess(res, { ...mapRoute(route), items });
  }

  if (endpoint === "route-lifecycle") {
    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);
    if (!id) return sendError(res, "ID de ruta inválido", 400);

    const parsed = routeLifecycleSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const permissionAction = parsed.data.action === "cancel" ? "delete" : "edit";
    const user = await requireRoutePermission(req, res, permissionAction);
    if (!user) return;

    try {
      const result = await routeLifecycleService.changeStatus({
        routeId: id,
        action: parsed.data.action as RouteLifecycleAction,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });

      const message = parsed.data.action === "finalize"
        ? "Ruta finalizada correctamente"
        : parsed.data.action === "cancel"
          ? "Ruta cancelada correctamente"
          : "Ruta reabierta correctamente";
      return sendSuccess(res, result, message);
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo actualizar el estado de la ruta",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "route-operational-lifecycle") {
    const user = await requireRoutePermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de ruta inválido", 400);
    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

    const parsed = routeOperationalLifecycleSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const result = await routeOperationalLifecycleService.changeStatus({
        routeId: id,
        action: parsed.data.action as RouteOperationalAction,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
        expectedVersion: parsed.data.expectedVersion,
      });
      return sendSuccess(
        res,
        result,
        parsed.data.action === "start"
          ? "Ruta iniciada correctamente"
          : "Ruta devuelta a planificación correctamente",
      );
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo actualizar el estado operativo de la ruta",
        error?.statusCode || 400,
        error?.errors || [],
      );
    }
  }

  if (endpoint === "routes") {
    if (req.method === "GET") {
      const user = await requireRoutePermission(req, res, "view");
      if (!user) return;

      if (id) {
        const routeResult = await pool.query(
          `
            SELECT r.*,
              COUNT(ri.id)::int AS total_customers,
              COALESCE(SUM(CASE WHEN COALESCE(ri.visitado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS visited_customers,
              COALESCE(SUM(CASE WHEN COALESCE(ri.venta_registrada, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS sales_count,
              COALESCE(SUM(CASE WHEN COALESCE(ri.pedido_generado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS orders_count,
          (
            COALESCE(r.status, 'planificada') NOT IN ('planificada', 'pendiente')
            OR COALESCE(BOOL_OR(
              ri.id IS NOT NULL AND (
                COALESCE(ri.visitado, 0) <> 0
                OR COALESCE(ri.venta_registrada, 0) <> 0
                OR COALESCE(ri.pedido_generado, 0) <> 0
                OR COALESCE(ri.cobranza_realizada, 0) <> 0
                OR COALESCE(ri.status, 'pendiente') <> 'pendiente'
                OR ri.visited_at IS NOT NULL
                OR NULLIF(BTRIM(COALESCE(ri.notes, '')), '') IS NOT NULL
              )
            ), FALSE)
          ) AS has_activity
            FROM routes r
            LEFT JOIN route_items ri ON ri.route_id = r.id
            WHERE r.id = $1
            GROUP BY r.id
            LIMIT 1
          `,
          [id]
        );
        const route = routeResult.rows[0];
        if (!route) return sendError(res, "Ruta no encontrada", 404);
        const items = await getRouteItems(id);
        return sendSuccess(res, { ...mapRoute(route), items });
      }

      const result = await pool.query(
        `
          SELECT r.*,
            COUNT(ri.id)::int AS total_customers,
            COALESCE(SUM(CASE WHEN COALESCE(ri.visitado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS visited_customers,
            COALESCE(SUM(CASE WHEN COALESCE(ri.venta_registrada, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS sales_count,
            COALESCE(SUM(CASE WHEN COALESCE(ri.pedido_generado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS orders_count,
          (
            COALESCE(r.status, 'planificada') NOT IN ('planificada', 'pendiente')
            OR COALESCE(BOOL_OR(
              ri.id IS NOT NULL AND (
                COALESCE(ri.visitado, 0) <> 0
                OR COALESCE(ri.venta_registrada, 0) <> 0
                OR COALESCE(ri.pedido_generado, 0) <> 0
                OR COALESCE(ri.cobranza_realizada, 0) <> 0
                OR COALESCE(ri.status, 'pendiente') <> 'pendiente'
                OR ri.visited_at IS NOT NULL
                OR NULLIF(BTRIM(COALESCE(ri.notes, '')), '') IS NOT NULL
              )
            ), FALSE)
          ) AS has_activity
          FROM routes r
          LEFT JOIN route_items ri ON ri.route_id = r.id
          GROUP BY r.id
          ORDER BY r.date DESC, r.id DESC
        `
      );
      return sendSuccess(res, result.rows.map(mapRoute));
    }

    if (req.method === "POST") {
      const user = await requireRoutePermission(req, res, "create");
      if (!user) return;

      const parsed = routeSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })));
      }

      const customerIds = parsed.data.customerIds || parsed.data.clientIds || [];
      if (customerIds.length === 0) return sendError(res, "Seleccione al menos un cliente", 400);

      const activeCustomersResult = await pool.query(
        `SELECT id
         FROM clientes
         WHERE id = ANY($1::int[])
           AND COALESCE(activo, 1) <> 0`,
        [customerIds]
      );
      if (activeCustomersResult.rowCount !== new Set(customerIds.map(Number)).size) {
        return sendError(res, "La ruta contiene uno o más clientes inactivos. Actualizá la selección.", 409);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const routeResult = await client.query(
          `INSERT INTO routes (name, date, status) VALUES ($1, $2, $3) RETURNING id`,
          [parsed.data.name, parsed.data.date, "planificada"]
        );
        const routeId = toNumber(routeResult.rows[0]?.id);
        for (let index = 0; index < customerIds.length; index += 1) {
          await client.query(
            `INSERT INTO route_items (route_id, client_id, order_index, status) VALUES ($1, $2, $3, $4)`,
            [routeId, customerIds[index], index, "pendiente"]
          );
        }
        await client.query("COMMIT");
        return sendSuccess(res, { id: routeId }, "Ruta creada exitosamente", 201);
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al crear ruta", 400);
      } finally {
        client.release();
      }
    }

    if (req.method === "PATCH") {
      const user = await requireRoutePermission(req, res, "edit");
      if (!user) return;
      return sendError(
        res,
        "El cambio directo del estado operativo de la ruta fue deshabilitado. Usá las acciones auditadas.",
        409,
      );
    }

    if (req.method === "DELETE") {
      const user = await requireRoutePermission(req, res, "delete");
      if (!user) return;

      return sendError(
        res,
        "La eliminación física de rutas está deshabilitada. Usá Cancelar para conservar visitas, ventas, pedidos, cobranzas y notas.",
        409
      );
    }

  }

  return sendError(res, "Endpoint de rutas no encontrado", 404);
};



const requireChecklistPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const permissionKey = permissionKeyByAction[action];
  const checklistPermissions = permissions?.checklist;

  if (!checklistPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for checklist", 403);
    return null;
  }

  return decoded;
};

const checklistTemplateSchema = z.object({
  name: z.string().min(2, "Nombre de plantilla requerido").max(200),
  description: z.string().max(2000).optional().nullable(),
  type: z.enum(["Apertura", "Cierre", "Ruta", "General"]).optional().nullable(),
  items: z.array(z.string().trim().min(1).max(500)).min(1, "Debe incluir al menos una tarea").max(200),
});

const checklistTemplateContentSchema = checklistTemplateSchema.extend({
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  expectedContentVersion: z.number().int().min(0),
});

const checklistTemplateLifecycleSchema = z.object({
  action: z.enum(["deactivate", "reactivate"]),
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

const checklistCreateSchema = z.object({
  template_id: z.number(),
  date: z.string().min(10, "Fecha requerida"),
  notes: z.string().optional().nullable(),
});

const checklistUpdateSchema = z.object({
  notes: z.string().optional().nullable(),
}).strict();

const checklistLifecycleSchema = z.object({
  action: z.enum(["finalize", "cancel", "reopen"]),
  motivo: z.string().trim().max(500).optional(),
});

const checklistItemUpdateSchema = z.object({
  completed: z.union([z.number(), z.boolean()]),
  completed_by: z.string().optional().nullable(),
});

const mapChecklistTemplate = (row: any) => ({
  id: toNumber(row.id),
  name: row.name || "",
  description: row.description || "",
  type: row.type || "General",
  active: toNumber(row.active, 1),
  deactivated_at: row.deactivated_at || null,
  deactivated_by: row.deactivated_by || null,
  deactivation_reason: row.deactivation_reason || null,
  reactivated_at: row.reactivated_at || null,
  reactivated_by: row.reactivated_by || null,
  reactivation_reason: row.reactivation_reason || null,
  content_version: toNumber(row.content_version),
  content_changed_at: row.content_changed_at || null,
  content_changed_by: row.content_changed_by || null,
  content_change_reason: row.content_change_reason || null,
  created_at: row.created_at || null,
});

const mapChecklistItem = (row: any) => ({
  id: toNumber(row.id),
  checklist_id: toNumber(row.checklist_id),
  task_name: row.task_name || "",
  completed: toNumber(row.completed),
  completed_at: row.completed_at || null,
  completed_by: row.completed_by || null,
});

const mapChecklist = (row: any, items?: any[]) => ({
  id: toNumber(row.id),
  template_id: toNumber(row.template_id),
  template_name: row.template_name || "",
  date: typeof row.date === "string" ? row.date.slice(0, 10) : row.date,
  status: row.status || "pendiente",
  notes: row.notes || "",
  created_at: row.created_at || null,
  completed_at: row.completed_at || null,
  completed_by: row.completed_by || null,
  lifecycle_version: toNumber(row.lifecycle_version),
  cancelled_at: row.cancelled_at || null,
  cancelled_by: row.cancelled_by || null,
  cancel_reason: row.cancel_reason || null,
  cancelled_from_status: row.cancelled_from_status || null,
  reopened_at: row.reopened_at || null,
  reopened_by: row.reopened_by || null,
  reopen_reason: row.reopen_reason || null,
  finalization_version: toNumber(row.finalization_version),
  finalized_at: row.finalized_at || null,
  finalized_by: row.finalized_by || null,
  finalization_reason: row.finalization_reason || null,
  finalized_from_status: row.finalized_from_status || null,
  total_tasks: toNumber(row.total_tasks),
  completed_tasks: toNumber(row.completed_tasks),
  ...(items ? { items: items.map(mapChecklistItem) } : {}),
});

const getChecklistItems = async (pool: any, checklistId: number) => {
  const itemsResult = await pool.query(
    `
      SELECT id, checklist_id, task_name, completed, completed_at, completed_by
      FROM checklist_items
      WHERE checklist_id = $1
      ORDER BY id ASC
    `,
    [checklistId]
  );

  return itemsResult.rows;
};

const getChecklistProgress = async (pool: any, checklistId: number) => {
  const countsResult = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN COALESCE(completed, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS completed
      FROM checklist_items
      WHERE checklist_id = $1
    `,
    [checklistId]
  );

  return {
    total: toNumber(countsResult.rows[0]?.total),
    completed: toNumber(countsResult.rows[0]?.completed),
  };
};

const handleChecklist = async (req: any, res: any) => {
  const endpoint = getEndpoint(req);
  const id = getId(req);
  const pool = getPostgresPool();

  if (endpoint === "checklist-templates") {
    if (req.method === "GET") {
      const user = await requireChecklistPermission(req, res, "view");
      if (!user) return;

      try {
        const result = await pool.query(
          `
            SELECT id, name, description, type, active,
                   deactivated_at, deactivated_by, deactivation_reason,
                   reactivated_at, reactivated_by, reactivation_reason,
                   content_version, content_changed_at, content_changed_by, content_change_reason,
                   created_at
            FROM checklist_templates
            ORDER BY created_at DESC, id DESC
          `
        );

        return sendSuccess(res, result.rows.map(mapChecklistTemplate));
      } catch (error: any) {
        return sendError(res, error?.message || "Error al obtener plantillas", 400);
      }
    }

    if (req.method === "POST") {
      const user = await requireChecklistPermission(req, res, "create");
      if (!user) return;

      const parsed = checklistTemplateSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const templateResult = await client.query(
          `
            INSERT INTO checklist_templates (name, description, type, active)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `,
          [
            parsed.data.name,
            parsed.data.description || null,
            parsed.data.type || "General",
            1,
          ]
        );

        const templateId = toNumber(templateResult.rows[0]?.id);

        for (const taskName of parsed.data.items) {
          await client.query(
            `INSERT INTO checklist_template_items (template_id, task_name) VALUES ($1, $2)`,
            [templateId, taskName.trim()]
          );
        }

        await client.query("COMMIT");
        return sendSuccess(res, { id: templateId }, "Plantilla creada exitosamente", 201);
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al crear plantilla", 400);
      } finally {
        client.release();
      }
    }

    return sendError(res, "Method not allowed", 405);
  }

  if (endpoint === "checklist-template") {
    if (!id) return sendError(res, "ID de plantilla inválido", 400);

    if (req.method === "GET") {
      const user = await requireChecklistPermission(req, res, "view");
      if (!user) return;

      try {
        const templateResult = await pool.query(
          `
            SELECT id, name, description, type, active,
                   deactivated_at, deactivated_by, deactivation_reason,
                   reactivated_at, reactivated_by, reactivation_reason,
                   content_version, content_changed_at, content_changed_by, content_change_reason,
                   created_at
            FROM checklist_templates
            WHERE id = $1
            LIMIT 1
          `,
          [id]
        );

        if (!templateResult.rowCount) return sendError(res, "Plantilla no encontrada", 404);

        const itemsResult = await pool.query(
          `
            SELECT id, template_id, task_name
            FROM checklist_template_items
            WHERE template_id = $1
            ORDER BY id ASC
          `,
          [id]
        );

        return sendSuccess(res, {
          ...mapChecklistTemplate(templateResult.rows[0]),
          items: itemsResult.rows.map((row: any) => ({
            id: toNumber(row.id),
            template_id: toNumber(row.template_id),
            task_name: row.task_name || "",
          })),
        });
      } catch (error: any) {
        return sendError(res, error?.message || "Error al obtener plantilla", 400);
      }
    }

    if (req.method === "PUT") {
      const user = await requireChecklistPermission(req, res, "edit");
      if (!user) return;

      const parsed = checklistTemplateContentSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })));
      }

      try {
        const result = await checklistTemplateContentLifecycleService.update({
          templateId: id,
          name: parsed.data.name,
          description: parsed.data.description || null,
          type: parsed.data.type || "General",
          items: parsed.data.items,
          motivo: parsed.data.motivo,
          usuario: user.userName || "Sistema",
          expectedContentVersion: parsed.data.expectedContentVersion,
        });
        return sendSuccess(res, result, "Plantilla actualizada exitosamente");
      } catch (error: any) {
        return sendError(res, error?.message || "Error al actualizar plantilla", error?.statusCode || 400);
      }
    }

    if (req.method === "DELETE") {
      const user = await requireChecklistPermission(req, res, "delete");
      if (!user) return;
      return sendError(
        res,
        "La eliminación física de plantillas está deshabilitada. Usá Dar de baja.",
        405
      );
    }

    return sendError(res, "Method not allowed", 405);
  }

  if (endpoint === "checklist-template-status") {
    if (!id) return sendError(res, "ID de plantilla inválido", 400);
    if (req.method !== "PATCH") return sendError(res, "Method not allowed", 405);

    const parsed = checklistTemplateLifecycleSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const action = parsed.data.action as ChecklistTemplateLifecycleAction;
    const permission = action === "deactivate" ? "delete" : "edit";
    const user = await requireChecklistPermission(req, res, permission);
    if (!user) return;

    try {
      const result = await checklistTemplateLifecycleService.changeStatus({
        templateId: id,
        action,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(
        res,
        result,
        action === "deactivate" ? "Plantilla dada de baja correctamente" : "Plantilla reactivada correctamente"
      );
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al actualizar el estado de la plantilla",
        error?.statusCode || 400
      );
    }
  }

  if (endpoint === "checklists") {
    if (req.method === "GET") {
      const user = await requireChecklistPermission(req, res, "view");
      if (!user) return;

      try {
        const result = await pool.query(
          `
            SELECT
              c.id,
              c.template_id,
              c.date,
              c.status,
              c.notes,
              c.created_at,
              c.completed_at,
              c.completed_by,
              c.lifecycle_version,
              c.cancelled_at,
              c.cancelled_by,
              c.cancel_reason,
              c.cancelled_from_status,
              c.reopened_at,
              c.reopened_by,
              c.reopen_reason,
              t.name AS template_name,
              COUNT(ci.id)::int AS total_tasks,
              COALESCE(SUM(CASE WHEN COALESCE(ci.completed, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS completed_tasks
            FROM checklists c
            JOIN checklist_templates t ON c.template_id = t.id
            LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
            GROUP BY c.id, t.name
            ORDER BY c.date DESC, c.created_at DESC, c.id DESC
          `
        );

        return sendSuccess(res, result.rows.map((row: any) => mapChecklist(row)));
      } catch (error: any) {
        return sendError(res, error?.message || "Error al obtener checklists", 400);
      }
    }

    if (req.method === "POST") {
      const user = await requireChecklistPermission(req, res, "create");
      if (!user) return;

      const parsed = checklistCreateSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const templateResult = await client.query(
          `SELECT id, active FROM checklist_templates WHERE id = $1 LIMIT 1 FOR SHARE`,
          [parsed.data.template_id]
        );
        if (!templateResult.rowCount) {
          throw Object.assign(new Error("Plantilla no encontrada"), { statusCode: 404 });
        }
        if (toNumber(templateResult.rows[0]?.active) !== 1) {
          throw Object.assign(
            new Error("La plantilla está inactiva y no puede iniciar nuevos checklists."),
            { statusCode: 409 }
          );
        }

        const checklistResult = await client.query(
          `
            INSERT INTO checklists (template_id, date, notes, status, lifecycle_version)
            VALUES ($1, $2, $3, $4, 1)
            RETURNING id
          `,
          [
            parsed.data.template_id,
            parsed.data.date,
            parsed.data.notes || null,
            "pendiente",
          ]
        );

        const checklistId = toNumber(checklistResult.rows[0]?.id);

        const templateItemsResult = await client.query(
          `
            SELECT task_name
            FROM checklist_template_items
            WHERE template_id = $1
            ORDER BY id ASC
          `,
          [parsed.data.template_id]
        );

        for (const item of templateItemsResult.rows) {
          await client.query(
            `INSERT INTO checklist_items (checklist_id, task_name, completed) VALUES ($1, $2, $3)`,
            [checklistId, item.task_name, 0]
          );
        }

        await client.query("COMMIT");
        return sendSuccess(res, { id: checklistId }, "Checklist iniciado exitosamente", 201);
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al iniciar checklist", error?.statusCode || 400);
      } finally {
        client.release();
      }
    }

    return sendError(res, "Method not allowed", 405);
  }

  if (endpoint === "checklists-today") {
    const user = await requireChecklistPermission(req, res, "view");
    if (!user) return;
    if (req.method !== "GET") return sendError(res, "Method not allowed", 405);

    try {
      const result = await pool.query(
        `
          SELECT
            c.id,
            c.template_id,
            c.date,
            c.status,
            c.notes,
            c.created_at,
            c.completed_at,
            c.completed_by,
            c.lifecycle_version,
            c.cancelled_at,
            c.cancelled_by,
            c.cancel_reason,
            c.cancelled_from_status,
            c.reopened_at,
            c.reopened_by,
            c.reopen_reason,
            t.name AS template_name
          FROM checklists c
          JOIN checklist_templates t ON c.template_id = t.id
          WHERE c.date::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
            AND c.status = 'pendiente'
          ORDER BY c.created_at DESC, c.id DESC
        `
      );

      const checklists = [];
      for (const row of result.rows) {
        const items = await getChecklistItems(pool, toNumber(row.id));
        checklists.push(mapChecklist(row, items));
      }

      return sendSuccess(res, checklists);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener checklists de hoy", 400);
    }
  }

  if (endpoint === "checklist") {
    if (!id) return sendError(res, "ID de checklist inválido", 400);

    if (req.method === "GET") {
      const user = await requireChecklistPermission(req, res, "view");
      if (!user) return;

      try {
        const checklistResult = await pool.query(
          `
            SELECT
              c.id,
              c.template_id,
              c.date,
              c.status,
              c.notes,
              c.created_at,
              c.completed_at,
              c.completed_by,
              c.lifecycle_version,
              c.cancelled_at,
              c.cancelled_by,
              c.cancel_reason,
              c.cancelled_from_status,
              c.reopened_at,
              c.reopened_by,
              c.reopen_reason,
              t.name AS template_name
            FROM checklists c
            JOIN checklist_templates t ON c.template_id = t.id
            WHERE c.id = $1
            LIMIT 1
          `,
          [id]
        );

        if (!checklistResult.rowCount) return sendError(res, "Checklist no encontrado", 404);

        const items = await getChecklistItems(pool, id);
        return sendSuccess(res, mapChecklist(checklistResult.rows[0], items));
      } catch (error: any) {
        return sendError(res, error?.message || "Error al obtener checklist", 400);
      }
    }

    if (req.method === "PATCH") {
      const user = await requireChecklistPermission(req, res, "edit");
      if (!user) return;

      const parsed = checklistUpdateSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(res, "El estado del checklist debe cambiarse desde Finalizar, Cancelar o Reabrir", 400, parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const currentResult = await client.query(
          `SELECT id, status FROM checklists WHERE id = $1 LIMIT 1 FOR UPDATE`,
          [id]
        );
        if (!currentResult.rowCount) throw Object.assign(new Error("Checklist no encontrado"), { statusCode: 404 });
        if (String(currentResult.rows[0]?.status || "pendiente").toLowerCase() !== "pendiente") {
          throw Object.assign(new Error("El checklist está cerrado. Reabrilo antes de editar sus notas."), { statusCode: 409 });
        }

        await client.query(`UPDATE checklists SET notes = COALESCE($1, notes) WHERE id = $2`, [parsed.data.notes ?? null, id]);
        await client.query("COMMIT");
        return sendSuccess(res, null, "Checklist actualizado");
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al actualizar checklist", error?.statusCode || 400);
      } finally {
        client.release();
      }
    }

    return sendError(res, "Method not allowed", 405);
  }

  if (endpoint === "checklist-status") {
    if (!id) return sendError(res, "ID de checklist inválido", 400);
    if (req.method !== "PATCH") return sendError(res, "Method not allowed", 405);

    const parsed = checklistLifecycleSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const action = parsed.data.action as ChecklistLifecycleAction;
    const permission = action === "cancel" ? "delete" : "edit";
    const user = await requireChecklistPermission(req, res, permission);
    if (!user) return;

    try {
      const result = await checklistLifecycleService.changeStatus({
        checklistId: id,
        action,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });
      const message = action === "finalize"
        ? "Checklist finalizado correctamente"
        : action === "cancel"
          ? "Checklist cancelado correctamente"
          : "Checklist reabierto correctamente";
      return sendSuccess(res, result, message);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al cambiar el estado del checklist", error?.statusCode || 400);
    }
  }

  if (endpoint === "checklist-item") {
    const user = await requireChecklistPermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de ítem inválido", 400);
    if (req.method !== "PATCH") return sendError(res, "Method not allowed", 405);

    const parsed = checklistItemUpdateSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const itemLookup = await client.query(
        `SELECT ci.id, ci.checklist_id, c.status
         FROM checklist_items ci
         JOIN checklists c ON c.id = ci.checklist_id
         WHERE ci.id = $1
         LIMIT 1
         FOR UPDATE OF ci, c`,
        [id]
      );
      if (!itemLookup.rowCount) throw Object.assign(new Error("Tarea de checklist no encontrada"), { statusCode: 404 });
      if (String(itemLookup.rows[0]?.status || "pendiente").toLowerCase() !== "pendiente") {
        throw Object.assign(new Error("El checklist está cerrado. Reabrilo antes de modificar sus tareas."), { statusCode: 409 });
      }

      const completed = toIntFlag(parsed.data.completed);
      const completedAt = completed ? new Date().toISOString() : null;
      const itemResult = await client.query(
        `UPDATE checklist_items
         SET completed = $1, completed_at = $2, completed_by = $3
         WHERE id = $4
         RETURNING id, checklist_id, task_name, completed, completed_at, completed_by`,
        [completed, completedAt, parsed.data.completed_by || null, id]
      );

      const checklistId = toNumber(itemLookup.rows[0]?.checklist_id);
      const progress = await getChecklistProgress(client, checklistId);
      await client.query("COMMIT");

      return sendSuccess(res, {
        item: mapChecklistItem(itemResult.rows[0]),
        checklist: {
          id: checklistId,
          status: "pendiente",
          completed_at: null,
          total_tasks: progress.total,
          completed_tasks: progress.completed,
        },
      }, completed ? "Tarea marcada como completada" : "Tarea marcada como pendiente");
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al actualizar item", error?.statusCode || 400);
    } finally {
      client.release();
    }
  }

  if (endpoint === "checklist-summary") {
    const user = await requireChecklistPermission(req, res, "view");
    if (!user) return;
    if (req.method !== "GET") return sendError(res, "Method not allowed", 405);

    try {
      const [
        routeClientsResult,
        pendingMoneyResult,
        criticalStockResult,
        pendingSupplierOrdersResult,
      ] = await Promise.all([
        pool.query(
          `
            SELECT COUNT(*)::int AS count
            FROM route_items ri
            JOIN routes r ON ri.route_id = r.id
            WHERE r.date::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
          `
        ),
        pool.query(`SELECT COALESCE(SUM(monto_pendiente), 0) AS total FROM sales WHERE monto_pendiente > 0 AND COALESCE(estado, '') <> 'Anulada'`),
        pool.query(`SELECT COUNT(*)::int AS count FROM products WHERE stock <= stock_minimo AND eliminado = 0`),
        pool.query(`SELECT COUNT(*)::int AS count FROM supplier_orders WHERE estado = 'pendiente'`),
      ]);

      return sendSuccess(res, {
        routeClients: toNumber(routeClientsResult.rows[0]?.count),
        pendingMoney: toNumber(pendingMoneyResult.rows[0]?.total),
        criticalStock: toNumber(criticalStockResult.rows[0]?.count),
        pendingSupplierOrders: toNumber(pendingSupplierOrdersResult.rows[0]?.count),
      });
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener resumen", 400);
    }
  }

  return sendError(res, "Endpoint de checklist no encontrado", 404);
};



const portalLoginSchema = z.object({
  username: z.string().min(1, "Usuario requerido"),
  password: z.string().min(1, "Contraseña requerida"),
});

const portalOrderSchema = z.object({
  items: z.array(z.object({
    product_id: z.number(),
    cantidad: z.number().positive(),
  })).min(1, "Debe incluir al menos un producto"),
});

const requirePortalCustomer = async (req: any, res: any) => {
  const token = getBearerToken(req);

  if (!token) {
    sendError(res, "Unauthorized: Login cliente requerido", 401);
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId || decoded.role !== "cliente") {
    sendError(res, "Unauthorized: Login cliente requerido", 401);
    return null;
  }

  const pool = getPostgresPool();
  const customerResult = await pool.query(
    `SELECT id
     FROM clientes
     WHERE id = $1
       AND COALESCE(activo, 1) <> 0
       AND COALESCE(portal_enabled, 0) <> 0
     LIMIT 1`,
    [Number(decoded.userId)]
  );

  if (!customerResult.rowCount) {
    sendError(res, "El acceso al portal de este cliente está deshabilitado", 403);
    return null;
  }

  return decoded;
};

const mapPortalOrder = (row: any, items: any[] = []) => {
  const estado = row.estado || "pendiente_aprobacion";
  const hasShortage = items.some((item: any) => toNumber(item.faltante) > 0);
  const stockStatus =
    estado === "aprobado_pendiente_entrega"
      ? (hasShortage ? "esperando_stock" : "listo_entrega")
      : null;

  return {
    id: toNumber(row.id),
    numero_pedido: toNumber(row.numero_pedido),
    cliente_id: toNumber(row.cliente_id),
    cliente: row.cliente || "",
    fecha: row.fecha,
    estado,
    stock_status: stockStatus,
    subtotal: toNumber(row.subtotal),
    descuento_tipo: row.descuento_tipo || "none",
    descuento_valor: toNumber(row.descuento_valor),
    descuento_monto: toNumber(row.descuento_monto),
    total_final: toNumber(row.total_final),
    sale_id: row.sale_id === null || row.sale_id === undefined ? null : toNumber(row.sale_id),
    numero_venta: row.numero_venta || null,
    sale_total: toNumber(row.sale_total),
    sale_monto_pagado: toNumber(row.sale_monto_pagado),
    sale_monto_pendiente: toNumber(row.sale_monto_pendiente),
    sale_estado: row.sale_estado || null,
    admin_notes: row.admin_notes || "",
    rejection_reason: row.rejection_reason || "",
    cancel_reason: row.cancel_reason || "",
    aprobado_at: row.aprobado_at || null,
    entregado_at: row.entregado_at || null,
    rejected_at: row.rejected_at || null,
    cancelled_at: row.cancelled_at || null,
    cancelled_by: row.cancelled_by || "",
    cancellation_source: row.cancellation_source || "",
    cancelled_from_status: row.cancelled_from_status || "",
    items,
  };
};

const fetchPortalOrderItems = async (pool: any, orderIds: number[]) => {
  if (!orderIds.length) return new Map<number, any[]>();

  const result = await pool.query(
    `
      SELECT
        coi.id,
        coi.order_id,
        coi.product_id,
        coi.cantidad,
        coi.precio_unitario,
        (coi.cantidad * coi.precio_unitario) AS importe,
        p.name AS product_name,
        p.code,
        p.codigo_unico,
        COALESCE(p.stock, 0) AS stock_actual
      FROM customer_order_items coi
      JOIN products p ON p.id = coi.product_id
      WHERE coi.order_id = ANY($1::int[])
      ORDER BY coi.id ASC
    `,
    [orderIds]
  );

  const grouped = new Map<number, any[]>();
  for (const row of result.rows) {
    const orderId = toNumber(row.order_id);
    if (!grouped.has(orderId)) grouped.set(orderId, []);
    grouped.get(orderId)!.push({
      id: toNumber(row.id),
      order_id: orderId,
      product_id: toNumber(row.product_id),
      product_name: row.product_name,
      code: row.code || row.codigo_unico || "",
      cantidad: toNumber(row.cantidad),
      precio_unitario: toNumber(row.precio_unitario),
      importe: toNumber(row.importe),
      stock_actual: toNumber(row.stock_actual),
      faltante: Math.max(0, toNumber(row.cantidad) - toNumber(row.stock_actual)),
    });
  }

  return grouped;
};

const handleCustomerPortal = async (req: any, res: any) => {
  const endpoint = getEndpoint(req);
  const pool = getPostgresPool();

  if (endpoint === "portal-login") {
    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

    const parsed = portalLoginSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    const result = await pool.query(
      `
        SELECT id, nombre_apellido, razon_social, portal_username, portal_password_hash, portal_enabled, saldo_cta_cte
        FROM clientes
        WHERE portal_username = $1
          AND COALESCE(portal_enabled, 0) <> 0
          AND COALESCE(activo, 1) <> 0
        LIMIT 1
      `,
      [parsed.data.username]
    );

    const cliente = result.rows[0];
    if (!cliente?.portal_password_hash || !bcrypt.compareSync(parsed.data.password, cliente.portal_password_hash)) {
      return sendError(res, "Usuario o contraseña inválidos", 401);
    }

    const token = generateToken({
      userId: toNumber(cliente.id),
      role: "cliente",
      userName: cliente.nombre_apellido,
    });

    return sendSuccess(res, {
      token,
      cliente: {
        id: toNumber(cliente.id),
        nombre_apellido: cliente.nombre_apellido,
        razon_social: cliente.razon_social,
        saldo_cta_cte: toNumber(cliente.saldo_cta_cte),
      },
    });
  }

  const portalUser = await requirePortalCustomer(req, res);
  if (!portalUser) return;
  const clienteId = Number(portalUser.userId);

  if (endpoint === "portal-me") {
    if (req.method !== "GET") return sendError(res, "Method not allowed", 405);

    const result = await pool.query(
      `SELECT id, nombre_apellido, razon_social, telefono, email, direccion, localidad, saldo_cta_cte
       FROM clientes
       WHERE id = $1
         AND COALESCE(portal_enabled, 0) <> 0
         AND COALESCE(activo, 1) <> 0
       LIMIT 1`,
      [clienteId]
    );

    if (!result.rowCount) return sendError(res, "Cliente no encontrado", 404);
    return sendSuccess(res, {
      ...result.rows[0],
      id: toNumber(result.rows[0].id),
      saldo_cta_cte: toNumber(result.rows[0].saldo_cta_cte),
    });
  }

  if (endpoint === "portal-products") {
    if (req.method !== "GET") return sendError(res, "Method not allowed", 405);

    const result = await pool.query(
      `
        SELECT p.id, p.code, p.codigo_unico, p.name, p.description, p.sale_price, p.stock, pf.name AS family_name, pc.name AS category_name
        FROM products p
        LEFT JOIN product_families pf ON pf.id = p.family_id
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE COALESCE(p.eliminado, 0) = 0
          AND COALESCE(p.estado, 'activo') = 'activo'
        ORDER BY p.name ASC
      `
    );

    return sendSuccess(res, result.rows.map((row: any) => ({
      id: toNumber(row.id),
      code: row.codigo_unico || row.code || "",
      name: row.name,
      description: row.description || "",
      sale_price: toNumber(row.sale_price),
      stock: toNumber(row.stock),
      family_name: row.family_name || "",
      category_name: row.category_name || "",
    })));
  }

  if (endpoint === "portal-orders") {
    if (req.method === "GET") {
      const ordersResult = await pool.query(
        `
          SELECT
            co.*,
            c.nombre_apellido AS cliente,
            s.numero_venta,
            s.total AS sale_total,
            s.monto_pagado AS sale_monto_pagado,
            s.monto_pendiente AS sale_monto_pendiente,
            s.estado AS sale_estado
          FROM customer_orders co
          JOIN clientes c ON c.id = co.cliente_id
          LEFT JOIN sales s ON s.id = co.sale_id
          WHERE co.cliente_id = $1
          ORDER BY co.fecha DESC, co.id DESC
        `,
        [clienteId]
      );

      const orderIds = ordersResult.rows.map((row: any) => toNumber(row.id));
      const itemsByOrder = await fetchPortalOrderItems(pool, orderIds);
      return sendSuccess(res, ordersResult.rows.map((row: any) => mapPortalOrder(row, itemsByOrder.get(toNumber(row.id)) || [])));
    }

    if (req.method === "POST") {
      const parsed = portalOrderSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO settings (key, value) VALUES ('next_customer_order_number', '1') ON CONFLICT (key) DO NOTHING`
        );
        const numberResult = await client.query(`SELECT value FROM settings WHERE key = 'next_customer_order_number' LIMIT 1`);
        const nextNumber = parseInt(numberResult.rows[0]?.value || "1", 10) || 1;
        await client.query(`UPDATE settings SET value = $1 WHERE key = 'next_customer_order_number'`, [String(nextNumber + 1)]);

        const productIds = parsed.data.items.map((item) => item.product_id);
        const productResult = await client.query(
          `SELECT id, name, sale_price FROM products WHERE id = ANY($1::int[]) AND COALESCE(eliminado, 0) = 0`,
          [productIds]
        );
        const productMap = new Map<number, any>(productResult.rows.map((row: any) => [toNumber(row.id), row]));

        let subtotal = 0;
        for (const item of parsed.data.items) {
          const product = productMap.get(item.product_id);
          if (!product) throw new Error(`Producto inválido: ${item.product_id}`);
          subtotal += toNumber(item.cantidad) * toNumber(product.sale_price);
        }

        const orderResult = await client.query(
          `
            INSERT INTO customer_orders (numero_pedido, cliente_id, estado, subtotal, descuento_tipo, descuento_valor, descuento_monto, total_final)
            VALUES ($1, $2, 'pendiente_aprobacion', $3, 'none', 0, 0, $3)
            RETURNING id
          `,
          [nextNumber, clienteId, subtotal]
        );

        const orderId = toNumber(orderResult.rows[0]?.id);

        for (const item of parsed.data.items) {
          const product = productMap.get(item.product_id);
          await client.query(
            `INSERT INTO customer_order_items (order_id, product_id, cantidad, precio_unitario)
             VALUES ($1, $2, $3, $4)`,
            [orderId, item.product_id, item.cantidad, toNumber(product.sale_price)]
          );
        }

        await client.query("COMMIT");
        return sendSuccess(res, { id: orderId, numero_pedido: nextNumber }, "Pedido enviado para aprobación", 201);
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al crear pedido", 400);
      } finally {
        client.release();
      }
    }

    return sendError(res, "Method not allowed", 405);
  }

  if (endpoint === "portal-order-cancel") {
    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);
    const orderId = getId(req);
    if (!orderId) return sendError(res, "ID de pedido inválido", 400);

    const reason = String(getBody(req)?.motivo || "").trim();

    try {
      const result = await customerOrderCancellationService.cancelCustomerOrder({
        customerOrderId: orderId,
        motivo: reason,
        usuario: `Cliente #${clienteId}`,
        source: "customer_portal",
        customerId: clienteId,
      });

      return sendSuccess(res, result, "Pedido cancelado");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo cancelar el pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }


  if (endpoint === "portal-sale-detail") {
    if (req.method !== "GET") return sendError(res, "Method not allowed", 405);
    const saleId = getId(req);
    if (!saleId) return sendError(res, "ID de venta inválido", 400);

    const saleResult = await pool.query(
      `SELECT
         s.*,
         c.nombre_apellido AS nombre_cliente,
         c.telefono AS cliente_telefono,
         c.direccion AS cliente_direccion,
         c.localidad AS cliente_localidad,
         sc.monto_pagado_original,
         sc.monto_pendiente_original,
         sc.motivo AS cancellation_motivo,
         sc.anulada_por AS cancellation_anulada_por,
         sc.anulada_at AS cancellation_anulada_at
       FROM sales s
       JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN sale_cancellations sc ON sc.sale_id = s.id
       WHERE s.id = $1
         AND s.cliente_id = $2
       LIMIT 1`,
      [saleId, clienteId]
    );

    if (!saleResult.rowCount) {
      return sendError(res, "Venta no encontrada", 404);
    }

    const itemsResult = await pool.query(
      `SELECT
         si.id,
         si.product_id,
         si.cantidad,
         si.precio_venta,
         si.precio_unitario_original,
         si.bonificacion_tipo,
         si.bonificacion_valor,
         si.precio_unitario_bonificado,
         p.name AS product_name
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1
       ORDER BY si.id ASC`,
      [saleId]
    );

    const sale = saleResult.rows[0];
    return sendSuccess(res, {
      ...sale,
      id: toNumber(sale.id),
      total: toNumber(sale.total),
      monto_pagado: toNumber(sale.monto_pagado),
      monto_pendiente: toNumber(sale.monto_pendiente),
      items: itemsResult.rows.map((item: any) => ({
        ...item,
        id: toNumber(item.id),
        product_id: toNumber(item.product_id),
        cantidad: toNumber(item.cantidad),
        precio_venta: toNumber(item.precio_venta),
        precio_unitario_original: toNumber(item.precio_unitario_original),
        bonificacion_valor: toNumber(item.bonificacion_valor),
        precio_unitario_bonificado: toNumber(item.precio_unitario_bonificado),
      })),
    });
  }

  if (endpoint === "portal-movements") {
    if (req.method !== "GET") return sendError(res, "Method not allowed", 405);

    const [salesResult, movementsResult] = await Promise.all([
      pool.query(
        `SELECT
           s.id,
           s.numero_venta,
           s.fecha,
           s.total,
           s.monto_pagado,
           s.monto_pendiente,
           s.estado,
           s.metodo_pago,
           s.anulada_at,
           s.anulada_por,
           s.anulacion_motivo,
           co.numero_pedido,
           COALESCE((
             SELECT SUM(
               GREATEST(
                 0,
                 (COALESCE(si.precio_unitario_original, si.precio_venta) - COALESCE(si.precio_unitario_bonificado, si.precio_venta)) * si.cantidad
               )
             )
             FROM sale_items si
             WHERE si.sale_id = s.id
           ), 0) AS descuento_total
         FROM sales s
         LEFT JOIN customer_orders co ON co.sale_id = s.id
         WHERE s.cliente_id = $1
         ORDER BY s.fecha DESC, s.id DESC`,
        [clienteId]
      ),
      pool.query(
        `SELECT
           mf.id,
           mf.fecha,
           mf.tipo,
           mf.origen,
           mf.descripcion,
           mf.forma_pago,
           mf.monto,
           mf.numero_pago,
           mf.venta_id,
           mf.estado,
           mf.reversion_version,
           mf.anulada_at,
           mf.anulada_por,
           mf.anulacion_motivo,
           mf.reversed_movement_id,
           mf.client_payment_cancellation_id,
           mf.route_item_id,
           s.numero_venta,
           co.numero_pedido
         FROM movimientos_financieros mf
         LEFT JOIN sales s ON s.id = mf.venta_id
         LEFT JOIN customer_orders co ON co.sale_id = s.id
         WHERE mf.cliente_id = $1
         ORDER BY mf.fecha DESC, mf.id DESC`,
        [clienteId]
      ),
    ]);

    return sendSuccess(res, {
      sales: salesResult.rows.map((row: any) => ({
        ...row,
        id: toNumber(row.id),
        total: toNumber(row.total),
        monto_pagado: toNumber(row.monto_pagado),
        monto_pendiente: toNumber(row.monto_pendiente),
        descuento_total: toNumber(row.descuento_total),
        payment_status: getSalePaymentStatus(row),
      })),
      movements: movementsResult.rows.map((row: any) => ({
        ...row,
        id: toNumber(row.id),
        monto: toNumber(row.monto),
        payment_status: String(row.estado || "Activo").toLowerCase() === "anulado" ? "cancelled" : "paid",
        estado: row.estado || "Activo",
        reversion_version: toNumber(row.reversion_version),
        anulada_at: row.anulada_at || null,
        anulada_por: row.anulada_por || null,
        anulacion_motivo: row.anulacion_motivo || null,
        reversed_movement_id: row.reversed_movement_id ? toNumber(row.reversed_movement_id) : null,
        client_payment_cancellation_id: row.client_payment_cancellation_id ? toNumber(row.client_payment_cancellation_id) : null,
        route_item_id: row.route_item_id ? toNumber(row.route_item_id) : null,
      })),
    });
  }

  return sendError(res, "Endpoint portal cliente no encontrado", 404);
};


const handleClientAccountAdmin = async (req: any, res: any) => {
  const endpoint = getEndpoint(req);
  const id = getId(req);

  if (!id) {
    return sendError(res, "ID de cliente inválido", 400);
  }

  if (endpoint === "client-payment") {
    const user = await requireClientPermission(req, res, "edit");
    if (!user) return;
    if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

    const body = getBody(req);
    const amount = Number(body?.monto || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return sendError(res, "El monto debe ser mayor a cero", 400);
    }

    try {
      const result = await salesService.registerClientPayment({
        cliente_id: id,
        monto: amount,
        metodo_pago: String(body?.metodo_pago || "").trim(),
        fecha: body?.fecha || undefined,
        observaciones: body?.observaciones || undefined,
        cheque_data: body?.cheque_data || undefined,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(res, result, "Pago registrado exitosamente", 201);
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al registrar el pago",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  const user = await requireClientPermission(req, res, "view");
  if (!user) return;
  if (req.method !== "GET") return sendError(res, "Method not allowed", 405);

  const pool = getPostgresPool();

  if (endpoint === "client-detail") {
    try {
      const [clientResult, salesResult, totalsResult, pendingOrdersResult, topProductsResult] = await Promise.all([
        pool.query(
          `SELECT *
           FROM clientes
           WHERE id = $1
           LIMIT 1`,
          [id]
        ),
        pool.query(
          `SELECT
             s.id,
             s.numero_venta,
             s.fecha,
             s.total,
             s.monto_pagado,
             s.monto_pendiente,
             s.estado,
             s.metodo_pago,
             s.notes,
             s.anulada_at,
             s.anulada_por,
             s.anulacion_motivo,
             co.numero_pedido,
             COALESCE((
               SELECT SUM(
                 GREATEST(
                   0,
                   (COALESCE(si.precio_unitario_original, si.precio_venta) - COALESCE(si.precio_unitario_bonificado, si.precio_venta)) * si.cantidad
                 )
               )
               FROM sale_items si
               WHERE si.sale_id = s.id
             ), 0) AS descuento_total
           FROM sales s
           LEFT JOIN customer_orders co ON co.sale_id = s.id
           WHERE s.cliente_id = $1
           ORDER BY s.fecha DESC, s.id DESC`,
          [id]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total_sales,
             COALESCE(SUM(total), 0) AS total_purchased,
             COALESCE(SUM(monto_pagado), 0) AS total_paid,
             COALESCE(SUM(monto_pendiente), 0) AS total_pending,
             COALESCE(AVG(total), 0) AS average_ticket
           FROM sales
           WHERE cliente_id = $1
             AND COALESCE(estado, '') <> 'Anulada'`,
          [id]
        ),
        pool.query(
          `SELECT
             co.id,
             co.numero_pedido,
             co.fecha,
             co.estado,
             coi.cantidad AS quantity,
             p.name AS product_name,
             p.company
           FROM customer_orders co
           JOIN customer_order_items coi ON coi.order_id = co.id
           JOIN products p ON p.id = coi.product_id
           WHERE co.cliente_id = $1
             AND co.estado IN ('pendiente_aprobacion', 'aprobado_pendiente_entrega')
           ORDER BY co.fecha DESC, co.id DESC, coi.id ASC`,
          [id]
        ),
        pool.query(
          `SELECT
             p.id,
             p.name,
             p.company,
             COALESCE(SUM(si.cantidad), 0) AS quantity,
             COALESCE(SUM(si.cantidad * si.precio_venta), 0) AS amount
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           JOIN products p ON p.id = si.product_id
           WHERE s.cliente_id = $1
             AND COALESCE(s.estado, '') <> 'Anulada'
           GROUP BY p.id, p.name, p.company
           ORDER BY quantity DESC, amount DESC
           LIMIT 5`,
          [id]
        ),
      ]);

      if (!clientResult.rowCount) {
        return sendError(res, "Cliente no encontrado", 404);
      }

      const cliente = clientResult.rows[0];
      const totals = totalsResult.rows[0] || {};
      const sales = salesResult.rows.map((row: any) => ({
        ...row,
        id: toNumber(row.id),
        total: toNumber(row.total),
        monto_pagado: toNumber(row.monto_pagado),
        monto_pendiente: toNumber(row.monto_pendiente),
        descuento_total: toNumber(row.descuento_total),
        payment_status: getSalePaymentStatus(row),
      }));

      return sendSuccess(res, {
        cliente: {
          ...cliente,
          id: toNumber(cliente.id),
          saldo_cta_cte: toNumber(cliente.saldo_cta_cte),
          limite_credito: toNumber(cliente.limite_credito),
        },
        summary: {
          total_sales: toNumber(totals.total_sales),
          total_purchased: toNumber(totals.total_purchased),
          total_paid: toNumber(totals.total_paid),
          total_pending: toNumber(totals.total_pending),
          average_ticket: toNumber(totals.average_ticket),
        },
        sales,
        total_payments: toNumber(totals.total_paid),
        pending_orders: pendingOrdersResult.rows.map((row: any) => ({
          ...row,
          id: toNumber(row.id),
          quantity: toNumber(row.quantity),
          order_date: row.fecha,
        })),
        top_products: topProductsResult.rows.map((row: any) => ({
          ...row,
          id: toNumber(row.id),
          quantity: toNumber(row.quantity),
          amount: toNumber(row.amount),
        })),
      });
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener la ficha del cliente", 400);
    }
  }

  if (endpoint === "client-account") {
    try {
      const [clientResult, salesResult, movementsResult] = await Promise.all([
        pool.query(
          `SELECT id, nombre_apellido, saldo_cta_cte
           FROM clientes
           WHERE id = $1
           LIMIT 1`,
          [id]
        ),
        pool.query(
          `SELECT
             s.id,
             s.numero_venta,
             s.fecha,
             s.total,
             s.monto_pagado,
             s.monto_pendiente,
             s.estado,
             s.metodo_pago,
             s.notes,
             s.anulada_at,
             s.anulada_por,
             s.anulacion_motivo,
             co.numero_pedido,
             COALESCE((
               SELECT SUM(
                 GREATEST(
                   0,
                   (COALESCE(si.precio_unitario_original, si.precio_venta) - COALESCE(si.precio_unitario_bonificado, si.precio_venta)) * si.cantidad
                 )
               )
               FROM sale_items si
               WHERE si.sale_id = s.id
             ), 0) AS descuento_total
           FROM sales s
           LEFT JOIN customer_orders co ON co.sale_id = s.id
           WHERE s.cliente_id = $1`,
          [id]
        ),
        pool.query(
          `SELECT
             mf.id,
             mf.fecha,
             mf.tipo,
             mf.origen,
             mf.descripcion,
             mf.forma_pago,
             mf.monto,
             mf.numero_pago,
             mf.venta_id,
             mf.estado,
             mf.reversion_version,
             mf.anulada_at,
             mf.anulada_por,
             mf.anulacion_motivo,
             mf.reversed_movement_id,
             mf.client_payment_cancellation_id,
             mf.route_item_id,
             s.numero_venta,
             co.numero_pedido
           FROM movimientos_financieros mf
           LEFT JOIN sales s ON s.id = mf.venta_id
           LEFT JOIN customer_orders co ON co.sale_id = s.id
           WHERE mf.cliente_id = $1`,
          [id]
        ),
      ]);

      if (!clientResult.rowCount) {
        return sendError(res, "Cliente no encontrado", 404);
      }

      const cliente = clientResult.rows[0];
      const saleOperations = salesResult.rows.map((row: any) => {
        const cancelled = String(row.estado || "").toLowerCase() === "anulada";
        return {
          id: `sale-${row.id}`,
          source_id: toNumber(row.id),
          operation_type: "venta",
          fecha: row.fecha,
          descripcion: `${cancelled ? "Venta anulada" : "Venta"} N° ${row.numero_venta || row.id}${row.numero_pedido ? ` / Pedido #${row.numero_pedido}` : ""}`,
          debe: cancelled ? 0 : toNumber(row.total),
          haber: 0,
          numero_venta: row.numero_venta,
          numero_pedido: row.numero_pedido,
          venta_id: toNumber(row.id),
          metodo_pago: row.metodo_pago,
          total: toNumber(row.total),
          monto_pagado: toNumber(row.monto_pagado),
          monto_pendiente: toNumber(row.monto_pendiente),
          descuento_total: toNumber(row.descuento_total),
          payment_status: getSalePaymentStatus(row),
          estado: row.estado || (toNumber(row.monto_pendiente) > 0 ? "Pendiente" : "Pagada"),
          notes: row.notes || null,
          anulada_at: row.anulada_at || null,
          anulada_por: row.anulada_por || null,
          anulacion_motivo: row.anulacion_motivo || null,
        };
      });

      const paymentOperations = movementsResult.rows.map((row: any) => {
        const isIncome = String(row.tipo || "").toLowerCase() === "ingreso";
        return {
          id: `movement-${row.id}`,
          source_id: toNumber(row.id),
          operation_type: isIncome ? "pago" : "ajuste",
          fecha: row.fecha,
          descripcion: row.descripcion || (isIncome ? "Pago recibido" : "Ajuste"),
          debe: isIncome ? 0 : toNumber(row.monto),
          haber: isIncome ? toNumber(row.monto) : 0,
          monto: toNumber(row.monto),
          numero_pago: row.numero_pago,
          numero_venta: row.numero_venta,
          numero_pedido: row.numero_pedido,
          venta_id: row.venta_id ? toNumber(row.venta_id) : null,
          metodo_pago: row.forma_pago || row.origen || "",
          forma_pago: row.forma_pago || row.origen || "",
          origen: row.origen,
          payment_status: String(row.estado || "Activo").toLowerCase() === "anulado" ? "cancelled" : "paid",
          estado: row.estado || (isIncome ? "Pagado" : "Activo"),
          reversion_version: toNumber(row.reversion_version),
          anulada_at: row.anulada_at || null,
          anulada_por: row.anulada_por || null,
          anulacion_motivo: row.anulacion_motivo || null,
          reversed_movement_id: row.reversed_movement_id ? toNumber(row.reversed_movement_id) : null,
          client_payment_cancellation_id: row.client_payment_cancellation_id ? toNumber(row.client_payment_cancellation_id) : null,
          route_item_id: row.route_item_id ? toNumber(row.route_item_id) : null,
        };
      });

      const chronological = [...saleOperations, ...paymentOperations].sort((a: any, b: any) => {
        const dateDiff = new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
        if (dateDiff !== 0) return dateDiff;
        if (a.operation_type === b.operation_type) return a.source_id - b.source_id;
        return a.operation_type === "venta" ? -1 : 1;
      });

      const totalNet = chronological.reduce(
        (sum: number, operation: any) => sum + toNumber(operation.debe) - toNumber(operation.haber),
        0
      );
      const currentBalance = toNumber(cliente.saldo_cta_cte);
      let runningBalance = currentBalance - totalNet;

      const withBalance = chronological.map((operation: any) => {
        runningBalance += toNumber(operation.debe) - toNumber(operation.haber);
        return {
          ...operation,
          saldo_resultante: Math.round(runningBalance * 100) / 100,
        };
      });

      const activeSaleOperations = saleOperations.filter((row: any) => String(row.estado || "").toLowerCase() !== "anulada");
      const totalSales = activeSaleOperations.reduce((sum: number, row: any) => sum + toNumber(row.total), 0);
      const totalPayments = paymentOperations.reduce(
        (sum: number, row: any) => sum + toNumber(row.haber) - toNumber(row.debe),
        0
      );
      const totalPending = activeSaleOperations.reduce((sum: number, row: any) => sum + toNumber(row.monto_pendiente), 0);
      const totalDiscounts = activeSaleOperations.reduce((sum: number, row: any) => sum + toNumber(row.descuento_total), 0);

      return sendSuccess(res, {
        cliente: {
          id: toNumber(cliente.id),
          nombre_apellido: cliente.nombre_apellido,
          saldo_cta_cte: currentBalance,
        },
        summary: {
          total_sales: totalSales,
          total_payments: totalPayments,
          total_collected: totalPayments,
          total_pending: totalPending,
          total_discounts: totalDiscounts,
          current_balance: currentBalance,
          pending_balance: currentBalance,
          pending_sales: saleOperations.filter((row: any) => row.payment_status === "pending").length,
          partial_sales: saleOperations.filter((row: any) => row.payment_status === "partial").length,
          paid_sales: saleOperations.filter((row: any) => row.payment_status === "paid").length,
        },
        movements: withBalance.reverse(),
      });
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener la cuenta corriente", 400);
    }
  }

  return sendError(res, "Endpoint de cliente no encontrado", 404);
};

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  if (endpoint.startsWith("portal-")) {
    return handleCustomerPortal(req, res);
  }

  if (["client-detail", "client-account", "client-payment"].includes(endpoint)) {
    return handleClientAccountAdmin(req, res);
  }

  if (endpoint === "users") {
    return handleUsers(req, res);
  }

  if (endpoint === "users-permissions") {
    return handleUserPermissions(req, res);
  }

  if (endpoint === "user-lifecycle") {
    return handleUserLifecycle(req, res);
  }

  if (["routes", "routes-today", "route-item", "route-item-lifecycle", "routes-reorder", "route-supplier-order", "route-lifecycle", "route-operational-lifecycle"].includes(endpoint)) {
    return handleRoutes(req, res);
  }

  if ([
    "checklist-templates",
    "checklist-template",
    "checklist-template-status",
    "checklists",
    "checklists-today",
    "checklist",
    "checklist-status",
    "checklist-item",
    "checklist-summary",
  ].includes(endpoint)) {
    return handleChecklist(req, res);
  }

  const id = getId(req);

  if (req.method === "GET") {
    const user = await requireClientPermission(req, res, "view");
    if (!user) return;

    try {
      if (id) {
        const cliente = await clientRepository.findById(id);

        if (!cliente) {
          return sendError(res, "Cliente no encontrado", 404);
        }

        return sendSuccess(res, cliente);
      }

      const activeOnly = String(req.query?.active_only || "").toLowerCase() === "true";
      const clientes = await clientRepository.findAll({ activeOnly });
      return sendSuccess(res, clientes);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener clientes", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST" && isCustomerLifecycleAction(getAction(req))) {
    const user = await requireClientPermission(req, res, "delete");
    if (!user) return;

    if (!id) return sendError(res, "ID de cliente inválido", 400);

    const parsed = customerLifecycleSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const action = getAction(req) as CustomerLifecycleAction;
      const result = await customerLifecycleService.changeStatus({
        customerId: id,
        action,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(
        res,
        result,
        action === "deactivate"
          ? "Cliente dado de baja correctamente"
          : "Cliente reactivado correctamente"
      );
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo actualizar el estado del cliente",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (req.method === "POST") {
    const user = await requireClientPermission(req, res, "create");
    if (!user) return;

    const parsed = clientSchema.safeParse(normalizeClientBody(getBody(req)));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const newId = await clientRepository.create(parsed.data as any);
      const cliente = await clientRepository.findById(newId);
      return sendSuccess(res, cliente, "Cliente creado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al crear cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "PUT") {
    const user = await requireClientPermission(req, res, "edit");
    if (!user) return;

    if (!id) {
      return sendError(res, "ID de cliente inválido", 400);
    }

    const parsed = customerContentSchema.safeParse(normalizeClientBody(getBody(req)));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const cliente = await customerContentLifecycleService.update({
        customerId: id,
        nombreApellido: parsed.data.nombre_apellido,
        razonSocial: parsed.data.razon_social,
        cuit: parsed.data.cuit,
        telefono: parsed.data.telefono,
        email: parsed.data.email,
        direccion: parsed.data.direccion,
        localidad: parsed.data.localidad,
        provincia: parsed.data.provincia,
        codigoPostal: parsed.data.codigo_postal,
        latitud: parsed.data.latitud,
        longitud: parsed.data.longitud,
        observaciones: parsed.data.observaciones,
        tipoCliente: parsed.data.tipo_cliente || "minorista",
        listaPrecio: parsed.data.lista_precio,
        limiteCredito: parsed.data.limite_credito,
        portalEnabled: parsed.data.portal_enabled,
        portalUsername: parsed.data.portal_username,
        portalPassword: parsed.data.portal_password,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
        expectedContentVersion: parsed.data.expectedContentVersion,
      });
      return sendSuccess(res, cliente, "Cliente actualizado con trazabilidad");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "DELETE") {
    const user = await requireClientPermission(req, res, "delete");
    if (!user) return;

    return sendError(
      res,
      "La eliminación física de clientes está deshabilitada. Usá Dar de baja para conservar ventas, pagos y pedidos.",
      409
    );
  }

  return sendError(res, "Method not allowed", 405);
}
