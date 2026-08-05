import { getSessionConfig } from "../../server/utils/sessionConfig.js";
import { staffTokenRevocationService } from "../../server/services/staffTokenRevocationService.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return sendError(res, "Method not allowed", 405);
  }

  const { cookieOptions } = getSessionConfig();
  res.setHeader("Set-Cookie", [
    `sid=; Path=/; Max-Age=0; HttpOnly; SameSite=${cookieOptions.sameSite || "lax"}`,
  ]);

  try {
    await staffTokenRevocationService.revokeBearerTokenIfValid(req);
    return sendSuccess(res, null, "Sesión cerrada y token revocado");
  } catch (error: any) {
    console.error("[auth/logout] No se pudo revocar el token actual.", error);
    return sendError(
      res,
      "La sesión local se cerró, pero no se pudo revocar el token en el servidor",
      503
    );
  }
}
