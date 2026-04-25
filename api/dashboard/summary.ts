import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getPoolOrFail, getSummaryData, requireDashboardAccess } from "../../server/services/vercel/dashboardApiHelpers.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  const user = await requireDashboardAccess(req, res);
  if (!user) return;

  try {
    const pool = getPoolOrFail(res);
    if (!pool) return;

    const data = await getSummaryData(pool);
    return sendSuccess(res, data);
  } catch (error: any) {
    return sendError(res, error?.message || "Error al cargar dashboard", 400);
  }
}
