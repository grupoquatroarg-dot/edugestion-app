import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { applyProductInventoryPostgres } from '../server/services/vercel/productInventoryApiHelpers.js';

const root = process.cwd();
const assert = (condition: any, message: string) => {
  if (!condition) throw new Error(message);
};

for (const route of ['stock', 'expire', 'min-stock']) {
  const routePath = path.join(root, 'api', 'products', '[id]', `${route}.ts`);
  assert(fs.existsSync(routePath), `Falta la función Vercel ${routePath}.`);
  const source = fs.readFileSync(routePath, 'utf8');
  assert(source.includes(`"${route}"`), `La función ${route} no delega la acción correcta.`);
}

const helperPath = path.join(root, 'server/services/vercel/productInventoryApiHelpers.ts');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const sourceFile = ts.createSourceFile(helperPath, helperSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let sqlQueriesChecked = 0;

const getSqlText = (node: ts.Expression) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};

const visit = (node: ts.Node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'query' &&
    node.arguments.length >= 2
  ) {
    const sql = getSqlText(node.arguments[0]);
    const params = node.arguments[1];
    if (sql && ts.isArrayLiteralExpression(params)) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      const maximum = placeholders.length ? Math.max(...placeholders) : 0;
      if (maximum) {
        sqlQueriesChecked += 1;
        assert(maximum === params.elements.length, `Parámetros SQL incorrectos: ${maximum}/${params.elements.length}.`);
      }
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert(sqlQueriesChecked >= 5, 'No se auditaron suficientes consultas de inventario.');

const state = {
  stock: 5,
  stockMinimo: 1,
  movements: [] as any[],
};

const client = {
  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT id, stock FROM products')) {
      return { rows: [{ id: params[0], stock: state.stock }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE products SET stock = COALESCE')) {
      state.stock += Number(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE products SET stock_minimo')) {
      state.stockMinimo = Number(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE products SET stock = stock -')) {
      state.stock -= Number(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO stock_movimientos')) {
      state.movements.push({ params });
      return { rows: [{ id: state.movements.length }], rowCount: 1 };
    }
    throw new Error(`Consulta no contemplada por la prueba: ${sql}`);
  },
};

await applyProductInventoryPostgres(client, 'stock', 100, { cantidad: 4, costo_unitario: 12, notes: 'Prueba' }, 'Tester');
assert(state.stock === 9, 'La carga no incrementó el stock.');
assert(state.movements.length === 1 && state.movements[0].params[6] === 'carga_stock', 'La carga no registró el movimiento correcto.');

await applyProductInventoryPostgres(client, 'min-stock', 100, { stock_minimo: 3 }, 'Tester');
assert(state.stockMinimo === 3, 'No se actualizó el stock mínimo.');

await applyProductInventoryPostgres(client, 'expire', 100, { cantidad: 2, notes: 'Merma' }, 'Tester');
assert(state.stock === 7, 'La merma no descontó el stock.');
assert(state.movements.length === 2 && state.movements[1].params[5] === 'merma', 'La merma no registró el movimiento correcto.');

let insufficientStockBlocked = false;
try {
  await applyProductInventoryPostgres(client, 'expire', 100, { cantidad: 99 }, 'Tester');
} catch (error: any) {
  insufficientStockBlocked = error?.statusCode === 400;
}
assert(insufficientStockBlocked, 'La merma permitió descontar más stock del disponible.');

const localStorageMock = {
  getItem() { return null; },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, 'fetch', {
  value: async () => new Response('The page could not be found\n\nNOT_FOUND', { status: 404, headers: { 'content-type': 'text/plain' } }),
  configurable: true,
});
const { apiFetch } = await import('../src/utils/api.js');
let friendlyError = '';
try {
  await apiFetch('/api/products/100/stock', { method: 'POST' });
} catch (error: any) {
  friendlyError = String(error?.message || '');
}
assert(friendlyError.includes('no está disponible'), 'apiFetch no convierte un NOT_FOUND de Vercel en un error comprensible.');

console.log(`Inventario correcto: tres rutas, ${sqlQueriesChecked} consultas SQL, carga, mínimo, merma, límite y error Vercel verificados.`);
