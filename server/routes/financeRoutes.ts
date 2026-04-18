import { Router } from 'express';
import { z } from 'zod';
import { financeRepository } from '../repositories/financeRepository.js';
import { requireAuth, requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { sendError, sendSuccess } from '../utils/response.js';

const router = Router();

const expenseSchema = z.object({
  body: z.object({
    monto: z.number().positive('El monto debe ser positivo'),
    descripcion: z.string().min(3, 'La descripción es muy corta'),
    categoria: z.string().min(1, 'La categoría es requerida'),
    forma_pago: z.string().min(1, 'La forma de pago es requerida'),
    fecha: z.string().optional(),
    cheque_id: z.union([z.number(), z.string()]).optional(),
    proveedor_id: z.union([z.number(), z.string()]).optional(),
  }),
});

const updateChequeStatusSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    estado: z.string().min(1),
    observaciones: z.string().optional(),
  }),
});

router.get('/movimientos', requireAuth, requirePermission('current_accounts', 'view'), async (req, res) => {
  try {
    const movimientos = await financeRepository.getMovements();
    return sendSuccess(res, movimientos);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener movimientos', error.statusCode || 400, error.errors || []);
  }
});

router.get('/cheques', requireAuth, requirePermission('current_accounts', 'view'), async (req, res) => {
  try {
    const cheques = await financeRepository.getCheques();
    return sendSuccess(res, cheques);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener cheques', error.statusCode || 400, error.errors || []);
  }
});

router.patch(
  '/cheques/:id/estado',
  requireAuth,
  requirePermission('current_accounts', 'edit'),
  validate(updateChequeStatusSchema),
  async (req, res) => {
    try {
      const chequeId = parseInt(req.params.id, 10);
      await financeRepository.updateChequeStatus(chequeId, req.body.estado, req.body.observaciones);
      return sendSuccess(res, null, 'Estado de cheque actualizado');
    } catch (error: any) {
      return sendError(res, error.message || 'Error al actualizar cheque', error.statusCode || 400, error.errors || []);
    }
  }
);

router.post('/egresos', requireAuth, requirePermission('current_accounts', 'create'), validate(expenseSchema), async (req, res) => {
  try {
    await financeRepository.registerExpense({
      ...req.body,
      usuario: (req as any).user?.userName || 'Sistema',
    });
    return sendSuccess(res, null, 'Egreso registrado exitosamente', 201);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al registrar egreso', error.statusCode || 400, error.errors || []);
  }
});

export default router;
