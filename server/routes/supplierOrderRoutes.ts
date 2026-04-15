import { Router } from 'express';
import { supplierOrderRepository } from '../repositories/supplierOrderRepository.js';
import { supplierOrderService } from '../services/supplierOrderService.js';
import { requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();

const supplierOrderSchema = z.object({
  body: z.object({
    proveedor_id: z.number(),
    items: z.array(z.object({
      product_id: z.number(),
      cantidad: z.number().positive(),
    })).min(1, "Debe incluir al menos un producto"),
  }),
});

const statusSchema = z.object({
  body: z.object({
    estado: z.enum(['Pendiente', 'Recibido', 'Cancelado']),
  }),
});

router.get('/', requirePermission('suppliers', 'view'), (req, res) => {
  const orders = supplierOrderRepository.getAll();
  return sendSuccess(res, orders);
});

router.post('/', requirePermission('suppliers', 'create'), validate(supplierOrderSchema), (req, res) => {
  const orderId = supplierOrderRepository.create(req.body);
  return sendSuccess(res, { orderId }, "Pedido creado exitosamente", 201);
});

router.post('/:id/status', requirePermission('suppliers', 'edit'), validate(statusSchema), (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  supplierOrderRepository.updateStatus(parseInt(id), estado);
  return sendSuccess(res, null, "Estado actualizado");
});

router.post('/:id/complete-sale', requirePermission('suppliers', 'edit'), (req, res) => {
  const { id } = req.params;
  const result = supplierOrderService.completeSale(parseInt(id), {
    ...req.body,
    usuario: (req.session as any).userName || 'Sistema'
  });
  return sendSuccess(res, result, "Venta completada");
});

export default router;
