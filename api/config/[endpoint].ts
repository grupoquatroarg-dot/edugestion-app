import { sendError, sendSuccess } from "../../server/utils/response.js";
import { generalSettingsContentLifecycleService } from "../../server/services/generalSettingsContentLifecycleService.js";
import { maintenanceOperationSecurityService } from "../../server/services/maintenanceOperationSecurityService.js";
import { backupRestoreIntegrityService, BACKUP_SCHEMA_VERSION } from "../../server/services/backupRestoreIntegrityService.js";
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
        return sendError(
          res,
          "La copia de seguridad requiere reautenticación y debe solicitarse mediante POST",
          405
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
      const adminPassword = typeof body?.adminPassword === "string"
        ? body.adminPassword
        : typeof body?.password === "string"
          ? body.password
          : "";
      const confirmation = String(body?.confirmation || "");
      const motivo = String(body?.motivo || "");
      const backup = body?.backup;

      const client = await pool.connect();

      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

        const authorization = await maintenanceOperationSecurityService.authorize(
          {
            operation: "restore",
            actorUserId: Number(user.userId),
            actorName: String(user.userName || "Administrador"),
            password: adminPassword,
            motivo,
            confirmation,
          },
          client
        );

        const restored = await backupRestoreIntegrityService.restore(client, backup);

        await maintenanceOperationSecurityService.record(
          {
            ...authorization,
            affectedTables: restored.restoredTables,
            affectedRows: restored.restoredRows,
            artifactSchemaVersion: restored.schemaVersion,
            artifactChecksumSha256: restored.checksum,
            details: {
              backup_type: "verified-operational-backup",
              backup_version: 2,
              backup_created_at: String(backup?.created_at || ""),
              scope: String(backup?.scope || ""),
            },
          },
          client
        );

        await client.query("COMMIT");

        return sendSuccess(
          res,
          {
            restored: true,
            tablas_restauradas: restored.restoredTables,
            filas_restauradas: restored.restoredRows,
            schema_version: restored.schemaVersion,
            checksum_sha256: restored.checksum,
          },
          "Copia íntegra verificada y restaurada correctamente"
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
      const adminPassword = typeof body?.adminPassword === "string"
        ? body.adminPassword
        : typeof body?.password === "string"
          ? body.password
          : "";
      const confirmation = String(body?.confirmation || "");
      const motivo = String(body?.motivo || "");

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

        const authorization = await maintenanceOperationSecurityService.authorize(
          {
            operation: "reset",
            actorUserId: Number(user.userId),
            actorName: String(user.userName || "Administrador"),
            password: adminPassword,
            motivo,
            confirmation,
          },
          client
        );

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

        let affectedRows = 0;
        for (const tableName of existingTables) {
          const countResult = await client.query(
            `SELECT COUNT(*)::bigint AS total FROM ${quoteIdentifier(tableName)}`
          );
          affectedRows += Number(countResult.rows[0]?.total || 0);
        }

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

        await maintenanceOperationSecurityService.record(
          {
            ...authorization,
            affectedTables: existingTables.length,
            affectedRows,
            details: {
              preserved: ["users", "user_permissions", "settings", "payment_methods"],
            },
          },
          client
        );

        await client.query("COMMIT");

        return sendSuccess(
          res,
          {
            reset: true,
            tablas_limpiadas: existingTables.length,
            filas_eliminadas: affectedRows,
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
      const requestedAction = endpoint === "settings" ? "edit" : endpoint === "backup-data" ? "delete" : "create";
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

        const client = await pool.connect();

        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");

          const authorization = await maintenanceOperationSecurityService.authorize(
            {
              operation: "backup",
              actorUserId: Number(user.userId),
              actorName: String(user.userName || "Administrador"),
              password: typeof body.adminPassword === "string" ? body.adminPassword : "",
              motivo: String(body.motivo || ""),
              confirmation: String(body.confirmation || ""),
            },
            client
          );

          const backup = await backupRestoreIntegrityService.create(client);
          const affectedRows = backup.manifest.tables.reduce(
            (total, table) => total + table.row_count,
            0
          );

          await maintenanceOperationSecurityService.record(
            {
              ...authorization,
              affectedTables: backup.manifest.tables.length,
              affectedRows,
              artifactSchemaVersion: BACKUP_SCHEMA_VERSION,
              artifactChecksumSha256: backup.manifest.checksum_sha256,
              details: {
                backup_type: backup.type,
                backup_version: backup.version,
                scope: backup.scope,
                created_at: backup.created_at,
                excluded_security_tables: backup.manifest.excluded_security_tables,
              },
            },
            client
          );

          await client.query("COMMIT");

          return sendSuccess(
            res,
            backup,
            "Copia íntegra verificada generada correctamente"
          );
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }

      return sendError(res, "Endpoint de configuración no encontrado", 404);
    }

    return sendError(res, "Method not allowed", 405);
  } catch (error: any) {
    return sendError(res, error?.message || "Error en configuración", 400);
  }
}
