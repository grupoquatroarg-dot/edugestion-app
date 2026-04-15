import { Router } from 'express';
import { financeRepository } from '../repositories/financeRepository.js';
import { requireAuth, requirePermission } from '../middleware/authMiddleware.js';
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";

const router = Router();

const expenseSchema = z.object({
  body: z.object({
    monto: z.number().positive("El monto debe ser positivo"),
    descripcion: z.string().min(3, "La descripción es muy corta"),
    categoria: z.string().min(1, "La categoría es requerida"),
    forma_pago: z.string().min(1, "La forma de pago es requerida"),
    fecha: z.string().optional(),
  }),
});

router.get('/movimientos', requireAuth, requirePermission('current_accounts', 'view'), (req, res) => {
  try {
    const movimientos = financeRepository.getMovements();
    sendSuccess(res, movimientos);
  } catch (error) {
    throw error;
  }
});

router.get('/cheques', requireAuth, requirePermission('current_accounts', 'view'), (req, res) => {
  try {
    const cheques = financeRepository.getCheques();
    sendSuccess(res, cheques);
  } catch (error) {
    throw error;
  }
});

router.patch('/cheques/:id/estado', requireAuth, requirePermission('current_accounts', 'edit'), validate(z.object({
  body: z.object({
    estado: z.string().min(1),
    observaciones: z.string().optional(),
  })
})), (req, res) => {
  const { id } = req.params;
  const { estado, observaciones } = req.body;
  try {
    financeRepository.updateChequeStatus(parseInt(id), estado, observaciones);
    sendSuccess(res, null, "Estado de cheque actualizado");
  } catch (error) {
    throw error;
  }
});

router.post('/egresos', requireAuth, requirePermission('current_accounts', 'create'), validate(expenseSchema), (req, res) => {
  try {
    financeRepository.registerExpense({
      ...req.body,
      usuario: (req as any).user?.userName || 'Sistema'
    });
    sendSuccess(res, null, "Egreso registrado exitosamente", 201);
  } catch (error) {
    throw error;
  }
});

export default router;
