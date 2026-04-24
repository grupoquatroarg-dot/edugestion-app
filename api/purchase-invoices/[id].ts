import { getPurchaseInvoiceById } from "../../server/services/purchaseInvoiceService.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";
import { requirePurchaseInvoicePermission } from "./_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  const user = await requirePurchaseInvoicePermission(req, res, "view");
  if (!user) return;

  const id = Number(req.query?.id);

  if (!id) {
    return sendError(res, "ID invÃ¡lido", 400);
  }

  try {
    const invoice = await getPurchaseInvoiceById(id);

    if (!invoice) {
      return sendError(res, "Factura no encontrada", 404);
    }

    return sendSuccess(res, invoice);
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener factura de compra", 400);
  }
}
