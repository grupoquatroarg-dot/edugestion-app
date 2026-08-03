import type { Request, RequestHandler, Response } from "express";
import clientesHandler from "../../api/clientes.js";
import productsHandler from "../../api/products.js";
import productByIdHandler from "../../api/products/[id].js";
import salesHandler from "../../api/sales.js";
import financeHandler from "../../api/finanzas.js";
import dashboardHandler from "../../api/dashboard/[endpoint].js";
import purchaseInvoiceHandler from "../../api/purchase-invoices/index.js";
import configHandler from "../../api/config/[endpoint].js";
import { isPostgresConfigured } from "../utils/postgres.js";

type ConsolidatedHandler = (req: any, res: any) => Promise<any> | any;

export type ConsolidatedApiTarget = {
  key:
    | "clientes"
    | "products"
    | "product-id"
    | "sales"
    | "finanzas"
    | "dashboard"
    | "purchase-invoices"
    | "config";
  endpoint?: string;
  id?: string;
};

const firstQueryValue = (value: unknown) =>
  Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");

/**
 * Determina qué función consolidada de Vercel representa una URL utilizada
 * por el frontend. Es una función pura para poder auditar todas las rutas.
 */
export const resolveConsolidatedApiTarget = (
  pathname: string,
  query: Record<string, unknown> = {}
): ConsolidatedApiTarget | null => {
  const endpoint = firstQueryValue(query.endpoint).trim();
  const id = firstQueryValue(query.id).trim();
  const action = firstQueryValue(query.action).trim();

  if (pathname === "/api/clientes" && (endpoint || id || action)) {
    return { key: "clientes" };
  }

  if (pathname === "/api/products" && endpoint) {
    return { key: "products" };
  }

  const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (productMatch && (action || id || pathname)) {
    return { key: "product-id", id: productMatch[1] };
  }

  if (pathname === "/api/sales" && (endpoint || id)) {
    return { key: "sales" };
  }

  if (pathname === "/api/finanzas" && endpoint) {
    return { key: "finanzas" };
  }

  const dashboardMatch = pathname.match(/^\/api\/dashboard\/([^/]+)$/);
  if (dashboardMatch) {
    return { key: "dashboard", endpoint: decodeURIComponent(dashboardMatch[1]) };
  }

  if (pathname === "/api/purchase-invoices" && (endpoint || id)) {
    return { key: "purchase-invoices" };
  }

  const configMatch = pathname.match(
    /^\/api\/config\/(backup-data|restore-app-data|reset-app-data)$/
  );
  if (configMatch) {
    return { key: "config", endpoint: configMatch[1] };
  }

  return null;
};

const handlers: Record<ConsolidatedApiTarget["key"], ConsolidatedHandler> = {
  clientes: clientesHandler,
  products: productsHandler,
  "product-id": productByIdHandler,
  sales: salesHandler,
  finanzas: financeHandler,
  dashboard: dashboardHandler,
  "purchase-invoices": purchaseInvoiceHandler,
  config: configHandler,
};

const prepareQuery = (req: Request, target: ConsolidatedApiTarget) => {
  const mutableQuery = req.query as Record<string, any>;
  if (target.endpoint) mutableQuery.endpoint = target.endpoint;
  if (target.id) mutableQuery.id = target.id;
};

/**
 * En Vercel varias áreas comparten una función para no superar el límite de
 * funciones. El frontend usa esas URLs consolidadas también en desarrollo.
 * Cuando el servidor local trabaja contra PostgreSQL/Supabase, este adaptador
 * ejecuta exactamente el mismo handler que producción y evita respuestas de
 * otro módulo por una ruta Express diferente.
 */
export const consolidatedApiCompatibility: RequestHandler = async (
  req: Request,
  res: Response,
  next
) => {
  if (!isPostgresConfigured()) return next();

  const target = resolveConsolidatedApiTarget(req.path, req.query as Record<string, unknown>);
  if (!target) return next();

  prepareQuery(req, target);

  try {
    await handlers[target.key](req, res);
  } catch (error) {
    next(error);
  }
};
