import { Router } from 'express';
import { z } from 'zod';
import { clientRepository } from '../repositories/clientRepository.js';
import { salesService } from '../services/salesService.js';
import { requireAuth, requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { customerLifecycleService } from '../services/customerLifecycleService.js';
import { customerContentLifecycleService } from '../services/customerContentLifecycleService.js';

const router = Router();

const optionalEmailSchema = z.string().email('Email inválido').optional().or(z.literal(''));

const clientBodySchema = z.object({
  nombre_apellido: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  razon_social: z.string().optional().nullable(),
  cuit: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: optionalEmailSchema.nullable(),
  direccion: z.string().optional().nullable(),
  localidad: z.string().optional().nullable(),
  provincia: z.string().optional().nullable(),
  codigo_postal: z.string().optional().nullable(),
  latitud: z.number().nullable().optional(),
  longitud: z.number().nullable().optional(),
  observaciones: z.string().optional().nullable(),
  tipo_cliente: z.enum(['minorista', 'mayorista']).default('minorista'),
  lista_precio: z.enum(['lista1', 'lista2', 'lista3']).default('lista1'),
  limite_credito: z.number().min(0).default(0),
  portal_enabled: z.union([z.boolean(), z.number()]).optional().nullable(),
  portal_username: z.string().optional().nullable(),
  portal_password: z.string().optional().nullable(),
});

const clientSchema = z.object({ body: clientBodySchema });
const customerContentSchema = z.object({
  body: clientBodySchema.extend({
    motivo: z.string().trim().min(3, 'El motivo debe tener al menos 3 caracteres').max(500),
    expectedContentVersion: z.number().int().min(0),
  }),
});

const lifecycleSchema = z.object({
  body: z.object({
    motivo: z.string().trim().min(3, 'El motivo debe tener al menos 3 caracteres').max(500),
  }),
});

const paymentSchema = z.object({
  body: z.object({
    monto: z.number().positive('El monto debe ser mayor a cero'),
    metodo_pago: z.string().min(1, 'La forma de pago es requerida'),
    fecha: z.string().optional(),
    observaciones: z.string().optional(),
    route_item_id: z.number().int().positive().optional(),
    cheque_data: z.object({
      numero_cheque: z.string().trim().min(1, 'Número de cheque requerido'),
      banco: z.string().trim().min(1, 'Banco requerido'),
      fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de vencimiento inválida'),
      importe: z.number().positive(),
    }).optional(),
  }),
});

router.get('/', requireAuth, requirePermission('customers', 'view'), async (req, res) => {
  const activeOnly = String(req.query.active_only || '').toLowerCase() === 'true';
  const clients = await clientRepository.findAll({ activeOnly });
  return sendSuccess(res, clients);
});

router.post('/', requireAuth, requirePermission('customers', 'create'), validate(clientSchema), async (req, res) => {
  const id = await clientRepository.create(req.body);
  return sendSuccess(res, { id, ...req.body }, 'Cliente creado exitosamente', 201);
});

router.put('/:id', requireAuth, requirePermission('customers', 'edit'), validate(customerContentSchema), async (req, res) => {
  try {
    const result = await customerContentLifecycleService.update({
      customerId: Number(req.params.id),
      nombreApellido: req.body.nombre_apellido,
      razonSocial: req.body.razon_social,
      cuit: req.body.cuit,
      telefono: req.body.telefono,
      email: req.body.email,
      direccion: req.body.direccion,
      localidad: req.body.localidad,
      provincia: req.body.provincia,
      codigoPostal: req.body.codigo_postal,
      latitud: req.body.latitud,
      longitud: req.body.longitud,
      observaciones: req.body.observaciones,
      tipoCliente: req.body.tipo_cliente,
      listaPrecio: req.body.lista_precio,
      limiteCredito: req.body.limite_credito,
      portalEnabled: req.body.portal_enabled,
      portalUsername: req.body.portal_username,
      portalPassword: req.body.portal_password,
      motivo: req.body.motivo,
      usuario: (req as any).user?.userName || 'Sistema',
      expectedContentVersion: req.body.expectedContentVersion,
    });
    return sendSuccess(res, result, 'Cliente actualizado con trazabilidad');
  } catch (error: any) {
    return sendError(res, error.message || 'No se pudo actualizar el cliente', error.statusCode || 400, error.errors || []);
  }
});

router.post('/:id/deactivate', requireAuth, requirePermission('customers', 'delete'), validate(lifecycleSchema), async (req, res) => {
  const result = await customerLifecycleService.changeStatus({
    customerId: Number(req.params.id),
    action: 'deactivate',
    motivo: req.body.motivo,
    usuario: (req as any).user?.userName || 'Sistema',
  });
  return sendSuccess(res, result, 'Cliente dado de baja correctamente');
});

router.post('/:id/reactivate', requireAuth, requirePermission('customers', 'delete'), validate(lifecycleSchema), async (req, res) => {
  const result = await customerLifecycleService.changeStatus({
    customerId: Number(req.params.id),
    action: 'reactivate',
    motivo: req.body.motivo,
    usuario: (req as any).user?.userName || 'Sistema',
  });
  return sendSuccess(res, result, 'Cliente reactivado correctamente');
});

router.delete('/:id', requireAuth, requirePermission('customers', 'delete'), async (_req, res) => {
  return sendError(
    res,
    'La eliminación física de clientes está deshabilitada. Usá Dar de baja para conservar el historial.',
    409
  );
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
