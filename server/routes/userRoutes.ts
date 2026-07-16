import express from "express";
import { UserRepository } from "../repositories/userRepository.js";
import { requireAdmin } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { userLifecycleService, type UserLifecycleAction } from "../services/userLifecycleService.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";

const router = express.Router();

const baseUserBodySchema = z.object({
  name: z.string().min(2, "Nombre demasiado corto"),
  email: z.string().email("Email inválido"),
  role: z.enum(["administrador", "empleado", "vendedor", "operario"]),
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

const lifecycleSchema = z.object({
  body: z.object({
    motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  }),
  query: z.object({
    action: z.enum(["deactivate", "reactivate"]),
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

router.get("/", requireAdmin, async (_req, res) => {
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
    const actor = (req as any).user;
    const updatedUser = await UserRepository.update(Number(req.params.id), req.body, Number(actor.userId));
    return sendSuccess(res, updatedUser, "Usuario actualizado");
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505') {
      return sendError(res, "El email ya está registrado", 400);
    }
    throw error;
  }
});

router.post("/:id/lifecycle", requireAdmin, validate(lifecycleSchema), async (req, res) => {
  const actor = (req as any).user;
  const action = req.query.action as UserLifecycleAction;
  const result = await userLifecycleService.changeStatus({
    userId: Number(req.params.id),
    action,
    motivo: req.body.motivo,
    performedByUserId: Number(actor.userId),
    performedByName: actor.userName || "Sistema",
  });

  return sendSuccess(
    res,
    result,
    action === "deactivate"
      ? "Usuario dado de baja correctamente"
      : "Usuario reactivado correctamente"
  );
});

router.delete("/:id", requireAdmin, async (_req, res) => {
  return sendError(
    res,
    "La eliminación física de usuarios está deshabilitada. Usá Dar de baja para conservar el historial.",
    409
  );
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
