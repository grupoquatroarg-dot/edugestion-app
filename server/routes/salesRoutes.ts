import { Router } from 'express';
import { salesRepository } from '../repositories/salesRepository.js';
import { salesService } from '../services/salesService.js';
import { requireAuth, requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();

const saleSchema = z.object({
  body: z.object({
    cliente_id: z.number(),
    nombre_cliente: z.string().optional(),
    metodo_pago: z.string(),
    monto_pagado: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    cheque_data: z.any().optional(),
    items: z.array(z.object({
      product_id: z.number(),
      cantidad: z.number().positive(),
      precio_venta: z.number().nonnegative(),
    })).min(1, 'Debe incluir al menos un producto'),
    total: z.number().nonnegative(),
  }),
});

router.get('/', requireAuth, requirePermission('sales', 'view'), async (req, res) => {
  try {
    const sales = await salesRepository.getAll();
    return sendSuccess(res, sales);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener ventas', error.statusCode || 400, error.errors || []);
  }
});

router.get('/:id', requireAuth, requirePermission('sales', 'view'), async (req, res) => {
  try {
    const sale = await salesRepository.getById(parseInt(req.params.id, 10));
    if (!sale) return sendError(res, 'Venta no encontrada', 404);
    return sendSuccess(res, sale);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener la venta', error.statusCode || 400, error.errors || []);
  }
});

router.post('/', requireAuth, requirePermission('sales', 'create'), validate(saleSchema), async (req, res) => {
  try {
    const result = await salesService.createSale({
      ...req.body,
      usuario: (req as any).user?.userName || 'Sistema',
    });
    return sendSuccess(res, result, 'Venta registrada exitosamente', 201);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al procesar la venta', error.statusCode || 400, error.errors || []);
  }
});

export default router;
