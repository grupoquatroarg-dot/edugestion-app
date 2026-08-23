import fs from 'node:fs';
import path from 'node:path';
import {
  ECONOMIC_HALF_PAGE_MAX_ITEMS,
  buildEconomicSalePrintDocument,
  getEconomicSalePrintLayout,
  planEconomicSalePrintPages,
} from '../src/utils/saleReceiptPrint.js';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const makeSale = (id: number, itemCount: number) => {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    cantidad: index % 3 + 1,
    product_name: `Producto de prueba ${index + 1} con descripción completa`,
    precio_unitario_original: 100 + index,
    bonificacion_tipo: index % 4 === 0 ? 'percentage' : 'none',
    bonificacion_valor: index % 4 === 0 ? 10 : 0,
    precio_unitario_bonificado: index % 4 === 0 ? (100 + index) * 0.9 : 100 + index,
    precio_venta: index % 4 === 0 ? (100 + index) * 0.9 : 100 + index,
  }));
  const total = items.reduce((sum, item) => sum + item.cantidad * item.precio_venta, 0);

  return {
    id,
    numero_venta: String(id),
    fecha: '2026-08-22T12:00:00-03:00',
    nombre_cliente: `Cliente ${id}`,
    cliente_direccion: 'Calle de prueba 1234',
    cliente_localidad: 'Carcarañá',
    cliente_telefono: '3410000000',
    metodo_pago: 'efectivo',
    monto_pagado: total,
    monto_pendiente: 0,
    total,
    items,
  };
};

const shortSale = makeSale(101, ECONOMIC_HALF_PAGE_MAX_ITEMS);
const secondShortSale = makeSale(102, 3);
const thirdShortSale = makeSale(103, 1);
const longSale = makeSale(201, ECONOMIC_HALF_PAGE_MAX_ITEMS + 1);
const veryLongSale = makeSale(202, 60);

assert(getEconomicSalePrintLayout(shortSale) === 'half', 'Una venta corta no ocupa media hoja.');
assert(getEconomicSalePrintLayout(longSale) === 'full', 'Una venta extensa no ocupa una hoja completa.');

const pairedPlan = planEconomicSalePrintPages([shortSale, secondShortSale]);
assert(pairedPlan.length === 1, 'Dos ventas cortas no se agrupan en una hoja.');
assert(pairedPlan[0].layout === 'half' && pairedPlan[0].sales.length === 2, 'La hoja no contiene dos comprobantes cortos.');

const threeShortPlan = planEconomicSalePrintPages([shortSale, secondShortSale, thirdShortSale]);
assert(threeShortPlan.length === 2, 'Tres ventas cortas deben ocupar dos hojas.');

const pairedDocument = buildEconomicSalePrintDocument([shortSale, secondShortSale], { business_name: 'EDUGESTIÓN' });
assert(pairedDocument.getNumberOfPages() === 1, 'Dos ventas cortas generaron más de una hoja A4.');

const longDocument = buildEconomicSalePrintDocument([longSale], { business_name: 'EDUGESTIÓN' });
assert(longDocument.getNumberOfPages() === 1, 'Una venta de más de ocho líneas generó más de una hoja A4.');

const veryLongDocument = buildEconomicSalePrintDocument([veryLongSale], { business_name: 'EDUGESTIÓN' });
assert(veryLongDocument.getNumberOfPages() === 1, 'Una venta de sesenta líneas no se adaptó a una hoja A4.');
assert(veryLongDocument.output('arraybuffer').byteLength > 2_000, 'El comprobante extenso quedó vacío o incompleto.');

const receiptGenerator = read('src/utils/pdfGenerator.ts');
const economicPrint = read('src/utils/saleReceiptPrint.ts');
const pdfOutput = read('src/utils/pdfOutput.ts');
const salesUi = read('src/components/SalesModule.tsx');
const customerDetail = read('src/components/CustomerDetail.tsx');
const packageJson = JSON.parse(read('package.json'));

assert(receiptGenerator.includes("orientation: 'landscape'"), 'El PDF amplio dejó de usar su diseño horizontal independiente.');
assert(receiptGenerator.includes('buildEconomicSalePrintDocument'), 'La impresión no usa el generador económico separado.');
assert(receiptGenerator.includes('printSaleReceipts'), 'Falta la impresión de varias ventas en un solo trabajo.');
assert(!economicPrint.toLowerCase().includes('flete'), 'La impresión económica expone el concepto interno de flete.');
assert(pdfOutput.includes("doc.autoPrint({ variant: 'non-conform' })"), 'La impresión no intenta abrir el selector de impresora.');
assert(pdfOutput.includes('openPrintWindowPlaceholder'), 'La preparación asíncrona puede ser bloqueada por el navegador.');

for (const token of [
  'selectedPrintSaleIds',
  'toggleAllFilteredSalesForPrint',
  'handlePrintSelectedSales',
  'Impresión económica por lote',
  'Seleccionar para imprimir',
  'Imprimir selección',
]) {
  assert(salesUi.includes(token), `El historial no contiene ${token}.`);
}

assert(salesUi.includes('openPrintWindowPlaceholder()'), 'Ventas no abre la impresión desde el gesto del usuario.');
assert(customerDetail.includes('openPrintWindowPlaceholder()'), 'La ficha del cliente no abre la impresión desde el gesto del usuario.');
assert(packageJson.scripts?.['check:sale-receipt-print-layout'] === 'tsx scripts/check-sale-receipt-print-layout.ts', 'Falta el comando de auditoría de impresión.');
assert(String(packageJson.scripts?.['validate:audit'] || '').includes('check:sale-receipt-print-layout'), 'La regresión general no incluye la impresión de ventas.');

console.log('Impresión de ventas correcta: PDF amplio independiente, dos ventas cortas por A4 y ventas extensas en una sola hoja.');
