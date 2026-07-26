import { z } from "zod";
import {
  createPurchaseInvoice,
  getPurchaseInvoiceById,
  listPurchaseInvoices,
  listAvailablePurchaseCheques,
  payPurchaseInvoice,
  purchaseInvoiceBodySchema,
  purchaseInvoicePaymentSchema,
} from "../../server/services/purchaseInvoiceService.js";
import { providerRepository } from "../../server/repositories/providerRepository.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getRequestBody, requirePurchaseInvoicePermission } from "../../server/services/vercel/purchaseInvoiceApiHelpers.js";
import { purchaseInvoiceCancellationService } from "../../server/services/purchaseInvoiceCancellationService.js";
import { providerLifecycleService } from "../../server/services/providerLifecycleService.js";
import { listActivePaymentMethods } from "../../server/services/paymentMethodAvailabilityService.js";
import { supplierPaymentCancellationService } from "../../server/services/supplierPaymentCancellationService.js";

const providerSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  cuit: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
});

const providerLifecycleSchema = z.object({
  action: z.enum(["deactivate", "reactivate"]),
  motivo: z.string().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

const getEndpoint = (req: any) => {
  const rawEndpoint = Array.isArray(req.query?.endpoint) ? req.query.endpoint[0] : req.query?.endpoint;
  return String(rawEndpoint || "");
};

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);


  if (endpoint === "payment-methods" && req.method === "GET") {
    const user = await requirePurchaseInvoicePermission(req, res, "view");
    if (!user) return;

    try {
      return sendSuccess(res, await listActivePaymentMethods());
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener formas de pago", error?.statusCode || 400);
    }
  }

  if (endpoint === "available-cheques" && req.method === "GET") {
    const user = await requirePurchaseInvoicePermission(req, res, "view");
    if (!user) return;

    try {
      return sendSuccess(res, await listAvailablePurchaseCheques());
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener cheques en cartera", error?.statusCode || 400);
    }
  }

  if (endpoint === "proveedores" && req.method === "GET") {
    const user = await requirePurchaseInvoicePermission(req, res, "view");
    if (!user) return;

    try {
      const activeOnly = String(req.query?.active_only || "").toLowerCase() === "true";
      const providers = await providerRepository.findAll({ activeOnly });
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
      return sendSuccess(res, { id, ...parsed.data, estado: "activo" }, "Proveedor creado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al crear proveedor", 400);
    }
  }


  if (endpoint === "provider-lifecycle" && req.method === "POST") {
    const user = await requirePurchaseInvoicePermission(req, res, "delete");
    if (!user) return;

    const providerId = Number(req.query?.id);
    if (!Number.isInteger(providerId) || providerId <= 0) {
      return sendError(res, "ID de proveedor inválido", 400);
    }

    const parsed = providerLifecycleSchema.safeParse(getRequestBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const result = await providerLifecycleService.changeStatus({
        providerId,
        action: parsed.data.action,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(
        res,
        result,
        parsed.data.action === "deactivate"
          ? "Proveedor dado de baja correctamente"
          : "Proveedor reactivado correctamente"
      );
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo cambiar el estado del proveedor",
        error?.statusCode || 400
      );
    }
  }

  if (endpoint === "proveedores" && req.method === "DELETE") {
    const user = await requirePurchaseInvoicePermission(req, res, "delete");
    if (!user) return;

    return sendError(
      res,
      "La eliminación física de proveedores está deshabilitada. Usá Dar de baja para conservar el historial.",
      409
    );
  }

  if (endpoint === "cancel-payment" && req.method === "POST") {
    const user = await requirePurchaseInvoicePermission(req, res, "delete");
    if (!user) return;

    const movementId = Number(req.query?.id);
    if (!Number.isInteger(movementId) || movementId <= 0) {
      return sendError(res, "ID de pago a proveedor inválido", 400);
    }

    const motivo = String(getRequestBody(req)?.motivo || "").trim();

    try {
      const result = await supplierPaymentCancellationService.cancelSupplierPayment({
        movementId,
        motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Pago a proveedor anulado correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al anular el pago a proveedor",
        error?.statusCode || 400
      );
    }
  }

  if (endpoint === "cancel" && req.method === "POST") {
    const user = await requirePurchaseInvoicePermission(req, res, "delete");
    if (!user) return;

    const id = Number(req.query?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, "ID de factura inválido", 400);
    }

    const motivo = String(getRequestBody(req)?.motivo || "").trim();

    try {
      const result = await purchaseInvoiceCancellationService.cancelPurchaseInvoice({
        purchaseInvoiceId: id,
        motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Factura de compra anulada correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al anular la factura de compra",
        error?.statusCode || 400
      );
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
    if (!id) return sendError(res, "ID de factura inválido", 400);

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
