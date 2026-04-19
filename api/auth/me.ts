import { UserRepository } from "../../server/repositories/userRepository.js";
import { verifyToken } from "../../server/utils/jwt.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";

const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return sendError(res, "No has iniciado sesión", 401);
    }

    const decoded = verifyToken(token);
    if (!decoded?.userId) {
      return sendError(res, "No has iniciado sesión", 401);
    }

    const userId = Number(decoded.userId);
    const user = (await UserRepository.findById(userId)) as any;

    if (!user) {
      return sendError(res, "Usuario no encontrado", 404);
    }

    const permissions = await UserRepository.getPermissions(userId);
    return sendSuccess(res, { ...user, permissions });
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener usuario actual", 500);
  }
}
