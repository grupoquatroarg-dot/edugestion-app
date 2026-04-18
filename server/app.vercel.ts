import express from "express";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import "express-async-errors";
import { z } from "zod";

import { validate } from "./middleware/validate.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { getSessionConfig } from "./utils/sessionConfig.js";
import { requireAuth, requirePermission } from "./middleware/authMiddleware.js";
import { sendError, sendSuccess } from "./utils/response.js";
import { getPostgresPool, isPostgresConfigured } from "./utils/postgres.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import salesRoutes from "./routes/salesRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import providerRoutes from "./routes/providerRoutes.js";
import configRoutes from "./routes/configRoutes.js";
import dashboardRoutesVercel from "./routes/dashboardRoutesVercel.js";

dotenv.config();

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
    userName: string;
  }
}

const familyAliasSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Nombre demasiado corto"),
    category_id: z.number().nullable().optional(),
  }),
});

const mapFamily = (row: any) => ({
  id: Number(row.id),
  name: row.name,
  category_id: row.category_id === null || row.category_id === undefined ? null : Number(row.category_id),
  estado: row.estado,
});

export function createVercelApp() {
  const app = express();
  const { cookieOptions } = getSessionConfig();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "fallback-insecure-key-replace-in-production",
    resave: false,
    saveUninitialized: false,
    name: "sid",
    proxy: true,
    cookie: cookieOptions,
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    })
  );
  app.use(morgan("dev"));
  app.use(express.json());
  app.use(sessionMiddleware);

  app.get("/api/health", (_req, res) => {
    return sendSuccess(res, { ok: true, runtime: "vercel" }, "API online");
  });

  app.use("/api", (req, res, next) => {
    if (!isPostgresConfigured()) {
      return sendError(res, "Falta configurar DATABASE_URL en Vercel", 500);
    }
    next();
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/sales", salesRoutes);
  app.use("/api/finanzas", financeRoutes);
  app.use("/api/clientes", clientRoutes);
  app.use("/api/proveedores", providerRoutes);
  app.use("/api/config", configRoutes);
  app.use("/api/dashboard", dashboardRoutesVercel);

  app.get("/api/families", requireAuth, requirePermission("products", "view"), async (_req, res) => {
    try {
      const pool = getPostgresPool();
      const result = await pool.query("SELECT * FROM product_families ORDER BY name ASC");
      return sendSuccess(res, result.rows.map(mapFamily));
    } catch (error: any) {
      return sendError(res, error.message || "Error al obtener familias", 400);
    }
  });

  app.post(
    "/api/families",
    requireAuth,
    requirePermission("products", "create"),
    validate(familyAliasSchema),
    async (req, res) => {
      const { name, category_id } = req.body;

      try {
        const pool = getPostgresPool();
        const result = await pool.query(
          `INSERT INTO product_families (name, category_id)
           VALUES ($1, $2)
           RETURNING id, name, category_id, estado`,
          [name, category_id || null]
        );

        return sendSuccess(res, mapFamily(result.rows[0]), "Familia creada", 201);
      } catch (error: any) {
        return sendError(res, error.message || "Error al crear familia", 400);
      }
    }
  );

  app.get(
    "/api/inventory/total-value",
    requireAuth,
    requirePermission("products", "view"),
    async (_req, res) => {
      try {
        const pool = getPostgresPool();
        const result = await pool.query(
          "SELECT COALESCE(SUM(stock * cost), 0) AS total FROM products WHERE eliminado = 0"
        );
        return sendSuccess(res, { total: Number(result.rows[0]?.total || 0) });
      } catch (error: any) {
        return sendError(res, error.message || "Error al obtener valor total del stock", 400);
      }
    }
  );

  app.use(errorHandler);

  return app;
}
