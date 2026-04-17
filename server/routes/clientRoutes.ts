import { Router } from 'express';
import { z } from 'zod';
import { clientRepository } from '../repositories/clientRepository.js';
import { salesService } from '../services/salesService.js';
import { requireAuth, requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendError } from '../utils/response.js';

const router = Router();

const optionalEmailSchema = z.string().email('Email inválido').optional().or(z.literal(''));

const clientSchema = z.object({
  body: z.object({
    nombre_apellido: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
    razon_social: z.string().optional(),
    cuit: z.string().optional(),
    telefono: z.string().optional(),
    email: optionalEmailSchema,
    direccion: z.string().optional(),
    localidad: z.string().optional(),
    provincia: z.string().optional(),
    latitud: z.number().optional(),
    longitud: z.number().optional(),
    observaciones: z.string().optional(),
    tipo_cliente: z.enum(['minorista', 'mayorista']).default('minorista'),
    lista_precio: z.string().default('lista1'),
    limite_credito: z.number().min(0).default(0),
  }),
});

const paymentSchema = z.object({
  body: z.object({
    monto: z.number().positive('El monto debe ser mayor a cero'),
    metodo_pago: z.string().min(1, 'La forma de pago es requerida'),
    fecha: z.string().optional(),
    observaciones: z.string().optional(),
  }),
});

router.get('/', requireAuth, requirePermission('customers', 'view'), async (req, res) => {
  const clients = await clientRepository.findAll();
  return sendSuccess(res, clients);
});

router.post('/', requireAuth, requirePermission('customers', 'create'), validate(clientSchema), async (req, res) => {
  const id = await clientRepository.create(req.body);
  return sendSuccess(res, { id, ...req.body }, 'Cliente creado exitosamente', 201);
});

router.put('/:id', requireAuth, requirePermission('customers', 'edit'), validate(clientSchema), async (req, res) => {
  await clientRepository.update(req.params.id, req.body);
  return sendSuccess(res, null, 'Cliente actualizado exitosamente');
});

router.delete('/:id', requireAuth, requirePermission('customers', 'delete'), async (req, res) => {
  await clientRepository.delete(req.params.id);
  return sendSuccess(res, null, 'Cliente eliminado exitosamente');
});

router.post('/:id/pagos', requireAuth, requirePermission('current_accounts', 'create'), validate(paymentSchema), async (req, res) => {
  try {
    const result = await salesService.registerClientPayment({
      cliente_id: Number(req.params.id),
      ...req.body,
      usuario: (req as any).user?.userName || 'Sistema',
    });

    return sendSuccess(res, result, 'Pago registrado exitosamente', 201);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al registrar el pago', error.statusCode || 400, error.errors || []);
  }
});

export default router;
