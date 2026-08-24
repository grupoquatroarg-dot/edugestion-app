import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  formatProductQuantity,
  getProductCostUnitPrice,
  getProductSaleUnitPrice,
  isValidProductQuantity,
  parseLocalizedDecimal,
} from '../shared/productMeasurement.js';
import { calculateSalePricesWithFreight } from '../server/utils/saleFreightPricing.js';

const weightedProduct = {
  quantity_mode: 'measure',
  measurement_unit: 'kg',
  price_reference_quantity: 3.4,
  sale_price: 6765,
  cost: 5100,
} as const;

assert.equal(parseLocalizedDecimal('0,8'), 0.8, 'La coma decimal debe aceptarse.');
assert.equal(parseLocalizedDecimal('1.5'), 1.5, 'El punto decimal debe aceptarse.');
assert.equal(parseLocalizedDecimal('0,125'), 0.125, 'Deben conservarse cantidades de balanza pequeñas.');

const unitPrice = getProductSaleUnitPrice(weightedProduct);
assert.equal(unitPrice, 1989.705882, 'El precio por kg debe salir del precio de presentación dividido por 3,4.');
assert.equal(Math.round(unitPrice * 0.8 * 100) / 100, 1591.76, '0,8 kg debe calcularse proporcionalmente.');
assert.equal(Math.round(unitPrice * 1.5 * 100) / 100, 2984.56, '1,5 kg debe calcularse proporcionalmente.');
assert.equal(getProductCostUnitPrice(weightedProduct), 1500, 'El costo de presentación también debe normalizarse para PEPS.');
assert.equal(formatProductQuantity(weightedProduct, 0.8), '0,8 kg', 'La unidad debe viajar al comprobante.');

const unitProduct = {
  quantity_mode: 'unit',
  measurement_unit: 'unidad',
  price_reference_quantity: 1,
  sale_price: 10,
};
assert.equal(isValidProductQuantity(unitProduct, 1), true);
assert.equal(isValidProductQuantity(unitProduct, 1.5), false, 'Los productos normales deben seguir exigiendo enteros.');
assert.equal(isValidProductQuantity(weightedProduct, 0.001), true);

const freightPrice = calculateSalePricesWithFreight({
  originalPrice: unitPrice,
  discountType: 'none',
  discountValue: 0,
  freightPercentage: 10,
  precision: 6,
});
assert.equal(freightPrice.originalPrice, 2188.67647, 'El flete debe respetar la precisión del precio medido.');

const [migration, salesService, salesUi, productUi, saleRepository, pdf, printPdf] = await Promise.all([
  readFile('supabase/47_weighted_product_sales.sql', 'utf8'),
  readFile('server/services/salesService.ts', 'utf8'),
  readFile('src/components/SalesModule.tsx', 'utf8'),
  readFile('src/components/ProductModule.tsx', 'utf8'),
  readFile('server/repositories/salesRepository.ts', 'utf8'),
  readFile('src/utils/pdfGenerator.ts', 'utf8'),
  readFile('src/utils/saleReceiptPrint.ts', 'utf8'),
]);

for (const token of [
  'price_reference_quantity',
  'measurement_unit',
  'ALTER COLUMN cantidad TYPE numeric',
  'ALTER COLUMN stock TYPE numeric',
  'ALTER COLUMN cantidad_restante TYPE numeric',
]) {
  assert.ok(migration.includes(token), `La migración 47 no contiene ${token}.`);
}

assert.ok(salesService.includes('getProductSaleUnitPrice(product)'), 'El servidor no recalcula el precio desde el producto.');
assert.ok(salesService.includes('isValidProductQuantity(product, cantidad)'), 'El servidor no protege cantidades unitarias/medidas.');
assert.ok(salesUi.includes('quantityInput'), 'El carrito no conserva la coma mientras el usuario escribe.');
assert.ok(salesUi.includes('inputMode="decimal"'), 'El carrito no solicita teclado decimal.');
assert.ok(productUi.includes('Fraccionable / balanza'), 'No existe configuración visible de producto fraccionable.');
assert.ok(productUi.includes('Cantidad incluida en el precio informado'), 'Falta la referencia del precio de presentación.');
assert.ok(saleRepository.includes('measurement_unit, price_reference_quantity'), 'La venta no guarda la unidad histórica.');
assert.ok(pdf.includes('formatMeasurementQuantity'), 'El PDF amplio no muestra la cantidad medida.');
assert.ok(printPdf.includes('formatMeasurementQuantity'), 'La impresión económica no muestra la cantidad medida.');

console.log('Weighted product sales regression checks passed.');
