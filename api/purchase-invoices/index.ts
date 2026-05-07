import { z } from "zod";
import {
  createPurchaseInvoice,
  getPurchaseInvoiceById,
  listPurchaseInvoices,
  payPurchaseInvoice,
  purchaseInvoiceBodySchema,
  purchaseInvoicePaymentSchema,
} from "../../server/services/purchaseInvoiceService.js";
import { providerRepository } from "../../server/repositories/providerRepository.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getRequestBody, requirePurchaseInvoicePermission } from "../../server/services/vercel/purchaseInvoiceApiHelpers.js";

const providerSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  cuit: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  estado: z.string().optional(),
});

const getEndpoint = (req: any) => {
  const rawEndpoint = Array.isArray(req.query?.endpoint) ? req.query.endpoint[0] : req.query?.endpoint;
  return String(rawEndpoint || "");
};

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  if (endpoint === "proveedores" && req.method === "GET") {
    const user = await requirePurchaseInvoicePermission(req, res, "view");
    if (!user) return;

    try {
      const providers = await providerRepository.findAll();
      return sendSuccess(res, providers);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener proveedores", 400);
    }
  }

  if (endpoint === "proveedores" && req.method === "POST") {
    const user = await requirePurchaseInvoicePermission(req, res, "create");
    if (!user) return;

    const parsed = providerSchema.safeParse(getRequestBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const id = await providerRepository.create(parsed.data);
      return sendSuccess(res, { id, ...parsed.data }, "Proveedor creado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al crear proveedor", 400);
    }
  }

  if (req.method === "GET") {
    const user = await requirePurchaseInvoicePermission(req, res, "view");
    if (!user) return;

    const id = Number(req.query?.id);

    try {
      if (id) {
        const invoice = await getPurchaseInvoiceById(id);
        if (!invoice) return sendError(res, "Factura no encontrada", 404);
        return sendSuccess(res, invoice);
      }

      const invoices = await listPurchaseInvoices();
      return sendSuccess(res, invoices);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener facturas de compra", 400);
    }
  }

  if (req.method === "POST") {
    const user = await requirePurchaseInvoicePermission(req, res, "create");
    if (!user) return;

    const parsed = purchaseInvoiceBodySchema.safeParse(getRequestBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const invoice = await createPurchaseInvoice(parsed.data, user.userName || "Sistema");
      return sendSuccess(res, invoice, "Factura de compra registrada", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al registrar factura de compra", 400);
    }
  }

  if (req.method === "PATCH") {
    const user = await requirePurchaseInvoicePermission(req, res, "create");
    if (!user) return;

    const id = Number(req.query?.id);
    if (!id) return sendError(res, "ID de factura invalido", 400);

    const parsed = purchaseInvoicePaymentSchema.safeParse(getRequestBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const invoice = await payPurchaseInvoice(id, parsed.data, user.userName || "Sistema");
      return sendSuccess(res, invoice, "Pago de proveedor registrado");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al registrar pago de proveedor", error?.statusCode || 400);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
