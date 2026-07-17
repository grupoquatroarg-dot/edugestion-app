import { requireBearerUser } from "../../server/services/currentUserAuthService.js";
import { serverlessUserService } from "../../server/services/serverlessUserService.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  try {
    const authUser = await requireBearerUser(req, res);
    if (!authUser) return;

    const user = (await serverlessUserService.findById(authUser.userId)) as any;
    if (!user || Number(user.active ?? 0) !== 1) {
      return sendError(res, "Usuario no encontrado o inactivo", 404);
    }

    const permissions = await serverlessUserService.getPermissions(authUser.userId);
    return sendSuccess(res, { ...user, permissions });
  } catch (error: any) {
    console.error("[auth/me]", error);
    return sendError(res, error?.message || "Error al obtener usuario actual", 500);
  }
}
