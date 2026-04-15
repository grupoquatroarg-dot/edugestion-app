import express from "express";
import { UserRepository } from "../repositories/userRepository.js";
import { requireAdmin } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";

const router = express.Router();

const userSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Nombre demasiado corto"),
    email: z.string().email("Email inválido"),
    role: z.enum(["administrador", "vendedor", "operario"]),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").optional(),
    active: z.union([z.number(), z.boolean()]).optional(),
    avatar: z.string().optional(),
  }),
});

const permissionsSchema = z.object({
  body: z.object({
    permissions: z.record(z.string(), z.object({
      module: z.string(),
      can_view: z.boolean(),
      can_create: z.boolean(),
      can_edit: z.boolean(),
      can_delete: z.boolean(),
    })),
  }),
});

router.get("/", requireAdmin, (req, res) => {
  const users = UserRepository.findAll();
  return sendSuccess(res, users);
});

router.post("/", requireAdmin, validate(userSchema), (req, res) => {
  try {
    const newUser = UserRepository.create(req.body);
    return sendSuccess(res, newUser, "Usuario creado exitosamente", 201);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      return sendError(res, "El email ya está registrado", 400);
    }
    throw error;
  }
});

router.put("/:id", requireAdmin, validate(userSchema), (req, res) => {
  const updatedUser = UserRepository.update(Number(req.params.id), req.body);
  return sendSuccess(res, updatedUser, "Usuario actualizado");
});

router.get("/:id/permissions", requireAdmin, (req, res) => {
  const permissions = UserRepository.getPermissions(Number(req.params.id));
  return sendSuccess(res, permissions);
});

router.put("/:id/permissions", requireAdmin, validate(permissionsSchema), (req, res) => {
  UserRepository.updatePermissions(Number(req.params.id), req.body.permissions);
  return sendSuccess(res, null, "Permisos actualizados");
});

export default router;
