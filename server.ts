import express from "express";
import path from "path";
import { createServer } from "http";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import "express-async-errors";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from 'url';
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// DB and Socket
import { initDb } from "./server/db.js";
import { initSocket } from "./server/socket.js";

// Middlewares
import { errorHandler } from "./server/middleware/errorHandler.js";
import { getSessionConfig } from "./server/utils/sessionConfig.js";

// Routes
import { requireAuth, requirePermission } from "./server/middleware/authMiddleware.js";
import { sendSuccess } from "./server/utils/response.js";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

declare module 'express-session' {
  interface SessionData {
    userId: number;
    role: string;
    userName: string;
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  const PORT = Number(process.env.PORT) || 3000;
  const { cookieOptions } = getSessionConfig();

  // Trust proxy is required for 'secure: true' cookies when behind a proxy (like in AI Studio)
  app.set('trust proxy', 1);

  // Initialize DB
  initDb();

  const SQLiteStoreSession = SQLiteStore(session);
  const sessionMiddleware = session({
    store: new SQLiteStoreSession({ db: "sessions.db", dir: "." }),
    secret: process.env.SESSION_SECRET || "fallback-insecure-key-replace-in-production",
    resave: false,
    saveUninitialized: false,
    name: "sid", // Custom cookie name for security
    proxy: true, // Required when trust proxy is set
    cookie: cookieOptions,
  });

  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    console.warn("WARNING: SESSION_SECRET is not set in production. Using insecure fallback.");
  }

  // Initialize Socket.io with session
  initSocket(server, sessionMiddleware);

  app.use(helmet({
    contentSecurityPolicy: false, // Vite needs this disabled or configured
    crossOriginEmbedderPolicy: false,
  }));
  
  app.use(cors({
    origin: process.env.CORS_ORIGIN === "*" ? true : (process.env.CORS_ORIGIN || "http://localhost:3000"),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  }));
  app.use(morgan("dev"));
  app.use(express.json());
  app.use(sessionMiddleware);
  
  app.use((req, res, next) => {
    console.log(`[Session] ${req.method} ${req.url} - SessionID: ${req.sessionID}, UserId: ${(req.session as any).userId}`);
    next();
  });

  // API Routes
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
  
  // Missing routes for frontend compatibility
  app.get("/api/families", requireAuth, requirePermission('products', 'view'), (req, res) => {
    const families = db.prepare("SELECT * FROM product_families ORDER BY name ASC").all();
    return sendSuccess(res, families);
  });

  app.get("/api/inventory/total-value", requireAuth, requirePermission('products', 'view'), (req, res) => {
    const totalValue = db.prepare("SELECT SUM(stock * cost) as total FROM products WHERE eliminado = 0").get() as any;
    return sendSuccess(res, totalValue.total || 0);
  });

  // Error handling middleware
  app.use(errorHandler);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
