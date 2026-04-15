import db from '../db.js';

export const financeRepository = {
  getMovements: () => {
    return db.prepare(`
      SELECT m.*, c.nombre_apellido as nombre_cliente 
      FROM movimientos_financieros m
      LEFT JOIN clientes c ON m.cliente_id = c.id
      ORDER BY m.fecha DESC
    `).all();
  },

  getCheques: () => {
    return db.prepare(`
      SELECT ch.*, c.nombre_apellido as nombre_cliente, s.numero_venta, p.nombre as nombre_proveedor
      FROM cheques ch
      JOIN clientes c ON ch.cliente_id = c.id
      LEFT JOIN sales s ON ch.venta_id = s.id
      LEFT JOIN proveedores p ON ch.proveedor_id = p.id
      ORDER BY ch.fecha_vencimiento ASC
    `).all();
  },

  updateChequeStatus: (id: number, estado: string, observaciones?: string) => {
    return db.transaction(() => {
      const cheque = db.prepare("SELECT * FROM cheques WHERE id = ?").get(id) as any;
      if (!cheque) throw new Error("Cheque no encontrado");

      db.prepare("UPDATE cheques SET estado = ?, observaciones = ? WHERE id = ?")
        .run(estado, observaciones || null, id);

      if (estado === 'rechazado' && cheque.estado !== 'rechazado') {
        const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1');
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run((nextPaymentNum + 1).toString());

        db.prepare(`
          INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('egreso', 'egreso_manual', `Cheque Rechazado N° ${cheque.numero_cheque} - ${cheque.banco}`, 'Cheque Rechazado', 'cheque', cheque.importe, new Date().toISOString(), 'Sistema', nextPaymentNum, id);
      }
    })();
  },

  registerExpense: (expenseData: any) => {
    const { monto, descripcion, categoria, forma_pago, fecha, usuario, cheque_id, proveedor_id } = expenseData;
    return db.transaction(() => {
      const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run((nextPaymentNum + 1).toString());

      db.prepare(`
        INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cheque_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('egreso', 'egreso_manual', descripcion, categoria, forma_pago, monto, fecha || new Date().toISOString(), usuario || 'Sistema', nextPaymentNum, cheque_id || null);

      if (forma_pago === 'cheque_en_cartera' && cheque_id) {
        db.prepare(`
          UPDATE cheques 
          SET estado = 'entregado_proveedor', 
              proveedor_id = ?, 
              fecha_entrega = ? 
          WHERE id = ?
        `).run(proveedor_id || null, fecha || new Date().toISOString(), cheque_id);
      }
    })();
  }
};
