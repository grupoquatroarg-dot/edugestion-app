import { Router } from "express";
import { z } from "zod";
import { providerRepository } from "../repositories/providerRepository.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { sendSuccess } from "../utils/response.js";

const router = Router();

const providerSchema = z.object({
  body: z.object({
    nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
    cuit: z.string().optional(),
    telefono: z.string().optional(),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    direccion: z.string().optional(),
    estado: z.string().optional(),
  }),
});

router.get("/", requireAuth, requirePermission('suppliers', 'view'), async (req, res) => {
  const providers = await providerRepository.findAll();
  return sendSuccess(res, providers);
});

router.post("/", requireAuth, requirePermission('suppliers', 'create'), validate(providerSchema), async (req, res) => {
  const id = await providerRepository.create(req.body);
  return sendSuccess(res, { id, ...req.body }, "Proveedor creado exitosamente", 201);
});

router.put("/:id", requireAuth, requirePermission('suppliers', 'edit'), validate(providerSchema), async (req, res) => {
  await providerRepository.update(req.params.id, req.body);
  return sendSuccess(res, null, "Proveedor actualizado exitosamente");
});

router.delete("/:id", requireAuth, requirePermission('suppliers', 'delete'), async (req, res) => {
  await providerRepository.delete(req.params.id);
  return sendSuccess(res, null, "Proveedor eliminado exitosamente");
});

export default router;
