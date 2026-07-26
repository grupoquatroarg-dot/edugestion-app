import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { getIo } from "../socket.js";
import {
  createPurchaseInvoice,
  getPurchaseInvoiceById,
  listPurchaseInvoices,
  listAvailablePurchaseCheques,
  payPurchaseInvoice,
  purchaseInvoiceBodySchema,
  purchaseInvoicePaymentSchema,
} from "../services/purchaseInvoiceService.js";
import { purchaseInvoiceCancellationService } from "../services/purchaseInvoiceCancellationService.js";
import { listActivePaymentMethods } from "../services/paymentMethodAvailabilityService.js";
import { providerRepository } from "../repositories/providerRepository.js";
import { supplierPaymentCancellationService } from "../services/supplierPaymentCancellationService.js";

const router = Router();

const purchaseInvoiceSchema = z.object({
  body: purchaseInvoiceBodySchema,
});


router.get("/", requirePermission("suppliers", "view"), async (req, res) => {
  try {
    const endpoint = String(req.query.endpoint || "");
    if (endpoint === "payment-methods") {
      return sendSuccess(res, await listActivePaymentMethods());
    }
    if (endpoint === "proveedores") {
      const activeOnly = String(req.query.active_only || "").toLowerCase() === "true";
      return sendSuccess(res, await providerRepository.findAll({ activeOnly }));
    }
    if (endpoint === "available-cheques") {
      return sendSuccess(res, await listAvailablePurchaseCheques());
    }

    const invoices = await listPurchaseInvoices();
    return sendSuccess(res, invoices);
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener facturas de compra", error.statusCode || 400);
  }
});

router.get("/:id", requirePermission("suppliers", "view"), async (req, res) => {
  try {
    const invoice = await getPurchaseInvoiceById(Number(req.params.id));

    if (!invoice) {
      return sendError(res, "Factura no encontrada", 404);
    }

    return sendSuccess(res, invoice);
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener factura de compra", 400);
  }
});

router.post("/:id/cancel", requirePermission("suppliers", "delete"), async (req, res) => {
  try {
    const result = await purchaseInvoiceCancellationService.cancelPurchaseInvoice({
      purchaseInvoiceId: Number(req.params.id),
      motivo: String(req.body?.motivo || ""),
      usuario: (req as any).user?.userName || "Sistema",
    });

    try {
      const io = getIo();
      io.emit("financial_movement_created");
      io.emit("stock_updated");
    } catch {
      // Socket opcional
    }

    return sendSuccess(res, result, "Factura de compra anulada correctamente");
  } catch (error: any) {
    return sendError(
      res,
      error.message || "Error al anular la factura de compra",
      error.statusCode || 400
    );
  }
});

router.post("/", async (req, res, next) => {
  if (String(req.query.endpoint || "") !== "cancel-payment") return next();

  return requirePermission("suppliers", "delete")(req, res, async () => {
    try {
      const movementId = Number(req.query.id);
      const result = await supplierPaymentCancellationService.cancelSupplierPayment({
        movementId,
        motivo: String(req.body?.motivo || ""),
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Pago a proveedor anulado correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error.message || "Error al anular el pago a proveedor",
        error.statusCode || 400
      );
    }
  });
});

router.patch("/", requirePermission("suppliers", "create"), async (req, res) => {
  const parsed = purchaseInvoicePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, parsed.error.issues[0]?.message || "Datos de pago inválidos", 400, parsed.error.issues);
  }

  try {
    const id = Number(req.query.id);
    const invoice = await payPurchaseInvoice(id, parsed.data, (req as any).user?.userName || "Sistema");
    return sendSuccess(res, invoice, "Pago de proveedor registrado");
  } catch (error: any) {
    return sendError(res, error.message || "Error al registrar pago de proveedor", error.statusCode || 400);
  }
});

router.post("/", requirePermission("suppliers", "create"), validate(purchaseInvoiceSchema), async (req, res) => {
  try {
    const userName = (req as any).user?.userName || "Sistema";
    const invoice = await createPurchaseInvoice(req.body, userName);

    try {
      const io = getIo();
      io.emit("financial_movement_created");
    } catch {
      // Socket opcional
    }

    return sendSuccess(res, invoice, "Factura de compra registrada", 201);
  } catch (error: any) {
    return sendError(res, error.message || "Error al registrar factura de compra", 400);
  }
});

export default router;
