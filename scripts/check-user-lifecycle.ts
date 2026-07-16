import fs from "node:fs";
import path from "node:path";
import { userLifecycleService } from "../server/services/userLifecycleService.js";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

type FakeOptions = {
  user?: any;
  activeAdmins?: number;
};

class FakeClient {
  user: any;
  activeAdmins: number;
  history: any[] = [];

  constructor(options: FakeOptions = {}) {
    this.user = options.user || {
      id: 7,
      name: "Usuario de prueba",
      email: "usuario@prueba.local",
      role: "empleado",
      avatar: "UP",
      active: 1,
      created_at: "2026-07-16T12:00:00.000Z",
      session_version: 4,
      deactivated_at: null,
      deactivated_by: null,
      deactivation_reason: null,
    };
    this.activeAdmins = options.activeAdmins ?? 2;
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();

    if (["BEGIN", "COMMIT", "ROLLBACK", "LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"].includes(normalized)) {
      return { rows: [], rowCount: null };
    }

    if (normalized.startsWith("SELECT id, name, email, role") && normalized.includes("FROM users") && normalized.includes("FOR UPDATE")) {
      return this.user && Number(this.user.id) === Number(params[0])
        ? { rows: [{ ...this.user }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("SELECT COUNT(*)::int AS total") && normalized.includes("role = 'administrador'")) {
      return { rows: [{ total: this.activeAdmins }], rowCount: 1 };
    }

    if (normalized.startsWith("INSERT INTO user_status_history")) {
      this.history.push({
        user_id: params[0],
        action: params[1],
        reason: params[2],
        performed_by_user_id: params[3],
        performed_by: params[4],
        previous_status: params[5],
        new_status: params[6],
        snapshot: params[7],
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE users SET active = 0")) {
      this.user = {
        ...this.user,
        active: 0,
        deactivated_at: "2026-07-16T15:00:00.000Z",
        deactivated_by: params[0],
        deactivation_reason: params[1],
        session_version: Number(this.user.session_version || 1) + 1,
      };
      return { rows: [{ ...this.user }], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE users SET active = 1")) {
      this.user = {
        ...this.user,
        active: 1,
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
        session_version: Number(this.user.session_version || 1) + 1,
      };
      return { rows: [{ ...this.user }], rowCount: 1 };
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

const runServiceSimulation = async () => {
  const deactivateClient = new FakeClient();
  const deactivated = await userLifecycleService.changeStatus(
    {
      userId: 7,
      action: "deactivate",
      motivo: "Finalizó su relación laboral",
      performedByUserId: 1,
      performedByName: "Administrador",
    },
    deactivateClient as any
  );

  assert(Number(deactivated.active) === 0, "La baja no desactivó al usuario.");
  assert(Number(deactivated.session_version) === 5, "La baja no invalidó las sesiones anteriores.");
  assert(deactivateClient.history.length === 1, "La baja no registró auditoría.");
  assert(deactivateClient.history[0].previous_status === "active", "El historial no registró el estado anterior.");
  assert(deactivateClient.history[0].new_status === "inactive", "El historial no registró el estado nuevo.");

  const reactivateClient = new FakeClient({ user: { ...deactivated, active: 0 } });
  const reactivated = await userLifecycleService.changeStatus(
    {
      userId: 7,
      action: "reactivate",
      motivo: "Retoma sus funciones",
      performedByUserId: 1,
      performedByName: "Administrador",
    },
    reactivateClient as any
  );

  assert(Number(reactivated.active) === 1, "La reactivación no activó al usuario.");
  assert(Number(reactivated.session_version) === 6, "La reactivación no mantuvo invalidados los tokens anteriores.");

  await expectFailure(
    () => userLifecycleService.changeStatus(
      {
        userId: 7,
        action: "deactivate",
        motivo: "Prueba de cuenta propia",
        performedByUserId: 7,
        performedByName: "Usuario de prueba",
      },
      new FakeClient() as any
    ),
    "propia cuenta"
  );

  await expectFailure(
    () => userLifecycleService.changeStatus(
      {
        userId: 7,
        action: "deactivate",
        motivo: "Prueba de último administrador",
        performedByUserId: 1,
        performedByName: "Administrador principal",
      },
      new FakeClient({
        user: { id: 7, name: "Último admin", email: "admin@prueba.local", role: "administrador", active: 1, session_version: 2 },
        activeAdmins: 1,
      }) as any
    ),
    "al menos un administrador activo"
  );

  await expectFailure(
    () => userLifecycleService.changeStatus(
      {
        userId: 7,
        action: "deactivate",
        motivo: "Prueba de doble baja",
        performedByUserId: 1,
        performedByName: "Administrador",
      },
      new FakeClient({ user: { id: 7, role: "empleado", active: 0, session_version: 2 } }) as any
    ),
    "ya está dado de baja"
  );

  await expectFailure(
    () => userLifecycleService.changeStatus(
      {
        userId: 7,
        action: "reactivate",
        motivo: "Prueba de doble reactivación",
        performedByUserId: 1,
        performedByName: "Administrador",
      },
      new FakeClient() as any
    ),
    "ya está activo"
  );
};

const runStaticAudit = () => {
  const migration = read("supabase/13_user_lifecycle.sql");
  ["session_version", "deactivated_at", "deactivated_by", "deactivation_reason", "user_status_history"].forEach((token) =>
    assert(migration.includes(token), `Falta ${token} en la migración de usuarios.`)
  );

  const repository = read("server/repositories/userRepository.ts");
  assert(repository.includes("session_version = COALESCE(session_version, 1) + 1"), "Cambiar rol o contraseña no invalida sesiones.");
  assert(repository.includes("No podés cambiar tu propio rol"), "No se bloquea el cambio del rol propio.");
  assert(repository.includes("Debe quedar al menos un administrador activo"), "No se protege al último administrador.");
  assert(repository.includes("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"), "La protección del último administrador no está serializada.");
  assert(!repository.includes("DELETE FROM users"), "El repositorio todavía elimina usuarios físicamente.");
  assert(!repository.includes("finalActive"), "Editar usuario todavía permite modificar el estado directamente.");

  const vercelApi = read("api/clientes.ts");
  assert(vercelApi.includes("endpoint === \"user-lifecycle\""), "Falta el endpoint Vercel de ciclo de vida de usuarios.");
  assert(vercelApi.includes("userLifecycleService.changeStatus"), "La API Vercel no usa el servicio transaccional.");
  assert(vercelApi.includes("La eliminación física de usuarios está deshabilitada"), "DELETE de usuarios no está bloqueado en Vercel.");

  const expressRoutes = read("server/routes/userRoutes.ts");
  assert(expressRoutes.includes("/:id/lifecycle"), "Falta la ruta Express de ciclo de vida.");
  assert(expressRoutes.includes("La eliminación física de usuarios está deshabilitada"), "DELETE de usuarios no está bloqueado en Express.");

  const ui = read("src/components/UserManagement.tsx");
  assert(ui.includes("Dar de baja"), "Falta la acción de baja en Usuarios.");
  assert(ui.includes("Confirmar reactivación"), "Falta la reactivación en Usuarios.");
  assert(ui.includes("endpoint=user-lifecycle"), "La interfaz no llama al endpoint de ciclo de vida.");
  assert(!ui.includes("formData.active"), "Editar usuario todavía expone el estado directo.");
  assert(!ui.includes("method: 'DELETE'"), "La interfaz todavía intenta eliminar usuarios.");

  const loginApi = read("api/auth/login.ts");
  const loginExpress = read("server/routes/authRoutes.ts");
  assert(loginApi.includes("sessionVersion"), "El login Vercel no firma la versión de sesión.");
  assert(loginExpress.includes("sessionVersion"), "El login Express no guarda la versión de sesión.");

  const staffAuthFiles = [
    "api/finanzas.ts",
    "api/products.ts",
    "api/products/[id].ts",
    "api/sales.ts",
    "server/services/vercel/configApiHelpers.ts",
    "server/services/vercel/dashboardApiHelpers.ts",
    "server/services/vercel/productInventoryApiHelpers.ts",
    "server/services/vercel/purchaseInvoiceApiHelpers.ts",
  ];
  staffAuthFiles.forEach((file) => {
    const source = read(file);
    assert(source.includes("requireBearerUser"), `${file} no valida usuario activo y versión de sesión.`);
    assert(!source.includes("verifyToken"), `${file} todavía confía solamente en el JWT.`);
  });

  const currentAuth = read("server/services/currentUserAuthService.ts");
  assert(currentAuth.includes("currentSessionVersion !== tokenSessionVersion"), "No se compara la versión del token con la base.");
  assert(currentAuth.includes("Number(user.active ?? 0) !== 1"), "No se rechazan usuarios inactivos.");
  assert(currentAuth.includes("getPostgresPool"), "La validación de sesión no consulta PostgreSQL directamente.");
  assert(currentAuth.includes('await import("../repositories/userRepository.js")'), "El fallback SQLite no se carga de forma diferida.");
  assert(!currentAuth.includes('import { UserRepository } from "../repositories/userRepository.js"'), "La validación de sesión inicializa SQLite al cargar el módulo.");

  const portalAndUsersApi = read("api/clientes.ts");
  assert(portalAndUsersApi.includes("verifyToken(token)"), "Se perdió la autenticación independiente del Portal del cliente.");
  assert(portalAndUsersApi.includes("decoded.role !== \"cliente\""), "El Portal del cliente no conserva su separación de roles.");

  const frontendApi = read("src/utils/api.ts");
  assert(frontendApi.includes("auth:session-invalidated"), "El frontend no reacciona ante una sesión invalidada.");
  assert(frontendApi.includes("localStorage.removeItem('auth_token')"), "El frontend no elimina el token inválido.");
  assert(read("src/contexts/AuthContext.tsx").includes("disconnectSocket"), "AuthContext no desconecta el socket al invalidar sesión.");
  assert(read("server/socket.ts").includes("validateStaffSession"), "Socket.IO no valida la versión de sesión.");
  assert(read("server/socket.ts").includes("validateStaffToken"), "Socket.IO no valida tokens contra la base.");

  const configApi = read("api/config/[endpoint].ts");
  assert(configApi.includes('"user_status_history"'), "La auditoría de usuarios no está incluida en copias/restauración.");
};

await runServiceSimulation();
runStaticAudit();
console.log("Auditoría de ciclo de vida e invalidación de sesiones de usuarios correcta.");
