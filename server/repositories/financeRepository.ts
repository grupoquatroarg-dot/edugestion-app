import db from '../db.js';
import { getPostgresPool, isPostgresConfigured } from '../utils/postgres.js';
import { AppError } from '../utils/response.js';
import { normalizeBusinessDateForStorage, toBusinessDateKey, toStoredDateOnly } from '../utils/businessDate.js';
import { assertPaymentMethodActive } from '../services/paymentMethodAvailabilityService.js';

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getExecutor = (executor?: Queryable) => executor || getPostgresPool();

const getAndIncrementSetting = async (client: Queryable, key: string, defaultValue: number = 1) => {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, String(defaultValue)]
  );

  const currentResult = await client.query(
    `SELECT value
     FROM settings
     WHERE key = $1
     LIMIT 1`,
    [key]
  );

  const currentValue = parseInt(currentResult.rows[0]?.value || String(defaultValue), 10) || defaultValue;

  await client.query(
    `UPDATE settings
     SET value = $2
     WHERE key = $1`,
    [key, String(currentValue + 1)]
  );

  return currentValue;
};

const DATE_BASED_MOVEMENT_ORIGINS = new Set(['egreso_manual', 'compra', 'cobranza', 'pago_cc', 'cheque_rechazado', 'anulacion_pago_proveedor']);

const mapMovement = (row: any) => ({
  id: toNumber(row.id),
  fecha: row.fecha,
  fecha_dia: DATE_BASED_MOVEMENT_ORIGINS.has(String(row.origen || '').toLowerCase())
    ? toStoredDateOnly(row.fecha)
    : toBusinessDateKey(row.fecha),
  tipo: row.tipo,
  origen: row.origen,
  cliente_id: row.cliente_id === null || row.cliente_id === undefined ? null : toNumber(row.cliente_id),
  venta_id: row.venta_id === null || row.venta_id === undefined ? null : toNumber(row.venta_id),
  descripcion: row.descripcion || '',
  categoria: row.categoria || '',
  forma_pago: row.forma_pago || '',
  monto: toNumber(row.monto),
  usuario: row.usuario || 'Sistema',
  numero_pago: row.numero_pago === null || row.numero_pago === undefined ? null : toNumber(row.numero_pago),
  cheque_id: row.cheque_id === null || row.cheque_id === undefined ? null : toNumber(row.cheque_id),
  estado: row.estado || 'Activo',
  reversion_version: toNumber(row.reversion_version),
  anulada_at: row.anulada_at || null,
  anulada_por: row.anulada_por || null,
  anulacion_motivo: row.anulacion_motivo || null,
  reversed_movement_id: row.reversed_movement_id === null || row.reversed_movement_id === undefined ? null : toNumber(row.reversed_movement_id),
  financial_movement_cancellation_id: row.financial_movement_cancellation_id === null || row.financial_movement_cancellation_id === undefined ? null : toNumber(row.financial_movement_cancellation_id),
  client_payment_cancellation_id: row.client_payment_cancellation_id === null || row.client_payment_cancellation_id === undefined ? null : toNumber(row.client_payment_cancellation_id),
  supplier_payment_cancellation_id: row.supplier_payment_cancellation_id === null || row.supplier_payment_cancellation_id === undefined ? null : toNumber(row.supplier_payment_cancellation_id),
  route_item_id: row.route_item_id === null || row.route_item_id === undefined ? null : toNumber(row.route_item_id),
  nombre_cliente: row.nombre_cliente || null,
});

const mapCheque = (row: any) => ({
  id: toNumber(row.id),
  numero_cheque: row.numero_cheque || '',
  banco: row.banco || '',
  importe: toNumber(row.importe),
  fecha_vencimiento: toStoredDateOnly(row.fecha_vencimiento) || '',
  estado: row.estado || 'en_cartera',
  cliente_id: row.cliente_id === null || row.cliente_id === undefined ? null : toNumber(row.cliente_id),
  venta_id: row.venta_id === null || row.venta_id === undefined ? null : toNumber(row.venta_id),
  proveedor_id: row.proveedor_id === null || row.proveedor_id === undefined ? null : toNumber(row.proveedor_id),
  fecha_entrega: row.fecha_entrega ? toStoredDateOnly(row.fecha_entrega) : null,
  observaciones: row.observaciones || null,
  nombre_cliente: row.nombre_cliente || null,
  numero_venta: row.numero_venta || null,
  nombre_proveedor: row.nombre_proveedor || null,
  estado_actualizado_at: row.estado_actualizado_at || null,
  estado_actualizado_por: row.estado_actualizado_por || null,
  ultimo_cambio_estado_id: row.ultimo_cambio_estado_id === null || row.ultimo_cambio_estado_id === undefined ? null : toNumber(row.ultimo_cambio_estado_id),
  financial_movement_id: row.financial_movement_id === null || row.financial_movement_id === undefined ? null : toNumber(row.financial_movement_id),
  ultimo_estado_anterior: row.ultimo_estado_anterior || null,
  ultimo_cambio_motivo: row.ultimo_cambio_motivo || null,
  ultimo_cambio_por: row.ultimo_cambio_por || null,
  ultimo_cambio_at: row.ultimo_cambio_at || null,
  puede_revertir_estado: Boolean(row.puede_revertir_estado),
});

export const financeRepository = {
  getMovements(executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT m.*, c.nombre_apellido as nombre_cliente
        FROM movimientos_financieros m
        LEFT JOIN clientes c ON m.cliente_id = c.id
        ORDER BY m.fecha DESC, m.id DESC
      `).all().map(mapMovement);
    }

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `SELECT m.*, c.nombre_apellido AS nombre_cliente
         FROM movimientos_financieros m
         LEFT JOIN clientes c ON m.cliente_id = c.id
         ORDER BY m.fecha DESC, m.id DESC`
      )
      .then((result) => result.rows.map(mapMovement));
  },

  getCheques(executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT
          ch.*,
          c.nombre_apellido as nombre_cliente,
          s.numero_venta,
          p.nombre as nombre_proveedor,
          csc.estado_anterior as ultimo_estado_anterior,
          csc.motivo as ultimo_cambio_motivo,
          csc.cambiado_por as ultimo_cambio_por,
          csc.cambiado_at as ultimo_cambio_at,
          CASE
            WHEN csc.id IS NOT NULL
              AND csc.revertido_at IS NULL
              AND csc.estado_nuevo = ch.estado
            THEN 1 ELSE 0
          END as puede_revertir_estado
        FROM cheques ch
        LEFT JOIN clientes c ON ch.cliente_id = c.id
        LEFT JOIN sales s ON ch.venta_id = s.id
        LEFT JOIN proveedores p ON ch.proveedor_id = p.id
        LEFT JOIN cheque_status_changes csc ON csc.id = ch.ultimo_cambio_estado_id
        ORDER BY ch.fecha_vencimiento ASC, ch.id ASC
      `).all().map(mapCheque);
    }

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `SELECT
           ch.*,
           c.nombre_apellido AS nombre_cliente,
           s.numero_venta,
           p.nombre AS nombre_proveedor,
           csc.estado_anterior AS ultimo_estado_anterior,
           csc.motivo AS ultimo_cambio_motivo,
           csc.cambiado_por AS ultimo_cambio_por,
           csc.cambiado_at AS ultimo_cambio_at,
           (
             csc.id IS NOT NULL
             AND csc.revertido_at IS NULL
             AND csc.estado_nuevo = ch.estado
           ) AS puede_revertir_estado
         FROM cheques ch
         LEFT JOIN clientes c ON ch.cliente_id = c.id
         LEFT JOIN sales s ON ch.venta_id = s.id
         LEFT JOIN proveedores p ON ch.proveedor_id = p.id
         LEFT JOIN cheque_status_changes csc ON csc.id = ch.ultimo_cambio_estado_id
         ORDER BY ch.fecha_vencimiento ASC NULLS LAST, ch.id ASC`
      )
      .then((result) => result.rows.map(mapCheque));
  },

  async registerExpense(expenseData: any) {
    const {
      monto,
      descripcion,
      categoria,
      forma_pago,
      fecha,
      usuario,
      cheque_id,
      proveedor_id,
    } = expenseData;

    const amount = toNumber(monto);
    const movementDate = normalizeBusinessDateForStorage(fecha);
    const chequeId = cheque_id === null || cheque_id === undefined || cheque_id === '' ? null : Number(cheque_id);
    const proveedorId = proveedor_id === null || proveedor_id === undefined || proveedor_id === '' ? null : Number(proveedor_id);

    if (amount <= 0) {
      throw new AppError('El monto debe ser positivo', 400);
    }

    if (!isPostgresConfigured()) {
      await assertPaymentMethodActive(forma_pago);
      return db.transaction(() => {
        const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1', 10);
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_payment_number', '1')").run();
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run(String(nextPaymentNum + 1));

        db.prepare(`
          INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id, estado, reversion_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'egreso',
          'egreso_manual',
          descripcion,
          categoria,
          forma_pago,
          amount,
          movementDate,
          usuario || 'Sistema',
          nextPaymentNum,
          chequeId || null,
          'Activo',
          1
        );

        if (forma_pago === 'cheque_en_cartera' && chequeId) {
          db.prepare(`
            UPDATE cheques
            SET estado = 'entregado_proveedor',
                proveedor_id = ?,
                fecha_entrega = ?
            WHERE id = ?
          `).run(proveedorId || null, movementDate, chequeId);
        }
      })();
    }

    const pool = getPostgresPool();
    return pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        await assertPaymentMethodActive(forma_pago, client);

        const nextPaymentNum = await getAndIncrementSetting(client, 'next_payment_number');

        await client.query(
          `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id, estado, reversion_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            'egreso',
            'egreso_manual',
            descripcion,
            categoria,
            forma_pago,
            amount,
            movementDate,
            usuario || 'Sistema',
            nextPaymentNum,
            chequeId,
            'Activo',
            1,
          ]
        );

        if (forma_pago === 'cheque_en_cartera' && chequeId) {
          const chequeResult = await client.query(
            `SELECT id
             FROM cheques
             WHERE id = $1
             LIMIT 1`,
            [chequeId]
          );

          if (!chequeResult.rowCount) {
            throw new AppError('Cheque no encontrado', 404);
          }

          await client.query(
            `UPDATE cheques
             SET estado = 'entregado_proveedor',
                 proveedor_id = $1,
                 fecha_entrega = $2
             WHERE id = $3`,
            [proveedorId, movementDate, chequeId]
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  },
};
