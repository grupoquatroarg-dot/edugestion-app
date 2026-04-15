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
    })).min(1, "Debe incluir al menos un producto"),
    total: z.number().nonnegative(),
  }),
});

router.get('/', requireAuth, requirePermission('sales', 'view'), (req, res) => {
  const sales = salesRepository.getAll();
  return sendSuccess(res, sales);
});

router.get('/:id', requireAuth, requirePermission('sales', 'view'), (req, res) => {
  const sale = salesRepository.getById(parseInt(req.params.id));
  if (!sale) return sendError(res, "Venta no encontrada", 404);
  return sendSuccess(res, sale);
});

router.post('/', requireAuth, requirePermission('sales', 'create'), validate(saleSchema), (req, res) => {
  const result = salesService.createSale({
    ...req.body,
    usuario: (req.session as any).userName || 'Sistema'
  });
  return sendSuccess(res, result, "Venta registrada exitosamente", 201);
});

export default router;
