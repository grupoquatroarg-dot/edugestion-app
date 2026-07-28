import fs from "node:fs";
import path from "node:path";
import { checklistLifecycleService } from "../server/services/checklistLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/22_checklist_lifecycle.sql");
const service = read("server/services/checklistLifecycleService.ts");
const api = read("api/clientes.ts");
const localRoutes = read("server/routes/checklistRoutes.ts");
const database = read("server/db.ts");
const ui = read("src/components/ChecklistModule.tsx");
const types = read("src/types.ts");
const packageJson = JSON.parse(read("package.json"));

assert(migration.includes("ADD COLUMN IF NOT EXISTS lifecycle_version"), "La migración no agrega lifecycle_version.");
assert(migration.includes("CREATE TABLE IF NOT EXISTS public.checklist_status_history"), "Falta el historial de estados de checklist.");
assert(migration.includes("'finalize', 'cancel', 'reopen'"), "El historial no limita las acciones permitidas.");
assert(migration.includes("idx_checklist_status_history_checklist"), "Falta el índice del historial de checklist.");
assert(migration.includes("WHERE lower(COALESCE(status, 'pendiente')) = 'pendiente'"), "Los checklists pendientes existentes no quedan habilitados de forma controlada.");

assert(service.includes("FOR UPDATE"), "El servicio no bloquea checklist y tareas durante el cambio de estado.");
assert(service.includes("JSON.stringify({ checklist, items"), "El servicio no conserva snapshot de checklist y tareas.");
assert(service.includes("Checklist histórico sin trazabilidad"), "No se bloquean checklists históricos sin trazabilidad.");
assert(service.includes("El checklist está cancelado. Debe reabrirse"), "No se bloquea finalizar un checklist cancelado.");
assert(service.includes("Un checklist finalizado debe conservarse como historial"), "No se protege la cancelación de un checklist finalizado.");
assert(service.includes("completed_at = NULL, completed_by = NULL"), "La reapertura no limpia correctamente el cierre anterior.");

assert(api.includes('endpoint === "checklist-status"'), "Vercel no expone el ciclo de vida de checklists.");
assert(api.includes('"checklist-status"'), "El router consolidado no incluye checklist-status.");
assert(api.includes("INSERT INTO checklists (template_id, date, notes, status, lifecycle_version)"), "Los checklists nuevos no se marcan con trazabilidad.");
assert(api.includes("FOR UPDATE OF ci, c"), "La edición de tareas no bloquea tarea y checklist.");
assert(api.includes("El checklist está cerrado. Reabrilo antes de modificar sus tareas."), "La API no bloquea tareas de checklists cerrados.");
assert(!api.includes("updateChecklistCompletionStatus"), "Completar una tarea todavía finaliza el checklist sin auditoría.");
assert(api.includes("El estado del checklist debe cambiarse desde Finalizar, Cancelar o Reabrir"), "La API aún permite cambiar el estado directamente.");

assert(localRoutes.includes("checklistLifecycleService"), "El servidor local no utiliza el servicio de ciclo de vida.");
assert(localRoutes.includes('/checklists/:id/lifecycle'), "El servidor local no expone el ciclo de vida de checklists.");
assert(localRoutes.includes("El checklist está cerrado. Reabrilo antes de modificar sus tareas."), "SQLite no bloquea tareas cerradas.");
assert(database.includes("CREATE TABLE IF NOT EXISTS checklist_status_history"), "SQLite no crea el historial de checklist.");
assert(database.includes("ALTER TABLE checklists ADD COLUMN lifecycle_version"), "SQLite no migra lifecycle_version.");

assert(ui.includes("Cancelar control"), "La interfaz no permite cancelar un checklist activo.");
assert(ui.includes("Reabrir checklist"), "La interfaz no ofrece reapertura auditada.");
assert(ui.includes("endpoint=checklist-status"), "La interfaz no usa el endpoint seguro.");
assert(!ui.includes("body: JSON.stringify({ status: 'completado' })"), "La interfaz todavía finaliza mediante PATCH directo.");
assert(types.includes("'pendiente' | 'completado' | 'cancelado'"), "El tipo Checklist no contempla cancelado.");
assert(packageJson.scripts?.["check:checklist-lifecycle"], "Falta el script permanente de auditoría.");
assert(packageJson.scripts?.["validate:audit"]?.includes("check:checklist-lifecycle"), "validate:audit no incluye la nueva auditoría.");

type FakeState = {
  checklist: any;
  items: any[];
  history: any[];
};

class FakeClient {
  state: FakeState;
  backup: FakeState | null = null;
  failNextUpdate = false;

  constructor(status = "pendiente", lifecycleVersion = 1) {
    this.state = {
      checklist: {
        id: 11,
        template_id: 4,
        status,
        notes: "Control diario",
        lifecycle_version: lifecycleVersion,
        completed_at: null,
        completed_by: null,
        cancelled_at: null,
        cancelled_by: null,
        cancel_reason: null,
        cancelled_from_status: null,
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
      },
      items: [
        { id: 101, checklist_id: 11, task_name: "Abrir caja", completed: 1 },
        { id: 102, checklist_id: 11, task_name: "Revisar stock", completed: 0 },
      ],
      history: [],
    };
  }

  cloneState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql === "BEGIN") {
      this.backup = this.cloneState();
      return { rows: [], rowCount: 0 };
    }
    if (sql === "COMMIT") {
      this.backup = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql === "ROLLBACK") {
      if (this.backup) this.state = this.backup;
      this.backup = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT * FROM checklists WHERE id = $1")) {
      return { rows: params[0] === this.state.checklist.id ? [this.cloneState().checklist] : [], rowCount: params[0] === this.state.checklist.id ? 1 : 0 };
    }
    if (sql.startsWith("SELECT * FROM checklist_items WHERE checklist_id = $1")) {
      const rows = this.cloneState().items.filter((item: any) => item.checklist_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("INSERT INTO checklist_status_history")) {
      const history = {
        id: this.state.history.length + 1,
        checklist_id: params[0],
        action: params[1],
        reason: params[2],
        performed_by: params[3],
        previous_status: params[4],
        new_status: params[5],
        snapshot: JSON.parse(params[6]),
        performed_at: "2026-07-27T12:00:00.000Z",
      };
      this.state.history.push(history);
      return { rows: [{ id: history.id, performed_at: history.performed_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE checklists")) {
      if (this.failNextUpdate) {
        this.failNextUpdate = false;
        throw new Error("Fallo simulado al actualizar checklist");
      }
      if (sql.includes("status = 'completado'")) {
        this.state.checklist = { ...this.state.checklist, status: "completado", completed_at: params[0], completed_by: params[1], cancelled_at: null, cancelled_by: null, cancel_reason: null };
      } else if (sql.includes("status = 'cancelado'")) {
        this.state.checklist = { ...this.state.checklist, status: "cancelado", cancelled_at: params[0], cancelled_by: params[1], cancel_reason: params[2], cancelled_from_status: params[3], completed_at: null, completed_by: null };
      } else if (sql.includes("status = 'pendiente'")) {
        this.state.checklist = { ...this.state.checklist, status: "pendiente", completed_at: null, completed_by: null, reopened_at: params[0], reopened_by: params[1], reopen_reason: params[2] };
      } else {
        throw new Error(`UPDATE no reconocido: ${sql}`);
      }
      return { rows: [this.cloneState().checklist], rowCount: 1 };
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const execute = async (client: FakeClient, input: any) => {
  await client.query("BEGIN");
  try {
    const result = await checklistLifecycleService.changeStatus(input, client as any);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const expectFailure = async (operation: () => Promise<any>, expected: RegExp) => {
  try {
    await operation();
  } catch (error: any) {
    assert(expected.test(String(error?.message || error)), `Error inesperado: ${error?.message || error}`);
    return;
  }
  throw new Error(`Se esperaba un error: ${expected}`);
};

const client = new FakeClient();
const originalItems = client.cloneState().items;
await execute(client, { checklistId: 11, action: "finalize", usuario: "Auditor", motivo: "Finalización manual" });
assert(client.state.checklist.status === "completado", "Finalizar no cambió el estado.");
assert(client.state.checklist.completed_by === "Auditor", "Finalizar no registró usuario.");
assert(client.state.history.length === 1 && client.state.history[0].action === "finalize", "Finalizar no generó historial.");
assert(client.state.history[0].snapshot.items.length === 2, "El snapshot no conserva tareas.");

await expectFailure(
  () => execute(client, { checklistId: 11, action: "cancel", usuario: "Auditor", motivo: "Cancelar finalizado" }),
  /finalizado debe conservarse/
);
assert(client.state.history.length === 1, "El rechazo de cancelación dejó historial parcial.");

await execute(client, { checklistId: 11, action: "reopen", usuario: "Supervisor", motivo: "Corregir una tarea" });
assert(client.state.checklist.status === "pendiente", "Reabrir no restauró estado pendiente.");
assert(JSON.stringify(client.state.items) === JSON.stringify(originalItems), "Reabrir modificó las tareas históricas.");

await execute(client, { checklistId: 11, action: "cancel", usuario: "Supervisor", motivo: "Control iniciado por error" });
assert(client.state.checklist.status === "cancelado", "Cancelar no cambió el estado.");
assert(client.state.checklist.cancel_reason === "Control iniciado por error", "Cancelar no guardó motivo.");
await expectFailure(
  () => execute(client, { checklistId: 11, action: "cancel", usuario: "Supervisor", motivo: "Segundo intento" }),
  /ya está cancelado/
);

await execute(client, { checklistId: 11, action: "reopen", usuario: "Supervisor", motivo: "Retomar el control" });
assert(client.state.checklist.status === "pendiente", "Reabrir un cancelado no funcionó.");

await expectFailure(
  () => execute(client, { checklistId: 11, action: "cancel", usuario: "Supervisor", motivo: "x" }),
  /al menos 3 caracteres/
);

const historical = new FakeClient("completado", 0);
await expectFailure(
  () => execute(historical, { checklistId: 11, action: "reopen", usuario: "Supervisor", motivo: "Reabrir histórico" }),
  /histórico sin trazabilidad/
);

const rollbackClient = new FakeClient();
rollbackClient.failNextUpdate = true;
await expectFailure(
  () => execute(rollbackClient, { checklistId: 11, action: "finalize", usuario: "Auditor", motivo: "Finalización manual" }),
  /Fallo simulado/
);
assert(rollbackClient.state.checklist.status === "pendiente", "El rollback dejó el checklist finalizado.");
assert(rollbackClient.state.history.length === 0, "El rollback dejó historial parcial.");

console.log("Ciclo de vida seguro de checklists correcto: cierre, cancelación, reapertura, bloqueos, snapshot y rollback verificados.");
