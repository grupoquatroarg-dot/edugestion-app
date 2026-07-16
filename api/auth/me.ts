import { UserRepository } from "../../server/repositories/userRepository.js";
import { requireBearerUser } from "../../server/services/currentUserAuthService.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  try {
    const authUser = await requireBearerUser(req, res);
    if (!authUser) return;

    const user = (await UserRepository.findById(authUser.userId)) as any;
    if (!user) {
      return sendError(res, "Usuario no encontrado", 404);
    }

    const permissions = await UserRepository.getPermissions(authUser.userId);
    return sendSuccess(res, { ...user, permissions });
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener usuario actual", 500);
  }
}
