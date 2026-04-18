import db from '../db.js';
import { getPostgresPool, isPostgresConfigured } from '../utils/postgres.js';
import { AppError } from '../utils/response.js';

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

const mapMovement = (row: any) => ({
  id: toNumber(row.id),
  fecha: row.fecha,
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
  nombre_cliente: row.nombre_cliente || null,
});

const mapCheque = (row: any) => ({
  id: toNumber(row.id),
  numero_cheque: row.numero_cheque || '',
  banco: row.banco || '',
  importe: toNumber(row.importe),
  fecha_vencimiento: row.fecha_vencimiento || '',
  estado: row.estado || 'en_cartera',
  cliente_id: row.cliente_id === null || row.cliente_id === undefined ? null : toNumber(row.cliente_id),
  venta_id: row.venta_id === null || row.venta_id === undefined ? null : toNumber(row.venta_id),
  proveedor_id: row.proveedor_id === null || row.proveedor_id === undefined ? null : toNumber(row.proveedor_id),
  fecha_entrega: row.fecha_entrega || null,
  observaciones: row.observaciones || null,
  nombre_cliente: row.nombre_cliente || null,
  numero_venta: row.numero_venta || null,
  nombre_proveedor: row.nombre_proveedor || null,
});

export const financeRepository = {
  getMovements(executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT m.*, c.nombre_apellido as nombre_cliente
        FROM movimientos_financieros m
        LEFT JOIN clientes c ON m.cliente_id = c.id
        ORDER BY m.fecha DESC, m.id DESC
      `).all();
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
        SELECT ch.*, c.nombre_apellido as nombre_cliente, s.numero_venta, p.nombre as nombre_proveedor
        FROM cheques ch
        JOIN clientes c ON ch.cliente_id = c.id
        LEFT JOIN sales s ON ch.venta_id = s.id
        LEFT JOIN proveedores p ON ch.proveedor_id = p.id
        ORDER BY ch.fecha_vencimiento ASC, ch.id ASC
      `).all();
    }

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `SELECT ch.*, c.nombre_apellido AS nombre_cliente, s.numero_venta, p.nombre AS nombre_proveedor
         FROM cheques ch
         LEFT JOIN clientes c ON ch.cliente_id = c.id
         LEFT JOIN sales s ON ch.venta_id = s.id
         LEFT JOIN proveedores p ON ch.proveedor_id = p.id
         ORDER BY ch.fecha_vencimiento ASC NULLS LAST, ch.id ASC`
      )
      .then((result) => result.rows.map(mapCheque));
  },

  updateChequeStatus(id: number, estado: string, observaciones?: string | null) {
    if (!isPostgresConfigured()) {
      return db.transaction(() => {
        const cheque = db.prepare('SELECT * FROM cheques WHERE id = ?').get(id) as any;
        if (!cheque) throw new AppError('Cheque no encontrado', 404);

        db.prepare('UPDATE cheques SET estado = ?, observaciones = ? WHERE id = ?')
          .run(estado, observaciones || null, id);

        if (estado === 'rechazado' && cheque.estado !== 'rechazado') {
          const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1', 10);
          db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_payment_number', '1')").run();
          db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run(String(nextPaymentNum + 1));

          db.prepare(`
            INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            'egreso',
            'egreso_manual',
            `Cheque Rechazado N° ${cheque.numero_cheque} - ${cheque.banco}`,
            'Cheque Rechazado',
            'cheque',
            cheque.importe,
            new Date().toISOString(),
            'Sistema',
            nextPaymentNum,
            id
          );
        }
      })();
    }

    const pool = getPostgresPool();
    return pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');

        const chequeResult = await client.query(
          `SELECT *
           FROM cheques
           WHERE id = $1
           LIMIT 1`,
          [id]
        );

        if (!chequeResult.rowCount) {
          throw new AppError('Cheque no encontrado', 404);
        }

        const cheque = chequeResult.rows[0];

        await client.query(
          `UPDATE cheques
           SET estado = $1,
               observaciones = $2
           WHERE id = $3`,
          [estado, observaciones || null, id]
        );

        if (estado === 'rechazado' && cheque.estado !== 'rechazado') {
          const nextPaymentNum = await getAndIncrementSetting(client, 'next_payment_number');

          await client.query(
            `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              'egreso',
              'egreso_manual',
              `Cheque Rechazado N° ${cheque.numero_cheque || ''} - ${cheque.banco || ''}`.trim(),
              'Cheque Rechazado',
              'cheque',
              toNumber(cheque.importe),
              new Date().toISOString(),
              'Sistema',
              nextPaymentNum,
              id,
            ]
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

  registerExpense(expenseData: any) {
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
    const chequeId = cheque_id === null || cheque_id === undefined || cheque_id === '' ? null : Number(cheque_id);
    const proveedorId = proveedor_id === null || proveedor_id === undefined || proveedor_id === '' ? null : Number(proveedor_id);

    if (amount <= 0) {
      throw new AppError('El monto debe ser positivo', 400);
    }

    if (!isPostgresConfigured()) {
      return db.transaction(() => {
        const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1', 10);
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_payment_number', '1')").run();
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run(String(nextPaymentNum + 1));

        db.prepare(`
          INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'egreso',
          'egreso_manual',
          descripcion,
          categoria,
          forma_pago,
          amount,
          fecha || new Date().toISOString(),
          usuario || 'Sistema',
          nextPaymentNum,
          chequeId || null
        );

        if (forma_pago === 'cheque_en_cartera' && chequeId) {
          db.prepare(`
            UPDATE cheques
            SET estado = 'entregado_proveedor',
                proveedor_id = ?,
                fecha_entrega = ?
            WHERE id = ?
          `).run(proveedorId || null, fecha || new Date().toISOString(), chequeId);
        }
      })();
    }

    const pool = getPostgresPool();
    return pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');

        const nextPaymentNum = await getAndIncrementSetting(client, 'next_payment_number');

        await client.query(
          `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            'egreso',
            'egreso_manual',
            descripcion,
            categoria,
            forma_pago,
            amount,
            fecha || new Date().toISOString(),
            usuario || 'Sistema',
            nextPaymentNum,
            chequeId,
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
            [proveedorId, fecha || new Date().toISOString(), chequeId]
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
