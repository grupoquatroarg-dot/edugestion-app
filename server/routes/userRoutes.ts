import express from "express";
import { UserRepository } from "../repositories/userRepository.js";
import { requireAdmin } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";

const router = express.Router();

const baseUserBodySchema = z.object({
  name: z.string().min(2, "Nombre demasiado corto"),
  email: z.string().email("Email inválido"),
  role: z.enum(["administrador", "empleado", "vendedor", "operario"]),
  active: z.union([z.number(), z.boolean()]).optional(),
  avatar: z.string().optional(),
});

const createUserSchema = z.object({
  body: baseUserBodySchema.extend({
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  }),
});

const updateUserSchema = z.object({
  body: baseUserBodySchema.extend({
    password: z
      .string()
      .optional()
      .refine(
        (value) => value === undefined || value === "" || value.length >= 6,
        "La contraseña debe tener al menos 6 caracteres"
      ),
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

router.get("/", requireAdmin, async (req, res) => {
  const users = await UserRepository.findAll();
  return sendSuccess(res, users);
});

router.post("/", requireAdmin, validate(createUserSchema), async (req, res) => {
  try {
    const newUser = await UserRepository.create(req.body);
    return sendSuccess(res, newUser, "Usuario creado exitosamente", 201);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505') {
      return sendError(res, "El email ya está registrado", 400);
    }
    throw error;
  }
});

router.put("/:id", requireAdmin, validate(updateUserSchema), async (req, res) => {
  try {
    const updatedUser = await UserRepository.update(Number(req.params.id), req.body);
    return sendSuccess(res, updatedUser, "Usuario actualizado");
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505') {
      return sendError(res, "El email ya está registrado", 400);
    }
    throw error;
  }
});

router.get("/:id/permissions", requireAdmin, async (req, res) => {
  const permissions = await UserRepository.getPermissions(Number(req.params.id));
  return sendSuccess(res, permissions);
});

router.put("/:id/permissions", requireAdmin, validate(permissionsSchema), async (req, res) => {
  await UserRepository.updatePermissions(Number(req.params.id), req.body.permissions);
  return sendSuccess(res, null, "Permisos actualizados");
});

export default router;
