import { z } from "zod";
import { clientRepository } from "../server/repositories/clientRepository.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { verifyToken } from "../server/utils/jwt.js";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { getPostgresPool } from "../server/utils/postgres.js";

const clientSchema = z.object({
  nombre_apellido: z.string().min(2, "El nombre es requerido"),
  razon_social: z.string().optional().nullable(),
  cuit: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  localidad: z.string().optional().nullable(),
  provincia: z.string().optional().nullable(),
  latitud: z.number().optional().nullable(),
  longitud: z.number().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  tipo_cliente: z.enum(["minorista", "mayorista"]).optional(),
  lista_precio: z.string().optional().nullable(),
  limite_credito: z.number().optional().nullable(),
});

const baseUserSchema = z.object({
  name: z.string().min(2, "Nombre demasiado corto"),
  email: z.string().email("Email invalido"),
  role: z.enum(["administrador", "empleado", "vendedor", "operario"]),
  active: z.union([z.number(), z.boolean()]).optional(),
  avatar: z.string().optional(),
});

const createUserSchema = baseUserSchema.extend({
  password: z.string().min(6, "La contrasena debe tener al menos 6 caracteres"),
});

const updateUserSchema = baseUserSchema.extend({
  password: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || value === "" || value.length >= 6,
      "La contrasena debe tener al menos 6 caracteres"
    ),
});

const permissionsSchema = z.object({
  permissions: z.record(
    z.string(),
    z.object({
      module: z.string(),
      can_view: z.boolean(),
      can_create: z.boolean(),
      can_edit: z.boolean(),
      can_delete: z.boolean(),
    })
  ),
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
  const token = getBearerToken(req);

  if (!token) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

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
  const token = getBearerToken(req);

  if (!token) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

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

const normalizeClientBody = (body: any) => ({
  ...body,
  tipo_cliente: body.tipo_cliente || "minorista",
  limite_credito: Number(body.limite_credito || 0),
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
        return sendError(res, "El email ya esta registrado", 400);
      }

      return sendError(res, error?.message || "Error al crear usuario", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "PUT") {
    if (!id) return sendError(res, "ID de usuario invalido", 400);

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
      const updatedUser = await UserRepository.update(id, parsed.data);
      return sendSuccess(res, updatedUser, "Usuario actualizado exitosamente");
    } catch (error: any) {
      if (error?.code === "SQLITE_CONSTRAINT" || error?.code === "23505") {
        return sendError(res, "El email ya esta registrado", 400);
      }

      return sendError(res, error?.message || "Error al actualizar usuario", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
};

const handleUserPermissions = async (req: any, res: any) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = getId(req);
  if (!id) return sendError(res, "ID de usuario invalido", 400);

  if (req.method === "GET") {
    try {
      const permissions = await UserRepository.getPermissions(id);
      return sendSuccess(res, permissions);
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
      await UserRepository.updatePermissions(id, parsed.data.permissions);
      return sendSuccess(res, null, "Permisos actualizados");
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
  status: z.enum(["planificada", "en curso", "finalizada", "cancelada", "pendiente"]).optional(),
});

const routeItemSchema = z.object({
  status: z.string().optional(),
  notes: z.string().optional(),
  visitado: z.union([z.number(), z.boolean()]).optional(),
  venta_registrada: z.union([z.number(), z.boolean()]).optional(),
  pedido_generado: z.union([z.number(), z.boolean()]).optional(),
  cobranza_realizada: z.union([z.number(), z.boolean()]).optional(),
});

const routeReorderSchema = z.object({
  items: z.array(z.object({
    id: z.number(),
    order_index: z.number(),
  })),
});

const routeSupplierOrderSchema = z.object({
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

const toIntFlag = (value: any) => {
  if (value === true) return 1;
  if (value === false) return 0;
  return Number(value || 0) ? 1 : 0;
};

const requireRoutePermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const token = getBearerToken(req);

  if (!token) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

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
  total_customers: toNumber(row.total_customers),
  visited_customers: toNumber(row.visited_customers),
  sales_count: toNumber(row.sales_count),
  orders_count: toNumber(row.orders_count),
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
    if (!id) return sendError(res, "ID de item invalido", 400);
    if (req.method !== "PATCH") return sendError(res, "Method not allowed", 405);

    const parsed = routeItemSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const fields: string[] = [];
    const values: any[] = [];
    const addField = (sqlField: string, value: any) => {
      values.push(value);
      fields.push(`${sqlField} = $${values.length}`);
    };

    if (parsed.data.status !== undefined) addField("status", parsed.data.status);
    if (parsed.data.notes !== undefined) addField("notes", parsed.data.notes);
    if (parsed.data.visitado !== undefined) addField("visitado", toIntFlag(parsed.data.visitado));
    if (parsed.data.venta_registrada !== undefined) addField("venta_registrada", toIntFlag(parsed.data.venta_registrada));
    if (parsed.data.pedido_generado !== undefined) addField("pedido_generado", toIntFlag(parsed.data.pedido_generado));
    if (parsed.data.cobranza_realizada !== undefined) addField("cobranza_realizada", toIntFlag(parsed.data.cobranza_realizada));

    const shouldSetVisitedAt = parsed.data.visitado !== undefined || ["visitado", "pedido tomado", "venta realizada"].includes(parsed.data.status || "");
    if (shouldSetVisitedAt) addField("visited_at", new Date().toISOString());

    if (fields.length === 0) return sendSuccess(res, null, "Sin cambios");

    values.push(id);
    await pool.query(`UPDATE route_items SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    return sendSuccess(res, null, "Item de ruta actualizado");
  }

  if (endpoint === "routes-reorder") {
    const user = await requireRoutePermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de ruta invalido", 400);
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
      for (const item of parsed.data.items) {
        await client.query(
          `UPDATE route_items SET order_index = $1 WHERE id = $2 AND route_id = $3`,
          [item.order_index, item.id, id]
        );
      }
      await client.query("COMMIT");
      return sendSuccess(res, null, "Ruta reordenada");
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al reordenar ruta", 400);
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
          COALESCE(SUM(CASE WHEN COALESCE(ri.pedido_generado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS orders_count
        FROM routes r
        LEFT JOIN route_items ri ON ri.route_id = r.id
        WHERE r.date::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
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
              COALESCE(SUM(CASE WHEN COALESCE(ri.pedido_generado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS orders_count
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
            COALESCE(SUM(CASE WHEN COALESCE(ri.pedido_generado, 0) <> 0 THEN 1 ELSE 0 END), 0)::int AS orders_count
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
      if (!id) return sendError(res, "ID de ruta invalido", 400);

      const parsed = routeStatusSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })));
      }

      if (parsed.data.status) {
        await pool.query(`UPDATE routes SET status = $1 WHERE id = $2`, [parsed.data.status, id]);
      }
      return sendSuccess(res, null, "Ruta actualizada");
    }

    if (req.method === "DELETE") {
      const user = await requireRoutePermission(req, res, "delete");
      if (!user) return;
      if (!id) return sendError(res, "ID de ruta invalido", 400);

      await pool.query(`DELETE FROM routes WHERE id = $1`, [id]);
      return sendSuccess(res, null, "Ruta eliminada");
    }
  }

  return sendError(res, "Endpoint de rutas no encontrado", 404);
};



const requireChecklistPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const token = getBearerToken(req);

  if (!token) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

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
  name: z.string().min(2, "Nombre de plantilla requerido"),
  description: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  items: z.array(z.string().min(1)).min(1, "Debe incluir al menos una tarea"),
});

const checklistTemplateStatusSchema = z.object({
  active: z.union([z.number(), z.boolean()]),
});

const checklistCreateSchema = z.object({
  template_id: z.number(),
  date: z.string().min(10, "Fecha requerida"),
  notes: z.string().optional().nullable(),
});

const checklistUpdateSchema = z.object({
  status: z.string().optional(),
  notes: z.string().optional().nullable(),
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

const updateChecklistCompletionStatus = async (pool: any, checklistId: number) => {
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

  const total = toNumber(countsResult.rows[0]?.total);
  const completed = toNumber(countsResult.rows[0]?.completed);

  if (total > 0 && total === completed) {
    await pool.query(
      `UPDATE checklists SET status = 'completado', completed_at = COALESCE(completed_at, now()) WHERE id = $1`,
      [checklistId]
    );
  } else {
    await pool.query(
      `UPDATE checklists SET status = 'pendiente', completed_at = NULL WHERE id = $1`,
      [checklistId]
    );
  }
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
            SELECT id, name, description, type, active, created_at
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
    if (!id) return sendError(res, "ID de plantilla invalido", 400);

    if (req.method === "GET") {
      const user = await requireChecklistPermission(req, res, "view");
      if (!user) return;

      try {
        const templateResult = await pool.query(
          `
            SELECT id, name, description, type, active, created_at
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

        await client.query(
          `
            UPDATE checklist_templates
            SET name = $1, description = $2, type = $3
            WHERE id = $4
          `,
          [
            parsed.data.name,
            parsed.data.description || null,
            parsed.data.type || "General",
            id,
          ]
        );

        await client.query(`DELETE FROM checklist_template_items WHERE template_id = $1`, [id]);

        for (const taskName of parsed.data.items) {
          await client.query(
            `INSERT INTO checklist_template_items (template_id, task_name) VALUES ($1, $2)`,
            [id, taskName.trim()]
          );
        }

        await client.query("COMMIT");
        return sendSuccess(res, null, "Plantilla actualizada exitosamente");
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al actualizar plantilla", 400);
      } finally {
        client.release();
      }
    }

    if (req.method === "DELETE") {
      const user = await requireChecklistPermission(req, res, "delete");
      if (!user) return;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM checklist_template_items WHERE template_id = $1`, [id]);
        const result = await client.query(`DELETE FROM checklist_templates WHERE id = $1`, [id]);
        await client.query("COMMIT");

        if (!result.rowCount) return sendError(res, "Plantilla no encontrada", 404);
        return sendSuccess(res, null, "Plantilla eliminada exitosamente");
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al eliminar plantilla", 400);
      } finally {
        client.release();
      }
    }

    return sendError(res, "Method not allowed", 405);
  }

  if (endpoint === "checklist-template-status") {
    const user = await requireChecklistPermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de plantilla invalido", 400);
    if (req.method !== "PATCH") return sendError(res, "Method not allowed", 405);

    const parsed = checklistTemplateStatusSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      await pool.query(
        `UPDATE checklist_templates SET active = $1 WHERE id = $2`,
        [toIntFlag(parsed.data.active), id]
      );

      return sendSuccess(res, null, "Estado de plantilla actualizado");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar estado", 400);
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

        const checklistResult = await client.query(
          `
            INSERT INTO checklists (template_id, date, notes, status)
            VALUES ($1, $2, $3, $4)
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
        return sendError(res, error?.message || "Error al iniciar checklist", 400);
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
    if (!id) return sendError(res, "ID de checklist invalido", 400);

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
        return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })));
      }

      try {
        const completedAt = parsed.data.status === "completado" ? new Date().toISOString() : null;
        await pool.query(
          `
            UPDATE checklists
            SET status = COALESCE($1, status),
                notes = COALESCE($2, notes),
                completed_at = $3
            WHERE id = $4
          `,
          [
            parsed.data.status || null,
            parsed.data.notes ?? null,
            completedAt,
            id,
          ]
        );

        return sendSuccess(res, null, "Checklist actualizado");
      } catch (error: any) {
        return sendError(res, error?.message || "Error al actualizar checklist", 400);
      }
    }

    return sendError(res, "Method not allowed", 405);
  }

  if (endpoint === "checklist-item") {
    const user = await requireChecklistPermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de item invalido", 400);
    if (req.method !== "PATCH") return sendError(res, "Method not allowed", 405);

    const parsed = checklistItemUpdateSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const completed = toIntFlag(parsed.data.completed);
      const completedAt = completed ? new Date().toISOString() : null;

      const itemResult = await pool.query(
        `
          UPDATE checklist_items
          SET completed = $1,
              completed_at = $2,
              completed_by = $3
          WHERE id = $4
          RETURNING checklist_id
        `,
        [
          completed,
          completedAt,
          parsed.data.completed_by || null,
          id,
        ]
      );

      const checklistId = toNumber(itemResult.rows[0]?.checklist_id);
      if (checklistId) {
        await updateChecklistCompletionStatus(pool, checklistId);
      }

      return sendSuccess(res, null, "Item de checklist actualizado");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar item", 400);
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
        pool.query(`SELECT COALESCE(SUM(monto_pendiente), 0) AS total FROM sales WHERE estado <> 'Pagada'`),
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


export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  if (endpoint === "users") {
    return handleUsers(req, res);
  }

  if (endpoint === "users-permissions") {
    return handleUserPermissions(req, res);
  }

  if (["routes", "routes-today", "route-item", "routes-reorder", "route-supplier-order"].includes(endpoint)) {
    return handleRoutes(req, res);
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

      const clientes = await clientRepository.findAll();
      return sendSuccess(res, clientes);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener clientes", error?.statusCode || 400, error?.errors || []);
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
      return sendError(res, "ID de cliente invalido", 400);
    }

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
      await clientRepository.update(id, parsed.data as any);
      const cliente = await clientRepository.findById(id);
      return sendSuccess(res, cliente, "Cliente actualizado exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "DELETE") {
    const user = await requireClientPermission(req, res, "delete");
    if (!user) return;

    if (!id) {
      return sendError(res, "ID de cliente invalido", 400);
    }

    try {
      await clientRepository.delete(id);
      return sendSuccess(res, null, "Cliente eliminado exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al eliminar cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
