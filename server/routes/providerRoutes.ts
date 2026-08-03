import { Router } from "express";
import { z } from "zod";
import { providerRepository } from "../repositories/providerRepository.js";
import { providerLifecycleService } from "../services/providerLifecycleService.js";
import { providerContentLifecycleService } from "../services/providerContentLifecycleService.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { sendError, sendSuccess } from "../utils/response.js";

const router = Router();

const providerSchema = z.object({
  body: z.object({
    nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
    cuit: z.string().optional(),
    telefono: z.string().optional(),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    direccion: z.string().optional(),
  }),
});

const providerContentSchema = z.object({
  body: providerSchema.shape.body.extend({
    motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
    expectedContentVersion: z.number().int().min(0, "Versión de contenido inválida"),
  }),
});

const lifecycleSchema = z.object({
  body: z.object({
    motivo: z.string().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  }),
});

router.get("/", requireAuth, requirePermission("suppliers", "view"), async (req, res) => {
  const activeOnly = String(req.query.active_only || "").toLowerCase() === "true";
  const providers = await providerRepository.findAll({ activeOnly });
  return sendSuccess(res, providers);
});

router.post("/", requireAuth, requirePermission("suppliers", "create"), validate(providerSchema), async (req, res) => {
  const id = await providerRepository.create(req.body);
  return sendSuccess(res, { id, ...req.body, estado: "activo" }, "Proveedor creado exitosamente", 201);
});

router.put("/:id", requireAuth, requirePermission("suppliers", "edit"), validate(providerContentSchema), async (req, res) => {
  try {
    const result = await providerContentLifecycleService.update({
      providerId: Number(req.params.id),
      nombre: req.body.nombre,
      cuit: req.body.cuit,
      telefono: req.body.telefono,
      email: req.body.email,
      direccion: req.body.direccion,
      motivo: req.body.motivo,
      usuario: (req as any).user?.userName || "Sistema",
      expectedContentVersion: req.body.expectedContentVersion,
    });
    return sendSuccess(res, result, "Proveedor actualizado con trazabilidad");
  } catch (error: any) {
    return sendError(res, error.message || "Error al actualizar el proveedor", error.statusCode || 400, error.errors || []);
  }
});

router.post(
  "/:id/deactivate",
  requireAuth,
  requirePermission("suppliers", "delete"),
  validate(lifecycleSchema),
  async (req, res) => {
    try {
      const result = await providerLifecycleService.changeStatus({
        providerId: Number(req.params.id),
        action: "deactivate",
        motivo: req.body.motivo,
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Proveedor dado de baja correctamente");
    } catch (error: any) {
      return sendError(res, error.message || "No se pudo dar de baja el proveedor", error.statusCode || 400, error.errors || []);
    }
  }
);

router.post(
  "/:id/reactivate",
  requireAuth,
  requirePermission("suppliers", "delete"),
  validate(lifecycleSchema),
  async (req, res) => {
    try {
      const result = await providerLifecycleService.changeStatus({
        providerId: Number(req.params.id),
        action: "reactivate",
        motivo: req.body.motivo,
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Proveedor reactivado correctamente");
    } catch (error: any) {
      return sendError(res, error.message || "No se pudo reactivar el proveedor", error.statusCode || 400, error.errors || []);
    }
  }
);

router.delete("/:id", requireAuth, requirePermission("suppliers", "delete"), async (_req, res) => {
  return sendError(
    res,
    "La eliminación física de proveedores está deshabilitada. Usá Dar de baja para conservar el historial.",
    409
  );
});

export default router;
