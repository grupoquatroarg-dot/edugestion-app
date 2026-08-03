import { sendError, sendSuccess } from "../../server/utils/response.js";
import { generalSettingsContentLifecycleService } from "../../server/services/generalSettingsContentLifecycleService.js";
import {
  getEndpoint,
  getPoolOrFail,
  getRequestBody,
  mapCategory,
  mapFamily,
  mapPaymentMethod,
  requireSettingsPermission,
  validateName,
} from "../../server/services/vercel/configApiHelpers.js";

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  try {
    if (req.method === "GET") {
      const user = await requireSettingsPermission(req, res, "view");
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      if (endpoint === "settings") {
        const result = await generalSettingsContentLifecycleService.get(pool);
        return sendSuccess(res, result.response);
      }

      if (endpoint === "payment-methods") {
        const activeOnly = req.query?.active === "true";
        const result = activeOnly
          ? await pool.query("SELECT * FROM payment_methods WHERE activo = 1 ORDER BY name ASC")
          : await pool.query("SELECT * FROM payment_methods ORDER BY name ASC");
        return sendSuccess(res, result.rows.map(mapPaymentMethod));
      }

      if (endpoint === "product-categories") {
        const activeOnly = req.query?.active === "true";
        const result = activeOnly
          ? await pool.query("SELECT * FROM product_categories WHERE estado = 'activo' ORDER BY name ASC")
          : await pool.query("SELECT * FROM product_categories ORDER BY name ASC");
        return sendSuccess(res, result.rows.map(mapCategory));
      }

      if (endpoint === "product-families" || endpoint === "families") {
        const activeOnly = req.query?.active === "true";
        const result = await pool.query(`
          SELECT f.*, c.name AS category_name
          FROM product_families f
          LEFT JOIN product_categories c ON f.category_id = c.id
          ${activeOnly ? "WHERE COALESCE(f.estado, 'activo') = 'activo' AND (f.category_id IS NULL OR COALESCE(c.estado, 'activo') = 'activo')" : ""}
          ORDER BY f.name ASC
        `);
        return sendSuccess(res, result.rows.map(mapFamily));
      }


      if (endpoint === "backup-data") {
        if (user.role !== "administrador") {
          return sendError(res, "Solo el usuario administrador puede descargar copias de seguridad", 403);
        }

        const backupTables = [
          "settings",
          "payment_methods",
          "product_categories",
          "product_families",
          "configuration_item_status_history",
          "configuration_item_content_history",
          "general_settings_content_state",
          "general_settings_content_history",
          "user_status_history",
          "clientes",
          "proveedores",
          "products",
          "sales",
          "sale_items",
          "purchase_invoices",
          "purchase_invoice_items",
          "movimientos_financieros",
          "cheques",
          "stock_movimientos",
          "price_update_history",
          "routes",
          "route_items",
          "checklist_templates",
          "checklist_template_items",
          "checklists",
          "checklist_items",
          "supplier_orders",
          "supplier_order_items",
          "customer_orders",
          "customer_order_items"
        ];

        const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

        const existingTablesResult = await pool.query(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
          `,
          [backupTables]
        );

        const existingTables = existingTablesResult.rows
          .map((row: any) => String(row.table_name))
          .filter((tableName: string) => backupTables.includes(tableName));

        const tables: Record<string, any[]> = {};

        for (const tableName of backupTables) {
          if (!existingTables.includes(tableName)) {
            tables[tableName] = [];
            continue;
          }

          const result = await pool.query(`SELECT * FROM ${quoteIdentifier(tableName)}`);
          tables[tableName] = result.rows;
        }

        return sendSuccess(
          res,
          {
            app: "edugestion",
            type: "manual-json-backup",
            version: 1,
            created_at: new Date().toISOString(),
            tables
          },
          "Copia de seguridad generada"
        );
      }

      return sendError(res, "Endpoint de configuración no encontrado", 404);
    }



    if (req.method === "POST" && endpoint === "restore-app-data") {
      const user = await requireSettingsPermission(req, res, "delete");
      if (!user) return;

      if (user.role !== "administrador") {
        return sendError(res, "Solo el usuario administrador puede restaurar la app", 403);
      }

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const body = getRequestBody(req);
      const adminPassword = String(body?.adminPassword || body?.password || "").trim();
      const confirmation = String(body?.confirmation || "").trim();
      const expectedPassword = String(process.env.RESET_APP_PASSWORD || "admin123");
      const backup = body?.backup;

      if (!adminPassword || adminPassword !== expectedPassword) {
        return sendError(res, "Contraseña de administrador incorrecta", 403);
      }

      if (confirmation !== "RESTAURAR") {
        return sendError(res, "Debe confirmar la restauración", 400);
      }

      if (!backup || typeof backup !== "object" || !backup.tables || typeof backup.tables !== "object") {
        return sendError(res, "Archivo de copia de seguridad inválido", 400);
      }

      const restoreTables = [
        "settings",
        "payment_methods",
        "product_categories",
        "product_families",
        "configuration_item_status_history",
          "configuration_item_content_history",
          "general_settings_content_state",
          "general_settings_content_history",
          "user_status_history",
        "clientes",
        "proveedores",
        "products",
        "sales",
        "sale_items",
        "purchase_invoices",
        "purchase_invoice_items",
        "movimientos_financieros",
        "cheques",
        "stock_movimientos",
        "price_update_history",
        "routes",
        "route_items",
        "checklist_templates",
        "checklist_template_items",
        "checklists",
        "checklist_items",
        "supplier_orders",
        "supplier_order_items",
          "customer_orders",
          "customer_order_items"
      ];

      const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const existingTablesResult = await client.query(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
          `,
          [restoreTables]
        );

        const existingTables = existingTablesResult.rows
          .map((row: any) => String(row.table_name))
          .filter((tableName: string) => restoreTables.includes(tableName));

        if (existingTables.length > 0) {
          const truncateOrder = [...existingTables].sort(
            (a: string, b: string) => restoreTables.indexOf(b) - restoreTables.indexOf(a)
          );

          await client.query(
            `TRUNCATE TABLE ${truncateOrder.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`
          );
        }

        for (const tableName of restoreTables) {
          if (!existingTables.includes(tableName)) continue;

          const rows = Array.isArray(backup.tables?.[tableName]) ? backup.tables[tableName] : [];

          for (const row of rows) {
            if (!row || typeof row !== "object") continue;

            const columns = Object.keys(row);
            if (columns.length === 0) continue;

            const values = columns.map((column) => row[column]);
            const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
            const columnSql = columns.map(quoteIdentifier).join(", ");

            await client.query(
              `INSERT INTO ${quoteIdentifier(tableName)} (${columnSql}) VALUES (${placeholders})`,
              values
            );
          }
        }

        for (const tableName of existingTables) {
          const idColumnResult = await client.query(
            `
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = $1
                AND column_name = 'id'
              LIMIT 1
            `,
            [tableName]
          );

          if (!idColumnResult.rowCount) continue;

          const sequenceResult = await client.query(
            "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
            [`public.${tableName}`]
          );

          const sequenceName = sequenceResult.rows[0]?.sequence_name;

          if (sequenceName) {
            await client.query(
              `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(tableName)}), 1), COALESCE((SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}), 0) > 0)`,
              [sequenceName]
            );
          }
        }

        await client.query("COMMIT");

        return sendSuccess(
          res,
          {
            restored: true,
            tablas_restauradas: existingTables.length
          },
          "Copia de seguridad restaurada correctamente"
        );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === "POST" && endpoint === "reset-app-data") {
      const user = await requireSettingsPermission(req, res, "delete");
      if (!user) return;

      if (user.role !== "administrador") {
        return sendError(res, "Solo el usuario administrador puede restablecer la app", 403);
      }

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const body = getRequestBody(req);
      const adminPassword = String(body?.adminPassword || body?.password || "").trim();
      const confirmation = String(body?.confirmation || "").trim();
      const expectedPassword = String(process.env.RESET_APP_PASSWORD || "admin123");

      if (!adminPassword || adminPassword !== expectedPassword) {
        return sendError(res, "Contraseña de administrador incorrecta", 403);
      }

      if (confirmation !== "REESTABLECER") {
        return sendError(res, "Debe escribir REESTABLECER para confirmar", 400);
      }

      const resetTables = [
        "checklist_items",
        "checklists",
        "checklist_template_items",
        "checklist_templates",
        "route_items",
        "routes",
        "supplier_order_items",
          "customer_orders",
          "customer_order_items",
        "supplier_orders",
        "sale_items",
        "sales",
        "purchase_invoice_items",
        "purchase_invoices",
        "movimientos_financieros",
        "cheques",
        "price_update_history",
        "stock_movimientos",
        "products",
        "proveedores",
        "clientes",
        "configuration_item_status_history",
          "configuration_item_content_history",
          "general_settings_content_state",
          "general_settings_content_history",
        "user_status_history",
        "product_families",
        "product_categories"
      ];

      const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const existingTablesResult = await client.query(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
          `,
          [resetTables]
        );

        const existingTables = existingTablesResult.rows
          .map((row: any) => String(row.table_name))
          .filter((tableName: string) => resetTables.includes(tableName));

        if (existingTables.length > 0) {
          await client.query(
            `TRUNCATE TABLE ${existingTables.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`
          );
        }

        if (existingTables.includes("clientes")) {
          await client.query(
            `
              INSERT INTO clientes (
                nombre_apellido,
                razon_social,
                tipo_cliente,
                lista_precio,
                limite_credito
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            ["Consumidor Final", "Consumidor Final", "minorista", "lista1", 0]
          );
        }

        const counters = [
          ["next_sale_number", "1"],
          ["next_order_number", "1"],
          ["next_payment_number", "1"],
          ["next_invoice_number", "1"]
        ];

        for (const [key, value] of counters) {
          await client.query(
            `
              INSERT INTO settings (key, value)
              VALUES ($1, $2)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `,
            [key, value]
          );
        }

        await client.query("COMMIT");

        return sendSuccess(
          res,
          {
            reset: true,
            tablas_limpiadas: existingTables.length,
            conservado: ["usuarios", "permisos", "settings", "formas de pago"]
          },
          "Datos restablecidos correctamente"
        );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === "POST") {
      const requestedAction = endpoint === "settings" ? "edit" : "create";
      const user = await requireSettingsPermission(req, res, requestedAction);
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const body = getRequestBody(req);

      if (endpoint === "settings") {
        const result = await generalSettingsContentLifecycleService.update({
          settings: body.settings,
          motivo: String(body.motivo || ""),
          usuario: String(user.userName || "Sistema"),
          expectedContentVersion: Number(body.expectedContentVersion),
        });
        return sendSuccess(res, result, "Configuración general actualizada con trazabilidad");
      }

      if (endpoint === "payment-methods") {
        const name = validateName(body);
        const tipo = body.tipo || "Efectivo";
        const result = await pool.query(
          `INSERT INTO payment_methods (name, tipo)
           VALUES ($1, $2)
           RETURNING id, name, tipo, activo`,
          [name, tipo]
        );
        return sendSuccess(res, mapPaymentMethod(result.rows[0]), "Método de pago creado", 201);
      }

      if (endpoint === "product-categories") {
        const name = validateName(body);
        const result = await pool.query(
          `INSERT INTO product_categories (name, description, estado)
           VALUES ($1, $2, 'activo')
           RETURNING id, name, description, estado`,
          [name, body.description || null]
        );
        return sendSuccess(res, mapCategory(result.rows[0]), "Categoría creada", 201);
      }

      if (endpoint === "product-families" || endpoint === "families") {
        const name = validateName(body);
        const categoryId = body.category_id === null || body.category_id === undefined || body.category_id === "" ? null : Number(body.category_id);

        if (categoryId) {
          const category = await pool.query(
            "SELECT id FROM product_categories WHERE id = $1 AND COALESCE(estado, 'activo') = 'activo' LIMIT 1",
            [categoryId]
          );
          if (!category.rowCount) {
            return sendError(res, "La categoría seleccionada está inactiva o no existe", 409);
          }
        }

        const result = await pool.query(
          `INSERT INTO product_families (name, category_id, estado)
           VALUES ($1, $2, 'activo')
           RETURNING id, name, category_id, estado`,
          [name, categoryId]
        );
        return sendSuccess(res, mapFamily(result.rows[0]), "Familia creada", 201);
      }


      if (endpoint === "backup-data") {
        if (user.role !== "administrador") {
          return sendError(res, "Solo el usuario administrador puede descargar copias de seguridad", 403);
        }

        const backupTables = [
          "settings",
          "payment_methods",
          "product_categories",
          "product_families",
          "configuration_item_status_history",
          "configuration_item_content_history",
          "general_settings_content_state",
          "general_settings_content_history",
          "user_status_history",
          "clientes",
          "proveedores",
          "products",
          "sales",
          "sale_items",
          "purchase_invoices",
          "purchase_invoice_items",
          "movimientos_financieros",
          "cheques",
          "stock_movimientos",
          "price_update_history",
          "routes",
          "route_items",
          "checklist_templates",
          "checklist_template_items",
          "checklists",
          "checklist_items",
          "supplier_orders",
          "supplier_order_items",
          "customer_orders",
          "customer_order_items"
        ];

        const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

        const existingTablesResult = await pool.query(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
          `,
          [backupTables]
        );

        const existingTables = existingTablesResult.rows
          .map((row: any) => String(row.table_name))
          .filter((tableName: string) => backupTables.includes(tableName));

        const tables: Record<string, any[]> = {};

        for (const tableName of backupTables) {
          if (!existingTables.includes(tableName)) {
            tables[tableName] = [];
            continue;
          }

          const result = await pool.query(`SELECT * FROM ${quoteIdentifier(tableName)}`);
          tables[tableName] = result.rows;
        }

        return sendSuccess(
          res,
          {
            app: "edugestion",
            type: "manual-json-backup",
            version: 1,
            created_at: new Date().toISOString(),
            tables
          },
          "Copia de seguridad generada"
        );
      }

      return sendError(res, "Endpoint de configuración no encontrado", 404);
    }

    return sendError(res, "Method not allowed", 405);
  } catch (error: any) {
    return sendError(res, error?.message || "Error en configuración", 400);
  }
}
