import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Edit2, Trash2, Shield, Mail, CheckCircle2, XCircle, Loader2, AlertCircle, Key, Save, X } from 'lucide-react';
import { User, UserPermission } from '../types';
import { unwrapResponse, apiFetch } from '../utils/api';

const MODULES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'sales', label: 'Ventas' },
  { id: 'customers', label: 'Clientes' },
  { id: 'products', label: 'Productos' },
  { id: 'suppliers', label: 'Proveedores' },
  { id: 'current_accounts', label: 'Cuentas Corrientes' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'routes', label: 'Rutas' },
  { id: 'settings', label: 'Configuración' },
  { id: 'users', label: 'Usuarios' },
];

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userPermissions, setUserPermissions] = useState<Record<string, UserPermission>>({});
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'empleado' as 'administrador' | 'empleado',
    active: 1
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await apiFetch('/api/users');
      const body = await res.json();
      if (res.ok) {
        const data = unwrapResponse(body);
        setUsers(data);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        password: '', // Don't show password
        role: user.role as any,
        active: (user as any).active
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'empleado',
        active: 1
      });
    }
    setIsModalOpen(true);
    setError('');
  };

  const handleOpenPermissionsModal = async (user: User) => {
    setEditingUser(user);
    setIsPermissionsModalOpen(true);
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/users/${user.id}/permissions`);
      const body = await res.json();
      if (res.ok) {
        const data = unwrapResponse(body);
        setUserPermissions(data);
      }
    } catch (err) {
      console.error('Error fetching permissions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePermissionChange = (moduleId: string, action: keyof Omit<UserPermission, 'module'>, value: boolean) => {
    setUserPermissions(prev => ({
      ...prev,
      [moduleId]: {
        ...(prev[moduleId] || { module: moduleId, can_view: false, can_create: false, can_edit: false, can_delete: false }),
        [action]: value
      }
    }));
  };

  const handleSavePermissions = async () => {
    if (!editingUser) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/users/${editingUser.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: userPermissions })
      });
      
      const body = await res.json();
      unwrapResponse(body);
      
      setIsPermissionsModalOpen(false);
    } catch (err: any) {
      setError(err.message || 'Error al guardar permisos');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
      const method = editingUser ? 'PUT' : 'POST';
      
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(formData)
      });

      const body = await res.json();
      unwrapResponse(body);

      await fetchUsers();
      setIsModalOpen(false);
    } catch (err: any) {
      setError(err.message || 'Error al guardar usuario');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black text-zinc-900 tracking-tight">Gestión de Usuarios</h1>
          <p className="text-zinc-500 text-sm">Administra los accesos y roles del sistema</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/10"
        >
          <UserPlus size={20} />
          Nuevo Usuario
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Usuario</th>
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Rol</th>
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Estado</th>
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-zinc-50/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 font-bold text-sm">
                        {user.avatar || user.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-zinc-900">{user.name}</p>
                        <p className="text-xs text-zinc-400 flex items-center gap-1">
                          <Mail size={12} /> {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      user.role === 'administrador' 
                        ? 'bg-zinc-900 text-white' 
                        : 'bg-zinc-100 text-zinc-600'
                    }`}>
                      <Shield size={10} />
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {(user as any).active ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold uppercase tracking-wider">
                        <CheckCircle2 size={12} /> Activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-400 text-[10px] font-bold uppercase tracking-wider">
                        <XCircle size={12} /> Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenPermissionsModal(user)}
                        className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                        title="Permisos"
                      >
                        <Key size={18} />
                      </button>
                      <button
                        onClick={() => handleOpenModal(user)}
                        className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                        title="Editar"
                      >
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-xl font-black text-zinc-900 tracking-tight">
                {editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-900">
                <XCircle size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                  <AlertCircle size={18} className="shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">Email</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">
                  {editingUser ? 'Contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">Rol</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all text-sm"
                  >
                    <option value="empleado">Empleado</option>
                    <option value="administrador">Administrador</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">Estado</label>
                  <select
                    value={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all text-sm"
                  >
                    <option value={1}>Activo</option>
                    <option value={0}>Inactivo</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-6 py-3 border border-zinc-200 text-zinc-600 rounded-xl font-bold hover:bg-zinc-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-zinc-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/10 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {isPermissionsModalOpen && editingUser && (
        <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-zinc-900 tracking-tight">Permisos de Usuario</h3>
                <p className="text-sm text-zinc-500">{editingUser.name} ({editingUser.email})</p>
              </div>
              <button onClick={() => setIsPermissionsModalOpen(false)} className="text-zinc-400 hover:text-zinc-900">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {editingUser.role === 'administrador' ? (
                <div className="p-8 text-center bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                  <Shield size={48} className="mx-auto mb-4 text-zinc-300" />
                  <p className="font-bold text-zinc-900">Acceso de Administrador</p>
                  <p className="text-sm text-zinc-500">Los administradores tienen todos los permisos habilitados por defecto.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-5 gap-4 px-4 py-2 bg-zinc-50 rounded-lg text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                    <div className="col-span-1">Módulo</div>
                    <div className="text-center">Ver</div>
                    <div className="text-center">Crear</div>
                    <div className="text-center">Editar</div>
                    <div className="text-center">Eliminar</div>
                  </div>
                  {MODULES.map((module) => (
                    <div key={module.id} className="grid grid-cols-5 gap-4 px-4 py-3 items-center border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors">
                      <div className="col-span-1 font-bold text-zinc-900 text-sm">{module.label}</div>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={!!userPermissions[module.id]?.can_view}
                          onChange={(e) => handlePermissionChange(module.id, 'can_view', e.target.checked)}
                          className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                      </div>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={!!userPermissions[module.id]?.can_create}
                          onChange={(e) => handlePermissionChange(module.id, 'can_create', e.target.checked)}
                          className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                      </div>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={!!userPermissions[module.id]?.can_edit}
                          onChange={(e) => handlePermissionChange(module.id, 'can_edit', e.target.checked)}
                          className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                      </div>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={!!userPermissions[module.id]?.can_delete}
                          onChange={(e) => handlePermissionChange(module.id, 'can_delete', e.target.checked)}
                          className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-3">
              <button
                onClick={() => setIsPermissionsModalOpen(false)}
                className="px-6 py-2.5 text-zinc-600 font-bold hover:text-zinc-900 transition-all"
              >
                Cancelar
              </button>
              {editingUser.role !== 'administrador' && (
                <button
                  onClick={handleSavePermissions}
                  disabled={isSubmitting}
                  className="bg-zinc-900 text-white px-8 py-2.5 rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/10 flex items-center gap-2"
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  Guardar Permisos
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
