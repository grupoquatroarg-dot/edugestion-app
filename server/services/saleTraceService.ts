type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type SaleStockAllocationInput = {
  product_id: number;
  cantidad: number;
  costo_unitario: number;
  source_type: 'purchase_invoice_item' | 'product_cost' | 'supplier_delivery';
  purchase_invoice_item_id?: number | null;
  stock_movement_id?: number | null;
};

export type SalePaymentAllocationInput = {
  sale_id: number;
  monto: number;
  allocation_type: 'initial_payment' | 'client_payment' | 'customer_order_payment';
};

export const saleTraceService = {
  async recordStockAllocations(
    client: TransactionClient,
    saleId: number,
    allocations: SaleStockAllocationInput[]
  ) {
    for (const allocation of allocations) {
      if (allocation.cantidad <= 0) continue;

      await client.query(
        `INSERT INTO sale_stock_allocations (
           sale_id,
           product_id,
           purchase_invoice_item_id,
           stock_movement_id,
           source_type,
           cantidad,
           costo_unitario
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          saleId,
          allocation.product_id,
          allocation.purchase_invoice_item_id || null,
          allocation.stock_movement_id || null,
          allocation.source_type,
          allocation.cantidad,
          allocation.costo_unitario,
        ]
      );
    }
  },

  async recordPaymentAllocations(
    client: TransactionClient,
    movementId: number,
    allocations: SalePaymentAllocationInput[]
  ) {
    for (const allocation of allocations) {
      if (allocation.monto <= 0) continue;

      await client.query(
        `INSERT INTO sale_payment_allocations (
           sale_id,
           movimiento_financiero_id,
           monto,
           allocation_type,
           estado
         )
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sale_id, movimiento_financiero_id)
         DO UPDATE SET
           monto = EXCLUDED.monto,
           allocation_type = EXCLUDED.allocation_type`,
        [
          allocation.sale_id,
          movementId,
          allocation.monto,
          allocation.allocation_type,
          'Activo',
        ]
      );
    }
  },
};
