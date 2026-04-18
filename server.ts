import express from "express";
import path from "path";
import { createServer } from "http";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import "express-async-errors";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables
dotenv.config();

// DB and Socket
import { initDb } from "./server/db.js";
import { initSocket } from "./server/socket.js";

// Middlewares
import { errorHandler } from "./server/middleware/errorHandler.js";
import { getSessionConfig } from "./server/utils/sessionConfig.js";
import { validate } from "./server/middleware/validate.js";

// Routes
import { requireAuth, requirePermission } from "./server/middleware/authMiddleware.js";
import { sendSuccess, sendError } from "./server/utils/response.js";
import db from "./server/db.js";
import authRoutes from "./server/routes/authRoutes.js";
import userRoutes from "./server/routes/userRoutes.js";
import productRoutes from "./server/routes/productRoutes.js";
import salesRoutes from "./server/routes/salesRoutes.js";
import financeRoutes from "./server/routes/financeRoutes.js";
import supplierOrderRoutes from "./server/routes/supplierOrderRoutes.js";
import clientRoutes from "./server/routes/clientRoutes.js";
import providerRoutes from "./server/routes/providerRoutes.js";
import configRoutes from "./server/routes/configRoutes.js";
import reportRoutes from "./server/routes/reportRoutes.js";
import bulkUpdateRoutes from "./server/routes/bulkUpdateRoutes.js";
import checklistRoutes from "./server/routes/checklistRoutes.js";
import businessRouteRoutes from "./server/routes/businessRouteRoutes.js";
import dashboardRoutes from "./server/routes/dashboardRoutes.js";
import stockRoutes from "./server/routes/stockRoutes.js";
import purchaseInvoiceRoutes from "./server/routes/purchaseInvoiceRoutes.js";
import { getPostgresPool, isPostgresConfigured } from "./server/utils/postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const app = express();
const { cookieOptions } = getSessionConfig();

app.disable("x-powered-by");
app.set("trust proxy", 1);

initDb();

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "fallback-insecure-key-replace-in-production",
  resave: false,
  saveUninitialized: false,
  name: "sid",
  proxy: true,
  cookie: cookieOptions,
});

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("WARNING: SESSION_SECRET is not set in production. Using insecure fallback.");
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN || true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(sessionMiddleware);

app.get("/api/health", (_req, res) => {
  return sendSuccess(res, { ok: true, runtime: process.env.VERCEL ? "vercel" : "local" }, "API online");
});

app.use((req, res, next) => {
  console.log(`[Session] ${req.method} ${req.url} - SessionID: ${req.sessionID}, UserId: ${(req.session as any).userId}`);
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/finanzas", financeRoutes);
app.use("/api/supplier-orders", supplierOrderRoutes);
app.use("/api/clientes", clientRoutes);
app.use("/api/proveedores", providerRoutes);
app.use("/api/config", configRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/bulk-price", bulkUpdateRoutes);
app.use("/api", checklistRoutes);
app.use("/api/routes", businessRouteRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/purchase-invoices", purchaseInvoiceRoutes);

app.get("/api/families", requireAuth, requirePermission("products", "view"), async (_req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const families = db.prepare("SELECT * FROM product_families ORDER BY name ASC").all();
      return sendSuccess(res, families);
    }

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
      if (!isPostgresConfigured()) {
        const info = db
          .prepare("INSERT INTO product_families (name, category_id) VALUES (?, ?)")
          .run(name, category_id || null);
        return sendSuccess(
          res,
          { id: info.lastInsertRowid, name, category_id: category_id || null, estado: "activo" },
          "Familia creada",
          201
        );
      }

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

app.get("/api/inventory/total-value", requireAuth, requirePermission("products", "view"), async (_req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const totalValue = db.prepare("SELECT SUM(stock * cost) as total FROM products WHERE eliminado = 0").get() as any;
      return sendSuccess(res, { total: Number(totalValue?.total || 0) });
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT COALESCE(SUM(stock * cost), 0) AS total FROM products WHERE eliminado = 0");
    return sendSuccess(res, { total: Number(result.rows[0]?.total || 0) });
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener valor total del stock", 400);
  }
});

app.use(errorHandler);

export default app;

async function startLocalServer() {
  const server = createServer(app);
  initSocket(server, sessionMiddleware);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename && !process.env.VERCEL;

if (isDirectRun) {
  startLocalServer().catch((error) => {
    console.error("Error starting server:", error);
    process.exit(1);
  });
}
