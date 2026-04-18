import express from "express";
import bcrypt from "bcryptjs";
import { UserRepository } from "../repositories/userRepository.js";
import { validate } from "../middleware/validate.js";
import { getSessionConfig } from "../utils/sessionConfig.js";
import { generateToken, verifyToken } from "../utils/jwt.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";

const router = express.Router();

const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Email inválido"),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  }),
});

router.post("/login", validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const user = await UserRepository.findByEmail(email) as any;
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return sendError(res, "Credenciales inválidas", 401);
  }

  const token = generateToken({
    userId: user.id,
    role: user.role,
    userName: user.name
  });

  if (req.session) {
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.userName = user.name;

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

router.get("/me", async (req: any, res) => {
  let userId = req.session?.userId;
  
  if (!userId) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);
      if (decoded) {
        userId = decoded.userId;
      }
    }
  }

  if (!userId) {
    return sendError(res, "No has iniciado sesión", 401);
  }
  
  const user = await UserRepository.findById(Number(userId)) as any;
  if (!user) return sendError(res, "Usuario no encontrado", 404);
  
  const permissions = await UserRepository.getPermissions(Number(userId));
  return sendSuccess(res, { ...user, permissions });
});

router.post("/logout", (req, res) => {
  const { cookieOptions } = getSessionConfig();

  const clearAuthCookie = () => {
    res.clearCookie('sid', {
      ...cookieOptions,
      maxAge: 0,
    });
    return sendSuccess(res, null, "Sesión cerrada");
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
