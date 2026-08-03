import { Router } from 'express';
import { salesRepository } from '../repositories/salesRepository.js';
import { salesService } from '../services/salesService.js';
import { saleCancellationService } from '../services/saleCancellationService.js';
import { petiSalesReportService } from '../services/petiSalesReportService.js';
import { requireAuth, requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();


const saleCancellationSchema = z.object({
  body: z.object({
    motivo: z.string().trim().min(3, 'El motivo de anulación es obligatorio').max(500),
  }),
});

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
    if (String(req.query?.endpoint || '') === 'peti-customer-report') {
      const report = await petiSalesReportService.getReport({
        from: typeof req.query?.from === 'string' ? req.query.from : null,
        to: typeof req.query?.to === 'string' ? req.query.to : null,
      });
      return sendSuccess(res, report);
    }

    const sales = await salesRepository.getAll();
    return sendSuccess(res, sales);
  } catch (error: any) {
    return sendError(
      res,
      error.message || (
        String(req.query?.endpoint || '') === 'peti-customer-report'
          ? 'No se pudo generar el reporte de ventas Peti'
          : 'Error al obtener ventas'
      ),
      error.statusCode || 400,
      error.errors || []
    );
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

router.post('/:id/cancel', requireAuth, requirePermission('sales', 'delete'), validate(saleCancellationSchema), async (req, res) => {
  try {
    const result = await saleCancellationService.cancelSale({
      saleId: parseInt(req.params.id, 10),
      motivo: req.body.motivo,
      usuario: (req as any).user?.userName || 'Sistema',
    });
    return sendSuccess(res, result, 'Venta anulada correctamente');
  } catch (error: any) {
    return sendError(res, error.message || 'No se pudo anular la venta', error.statusCode || 400, error.errors || []);
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
