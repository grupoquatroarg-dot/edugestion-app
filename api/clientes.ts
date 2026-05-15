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
