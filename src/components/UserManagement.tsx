import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Crown,
  Edit3,
  Eye,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  PencilLine,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import { User, UserPermission } from '../types';
import { apiFetch, unwrapResponse } from '../utils/api';

type UserRole = 'administrador' | 'empleado' | 'vendedor' | 'operario';
type AccessUser = Omit<User, 'role'> & {
  role: UserRole;
  active?: number | boolean;
  created_at?: string;
};
type StatusFilter = 'todos' | 'activos' | 'inactivos';
type RoleFilter = 'todos' | UserRole;
type PermissionAction = keyof Omit<UserPermission, 'module'>;

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', description: 'Indicadores, alertas y resumen ejecutivo.' },
  { id: 'sales', label: 'Ventas', description: 'Ventas, pedidos de clientes, cobros y comprobantes.' },
  { id: 'customers', label: 'Clientes', description: 'Clientes, fichas, cuenta corriente y portal.' },
  { id: 'products', label: 'Productos', description: 'Productos, stock, precios, familias y bajas.' },
  { id: 'suppliers', label: 'Proveedores', description: 'Facturas de compra, proveedores y pedidos.' },
  { id: 'current_accounts', label: 'Finanzas', description: 'Caja, movimientos, cheques y cuentas corrientes.' },
  { id: 'checklist', label: 'Checklist', description: 'Plantillas, controles y tareas operativas.' },
  { id: 'routes', label: 'Rutas', description: 'Planificación y seguimiento de rutas.' },
  { id: 'settings', label: 'Configuración', description: 'Parámetros, medios de pago y mantenimiento.' },
  { id: 'users', label: 'Usuarios', description: 'Usuarios, roles y permisos de acceso.' },
] as const;

const ROLE_OPTIONS: Array<{ value: UserRole; label: string; description: string }> = [
  { value: 'administrador', label: 'Administrador', description: 'Acceso completo a toda la aplicación.' },
  { value: 'empleado', label: 'Empleado', description: 'Acceso definido mediante permisos por módulo.' },
  { value: 'vendedor', label: 'Vendedor', description: 'Perfil comercial con permisos configurables.' },
  { value: 'operario', label: 'Operario', description: 'Perfil operativo con permisos configurables.' },
];

const EMPTY_PERMISSION = (moduleId: string): UserPermission => ({
  module: moduleId,
  can_view: false,
  can_create: false,
  can_edit: false,
  can_delete: false,
});

const normalizeActive = (value: unknown) => value === true || value === 1 || value === '1';

const getInitials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'US';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
};

const roleLabel = (role: string) =>
  ROLE_OPTIONS.find((option) => option.value === role)?.label || role;

const roleClasses = (role: UserRole) => {
  if (role === 'administrador') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (role === 'vendedor') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (role === 'operario') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-100 text-slate-700';
};

const formatDate = (value?: string) => {
  if (!value) return 'Sin fecha registrada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha registrada';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

export default function UserManagement() {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AccessUser | null>(null);
  const [userPermissions, setUserPermissions] = useState<Record<string, UserPermission>>({});
  const [isPermissionsLoading, setIsPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const userNameInputRef = useRef<HTMLInputElement | null>(null);
  const permissionsTitleRef = useRef<HTMLHeadingElement | null>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);

  const [formData, setFormData] = useState<{
    name: string;
    email: string;
    password: string;
    role: UserRole;
    active: number;
  }>({
    name: '',
    email: '',
    password: '',
    role: 'empleado',
    active: 1,
  });

  useEffect(() => {
    void fetchUsers(true);
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(''), 4500);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    if (!isModalOpen) return;
    window.requestAnimationFrame(() => userNameInputRef.current?.focus());
  }, [isModalOpen]);

  useEffect(() => {
    if (!isPermissionsModalOpen) return;
    window.requestAnimationFrame(() => permissionsTitleRef.current?.focus());
  }, [isPermissionsModalOpen]);

  const rememberModalTrigger = () => {
    modalTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  };

  const restoreModalTrigger = () => {
    window.requestAnimationFrame(() => modalTriggerRef.current?.focus());
  };

  const fetchUsers = async (initial = false) => {
    if (initial) setIsLoading(true);
    else setIsRefreshing(true);
    setLoadError('');

    try {
      const res = await apiFetch('/api/clientes?endpoint=users');
      const body = await res.json();
      const data = unwrapResponse<AccessUser[]>(body);
      setUsers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      setLoadError(err?.message || 'No se pudieron cargar los usuarios.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        roleLabel(user.role).toLowerCase().includes(query);
      const isActive = normalizeActive(user.active ?? 1);
      const matchesStatus =
        statusFilter === 'todos' ||
        (statusFilter === 'activos' && isActive) ||
        (statusFilter === 'inactivos' && !isActive);
      const matchesRole = roleFilter === 'todos' || user.role === roleFilter;

      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [users, searchTerm, statusFilter, roleFilter]);

  const summary = useMemo(() => {
    const active = users.filter((user) => normalizeActive(user.active ?? 1)).length;
    const administrators = users.filter((user) => user.role === 'administrador').length;
    return {
      total: users.length,
      active,
      inactive: users.length - active,
      administrators,
    };
  }, [users]);

  const handleOpenModal = (user?: AccessUser) => {
    rememberModalTrigger();
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        password: '',
        role: user.role,
        active: normalizeActive(user.active ?? 1) ? 1 : 0,
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'empleado',
        active: 1,
      });
    }

    setFormError('');
    setIsModalOpen(true);
  };

  const closeUserModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setFormError('');
    restoreModalTrigger();
  };

  const buildPermissions = (data: Record<string, UserPermission> = {}) =>
    MODULES.reduce<Record<string, UserPermission>>((acc, module) => {
      acc[module.id] = {
        ...EMPTY_PERMISSION(module.id),
        ...(data[module.id] || {}),
        module: module.id,
      };
      return acc;
    }, {});

  const handleOpenPermissionsModal = async (user: AccessUser) => {
    if (!isPermissionsModalOpen) rememberModalTrigger();
    setEditingUser(user);
    setUserPermissions(buildPermissions());
    setPermissionsError('');
    setIsPermissionsModalOpen(true);

    if (user.role === 'administrador') return;

    setIsPermissionsLoading(true);
    try {
      const res = await apiFetch(`/api/clientes?endpoint=users-permissions&id=${user.id}`);
      const body = await res.json();
      const data = unwrapResponse<Record<string, UserPermission>>(body);
      setUserPermissions(buildPermissions(data));
    } catch (err: any) {
      console.error('Error fetching permissions:', err);
      setPermissionsError(err?.message || 'No se pudieron cargar los permisos.');
    } finally {
      setIsPermissionsLoading(false);
    }
  };

  const closePermissionsModal = () => {
    if (isSubmitting) return;
    setIsPermissionsModalOpen(false);
    setPermissionsError('');
    restoreModalTrigger();
  };

  const handlePermissionChange = (moduleId: string, action: PermissionAction, value: boolean) => {
    setUserPermissions((previous) => {
      const current = previous[moduleId] || EMPTY_PERMISSION(moduleId);
      const next = { ...current, [action]: value };

      if (action !== 'can_view' && value) next.can_view = true;
      if (action === 'can_view' && !value) {
        next.can_create = false;
        next.can_edit = false;
        next.can_delete = false;
      }

      return { ...previous, [moduleId]: next };
    });
  };

  const setModulePermissionPreset = (moduleId: string, preset: 'none' | 'view' | 'full') => {
    setUserPermissions((previous) => ({
      ...previous,
      [moduleId]: {
        module: moduleId,
        can_view: preset !== 'none',
        can_create: preset === 'full',
        can_edit: preset === 'full',
        can_delete: preset === 'full',
      },
    }));
  };

  const setAllPermissionPreset = (preset: 'none' | 'view' | 'full') => {
    setUserPermissions(
      MODULES.reduce<Record<string, UserPermission>>((acc, module) => {
        acc[module.id] = {
          module: module.id,
          can_view: preset !== 'none',
          can_create: preset === 'full',
          can_edit: preset === 'full',
          can_delete: preset === 'full',
        };
        return acc;
      }, {}),
    );
  };

  const handleSavePermissions = async () => {
    if (!editingUser || editingUser.role === 'administrador' || isSubmitting) return;
    setIsSubmitting(true);
    setPermissionsError('');

    try {
      const res = await apiFetch(`/api/clientes?endpoint=users-permissions&id=${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: userPermissions }),
      });
      const body = await res.json();
      unwrapResponse(body);
      setIsPermissionsModalOpen(false);
      setSuccessMessage(`Permisos de ${editingUser.name} actualizados correctamente.`);
      restoreModalTrigger();
    } catch (err: any) {
      setPermissionsError(err?.message || 'Error al guardar permisos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError('');
    setIsSubmitting(true);

    try {
      const url = editingUser
        ? `/api/clientes?endpoint=users&id=${editingUser.id}`
        : '/api/clientes?endpoint=users';
      const method = editingUser ? 'PUT' : 'POST';
      const payload = {
        ...formData,
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
      };

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      unwrapResponse(body);

      await fetchUsers(false);
      setIsModalOpen(false);
      setSuccessMessage(editingUser ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.');
      restoreModalTrigger();
    } catch (err: any) {
      setFormError(err?.message || 'Error al guardar usuario.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('todos');
    setRoleFilter('todos');
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-5 lg:p-7" role="status" aria-live="polite" aria-busy="true">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="h-7 w-52 animate-pulse rounded-lg bg-slate-200" />
            <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-slate-100" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-3xl border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-48 animate-pulse rounded-3xl border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 py-4 text-sm font-bold text-slate-500">
            <Loader2 className="animate-spin text-indigo-600" size={20} />
            Cargando usuarios y accesos...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-5 lg:p-7 custom-scrollbar">
      <div className="mx-auto w-full max-w-7xl space-y-5 sm:space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-indigo-200 bg-gradient-to-br from-indigo-700 via-indigo-600 to-sky-600 text-white shadow-xl shadow-indigo-950/10">
          <div className="relative p-5 sm:p-7 lg:p-8">
            <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-24 left-1/3 h-44 w-44 rounded-full bg-sky-300/20 blur-3xl" />
            <div className="relative flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-50">
                  <LockKeyhole size={14} />
                  Seguridad y accesos
                </div>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">Usuarios y permisos</h1>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-indigo-100 sm:text-base">
                  Administrá cuentas, roles, estados y permisos por módulo desde una vista clara y segura.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                <button
                  type="button"
                  onClick={() => void fetchUsers(false)}
                  disabled={isRefreshing}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-black text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60 lg:flex-none"
                >
                  <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                  {isRefreshing ? 'Actualizando...' : 'Actualizar'}
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenModal()}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-indigo-700 shadow-lg shadow-indigo-950/10 transition hover:bg-indigo-50 lg:flex-none"
                >
                  <UserPlus size={19} />
                  Nuevo usuario
                </button>
              </div>
            </div>
          </div>
        </section>

        {successMessage && (
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800" role="status" aria-live="polite">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
            <p className="min-w-0 text-sm font-bold leading-5">{successMessage}</p>
          </div>
        )}

        {loadError && (
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 sm:flex-row sm:items-center" role="alert">
            <div className="flex min-w-0 items-start gap-3">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-black">No pudimos cargar los usuarios</p>
                <p className="mt-1 break-words text-sm">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchUsers(false)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white transition hover:bg-red-800 sm:ml-auto"
            >
              <RefreshCw size={17} /> Reintentar
            </button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon={<Users size={21} />} label="Usuarios" value={summary.total} tone="indigo" />
          <SummaryCard icon={<UserCheck size={21} />} label="Activos" value={summary.active} tone="emerald" />
          <SummaryCard icon={<UserX size={21} />} label="Inactivos" value={summary.inactive} tone="rose" />
          <SummaryCard icon={<Crown size={21} />} label="Administradores" value={summary.administrators} tone="amber" />
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
            <label className="relative block min-w-0 md:col-span-2 xl:col-span-1">
              <span className="sr-only">Buscar usuario</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por nombre, email o rol..."
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>

            <label className="min-w-0">
              <span className="sr-only">Filtrar por estado</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              >
                <option value="todos">Todos los estados</option>
                <option value="activos">Solo activos</option>
                <option value="inactivos">Solo inactivos</option>
              </select>
            </label>

            <label className="min-w-0">
              <span className="sr-only">Filtrar por rol</span>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              >
                <option value="todos">Todos los roles</option>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={clearFilters}
              disabled={!searchTerm && statusFilter === 'todos' && roleFilter === 'todos'}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X size={18} /> Limpiar
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-1 border-t border-slate-100 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="font-bold text-slate-700">
              {filteredUsers.length} {filteredUsers.length === 1 ? 'usuario encontrado' : 'usuarios encontrados'}
            </p>
            <p className="text-slate-500">Las cuentas inactivas no pueden iniciar sesión.</p>
          </div>
        </section>

        {filteredUsers.length > 0 ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {filteredUsers.map((user) => {
              const isActive = normalizeActive(user.active ?? 1);
              return (
                <article key={user.id} className="min-w-0 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg hover:shadow-slate-200/60">
                  <div className="p-4 sm:p-5">
                    <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-sky-500 text-sm font-black text-white shadow-lg shadow-indigo-200 sm:h-14 sm:w-14">
                        {user.avatar || getInitials(user.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h2 className="break-words text-base font-black text-slate-950 sm:text-lg">{user.name}</h2>
                            <a href={`mailto:${user.email}`} className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-700">
                              <Mail size={14} className="shrink-0" />
                              <span className="min-w-0 break-all">{user.email}</span>
                            </a>
                          </div>
                          <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${roleClasses(user.role)}`}>
                            <Shield size={12} /> {roleLabel(user.role)}
                          </span>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                          <div className={`flex min-w-0 items-center gap-2 rounded-2xl border px-3 py-2.5 ${isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                            {isActive ? <CheckCircle2 size={16} className="shrink-0" /> : <XCircle size={16} className="shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-[10px] font-black uppercase tracking-wider opacity-70">Estado</p>
                              <p className="truncate text-sm font-black">{isActive ? 'Activo' : 'Inactivo'}</p>
                            </div>
                          </div>
                          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-700">
                            <Users size={16} className="shrink-0 text-slate-400" />
                            <div className="min-w-0">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Creado</p>
                              <p className="truncate text-sm font-black">{formatDate(user.created_at)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 border-t border-slate-100 bg-slate-50/70 p-3 min-[420px]:grid-cols-2 sm:p-4">
                    <button
                      type="button"
                      onClick={() => void handleOpenPermissionsModal(user)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-black text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100"
                      title={`Administrar permisos de ${user.name}`}
                      aria-label={`Administrar permisos de ${user.name}`}
                    >
                      <KeyRound size={17} /> Permisos
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenModal(user)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                      title={`Editar usuario ${user.name}`}
                      aria-label={`Editar usuario ${user.name}`}
                    >
                      <Edit3 size={17} /> Editar usuario
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="flex min-h-72 flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400">
              <Users size={30} />
            </div>
            <h2 className="text-xl font-black text-slate-900">
              {users.length === 0 ? 'Todavía no hay usuarios' : 'No encontramos coincidencias'}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              {users.length === 0
                ? 'Creá el primer usuario para comenzar a distribuir accesos y responsabilidades.'
                : 'Probá con otro nombre, email, rol o limpiá los filtros actuales.'}
            </p>
            <button
              type="button"
              onClick={users.length === 0 ? () => handleOpenModal() : clearFilters}
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white transition hover:bg-indigo-700"
            >
              {users.length === 0 ? <UserPlus size={18} /> : <X size={18} />}
              {users.length === 0 ? 'Crear usuario' : 'Limpiar filtros'}
            </button>
          </section>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="user-form-title">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-xl sm:rounded-[28px]">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">Cuenta de acceso</p>
                <h2 id="user-form-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">
                  {editingUser ? 'Editar usuario' : 'Nuevo usuario'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {editingUser ? 'Actualizá sus datos, rol, estado o contraseña.' : 'Creá una nueva cuenta para acceder a Edugestión.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeUserModal}
                disabled={isSubmitting}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                aria-label="Cerrar formulario de usuario"
              >
                <X size={21} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6 custom-scrollbar">
                {formError && (
                  <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
                    <AlertCircle size={19} className="mt-0.5 shrink-0" />
                    <p className="min-w-0 break-words text-sm font-bold">{formError}</p>
                  </div>
                )}

                <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
                      <Users size={20} />
                    </div>
                    <div>
                      <h3 className="font-black text-slate-900">Identificación</h3>
                      <p className="text-xs text-slate-500">Datos utilizados para reconocer e iniciar sesión.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="min-w-0 sm:col-span-2">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Nombre completo</span>
                      <input
                        ref={userNameInputRef}
                        type="text"
                        required
                        value={formData.name}
                        onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                        autoComplete="name"
                        placeholder="Ej.: Juan Pérez"
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>
                    <label className="min-w-0 sm:col-span-2">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Email de acceso</span>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                        autoComplete="email"
                        inputMode="email"
                        placeholder="usuario@empresa.com"
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>
                    <label className="min-w-0 sm:col-span-2">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">
                        {editingUser ? 'Nueva contraseña' : 'Contraseña'}
                      </span>
                      <input
                        type="password"
                        required={!editingUser}
                        minLength={editingUser && !formData.password ? undefined : 6}
                        value={formData.password}
                        onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                        autoComplete="new-password"
                        placeholder={editingUser ? 'Dejar vacío para conservar la actual' : 'Mínimo 6 caracteres'}
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      />
                      <span className="mt-2 block text-xs leading-5 text-slate-500">
                        {editingUser ? 'Solo se modificará si ingresás una nueva contraseña.' : 'Debe tener al menos 6 caracteres.'}
                      </span>
                    </label>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                      <Shield size={20} />
                    </div>
                    <div>
                      <h3 className="font-black text-slate-900">Acceso y estado</h3>
                      <p className="text-xs text-slate-500">El rol define cómo se administran sus permisos.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Rol</span>
                      <select
                        value={formData.role}
                        onChange={(event) => setFormData({ ...formData, role: event.target.value as UserRole })}
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Estado</span>
                      <select
                        value={formData.active}
                        onChange={(event) => setFormData({ ...formData, active: Number(event.target.value) })}
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      >
                        <option value={1}>Activo — puede iniciar sesión</option>
                        <option value={0}>Inactivo — acceso bloqueado</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-900">
                    <p className="font-black">{roleLabel(formData.role)}</p>
                    <p className="mt-0.5 text-indigo-700">
                      {ROLE_OPTIONS.find((option) => option.value === formData.role)?.description}
                    </p>
                  </div>
                </section>
              </div>

              <div className="grid shrink-0 grid-cols-1 gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:grid-cols-2 sm:px-6">
                <button
                  type="button"
                  onClick={closeUserModal}
                  disabled={isSubmitting}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {isSubmitting ? 'Guardando...' : editingUser ? 'Guardar cambios' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isPermissionsModalOpen && editingUser && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/65 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="permissions-title">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[94dvh] sm:max-w-5xl sm:rounded-[28px]">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">Control de acceso</p>
                <h2
                  ref={permissionsTitleRef}
                  id="permissions-title"
                  tabIndex={-1}
                  className="mt-1 break-words rounded-lg text-xl font-black text-slate-950 outline-none focus-visible:ring-4 focus-visible:ring-indigo-100 sm:text-2xl"
                >
                  Permisos de {editingUser.name}
                </h2>
                <p className="mt-1 break-all text-sm text-slate-500">{editingUser.email}</p>
              </div>
              <button
                type="button"
                onClick={closePermissionsModal}
                disabled={isSubmitting}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                aria-label="Cerrar panel de permisos"
              >
                <X size={21} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 custom-scrollbar">
              {editingUser.role === 'administrador' ? (
                <div className="flex min-h-72 flex-col items-center justify-center rounded-[28px] border border-indigo-200 bg-gradient-to-br from-indigo-50 to-sky-50 px-6 py-10 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-indigo-600 text-white shadow-xl shadow-indigo-200">
                    <Crown size={36} />
                  </div>
                  <h3 className="mt-5 text-2xl font-black text-slate-950">Acceso completo de administrador</h3>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                    Los administradores pueden ver, crear, editar y eliminar en todos los módulos. No es necesario guardar permisos individuales.
                  </p>
                </div>
              ) : isPermissionsLoading ? (
                <div className="space-y-4" role="status" aria-live="polite">
                  {[0, 1, 2, 3].map((item) => (
                    <div key={item} className="h-40 animate-pulse rounded-3xl border border-slate-200 bg-slate-100" />
                  ))}
                  <div className="flex items-center justify-center gap-2 py-3 text-sm font-bold text-slate-500">
                    <Loader2 size={19} className="animate-spin text-indigo-600" /> Cargando permisos...
                  </div>
                </div>
              ) : permissionsError ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-[28px] border border-red-200 bg-red-50 px-6 py-10 text-center" role="alert">
                  <AlertCircle size={36} className="text-red-600" />
                  <h3 className="mt-4 text-xl font-black text-red-900">No se pudieron cargar los permisos</h3>
                  <p className="mt-2 max-w-lg break-words text-sm leading-6 text-red-700">{permissionsError}</p>
                  <button
                    type="button"
                    onClick={() => void handleOpenPermissionsModal(editingUser)}
                    className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-red-700 px-5 py-3 text-sm font-black text-white transition hover:bg-red-800"
                  >
                    <RefreshCw size={17} /> Reintentar
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="font-black text-slate-950">Configuración rápida</h3>
                        <p className="mt-1 text-sm text-slate-500">Aplicá un nivel general y después ajustá módulos puntuales.</p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
                        <button type="button" onClick={() => setAllPermissionPreset('none')} aria-label="Aplicar sin acceso a todos los módulos" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-100">
                          <XCircle size={16} /> Sin acceso
                        </button>
                        <button type="button" onClick={() => setAllPermissionPreset('view')} aria-label="Aplicar solo lectura a todos los módulos" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black text-sky-700 transition hover:bg-sky-100">
                          <Eye size={16} /> Solo lectura
                        </button>
                        <button type="button" onClick={() => setAllPermissionPreset('full')} aria-label="Aplicar acceso completo a todos los módulos" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700 transition hover:bg-indigo-100">
                          <CheckCircle2 size={16} /> Acceso completo
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {MODULES.map((module) => {
                      const permission = userPermissions[module.id] || EMPTY_PERMISSION(module.id);
                      const enabledCount = ['can_view', 'can_create', 'can_edit', 'can_delete'].filter((action) => permission[action as PermissionAction]).length;

                      return (
                        <article key={module.id} className="min-w-0 rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                          <div className="flex min-w-0 flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-base font-black text-slate-950">{module.label}</h4>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${enabledCount === 4 ? 'bg-indigo-100 text-indigo-700' : enabledCount > 0 ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {enabledCount}/4
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-500">{module.description}</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-1.5">
                              <button type="button" onClick={() => setModulePermissionPreset(module.id, 'none')} aria-label={`${module.label} - Sin acceso`} className="min-h-9 rounded-xl border border-slate-200 px-2.5 text-[10px] font-black text-slate-500 hover:bg-slate-50">Ninguno</button>
                              <button type="button" onClick={() => setModulePermissionPreset(module.id, 'view')} aria-label={`${module.label} - Solo lectura`} className="min-h-9 rounded-xl border border-sky-200 bg-sky-50 px-2.5 text-[10px] font-black text-sky-700 hover:bg-sky-100">Lectura</button>
                              <button type="button" onClick={() => setModulePermissionPreset(module.id, 'full')} aria-label={`${module.label} - Acceso completo`} className="min-h-9 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 text-[10px] font-black text-indigo-700 hover:bg-indigo-100">Completo</button>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <PermissionToggle icon={<Eye size={16} />} label="Ver" accessibleLabel={`${module.label} - Ver`} checked={permission.can_view} onChange={(value) => handlePermissionChange(module.id, 'can_view', value)} />
                            <PermissionToggle icon={<PlusCircle size={16} />} label="Crear" accessibleLabel={`${module.label} - Crear`} checked={permission.can_create} onChange={(value) => handlePermissionChange(module.id, 'can_create', value)} />
                            <PermissionToggle icon={<PencilLine size={16} />} label="Editar" accessibleLabel={`${module.label} - Editar`} checked={permission.can_edit} onChange={(value) => handlePermissionChange(module.id, 'can_edit', value)} />
                            <PermissionToggle icon={<Trash2 size={16} />} label="Eliminar" accessibleLabel={`${module.label} - Eliminar`} checked={permission.can_delete} onChange={(value) => handlePermissionChange(module.id, 'can_delete', value)} danger />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="grid shrink-0 grid-cols-1 gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:grid-cols-[1fr_auto] sm:px-6">
              <button
                type="button"
                onClick={closePermissionsModal}
                disabled={isSubmitting}
                aria-label={editingUser.role === 'administrador' ? 'Cerrar panel de permisos' : 'Cerrar panel de permisos sin guardar'}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {editingUser.role === 'administrador' ? 'Cerrar' : 'Cancelar'}
              </button>
              {editingUser.role !== 'administrador' && (
                <button
                  type="button"
                  onClick={() => void handleSavePermissions()}
                  disabled={isSubmitting || isPermissionsLoading || Boolean(permissionsError)}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {isSubmitting ? 'Guardando...' : 'Guardar permisos'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'indigo' | 'emerald' | 'rose' | 'amber';
}) {
  const styles = {
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
  }[tone];

  return (
    <article className={`min-w-0 rounded-3xl border p-4 shadow-sm sm:p-5 ${styles}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 shadow-sm">{icon}</div>
        <p className="break-words text-right text-2xl font-black leading-none sm:text-3xl">{value}</p>
      </div>
      <p className="mt-4 text-[10px] font-black uppercase tracking-[0.16em] opacity-75">{label}</p>
    </article>
  );
}

function PermissionToggle({
  icon,
  label,
  accessibleLabel,
  checked,
  onChange,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  accessibleLabel: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  danger?: boolean;
}) {
  const activeClasses = danger
    ? 'border-rose-300 bg-rose-50 text-rose-700'
    : 'border-indigo-300 bg-indigo-50 text-indigo-700';

  return (
    <label className={`flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-xs font-black transition ${checked ? activeClasses : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <input
        type="checkbox"
        aria-label={accessibleLabel}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${checked ? 'border-current bg-white' : 'border-slate-300 bg-white'}`} aria-hidden="true">
        {checked && <Check size={15} strokeWidth={3} />}
      </span>
    </label>
  );
}
