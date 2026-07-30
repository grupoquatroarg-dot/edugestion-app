import fs from "node:fs";
import path from "node:path";
import { userPermissionLifecycleService, USER_PERMISSION_MODULES } from "../server/services/userPermissionLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const buildPermissions = (mode: "none" | "view" | "full" = "none") =>
  USER_PERMISSION_MODULES.reduce<Record<string, any>>((acc, module) => {
    acc[module] = {
      module,
      can_view: mode !== "none",
      can_create: mode === "full",
      can_edit: mode === "full",
      can_delete: mode === "full",
    };
    return acc;
  }, {});

type State = {
  user: any;
  permissions: any[];
  history: any[];
  snapshot?: State;
};

const createState = (): State => ({
  user: {
    id: 8,
    name: "Usuario operativo",
    email: "operativo@prueba.local",
    role: "empleado",
    active: 1,
    session_version: 3,
    permissions_version: 0,
    permissions_changed_at: null,
    permissions_changed_by: null,
    permissions_change_reason: null,
  },
  permissions: Object.values(buildPermissions("none")),
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
        user: this.state.user,
        permissions: this.state.permissions,
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
        this.state.user = restored.user;
        this.state.permissions = restored.permissions;
        this.state.history = restored.history;
        delete this.state.snapshot;
      }
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("SELECT id, name, email, role, active, session_version") && sql.includes("FOR UPDATE")) {
      const row = this.state.user && Number(this.state.user.id) === Number(params[0])
        ? clone(this.state.user)
        : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT module, can_view, can_create, can_edit, can_delete") && sql.includes("FOR UPDATE")) {
      const rows = this.state.permissions
        .filter((permission) => Number(permission.user_id || 8) === Number(params[0]))
        .map(clone);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("UPDATE users SET permissions_version = $1")) {
      this.mutate();
      if (
        Number(this.state.user.id) !== Number(params[3])
        || Number(this.state.user.permissions_version || 0) !== Number(params[4])
        || Number(this.state.user.active || 0) !== 1
        || this.state.user.role === "administrador"
      ) {
        return { rows: [], rowCount: 0 };
      }

      this.state.user = {
        ...this.state.user,
        permissions_version: Number(params[0]),
        permissions_changed_at: "2026-07-30T18:30:00.000Z",
        permissions_changed_by: params[1],
        permissions_change_reason: params[2],
        session_version: Number(this.state.user.session_version || 1) + 1,
      };
      return {
        rows: [{
          permissions_version: this.state.user.permissions_version,
          permissions_changed_at: this.state.user.permissions_changed_at,
          permissions_changed_by: this.state.user.permissions_changed_by,
          permissions_change_reason: this.state.user.permissions_change_reason,
          session_version: this.state.user.session_version,
        }],
        rowCount: 1,
      };
    }

    if (sql.startsWith("DELETE FROM user_permissions")) {
      this.mutate();
      this.state.permissions = [];
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("INSERT INTO user_permissions")) {
      this.mutate();
      this.state.permissions.push({
        user_id: Number(params[0]),
        module: params[1],
        can_view: Number(params[2]),
        can_create: Number(params[3]),
        can_edit: Number(params[4]),
        can_delete: Number(params[5]),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("INSERT INTO user_permission_history")) {
      this.mutate();
      this.state.history.push({
        user_id: Number(params[0]),
        version: Number(params[1]),
        reason: params[2],
        changed_by_user_id: params[3],
        changed_by: params[4],
        changed_at: params[5],
        before: JSON.parse(params[6]),
        after: JSON.parse(params[7]),
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const run = async (
  state: State,
  overrides: Partial<Parameters<typeof userPermissionLifecycleService.update>[0]> = {},
  failAt = 0,
) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await userPermissionLifecycleService.update({
      userId: 8,
      permissions: buildPermissions("view"),
      motivo: "Cambio de funciones del usuario",
      changedByUserId: 1,
      changedByName: "Administrador",
      expectedVersion: 0,
      ...overrides,
    }, client as any);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const expectFailure = async (promise: Promise<any>, expected: string) => {
  try {
    await promise;
    throw new Error(`Se esperaba un error que incluyera: ${expected}`);
  } catch (error: any) {
    assert(
      String(error?.message || error).toLowerCase().includes(expected.toLowerCase()),
      `Mensaje inesperado: ${error?.message || String(error)}`,
    );
  }
};

const success = createState();
const result = await run(success);
assert(result.version === 1, "La versión de permisos no se incrementó.");
assert(success.user.permissions_version === 1, "El usuario no conservó la nueva versión.");
assert(success.user.session_version === 4, "El cambio no invalidó las sesiones anteriores.");
assert(success.permissions.length === USER_PERMISSION_MODULES.length, "No se guardaron todos los módulos.");
assert(success.permissions.every((permission) => permission.can_view === 1), "Los permisos nuevos no se aplicaron.");
assert(success.history.length === 1, "No se creó el historial de permisos.");
assert(success.history[0].before.length === USER_PERMISSION_MODULES.length, "El snapshot anterior está incompleto.");
assert(success.history[0].after.length === USER_PERMISSION_MODULES.length, "El snapshot posterior está incompleto.");

await expectFailure(run(createState(), { motivo: "" }), "motivo del cambio");
await expectFailure(run(createState(), { expectedVersion: 2 }), "permisos cambiaron");
await expectFailure(run(createState(), { permissions: buildPermissions("none") }), "No se detectaron cambios");

const inactive = createState();
inactive.user.active = 0;
await expectFailure(run(inactive), "Reactivá al usuario");

const administrator = createState();
administrator.user.role = "administrador";
await expectFailure(run(administrator), "administradores tienen acceso completo");

const incomplete = buildPermissions("view");
delete incomplete.users;
await expectFailure(run(createState(), { permissions: incomplete }), "exactamente todos los módulos");

const invalidDependency = buildPermissions("none");
invalidDependency.sales.can_edit = true;
await expectFailure(run(createState(), { permissions: invalidDependency }), "debe permitir ver");

const rollback = createState();
await expectFailure(run(rollback, {}, 4), "Falla simulada");
assert(rollback.user.permissions_version === 0, "El rollback alteró la versión del usuario.");
assert(rollback.user.session_version === 3, "El rollback invalidó sesiones parcialmente.");
assert(rollback.permissions.every((permission) => !permission.can_view), "El rollback alteró permisos.");
assert(rollback.history.length === 0, "El rollback dejó historial parcial.");

const migration = read("supabase/33_user_permission_lifecycle.sql");
[
  "permissions_version",
  "permissions_changed_at",
  "permissions_change_reason",
  "user_permission_history",
  "permissions_before_snapshot",
  "permissions_after_snapshot",
].forEach((token) => assert(migration.includes(token), `Falta ${token} en la migración 33.`));

const service = read("server/services/userPermissionLifecycleService.ts");
assert(service.includes("FOR UPDATE"), "El servicio no bloquea al usuario durante el cambio.");
assert(service.includes("session_version = COALESCE(session_version, 1) + 1"), "El cambio no invalida sesiones.");
assert(service.includes("No se detectaron cambios en los permisos"), "No se bloquea un guardado sin cambios.");
assert(service.includes("DELETE FROM user_permissions"), "El reemplazo no está encapsulado en el servicio transaccional.");
assert(service.includes("INSERT INTO user_permission_history"), "El servicio no guarda historial.");

const repository = read("server/repositories/userRepository.ts");
assert(!repository.includes('const deleteOld = db.prepare("DELETE FROM user_permissions'), "El repositorio conserva el reemplazo directo SQLite.");
assert(!repository.includes('await client.query("DELETE FROM user_permissions'), "El repositorio conserva el reemplazo directo PostgreSQL.");
assert(repository.includes("actualización directa de permisos está deshabilitada"), "El bypass anterior del repositorio no está bloqueado.");

const vercelApi = read("api/clientes.ts");
assert(vercelApi.includes("userPermissionLifecycleService.update"), "Vercel no usa el servicio auditado.");
assert(vercelApi.includes("expectedVersion"), "Vercel no exige versión esperada.");
assert(vercelApi.includes("changedByUserId"), "Vercel no registra al administrador ejecutor.");

const expressRoutes = read("server/routes/userRoutes.ts");
assert(expressRoutes.includes("userPermissionLifecycleService.update"), "Express no usa el servicio auditado.");
assert(expressRoutes.includes("expectedVersion"), "Express no exige versión esperada.");

const ui = read("src/components/UserManagement.tsx");
assert(ui.includes("Motivo obligatorio del cambio"), "La interfaz no solicita motivo.");
assert(ui.includes("expectedVersion: permissionsVersion"), "La interfaz no envía control de concurrencia.");
assert(ui.includes("sesiones anteriores fueron invalidadas"), "La interfaz no informa la invalidación de sesiones.");

const dbSource = read("server/db.ts");
assert(dbSource.includes("CREATE TABLE IF NOT EXISTS user_permission_history"), "SQLite no crea el historial de permisos.");
assert(dbSource.includes("ALTER TABLE users ADD COLUMN permissions_version"), "SQLite no migra la versión de permisos.");

console.log(
  "Permisos auditados de usuarios correctos: motivo, snapshots, versiones, sesiones, concurrencia, validaciones y rollback verificados.",
);
