import { Router } from "express";
import { providerRepository } from "../repositories/providerRepository.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { sendSuccess, sendError } from "../utils/response.js";

const router = Router();

router.get("/", requireAuth, requirePermission('suppliers', 'view'), (req, res) => {
  try {
    const providers = providerRepository.findAll();
    sendSuccess(res, providers);
  } catch (error) {
    sendError(res, "Failed to fetch providers", 500);
  }
});

router.post("/", requireAuth, requirePermission('suppliers', 'create'), (req, res) => {
  try {
    const id = providerRepository.create(req.body);
    sendSuccess(res, { id, ...req.body }, "Proveedor creado exitosamente", 201);
  } catch (error) {
    sendError(res, "Failed to create provider", 500);
  }
});

router.put("/:id", requireAuth, requirePermission('suppliers', 'edit'), (req, res) => {
  try {
    providerRepository.update(req.params.id, req.body);
    sendSuccess(res, null, "Proveedor actualizado exitosamente");
  } catch (error) {
    sendError(res, "Failed to update provider", 500);
  }
});

router.delete("/:id", requireAuth, requirePermission('suppliers', 'delete'), (req, res) => {
  try {
    providerRepository.delete(req.params.id);
    sendSuccess(res, null, "Proveedor eliminado exitosamente");
  } catch (error) {
    sendError(res, "Failed to delete provider", 500);
  }
});

export default router;
