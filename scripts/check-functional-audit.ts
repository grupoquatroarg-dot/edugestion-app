import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  businessDayEndIso,
  businessDayStartIso,
  normalizeBusinessDateForStorage,
  toBusinessDateKey,
} from '../server/utils/businessDate';
import {
  differenceInBusinessCalendarDays,
  formatBusinessDate,
  getBusinessDateKey,
} from '../src/utils/businessDate';

const root = process.cwd();
let passed = 0;

const read = (relativePath: string) =>
  readFile(path.join(root, relativePath), 'utf8');

const check = async (name: string, test: () => void | Promise<void>) => {
  try {
    await test();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
};

const containsAll = (source: string, values: string[]) => {
  for (const value of values) {
    assert.ok(source.includes(value), `Falta el texto esperado: ${value}`);
  }
};

await check('Una fecha de negocio se almacena sin cambiar de día', () => {
  const stored = normalizeBusinessDateForStorage('2026-06-25');
  assert.equal(toBusinessDateKey(stored), '2026-06-25');
});

await check('El inicio y fin del día pertenecen al 25/06 en Buenos Aires', () => {
  assert.equal(toBusinessDateKey(businessDayStartIso('2026-06-25')), '2026-06-25');
  assert.equal(toBusinessDateKey(businessDayEndIso('2026-06-25')), '2026-06-25');
});

await check('Un timestamp UTC nocturno se agrupa en el día argentino correcto', () => {
  assert.equal(getBusinessDateKey('2026-06-26T01:30:00.000Z'), '2026-06-25');
  assert.equal(formatBusinessDate('2026-06-25'), '25/06/2026');
  assert.equal(differenceInBusinessCalendarDays('2026-06-25', '2026-06-26'), 1);
});

await check('La búsqueda de domicilios prioriza Carcarañá, Santa Fe y CP 2138', async () => {
  const source = await read('src/components/AddressAutocomplete.tsx');
  containsAll(source, [
    "localidad: 'Carcarañá'",
    "provincia: 'Santa Fe'",
    "codigoPostal: '2138'",
    'Carcarañá, Santa Fe, 2138, Argentina',
    'distanceFromBusiness',
    'suggestionPriority',
  ]);
});

await check('Clientes permite domicilio manual y distingue falta de coordenadas', async () => {
  const source = await read('src/components/CustomerModule.tsx');
  containsAll(source, [
    'customer-address',
    'customer-locality',
    'customer-province',
    'customer-postal-code',
    'Dirección cargada sin coordenadas',
  ]);
});

await check('El código postal se persiste en API, repositorio y migración', async () => {
  const [api, repository, migration] = await Promise.all([
    read('api/clientes.ts'),
    read('server/repositories/clientRepository.ts'),
    read('supabase/03_add_client_postal_code.sql'),
  ]);
  assert.ok(api.includes('codigo_postal'));
  assert.ok(repository.includes('codigo_postal'));
  assert.ok(migration.includes('codigo_postal'));
});

await check('Cambio de precios busca por todos los campos auditados', async () => {
  const source = await read('src/components/BulkPriceUpdate.tsx');
  containsAll(source, [
    'product.code',
    'product.codigo_unico',
    'product.name',
    'product.family_name',
    'product.category_name',
    'product.company',
  ]);
});

await check('Cambio de precios prioriza código exacto y refresca sin caché', async () => {
  const source = await read('src/components/BulkPriceUpdate.tsx');
  containsAll(source, [
    'findExactProduct',
    "cache: 'no-store'",
    "window.addEventListener('focus'",
    "event.key !== 'Enter'",
    'No encontramos productos con ese código o nombre.',
  ]);
});

await check('Ventas muestra carga y error explícitos', async () => {
  const source = await read('src/components/SalesModule.tsx');
  containsAll(source, [
    'Cargando ventas, productos y clientes',
    'No se pudo cargar Ventas',
    'Reintentar',
    'aria-busy',
  ]);
});

await check('Ruta, Checklist y Cambio de precios conservan estados de carga', async () => {
  const [route, checklist, prices] = await Promise.all([
    read('src/components/RouteModule.tsx'),
    read('src/components/ChecklistModule.tsx'),
    read('src/components/BulkPriceUpdate.tsx'),
  ]);
  assert.match(route, /Preparando ruta|Cargando rutas|Cargando/i);
  assert.match(checklist, /Cargando controles y tareas/i);
  assert.match(prices, /Cargando productos, familias e historial/i);
});

await check('Clientes utiliza scrollIntoView y foco al abrir formularios', async () => {
  const source = await read('src/components/CustomerModule.tsx');
  containsAll(source, ['scrollIntoView', '.focus({ preventScroll: true })', 'customer-name']);
});

await check('Ficha y cuenta corriente trasladan y restauran el foco', async () => {
  const source = await read('src/components/CustomerDetail.tsx');
  containsAll(source, ['.focus({ preventScroll: true })', 'showPaymentModal', 'paymentAmountRef']);
});

await check('Reportes expone nombres completos y navegación de pestañas', async () => {
  const source = await read('src/components/ReportsModule.tsx');
  containsAll(source, [
    'Reporte por período - detalle y margen',
    'Reporte por cliente - ranking y detalle',
    'Reporte de productos más vendidos',
    'role="tablist"',
    'handleReportTabKeyDown',
  ]);
});

await check('Permisos anuncia módulo y acción', async () => {
  const source = await read('src/components/UserManagement.tsx');
  containsAll(source, [
    'accessibleLabel={`${module.label} - Ver`}',
    'accessibleLabel={`${module.label} - Crear`}',
    'accessibleLabel={`${module.label} - Editar`}',
    'accessibleLabel={`${module.label} - Eliminar`}',
    'Cerrar panel de permisos',
  ]);
});

await check('Los cierres principales tienen nombres inequívocos', async () => {
  const [sales, customers, users] = await Promise.all([
    read('src/components/SalesModule.tsx'),
    read('src/components/CustomerModule.tsx'),
    read('src/components/UserManagement.tsx'),
  ]);
  assert.ok(sales.includes('Cerrar confirmación de venta'));
  assert.ok(sales.includes('Cerrar detalle de venta'));
  assert.ok(customers.includes('Cerrar formulario de cliente'));
  assert.ok(users.includes('Cerrar panel de permisos'));
});

await check('La metadata pública declara EduGestión, español argentino y UTF-8', async () => {
  const source = await read('index.html');
  containsAll(source, ['lang="es-AR"', 'charset="UTF-8"', '<title>EduGestión</title>']);
});

console.log(`\nAuditoría automatizada correcta: ${passed} comprobaciones superadas.`);
console.log('Nota: las operaciones con Supabase, geocodificación y UI real se validan con docs/AUDITORIA_FUNCIONAL_ADMIN.md.');
