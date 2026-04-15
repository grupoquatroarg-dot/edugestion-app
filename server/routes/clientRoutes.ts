import { Router } from "express";
import { clientRepository } from "../repositories/clientRepository.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";

const router = Router();

const clientSchema = z.object({
  body: z.object({
    nombre_apellido: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    razon_social: z.string().optional(),
    cuit: z.string().optional(),
    telefono: z.string().optional(),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    direccion: z.string().optional(),
    localidad: z.string().optional(),
    provincia: z.string().optional(),
    latitud: z.number().optional(),
    longitud: z.number().optional(),
    observaciones: z.string().optional(),
    tipo_cliente: z.enum(["minorista", "mayorista"]).default("minorista"),
    lista_precio: z.string().default("lista1"),
    limite_credito: z.number().min(0).default(0),
  }),
});

router.get("/", requireAuth, requirePermission('customers', 'view'), (req, res) => {
  try {
    const clients = clientRepository.findAll();
    sendSuccess(res, clients);
  } catch (error) {
    throw error;
  }
});

router.post("/", requireAuth, requirePermission('customers', 'create'), validate(clientSchema), (req, res) => {
  try {
    const id = clientRepository.create(req.body);
    sendSuccess(res, { id, ...req.body }, "Cliente creado exitosamente", 201);
  } catch (error) {
    throw error;
  }
});

router.put("/:id", requireAuth, requirePermission('customers', 'edit'), validate(clientSchema), (req, res) => {
  try {
    clientRepository.update(req.params.id, req.body);
    sendSuccess(res, null, "Cliente actualizado exitosamente");
  } catch (error) {
    throw error;
  }
});

router.delete("/:id", requireAuth, requirePermission('customers', 'delete'), (req, res) => {
  try {
    clientRepository.delete(req.params.id);
    sendSuccess(res, null, "Cliente eliminado exitosamente");
  } catch (error) {
    throw error;
  }
});

export default router;
