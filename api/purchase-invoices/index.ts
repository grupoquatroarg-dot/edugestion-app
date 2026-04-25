import { createPurchaseInvoice, getPurchaseInvoiceById, listPurchaseInvoices, purchaseInvoiceBodySchema } from "../../server/services/purchaseInvoiceService.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getRequestBody, requirePurchaseInvoicePermission } from "../../server/services/vercel/purchaseInvoiceApiHelpers.js";

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    const user = await requirePurchaseInvoicePermission(req, res, "view");
    if (!user) return;

    const id = Number(req.query?.id);

    try {
      if (id) {
        const invoice = await getPurchaseInvoiceById(id);

        if (!invoice) {
          return sendError(res, "Factura no encontrada", 404);
        }

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
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const invoice = await createPurchaseInvoice(parsed.data, user.userName || "Sistema");
      return sendSuccess(res, invoice, "Factura de compra registrada", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al registrar factura de compra", 400);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
