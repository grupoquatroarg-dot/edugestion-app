import { getSessionConfig } from "../../server/utils/sessionConfig.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return sendError(res, "Method not allowed", 405);
  }

  try {
    const { cookieOptions } = getSessionConfig();

    res.setHeader("Set-Cookie", [
      `sid=; Path=/; Max-Age=0; HttpOnly; SameSite=${cookieOptions.sameSite || "lax"}`,
    ]);

    return sendSuccess(res, null, "Sesión cerrada");
  } catch (error: any) {
    return sendError(res, error?.message || "Error al cerrar sesión", 500);
  }
}
