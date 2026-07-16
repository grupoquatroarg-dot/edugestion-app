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
  purchaseInvoiceBodySchema,
} from "../services/purchaseInvoiceService.js";
import { purchaseInvoiceCancellationService } from "../services/purchaseInvoiceCancellationService.js";
import { listActivePaymentMethods } from "../services/paymentMethodAvailabilityService.js";
import { providerRepository } from "../repositories/providerRepository.js";

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
