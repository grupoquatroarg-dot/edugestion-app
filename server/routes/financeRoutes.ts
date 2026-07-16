import { Router } from 'express';
import { z } from 'zod';
import { financeRepository } from '../repositories/financeRepository.js';
import { providerRepository } from '../repositories/providerRepository.js';
import { requireAuth, requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { manualExpenseCancellationService } from '../services/manualExpenseCancellationService.js';
import { clientPaymentCancellationService } from '../services/clientPaymentCancellationService.js';
import { listActivePaymentMethods } from '../services/paymentMethodAvailabilityService.js';

const router = Router();

router.get('/', requireAuth, requirePermission('current_accounts', 'view'), async (req, res) => {
  const endpoint = String(req.query.endpoint || '');

  try {
    if (endpoint === 'proveedores') {
      return sendSuccess(res, await providerRepository.findAll({ activeOnly: true }));
    }

    if (endpoint === 'payment-methods') {
      return sendSuccess(res, await listActivePaymentMethods());
    }

    return sendError(res, 'Endpoint de finanzas no encontrado', 404);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener datos de finanzas', error.statusCode || 400, error.errors || []);
  }
});

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

router.post('/', requireAuth, async (req, res, next) => {
  const endpoint = String(req.query.endpoint || '');

  if (!['egresos', 'manual-expense-cancel', 'client-payment-cancel'].includes(endpoint)) {
    return next();
  }

  const action = endpoint === 'egresos' ? 'create' : 'delete';
  const permissionMiddleware = requirePermission('current_accounts', action);

  return permissionMiddleware(req, res, async () => {
    try {
      if (endpoint === 'egresos') {
        const parsed = expenseSchema.safeParse({ body: req.body });
        if (!parsed.success) {
          return sendError(res, parsed.error.issues[0]?.message || 'Datos de egreso inválidos', 400, parsed.error.issues);
        }

        await financeRepository.registerExpense({
          ...parsed.data.body,
          usuario: (req as any).user?.userName || 'Sistema',
        });
        return sendSuccess(res, null, 'Egreso registrado exitosamente', 201);
      }

      const movementId = Number(req.query.id);
      if (!Number.isInteger(movementId) || movementId <= 0) {
        return sendError(res, endpoint === 'client-payment-cancel' ? 'ID de cobranza inválido' : 'ID de movimiento inválido', 400);
      }

      if (endpoint === 'client-payment-cancel') {
        const result = await clientPaymentCancellationService.cancelClientPayment({
          movementId,
          motivo: req.body?.motivo,
          usuario: (req as any).user?.userName || 'Sistema',
        });
        return sendSuccess(res, result, 'Cobranza anulada correctamente');
      }

      const result = await manualExpenseCancellationService.cancelManualExpense({
        movementId,
        motivo: req.body?.motivo,
        usuario: (req as any).user?.userName || 'Sistema',
      });
      return sendSuccess(res, result, 'Egreso anulado correctamente');
    } catch (error: any) {
      return sendError(
        res,
        error.message || (endpoint === 'client-payment-cancel' ? 'No se pudo anular la cobranza' : 'No se pudo completar la operación financiera'),
        error.statusCode || 400,
        error.errors || []
      );
    }
  });
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


router.post(
  '/movimientos/:id/cancel',
  requireAuth,
  requirePermission('current_accounts', 'delete'),
  async (req, res) => {
    try {
      const movementId = parseInt(req.params.id, 10);
      const result = await manualExpenseCancellationService.cancelManualExpense({
        movementId,
        motivo: req.body?.motivo,
        usuario: (req as any).user?.userName || 'Sistema',
      });
      return sendSuccess(res, result, 'Egreso anulado correctamente');
    } catch (error: any) {
      return sendError(
        res,
        error.message || 'No se pudo anular el egreso',
        error.statusCode || 400,
        error.errors || []
      );
    }
  }
);

router.post(
  '/movimientos/:id/cancel-client-payment',
  requireAuth,
  requirePermission('current_accounts', 'delete'),
  async (req, res) => {
    try {
      const movementId = parseInt(req.params.id, 10);
      const result = await clientPaymentCancellationService.cancelClientPayment({
        movementId,
        motivo: req.body?.motivo,
        usuario: (req as any).user?.userName || 'Sistema',
      });
      return sendSuccess(res, result, 'Cobranza anulada correctamente');
    } catch (error: any) {
      return sendError(
        res,
        error.message || 'No se pudo anular la cobranza',
        error.statusCode || 400,
        error.errors || []
      );
    }
  }
);

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
