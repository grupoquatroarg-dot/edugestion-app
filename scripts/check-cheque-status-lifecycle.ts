import fs from 'node:fs';
import path from 'node:path';
import { chequeStatusService, type ChequeTransactionClient } from '../server/services/chequeStatusService.js';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const migration = read('supabase/15_cheque_status_lifecycle.sql');
for (const required of [
  'CREATE TABLE IF NOT EXISTS public.cheque_status_changes',
  'estado_actualizado_at',
  'estado_actualizado_por',
  'ultimo_cambio_estado_id',
  'cheques_estado_check',
  'cheque_status_changes_cheque_id_fkey',
  'cheque_status_changes_financial_movement_id_fkey',
  'cheque_status_changes_reversal_movement_id_fkey',
  'CHECK (length(trim(motivo)) >= 3)',
  'BEGIN;',
  'COMMIT;',
]) {
  assert(migration.includes(required), `Falta trazabilidad SQL de cheques: ${required}`);
}

const service = read('server/services/chequeStatusService.ts');
for (const required of [
  'en_cartera: ["depositado"]',
  'depositado: ["cobrado", "rechazado"]',
  'FOR UPDATE',
  'cheque_rechazado',
  'anulacion_cheque_rechazado',
  'ultimo_cambio_estado_id',
  'revertido_at IS NULL',
  'ROLLBACK',
  'El estado actual no posee una transición auditada',
]) {
  assert(service.includes(required), `Falta protección en el servicio de cheques: ${required}`);
}

const repository = read('server/repositories/financeRepository.ts');
assert(repository.includes('LEFT JOIN cheque_status_changes csc'), 'La cartera no expone el último cambio auditado.');
assert(repository.includes('puede_revertir_estado'), 'La cartera no informa si el último estado puede revertirse.');
assert(!repository.includes('updateChequeStatus('), 'Todavía existe el cambio libre de estado en el repositorio.');

const api = read('api/finanzas.ts');
for (const required of [
  'endpoint === "cheques-historial"',
  'endpoint === "cheques-estado"',
  'endpoint === "cheques-estado-revertir"',
  'chequeStatusService.changeStatus',
  'chequeStatusService.revertLastStatus',
  'requireCurrentAccountsPermission(req, res, "edit")',
]) {
  assert(api.includes(required), `Falta integración Vercel de cheques: ${required}`);
}

const routes = read('server/routes/financeRoutes.ts');
for (const required of [
  "'/cheques/:id/historial'",
  "'/cheques/:id/estado'",
  "'/cheques/:id/estado/revertir'",
  "z.enum(['depositado', 'cobrado', 'rechazado'])",
  "requirePermission('current_accounts', 'edit')",
]) {
  assert(routes.includes(required), `Falta integración Express de cheques: ${required}`);
}

const ui = read('src/components/FinanceModule.tsx');
for (const required of [
  'cheques-historial',
  'cheques-estado-revertir',
  'Motivo obligatorio',
  'Revertir último cambio',
  'Historial auditado',
  'Marcar {chequeStatusLabel(nextState)}',
]) {
  assert(ui.includes(required), `Falta interfaz segura de cheques: ${required}`);
}
assert(!ui.includes('endpoint=cheques/${id}/estado'), 'La interfaz conserva el endpoint Vercel incorrecto.');

for (const file of ['src/components/FinanceModule.tsx', 'server/routes/reportRoutes.ts', 'api/dashboard/[endpoint].ts']) {
  assert(read(file).includes('anulacion_cheque_rechazado'), `Las métricas no excluyen la reversión de rechazo en ${file}.`);
}

const dbSource = read('server/db.ts');
assert(dbSource.includes('CREATE TABLE IF NOT EXISTS cheque_status_changes'), 'SQLite no conserva la tabla de historial de cheques.');

let nextChangeId = 1;
let nextMovementId = 100;
const state = {
  cheque: {
    id: 10,
    numero_cheque: 'CH-10',
    banco: 'Banco Prueba',
    importe: 1250,
    estado: 'en_cartera',
    ultimo_cambio_estado_id: null as number | null,
  },
  changes: [] as any[],
  movements: [] as any[],
  settings: { next_payment_number: '1' } as Record<string, string>,
  commits: 0,
  rollbacks: 0,
};

const client: ChequeTransactionClient = {
  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql === 'BEGIN') return { rows: [], rowCount: null };
    if (sql === 'COMMIT') { state.commits += 1; return { rows: [], rowCount: null }; }
    if (sql === 'ROLLBACK') { state.rollbacks += 1; return { rows: [], rowCount: null }; }

    if (sql.startsWith('SELECT * FROM cheques')) {
      return params[0] === state.cheque.id
        ? { rows: [{ ...state.cheque }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('INSERT INTO settings')) {
      state.settings[String(params[0])] ??= String(params[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT value FROM settings')) {
      return { rows: [{ value: state.settings[String(params[0])] }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE settings SET value')) {
      state.settings[String(params[0])] = String(params[1]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO movimientos_financieros')) {
      const id = nextMovementId++;
      const origin = String(params[1]);
      const movement = origin === 'cheque_rechazado'
        ? {
            id, tipo: params[0], origen: origin, descripcion: params[2], categoria: params[3],
            forma_pago: params[4], monto: params[5], fecha: params[6], usuario: params[7],
            numero_pago: params[8], cheque_id: params[9], estado: params[10], reversion_version: params[11],
          }
        : {
            id, tipo: params[0], origen: origin, descripcion: params[2], categoria: params[3],
            forma_pago: params[4], monto: params[5], fecha: params[6], usuario: params[7],
            numero_pago: params[8], cheque_id: params[9], reversed_movement_id: params[10],
            estado: params[11], reversion_version: params[12],
          };
      state.movements.push(movement);
      return { rows: [{ id }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO cheque_status_changes')) {
      const id = nextChangeId++;
      const change = {
        id,
        cheque_id: params[0],
        estado_anterior: params[1],
        estado_nuevo: params[2],
        motivo: params[3],
        cambiado_por: params[4],
        origen: params[5],
        financial_movement_id: params[6],
        cambiado_at: `2026-07-16T12:00:0${id}Z`,
        revertido_at: null,
      };
      state.changes.push(change);
      return { rows: [{ id, cambiado_at: change.cambiado_at }], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE cheques SET estado')) {
      state.cheque.estado = String(params[0]);
      state.cheque.ultimo_cambio_estado_id = params[3] ?? null;
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM cheque_status_changes')) {
      const change = state.changes.find((item) => item.cheque_id === params[0] && item.id === params[1] && !item.revertido_at);
      return change ? { rows: [{ ...change }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM movimientos_financieros')) {
      const movement = state.movements.find((item) => item.id === params[0]);
      return movement ? { rows: [{ ...movement }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('UPDATE movimientos_financieros SET estado')) {
      const movement = state.movements.find((item) => item.id === params[3]);
      if (movement) Object.assign(movement, { estado: 'Anulado', anulada_at: params[0], anulada_por: params[1], anulacion_motivo: params[2] });
      return { rows: [], rowCount: movement ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE cheque_status_changes SET revertido_at')) {
      const change = state.changes.find((item) => item.id === params[4]);
      if (change) Object.assign(change, { revertido_at: params[0], revertido_por: params[1], reversion_motivo: params[2], reversal_movement_id: params[3] });
      return { rows: [], rowCount: change ? 1 : 0 };
    }

    if (sql.startsWith('SELECT id FROM cheque_status_changes')) {
      const currentId = params[1];
      const change = [...state.changes]
        .filter((item) => item.cheque_id === params[0] && item.id !== currentId && !item.revertido_at)
        .sort((a, b) => b.id - a.id)[0];
      return change ? { rows: [{ id: change.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  },
};

await chequeStatusService.changeStatus({ chequeId: 10, estado: 'depositado', motivo: 'Depositado para cobro', usuario: 'Admin' }, client);
assert(state.cheque.estado === 'depositado', 'No cambió de en cartera a depositado.');
assert(state.changes.length === 1, 'No registró el primer cambio auditado.');

await chequeStatusService.changeStatus({ chequeId: 10, estado: 'cobrado', motivo: 'Acreditado por el banco', usuario: 'Admin' }, client);
assert(state.cheque.estado === 'cobrado', 'No cambió de depositado a cobrado.');

await chequeStatusService.revertLastStatus({ chequeId: 10, motivo: 'Acreditación informada por error', usuario: 'Admin' }, client);
assert(state.cheque.estado === 'depositado', 'No restauró cobrado a depositado.');

await chequeStatusService.changeStatus({ chequeId: 10, estado: 'rechazado', motivo: 'Rechazado por falta de fondos', usuario: 'Admin' }, client);
assert(state.cheque.estado === 'rechazado', 'No cambió de depositado a rechazado.');
const rejection = state.movements.find((item) => item.origen === 'cheque_rechazado');
assert(rejection?.estado === 'Activo', 'El rechazo no creó el egreso trazable.');

await chequeStatusService.revertLastStatus({ chequeId: 10, motivo: 'El banco corrigió el rechazo', usuario: 'Admin' }, client);
assert(state.cheque.estado === 'depositado', 'No restauró rechazado a depositado.');
assert(rejection.estado === 'Anulado', 'No anuló el egreso del rechazo.');
assert(state.movements.some((item) => item.origen === 'anulacion_cheque_rechazado'), 'No creó el contramovimiento del rechazo.');

let invalidBlocked = false;
try {
  state.cheque.estado = 'en_cartera';
  state.cheque.ultimo_cambio_estado_id = null;
  await chequeStatusService.changeStatus({ chequeId: 10, estado: 'cobrado', motivo: 'Salto inválido', usuario: 'Admin' }, client);
} catch (error: any) {
  invalidBlocked = String(error?.message || '').includes('Transición no permitida');
}
assert(invalidBlocked, 'No bloqueó el salto directo de en cartera a cobrado.');

console.log('Ciclo seguro de cheques correcto: transiciones, motivo, historial, rechazo, reversión, métricas y rollback verificados.');
