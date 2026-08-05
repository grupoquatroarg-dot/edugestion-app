import express from "express";
import bcrypt from "bcryptjs";
import { UserRepository } from "../repositories/userRepository.js";
import { validate } from "../middleware/validate.js";
import { getSessionConfig } from "../utils/sessionConfig.js";
import { generateToken } from "../utils/jwt.js";
import { getAuthUser } from "../middleware/authMiddleware.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";
import {
  authAttemptSecurityService,
  getLockoutMessage,
  getRequestClientAddress,
  setRetryAfterHeader,
} from "../services/authAttemptSecurityService.js";
import { staffTokenRevocationService } from "../services/staffTokenRevocationService.js";

const router = express.Router();

const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Email inválido"),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  }),
});

router.post("/login", validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const attemptInput = {
    scope: "staff" as const,
    identifier: email,
    clientAddress: getRequestClientAddress(req),
  };

  const gate = await authAttemptSecurityService.check(attemptInput);
  if (!gate.allowed) {
    setRetryAfterHeader(res, gate);
    return sendError(res, getLockoutMessage(gate), 429);
  }

  const user = await UserRepository.findByEmail(email) as any;

  if (!user || !bcrypt.compareSync(password, user.password)) {
    const failure = await authAttemptSecurityService.recordFailure(attemptInput);
    if (!failure.allowed) {
      setRetryAfterHeader(res, failure);
      return sendError(res, getLockoutMessage(failure), 429);
    }
    return sendError(res, "Credenciales inválidas", 401);
  }

  await authAttemptSecurityService.clearFailures(attemptInput);

  const sessionVersion = Number(user.session_version ?? 1);
  const token = generateToken({
    userId: user.id,
    role: user.role,
    userName: user.name,
    sessionVersion,
  });

  if (req.session) {
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.userName = user.name;
    req.session.sessionVersion = sessionVersion;

    await new Promise<void>((resolve) => {
      req.session.save((err) => {
        if (err) {
          console.warn("[Auth] No se pudo guardar la sesión. Se continuará con token.", err);
        }
        resolve();
      });
    });
  }

  const { password: _, ...userWithoutPassword } = user;
  const permissions = await UserRepository.getPermissions(user.id);
  return sendSuccess(res, { ...userWithoutPassword, permissions, token }, "Login exitoso");
});

router.get("/me", async (req, res) => {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return sendError(res, "Sesión inválida o vencida. Iniciá sesión nuevamente.", 401);
  }

  const user = await UserRepository.findById(Number(authUser.userId)) as any;
  if (!user) return sendError(res, "Usuario no encontrado", 404);

  const permissions = await UserRepository.getPermissions(Number(authUser.userId));
  return sendSuccess(res, { ...user, permissions });
});

router.post("/logout", async (req, res) => {
  const { cookieOptions } = getSessionConfig();
  let revocationError: unknown = null;

  try {
    await staffTokenRevocationService.revokeBearerTokenIfValid(req);
  } catch (error) {
    revocationError = error;
    console.error("[Auth] No se pudo revocar el token actual.", error);
  }

  const clearAuthCookie = () => {
    res.clearCookie('sid', {
      ...cookieOptions,
      maxAge: 0,
    });
    if (revocationError) {
      return sendError(res, "La sesión local se cerró, pero no se pudo revocar el token en el servidor", 503);
    }
    return sendSuccess(res, null, "Sesión cerrada y token revocado");
  };

  if (!req.session) {
    return clearAuthCookie();
  }

  req.session.destroy((err) => {
    if (err) {
      console.warn("[Auth] Error al destruir sesión. Se limpiará cookie igualmente.", err);
    }
    return clearAuthCookie();
  });
});

export default router;
