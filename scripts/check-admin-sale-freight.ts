import fs from 'node:fs';
import path from 'node:path';
import {
  calculateSalePricesWithFreight,
  normalizeSaleFreightPercentage,
} from '../server/utils/saleFreightPricing.js';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const ui = read('src/components/SalesModule.tsx');
const service = read('server/services/salesService.ts');
const vercel = read('api/sales.ts');
const express = read('server/routes/salesRoutes.ts');
const repository = read('server/repositories/salesRepository.ts');
const database = read('server/db.ts');
const customerApi = read('api/clientes.ts');
const receipt = read('src/utils/pdfGenerator.ts');
const packageJson = JSON.parse(read('package.json'));

for (const token of [
  "const { user, hasPermission } = useAuth()",
  "user?.role === 'administrador'",
  'freightEnabled',
  'freightPercentage',
  'activeFreightPercentage',
  'calculateClientUnitPrice',
  'Flete interno',
  'sale-freight-percentage',
  'flete_porcentaje: activeFreightPercentage',
]) {
  assert(ui.includes(token), `La interfaz de venta no contiene ${token}.`);
}
assert(ui.includes('{isAdmin && ('), 'El control de flete no está limitado visualmente al administrador.');
assert(ui.includes('calculateClientUnitPrice(item) * item.quantity'), 'El total no usa el precio final con flete.');
assert(ui.includes("setFreightEnabled(false)"), 'El flete no se limpia después de registrar la venta.');

for (const source of [vercel, express]) {
  assert(source.includes('flete_porcentaje: z.number().min(0).max(100).optional()'), 'Un endpoint no valida el porcentaje de flete.');
  assert(source.includes('actor_role:'), 'Un endpoint no entrega el rol autenticado al servicio.');
}

for (const token of [
  'normalizeSaleFreightPercentage',
  'calculateSalePricesWithFreight',
]) {
  assert(service.includes(token), `El backend no contiene ${token}.`);
}

assert(!repository.includes('flete_porcentaje'), 'El concepto flete se persistió en ventas y podría exponerse.');
assert(!database.includes('flete_porcentaje'), 'El concepto flete se agregó al esquema local.');
assert(!customerApi.includes('flete_porcentaje'), 'El portal o la ficha del cliente exponen el concepto flete.');
assert(!receipt.toLowerCase().includes('flete'), 'El comprobante del cliente menciona el flete.');
assert(packageJson.scripts?.['check:admin-sale-freight'] === 'tsx scripts/check-admin-sale-freight.ts', 'Falta el comando de auditoría del flete.');
assert(String(packageJson.scripts?.['validate:audit'] || '').includes('check:admin-sale-freight'), 'La regresión general no incluye el flete.');

const example = calculateSalePricesWithFreight({ originalPrice: 10, discountType: 'none', discountValue: 0, freightPercentage: 10 });
assert(example.originalPrice === 11 && example.discountedPrice === 11, 'El ejemplo $10 + 10% de flete no termina en $11.');

const discounted = calculateSalePricesWithFreight({ originalPrice: 100, discountType: 'percentage', discountValue: 10, freightPercentage: 20 });
assert(discounted.originalPrice === 120 && discounted.discountedPrice === 108, 'No se aplica primero la bonificación y luego el flete.');

const fixed = calculateSalePricesWithFreight({ originalPrice: 100, discountType: 'fixed', discountValue: 10, freightPercentage: 20 });
assert(fixed.discountedPrice === 108 && fixed.discountValue === 12, 'La bonificación fija visible no coincide con el precio final.');

assert(normalizeSaleFreightPercentage(10, 'administrador') === 10, 'El administrador no pudo configurar el flete.');
let unauthorizedBlocked = false;
try {
  normalizeSaleFreightPercentage(10, 'vendedor');
} catch (error: any) {
  unauthorizedBlocked = error?.statusCode === 403;
}
assert(unauthorizedBlocked, 'El backend permitió flete a un usuario no administrador.');
assert(normalizeSaleFreightPercentage(undefined, 'vendedor') === 0, 'Una venta sin flete cambió de precio.');

console.log('Flete de venta correcto: exclusivo del administrador, aplicado por producto y oculto al cliente.');
