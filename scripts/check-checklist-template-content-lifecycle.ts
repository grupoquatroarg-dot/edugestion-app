import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checklistTemplateContentLifecycleService } from "../server/services/checklistTemplateContentLifecycleService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/34_checklist_template_content_lifecycle.sql");
const service = read("server/services/checklistTemplateContentLifecycleService.ts");
const api = read("api/clientes.ts");
const localRoute = read("server/routes/checklistRoutes.ts");
const database = read("server/db.ts");
const ui = read("src/components/ChecklistModule.tsx");
const types = read("src/types.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "content_version",
  "content_changed_at",
  "content_changed_by",
  "content_change_reason",
  "checklist_template_content_history",
  "template_before_snapshot",
  "items_before_snapshot",
  "template_after_snapshot",
  "items_after_snapshot",
  "idx_checklist_template_content_history_template",
]) {
  assert(migration.includes(token), `La migración 34 no contiene ${token}.`);
  assert(database.includes(token), `SQLite no contiene ${token}.`);
}

for (const token of [
  "expectedContentVersion",
  "FOR UPDATE",
  "No se detectaron cambios para guardar",
  "DELETE FROM checklist_template_items",
  "INSERT INTO checklist_template_content_history",
  "ROLLBACK",
]) {
  assert(service.includes(token), `El servicio no contiene ${token}.`);
}

assert(api.includes("checklistTemplateContentLifecycleService.update"), "Vercel no usa el servicio auditado.");
assert(api.includes("checklistTemplateContentSchema"), "Vercel no valida motivo y versión.");
assert(api.includes("content_change_reason"), "Vercel no devuelve la trazabilidad de contenido.");
assert(localRoute.includes("checklistTemplateContentLifecycleService.update"), "Express no usa el servicio auditado.");
assert(!localRoute.includes('db.prepare("DELETE FROM checklist_template_items WHERE template_id = ?").run(id)'), "Express conserva el bypass directo anterior.");
assert(ui.includes("templateEditReason"), "La interfaz no solicita motivo.");
assert(ui.includes("editingTemplateContentVersion"), "La interfaz no conserva la versión.");
assert(ui.includes("expectedContentVersion"), "La interfaz no envía la versión esperada.");
assert(types.includes("content_version?: number"), "El tipo de plantilla no expone la versión.");
assert(packageJson.scripts["check:checklist-template-content-lifecycle"], "Falta el script permanente de auditoría.");
assert(
  packageJson.scripts["validate:audit"].includes("check:checklist-template-content-lifecycle"),
  "La auditoría nueva no forma parte de validate:audit."
);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type State = {
  template: any;
  items: any[];
  history: any[];
  snapshot?: any;
};

const createState = (): State => ({
  template: {
    id: 41,
    name: "Apertura diaria",
    description: "Control de apertura",
    type: "Apertura",
    active: 1,
    content_version: 0,
    content_changed_at: null,
    content_changed_by: null,
    content_change_reason: null,
  },
  items: [
    { id: 1, template_id: 41, task_name: "Abrir persianas" },
    { id: 2, template_id: 41, task_name: "Encender luces" },
  ],
  history: [],
});

class FakeClient {
  private mutation = 0;

  constructor(public state: State, private failAt = 0) {}

  private mutate() {
    this.mutation += 1;
    if (this.failAt && this.mutation === this.failAt) throw new Error("Falla simulada");
  }

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql === "BEGIN") {
      this.state.snapshot = clone({
        template: this.state.template,
        items: this.state.items,
        history: this.state.history,
      });
      return { rows: [], rowCount: null };
    }
    if (sql === "COMMIT") {
      delete this.state.snapshot;
      return { rows: [], rowCount: null };
    }
    if (sql === "ROLLBACK") {
      if (this.state.snapshot) {
        const restored = clone(this.state.snapshot);
        this.state.template = restored.template;
        this.state.items = restored.items;
        this.state.history = restored.history;
        delete this.state.snapshot;
      }
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("SELECT * FROM checklist_templates")) {
      const row = this.state.template.id === Number(params[0]) ? clone(this.state.template) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT id, template_id, task_name FROM checklist_template_items") && sql.includes("FOR UPDATE")) {
      const rows = this.state.items.filter((item) => item.template_id === Number(params[0])).map(clone);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("INSERT INTO checklist_template_content_history")) {
      this.mutate();
      const row = {
        id: this.state.history.length + 1,
        template_id: Number(params[0]),
        version: Number(params[1]),
        status_at_change: "activa",
        reason: params[2],
        changed_by: params[3],
        changed_at: "2026-07-30T19:00:00.000Z",
        template_before_snapshot: JSON.parse(params[4]),
        items_before_snapshot: JSON.parse(params[5]),
        template_after_snapshot: JSON.parse(params[6]),
        items_after_snapshot: JSON.parse(params[7]),
      };
      this.state.history.push(row);
      return { rows: [{ id: row.id, changed_at: row.changed_at }], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE checklist_templates SET name = $1")) {
      this.mutate();
      if (
        this.state.template.id !== Number(params[7])
        || Number(this.state.template.active) !== 1
        || Number(this.state.template.content_version || 0) !== Number(params[8])
      ) {
        return { rows: [], rowCount: 0 };
      }
      this.state.template = {
        ...this.state.template,
        name: params[0],
        description: params[1],
        type: params[2],
        content_version: Number(params[3]),
        content_changed_at: params[4],
        content_changed_by: params[5],
        content_change_reason: params[6],
      };
      return { rows: [clone(this.state.template)], rowCount: 1 };
    }

    if (sql.startsWith("DELETE FROM checklist_template_items")) {
      this.mutate();
      this.state.items = this.state.items.filter((item) => item.template_id !== Number(params[0]));
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("INSERT INTO checklist_template_items")) {
      this.mutate();
      this.state.items.push({
        id: 100 + this.state.items.length,
        template_id: Number(params[0]),
        task_name: String(params[1]),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("SELECT id, template_id, task_name FROM checklist_template_items")) {
      const rows = this.state.items.filter((item) => item.template_id === Number(params[0])).map(clone);
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const run = async (
  state: State,
  overrides: Partial<Parameters<typeof checklistTemplateContentLifecycleService.update>[0]> = {},
  failAt = 0
) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await checklistTemplateContentLifecycleService.update({
      templateId: 41,
      name: "Apertura actualizada",
      description: "Control actualizado",
      type: "Apertura",
      items: ["Abrir persianas", "Encender luces", "Revisar caja"],
      motivo: "Se agregó el control de caja",
      usuario: "Auditor",
      expectedContentVersion: 0,
      ...overrides,
    }, client as any);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const success = createState();
const result = await run(success);
assert(result.version === 1, "La edición no incrementó la versión.");
assert(success.template.content_version === 1, "La plantilla no conserva la nueva versión.");
assert(success.items.length === 3 && success.items[2].task_name === "Revisar caja", "Las tareas no se reemplazaron correctamente.");
assert(success.history.length === 1, "No se registró el historial.");
assert(success.history[0].items_before_snapshot.length === 2, "El snapshot anterior no conserva las tareas.");
assert(success.history[0].items_after_snapshot.length === 3, "El snapshot posterior no conserva las tareas.");

await run(createState(), { motivo: "" }).then(
  () => { throw new Error("Debía exigir motivo."); },
  (error) => assert(String(error.message).includes("motivo del cambio"), "Mensaje incorrecto para motivo faltante.")
);

const inactive = createState();
inactive.template.active = 0;
await run(inactive).then(
  () => { throw new Error("Debía bloquear una plantilla inactiva."); },
  (error) => assert(String(error.message).includes("inactiva"), "Mensaje incorrecto para plantilla inactiva.")
);

await run(createState(), { expectedContentVersion: 2 }).then(
  () => { throw new Error("Debía bloquear una pestaña antigua."); },
  (error) => assert(String(error.message).includes("cambió mientras estaba abierta"), "Mensaje incorrecto para versión antigua.")
);

await run(createState(), {
  name: "Apertura diaria",
  description: "Control de apertura",
  type: "Apertura",
  items: ["Abrir persianas", "Encender luces"],
}).then(
  () => { throw new Error("Debía bloquear un guardado sin cambios."); },
  (error) => assert(String(error.message).includes("No se detectaron cambios"), "Mensaje incorrecto para guardado sin cambios.")
);

await run(createState(), {
  items: ["Abrir persianas", "abrir persianas"],
}).then(
  () => { throw new Error("Debía bloquear tareas duplicadas."); },
  (error) => assert(String(error.message).includes("no puede repetirse"), "Mensaje incorrecto para tarea duplicada.")
);

const rollback = createState();
await run(rollback, {}, 4).then(
  () => { throw new Error("La prueba de rollback debía fallar."); },
  () => undefined
);
assert(rollback.template.content_version === 0, "El rollback alteró la versión.");
assert(rollback.template.name === "Apertura diaria", "El rollback alteró la plantilla.");
assert(rollback.items.length === 2 && rollback.items[1].task_name === "Encender luces", "El rollback alteró las tareas.");
assert(rollback.history.length === 0, "El rollback dejó historial parcial.");

console.log(
  "Edición auditada de plantillas de checklist correcta: motivo, snapshots, versiones, tareas, concurrencia y rollback verificados."
);
