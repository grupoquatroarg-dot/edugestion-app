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

router.post("/login", validate(loginSchema), (req, res) => {
  const { email, password } = req.body;
  const user = UserRepository.findByEmail(email) as any;
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return sendError(res, "Credenciales inválidas", 401);
  }

  // 1. Create Session (Cookie)
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.userName = user.name;

  // 2. Generate Bearer Token (Fallback)
  const token = generateToken({
    userId: user.id,
    role: user.role,
    userName: user.name
  });

  req.session.save((err) => {
    if (err) {
      return sendError(res, "Error al guardar la sesión", 500);
    }
    const { password: _, ...userWithoutPassword } = user;
    const permissions = UserRepository.getPermissions(user.id);
    
    // Return both user data and token
    return sendSuccess(res, { ...userWithoutPassword, permissions, token }, "Login exitoso");
  });
});

router.get("/me", (req: any, res) => {
  let userId = req.session.userId;
  
  // Fallback to Bearer Token if no session
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
  
  const user = UserRepository.findById(userId) as any;
  if (!user) return sendError(res, "Usuario no encontrado", 404);
  
  const permissions = UserRepository.getPermissions(userId);
  return sendSuccess(res, { ...user, permissions });
});

router.post("/logout", (req, res) => {
  const { cookieOptions } = getSessionConfig();
  
  req.session.destroy((err) => {
    if (err) return sendError(res, "Error al cerrar sesión", 500);
    
    res.clearCookie('sid', {
      ...cookieOptions,
      maxAge: 0, // Force immediate expiration
    });
    
    return sendSuccess(res, null, "Sesión cerrada");
  });
});

export default router;
