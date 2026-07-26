import fs from "node:fs";
import path from "node:path";
import { checklistTemplateLifecycleService } from "../server/services/checklistTemplateLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

class FakeClient {
  template: any;
  items: any[];
  checklistsCount: number;
  history: any[] = [];
  transactionLog: string[] = [];

  constructor(options: any = {}) {
    this.template = options.template || {
      id: 7,
      name: "Apertura diaria",
      description: "Control de apertura",
      type: "Apertura",
      active: 1,
      deactivated_at: null,
      deactivated_by: null,
      deactivation_reason: null,
      reactivated_at: null,
      reactivated_by: null,
      reactivation_reason: null,
    };
    this.items = options.items || [
      { id: 1, template_id: 7, task_name: "Abrir caja" },
      { id: 2, template_id: 7, task_name: "Revisar stock" },
    ];
    this.checklistsCount = options.checklistsCount ?? 4;
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      this.transactionLog.push(normalized);
      return { rows: [], rowCount: null };
    }
    if (normalized.startsWith("SELECT * FROM checklist_templates")) {
      return this.template && Number(this.template.id) === Number(params[0])
        ? { rows: [{ ...this.template }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM checklist_template_items")) {
      return { rows: this.items.map(item => ({ ...item })), rowCount: this.items.length };
    }
    if (normalized.includes("COUNT(*)::int AS total") && normalized.includes("FROM checklists")) {
      return { rows: [{ total: this.checklistsCount }], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO checklist_template_status_history")) {
      const entry = {
        id: this.history.length + 1,
        template_id: params[0],
        action: params[1],
        reason: params[2],
        performed_by: params[3],
        previous_status: params[4],
        new_status: params[5],
        snapshot: params[6],
        performed_at: "2026-07-26T15:00:00.000Z",
      };
      this.history.push(entry);
      return { rows: [entry], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE checklist_templates SET active = 0")) {
      this.template = {
        ...this.template,
        active: 0,
        deactivated_at: params[0],
        deactivated_by: params[1],
        deactivation_reason: params[2],
        reactivated_at: null,
        reactivated_by: null,
        reactivation_reason: null,
      };
      return { rows: [{ ...this.template }], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE checklist_templates SET active = 1")) {
      this.template = {
        ...this.template,
        active: 1,
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
        reactivated_at: params[0],
        reactivated_by: params[1],
        reactivation_reason: params[2],
      };
      return { rows: [{ ...this.template }], rowCount: 1 };
    }
    throw new Error(`Consulta no simulada: ${normalized}`);
  }
}

const expectFailure = async (fn: () => Promise<any>, includes: string) => {
  try {
    await fn();
    throw new Error(`Se esperaba un bloqueo que contuviera: ${includes}`);
  } catch (error: any) {
    assert(
      String(error?.message || error).toLowerCase().includes(includes.toLowerCase()),
      `Mensaje inesperado: ${error?.message || String(error)}`
    );
  }
};

const runSimulation = async () => {
  const client = new FakeClient();
  const deactivated = await checklistTemplateLifecycleService.changeStatus(
    {
      templateId: 7,
      action: "deactivate",
      motivo: "Reemplazada por una versión actualizada",
      usuario: "Auditor local",
    },
    client as any
  );
  assert(Number(deactivated.template.active) === 0, "La baja no dejó la plantilla inactiva.");
  assert(client.history.length === 1, "La baja no registró historial.");
  const snapshot = JSON.parse(client.history[0].snapshot);
  assert(snapshot.items.length === 2, "El historial no preservó los ítems de la plantilla.");
  assert(snapshot.checklists_count === 4, "El historial no preservó el uso histórico.");

  const reactivationClient = new FakeClient({ template: { ...client.template, active: 0 } });
  const reactivated = await checklistTemplateLifecycleService.changeStatus(
    {
      templateId: 7,
      action: "reactivate",
      motivo: "Vuelve a utilizarse",
      usuario: "Auditor local",
    },
    reactivationClient as any
  );
  assert(Number(reactivated.template.active) === 1, "La reactivación no dejó la plantilla activa.");
  assert(reactivated.template.deactivation_reason === null, "La reactivación no limpió la baja vigente.");
  assert(reactivated.template.reactivation_reason === "Vuelve a utilizarse", "No registró el motivo de reactivación.");

  await expectFailure(
    () => checklistTemplateLifecycleService.changeStatus(
      { templateId: 7, action: "deactivate", motivo: "Otra baja", usuario: "Auditor" },
      new FakeClient({ template: { ...client.template, active: 0 } }) as any
    ),
    "ya está dada de baja"
  );
  await expectFailure(
    () => checklistTemplateLifecycleService.changeStatus(
      { templateId: 7, action: "reactivate", motivo: "Otra alta", usuario: "Auditor" },
      new FakeClient() as any
    ),
    "ya está activa"
  );
  await expectFailure(
    () => checklistTemplateLifecycleService.changeStatus(
      { templateId: 7, action: "deactivate", motivo: "x", usuario: "Auditor" },
      new FakeClient() as any
    ),
    "al menos 3"
  );
};

const runStaticAudit = () => {
  const migration = read("supabase/18_checklist_template_lifecycle.sql");
  for (const token of [
    "checklist_template_status_history",
    "deactivated_at",
    "deactivation_reason",
    "reactivated_at",
    "reactivation_reason",
  ]) {
    assert(migration.includes(token), `Falta ${token} en la migración.`);
  }

  const api = read("api/clientes.ts");
  assert(api.includes("checklistTemplateLifecycleService.changeStatus"), "Vercel no usa el servicio de ciclo de vida.");
  assert(api.includes("La eliminación física de plantillas está deshabilitada"), "Vercel no bloquea DELETE físico.");
  assert(api.includes("La plantilla está inactiva y no puede iniciar nuevos checklists"), "Vercel permite usar plantillas inactivas.");
  assert(api.includes('action === "deactivate" ? "delete" : "edit"'), "Los permisos de baja/reactivación no están diferenciados.");

  const express = read("server/routes/checklistRoutes.ts");
  assert(express.includes('"/checklist-templates/:id/deactivate"'), "Falta la baja segura en Express.");
  assert(express.includes('"/checklist-templates/:id/reactivate"'), "Falta la reactivación en Express.");
  assert(express.includes("La eliminación física de plantillas está deshabilitada"), "Express no bloquea DELETE físico.");
  assert(express.includes("La plantilla está inactiva y no puede iniciar nuevos checklists"), "Express permite usar plantillas inactivas.");

  const ui = read("src/components/ChecklistModule.tsx");
  assert(ui.includes("Dar de baja plantilla"), "Falta modal de baja en la interfaz.");
  assert(ui.includes("Reactivar plantilla"), "Falta modal de reactivación en la interfaz.");
  assert(ui.includes("Motivo obligatorio"), "La interfaz no exige motivo.");
  assert(!ui.includes("Eliminar plantilla"), "La interfaz todavía ofrece eliminación física.");
  assert(!ui.includes("handleDeleteTemplate"), "La interfaz conserva el flujo DELETE anterior.");

  const db = read("server/db.ts");
  assert(db.includes("checklist_template_status_history"), "SQLite no tiene historial de ciclo de vida.");
};

await runSimulation();
runStaticAudit();
console.log("Auditoría de ciclo de vida de plantillas de checklist correcta.");
