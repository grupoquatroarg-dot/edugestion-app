import { Router } from 'express';
import { supplierOrderRepository } from '../repositories/supplierOrderRepository.js';
import { supplierOrderService } from '../services/supplierOrderService.js';
import { supplierOrderCancellationService } from '../services/supplierOrderCancellationService.js';
import { supplierOrderDeliveryReversalService } from '../services/supplierOrderDeliveryReversalService.js';
import { supplierOrderStatusLifecycleService } from '../services/supplierOrderStatusLifecycleService.js';
import { supplierOrderContentLifecycleService } from '../services/supplierOrderContentLifecycleService.js';
import { requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();

const supplierOrderSchema = z.object({
  body: z.object({
    // Un pedido a proveedor puede ser general y no necesita un cliente real.
    cliente: z.string().trim().min(1).max(250).optional().nullable(),
    cliente_id: z.number().int().positive().optional().nullable(),
    proveedor_id: z.number().int().positive().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    items: z.array(z.object({
      product_id: z.number().int().positive(),
      cantidad: z.number().positive(),
    })).min(1, "Debe incluir al menos un producto"),
  }),
});

const statusSchema = z.object({
  body: z.object({
    action: z.enum(['advance', 'reopen']),
    motivo: z.string().trim().max(500).optional(),
  }),
});

const contentSchema = z.object({
  body: z.object({
    notes: z.string().max(2000).optional().nullable(),
    motivo: z.string().trim().min(3).max(500),
    expected_content_version: z.number().int().nonnegative(),
    expected_status_version: z.number().int().nonnegative(),
    items: z.array(z.object({
      product_id: z.number().int().positive(),
      cantidad: z.number().positive(),
    })).min(1, 'Debe incluir al menos un producto'),
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

router.post('/:id/status', requirePermission('suppliers', 'edit'), validate(statusSchema), async (req, res) => {
  try {
    const result = await supplierOrderStatusLifecycleService.changeStatus({
      supplierOrderId: Number(req.params.id),
      action: req.body.action,
      motivo: req.body.motivo,
      usuario: (req as any).user?.userName || (req.session as any)?.userName || 'Sistema',
    });
    return sendSuccess(
      res,
      result,
      req.body.action === 'advance' ? 'Pedido avanzado correctamente' : 'Pedido reabierto correctamente'
    );
  } catch (error: any) {
    return sendError(res, error?.message || 'No se pudo actualizar la etapa del pedido', error?.statusCode || 400);
  }
});

router.put('/:id/items', requirePermission('suppliers', 'edit'), validate(contentSchema), async (req, res) => {
  try {
    const result = await supplierOrderContentLifecycleService.update({
      supplierOrderId: Number(req.params.id),
      items: req.body.items,
      notes: req.body.notes,
      motivo: req.body.motivo,
      usuario: (req as any).user?.userName || (req.session as any)?.userName || 'Sistema',
      expectedContentVersion: req.body.expected_content_version,
      expectedStatusVersion: req.body.expected_status_version,
    });
    return sendSuccess(res, result, 'Productos y observaciones actualizados con trazabilidad');
  } catch (error: any) {
    return sendError(
      res,
      error?.message || 'No se pudo actualizar el pedido',
      error?.statusCode || 400,
      error?.errors || []
    );
  }
});

router.post('/:id/complete-sale', requirePermission('suppliers', 'edit'), (req, res) => {
  const { id } = req.params;
  const result = supplierOrderService.completeSale(parseInt(id), {
    ...req.body,
    usuario: (req.session as any).userName || 'Sistema'
  });
  return sendSuccess(res, result, "Venta completada");
});

router.post('/:id/revert-delivery', requirePermission('suppliers', 'edit'), async (req, res) => {
  try {
    const result = await supplierOrderDeliveryReversalService.revert({
      supplierOrderId: Number(req.params.id),
      motivo: String(req.body?.motivo || ''),
      usuario: (req as any).user?.userName || (req.session as any)?.userName || 'Sistema',
    });

    return sendSuccess(res, result, 'Entrega revertida correctamente');
  } catch (error: any) {
    return sendError(
      res,
      error?.message || 'No se pudo revertir la entrega',
      error?.statusCode || 400,
      error?.errors || []
    );
  }
});

router.post('/:id/cancel', requirePermission('suppliers', 'delete'), async (req, res) => {
  try {
    const result = await supplierOrderCancellationService.cancelSupplierOrder({
      supplierOrderId: Number(req.params.id),
      motivo: String(req.body?.motivo || ''),
      usuario: (req as any).user?.userName || 'Sistema',
    });

    return sendSuccess(res, result, 'Pedido anulado correctamente');
  } catch (error: any) {
    return sendError(
      res,
      error?.message || 'No se pudo anular el pedido',
      error?.statusCode || 400,
      error?.errors || []
    );
  }
});

export default router;
