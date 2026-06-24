import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Store, 
  CreditCard, 
  Layers, 
  Tags, 
  Sliders, 
  Hash,
  Save,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  ShieldAlert,
  Download,
  Upload
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

type Section = 'negocio' | 'pagos' | 'categorias' | 'familias' | 'parametros' | 'numeraciones';

interface ConfigItem {
  id: number;
  name: string;
  description?: string;
  tipo?: string;
  activo?: number;
  estado?: string;
  category_id?: number | null;
  category_name?: string;
}

export default function ConfigModule() {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<Section>('negocio');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetAdminPassword, setResetAdminPassword] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);

  // Form states
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [paymentMethods, setPaymentMethods] = useState<ConfigItem[]>([]);
  const [categories, setCategories] = useState<ConfigItem[]>([]);
  const [families, setFamilies] = useState<ConfigItem[]>([]);
  
  const [newItemName, setNewItemName] = useState('');
  const [editingItem, setEditingItem] = useState<ConfigItem | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    name: '',
    tipo: 'Efectivo',
    activo: 1
  });
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    estado: 'activo'
  });
  const [familyForm, setFamilyForm] = useState({
    name: '',
    category_id: null as number | null,
    estado: 'activo'
  });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'negocio' || activeTab === 'parametros' || activeTab === 'numeraciones') {
        const res = await apiFetch('/api/config/settings');
        const body = await res.json();
        const data = unwrapResponse(body);
        setSettings(data);
      } else if (activeTab === 'pagos') {
        const res = await apiFetch('/api/config/payment-methods');
        const body = await res.json();
        const data = unwrapResponse(body);
        setPaymentMethods(data);
      } else if (activeTab === 'categorias') {
        const res = await apiFetch('/api/config/product-categories');
        const body = await res.json();
        const data = unwrapResponse(body);
        setCategories(data);
      } else if (activeTab === 'familias') {
        const res = await apiFetch('/api/config/product-families');
        const body = await res.json();
        const data = unwrapResponse(body);
        setFamilies(data);
      }
    } catch (error) {
      console.error("Error fetching config:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch('/api/config/settings', {
        method: 'POST',
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        showStatus('Configuración guardada correctamente', 'success');
      } else {
        showStatus('Error al guardar la configuración', 'error');
      }
    } catch (error) {
      showStatus('Error de conexión', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.name.trim()) return;
    setLoading(true);
    try {
      const url = editingItem 
        ? `/api/config/payment-methods/${editingItem.id}` 
        : '/api/config/payment-methods';
      const method = editingItem ? 'PUT' : 'POST';
      
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(paymentForm)
      });
      if (res.ok) {
        setPaymentForm({ name: '', tipo: 'Efectivo', activo: 1 });
        setEditingItem(null);
        fetchData();
        showStatus(editingItem ? 'Forma de pago actualizada' : 'Forma de pago agregada', 'success');
      }
    } catch (error) {
      showStatus('Error al guardar forma de pago', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) return;
    setLoading(true);
    try {
      const url = editingItem 
        ? `/api/config/product-categories/${editingItem.id}` 
        : '/api/config/product-categories';
      const method = editingItem ? 'PUT' : 'POST';
      
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(categoryForm)
      });
      if (res.ok) {
        setCategoryForm({ name: '', description: '', estado: 'activo' });
        setEditingItem(null);
        fetchData();
        showStatus(editingItem ? 'Categoría actualizada' : 'Categoría agregada', 'success');
      }
    } catch (error) {
      showStatus('Error al guardar categoría', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!familyForm.name.trim()) return;
    setLoading(true);
    try {
      const url = editingItem 
        ? `/api/config/product-families/${editingItem.id}` 
        : '/api/config/product-families';
      const method = editingItem ? 'PUT' : 'POST';
      
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(familyForm)
      });
      if (res.ok) {
        setFamilyForm({ name: '', category_id: null, estado: 'activo' });
        setEditingItem(null);
        fetchData();
        showStatus(editingItem ? 'Familia actualizada' : 'Familia agregada', 'success');
      }
    } catch (error) {
      showStatus('Error al guardar familia', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (endpoint: string) => {
    if (!newItemName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/config/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ name: newItemName })
      });
      if (res.ok) {
        setNewItemName('');
        fetchData();
        showStatus('Item agregado correctamente', 'success');
      }
    } catch (error) {
      showStatus('Error al agregar item', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (endpoint: string, id: number) => {
    if (!confirm('¿Estás seguro de eliminar este item?')) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/config/${endpoint}/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchData();
        showStatus('Item eliminado correctamente', 'success');
      }
    } catch (error) {
      showStatus('Error al eliminar item', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showStatus = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  
  const downloadJsonFile = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  const buildBackupFileName = () => {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().slice(0, 5).replace(':', '-');

    return `edugestion_backup_${date}_${time}.json`;
  };

  const handleDownloadBackup = async () => {
    setBackupLoading(true);

    try {
      const res = await apiFetch('/api/config/backup-data');
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body?.message || 'No se pudo generar la copia de seguridad');
      }

      const backup = unwrapResponse(body);
      downloadJsonFile(backup, buildBackupFileName());
      showStatus('Copia de seguridad descargada correctamente', 'success');
    } catch (error: any) {
      showStatus(error?.message || 'Error al descargar copia de seguridad', 'error');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreBackupFile = async (file: File | null) => {
    if (!file) return;

    const adminPassword = window.prompt('Ingrese la contraseña del administrador para restaurar la copia');

    if (!adminPassword) {
      showStatus('Restauración cancelada', 'error');
      return;
    }

    const confirmed = window.confirm(
      'Esta acción reemplazará los datos actuales por los datos del archivo JSON. ¿Desea continuar?'
    );

    if (!confirmed) {
      showStatus('Restauración cancelada', 'error');
      return;
    }

    setRestoreLoading(true);

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      const res = await apiFetch('/api/config/restore-app-data', {
        method: 'POST',
        body: JSON.stringify({
          adminPassword,
          confirmation: 'RESTAURAR',
          backup
        })
      });

      const body = await res.json();

      if (!res.ok) {
        throw new Error(body?.message || 'No se pudo restaurar la copia de seguridad');
      }

      await fetchData();
      showStatus('Copia de seguridad restaurada correctamente', 'success');
    } catch (error: any) {
      showStatus(error?.message || 'Error al restaurar copia de seguridad', 'error');
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleResetAppData = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!resetAdminPassword.trim()) {
      showStatus('Ingrese la contraseña del administrador', 'error');
      return;
    }

    if (resetConfirmation.trim() !== 'REESTABLECER') {
      showStatus('Debe escribir REESTABLECER para confirmar', 'error');
      return;
    }

    setResetLoading(true);

    try {
      const res = await apiFetch('/api/config/reset-app-data', {
        method: 'POST',
        body: JSON.stringify({
          adminPassword: resetAdminPassword,
          confirmation: resetConfirmation.trim()
        })
      });

      const body = await res.json();

      if (!res.ok) {
        throw new Error(body?.message || 'No se pudo restablecer la app');
      }

      setShowResetModal(false);
      setResetAdminPassword('');
      setResetConfirmation('');
      setSettings({});
      setPaymentMethods([]);
      setCategories([]);
      setFamilies([]);
      await fetchData();
      showStatus('Datos restablecidos correctamente', 'success');
    } catch (error: any) {
      showStatus(error?.message || 'Error al restablecer datos', 'error');
    } finally {
      setResetLoading(false);
    }
  };

const renderTabs = () => {
    const tabs = [
      { id: 'negocio', label: 'Datos del Negocio', icon: Store },
      { id: 'pagos', label: 'Formas de Pago', icon: CreditCard },
      { id: 'categorias', label: 'Categorías de Productos', icon: Tags },
      { id: 'familias', label: 'Familias de Productos', icon: Layers },
      { id: 'parametros', label: 'Parámetros Comerciales', icon: Sliders },
      { id: 'numeraciones', label: 'Numeraciones del Sistema', icon: Hash },
    ];

    return (
      <div className="flex lg:flex-col w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-zinc-200 bg-zinc-50/50 p-3 sm:p-4 gap-2 lg:gap-1 overflow-x-auto lg:overflow-visible shrink-0 no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Section)}
            className={`flex items-center gap-2 lg:gap-3 px-3 lg:px-4 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-zinc-900 text-white shadow-lg shadow-zinc-200'
                : 'text-zinc-500 hover:bg-zinc-200/50 hover:text-zinc-900'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>
    );
  };

  const renderContent = () => {
    if (loading && Object.keys(settings).length === 0 && paymentMethods.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900"></div>
        </div>
      );
    }

    switch (activeTab) {
      case 'negocio':
        return (
          <form onSubmit={handleSaveSettings} className="space-y-6 max-w-2xl w-full">
            <div className="grid grid-cols-1 gap-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8 p-4 sm:p-6 bg-zinc-50 rounded-3xl sm:rounded-[32px] border border-zinc-200">
                <div className="relative group">
                  <div className="w-24 h-24 sm:w-32 sm:h-32 bg-white rounded-2xl border-2 border-dashed border-zinc-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-zinc-400">
                    {settings.business_logo ? (
                      <img src={settings.business_logo} alt="Logo" className="w-full h-full object-contain" />
                    ) : (
                      <Store size={32} className="text-zinc-300" />
                    )}
                  </div>
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setSettings({...settings, business_logo: reader.result as string});
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  {settings.business_logo && (
                    <button 
                      type="button"
                      onClick={() => setSettings({...settings, business_logo: ''})}
                      className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-black text-zinc-900 uppercase tracking-widest text-xs mb-1">Logo del Negocio</h4>
                  <p className="text-zinc-500 text-xs font-medium">Sube una imagen para tus comprobantes y reportes (PNG/JPG)</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Nombre del Negocio</label>
                  <input 
                    type="text" 
                    value={settings.business_name || ''} 
                    onChange={(e) => setSettings({...settings, business_name: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    placeholder="Ej: Mi Negocio"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Razón Social</label>
                  <input 
                    type="text" 
                    value={settings.business_razon_social || ''} 
                    onChange={(e) => setSettings({...settings, business_razon_social: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    placeholder="Ej: Mi Negocio S.A."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">CUIT</label>
                  <input 
                    type="text" 
                    value={settings.business_cuit || ''} 
                    onChange={(e) => setSettings({...settings, business_cuit: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    placeholder="00-00000000-0"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Teléfono</label>
                  <input 
                    type="text" 
                    value={settings.business_phone || ''} 
                    onChange={(e) => setSettings({...settings, business_phone: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Dirección</label>
                  <input 
                    type="text" 
                    value={settings.business_address || ''} 
                    onChange={(e) => setSettings({...settings, business_address: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Localidad</label>
                  <input 
                    type="text" 
                    value={settings.business_localidad || ''} 
                    onChange={(e) => setSettings({...settings, business_localidad: e.target.value})}
                    className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Email de Contacto</label>
                <input 
                  type="email" 
                  value={settings.business_email || ''} 
                  onChange={(e) => setSettings({...settings, business_email: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
            </div>
            {hasPermission('settings', 'edit') && (
              <button 
                type="submit" 
                disabled={loading}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-zinc-900 text-white px-6 sm:px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-800 transition-all disabled:opacity-50"
              >
                <Save size={16} />
                Guardar Cambios
              </button>
            )}

            {hasPermission('settings', 'delete') && (
              <div className="mt-8 p-4 sm:p-6 rounded-3xl border border-red-200 bg-red-50/60 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                    <ShieldAlert size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-red-700 uppercase tracking-widest">Zona de peligro</h3>
                    <p className="text-xs text-red-600/80 font-bold mt-1 leading-relaxed">
                      Restablece todos los datos operativos de la app para empezar pruebas desde cero.
                      Se conservan usuarios, permisos, configuración base y formas de pago.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    disabled={backupLoading}
                    className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-800 transition-all disabled:opacity-50"
                  >
                    <Download size={16} />
                    {backupLoading ? 'Descargando...' : 'Descargar copia JSON'}
                  </button>

                  <label className="w-full flex items-center justify-center gap-2 bg-white text-zinc-900 px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-100 transition-all border border-zinc-200 cursor-pointer">
                    <Upload size={16} />
                    {restoreLoading ? 'Restaurando...' : 'Restaurar copia JSON'}
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      disabled={restoreLoading}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.currentTarget.value = '';
                        handleRestoreBackupFile(file);
                      }}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-red-600 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-red-700 transition-all"
                >
                  <RotateCcw size={16} />
                  Restablecer datos de la app
                </button>
              </div>
            )}
          </form>
        );

      case 'pagos':
        return (
          <div className="space-y-6 sm:space-y-8 max-w-3xl w-full">
            <form onSubmit={handleSavePaymentMethod} className="bg-white p-4 sm:p-6 lg:p-8 rounded-3xl sm:rounded-[32px] border border-zinc-200 shadow-sm space-y-5 sm:space-y-6">
              <h3 className="text-base sm:text-lg font-black text-zinc-900 uppercase tracking-widest">
                {editingItem ? 'Editar Forma de Pago' : 'Nueva Forma de Pago'}
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Nombre</label>
                  <input 
                    type="text" 
                    value={paymentForm.name}
                    onChange={(e) => setPaymentForm({ ...paymentForm, name: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    placeholder="Ej: Tarjeta de Crédito"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Tipo</label>
                  <select 
                    value={paymentForm.tipo}
                    onChange={(e) => setPaymentForm({ ...paymentForm, tipo: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                  >
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                    <option value="Digital">Digital (Billeteras)</option>
                    <option value="Crédito">Crédito / Cuenta Corriente</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="pm-activo"
                    checked={paymentForm.activo === 1}
                    onChange={(e) => setPaymentForm({ ...paymentForm, activo: e.target.checked ? 1 : 0 })}
                    className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                  />
                  <label htmlFor="pm-activo" className="text-sm font-bold text-zinc-700 leading-snug">Activo</label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  {editingItem && (
                    <button 
                      type="button"
                      onClick={() => {
                        setEditingItem(null);
                        setPaymentForm({ name: '', tipo: 'Efectivo', activo: 1 });
                      }}
                      className="w-full sm:w-auto px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs text-zinc-500 hover:bg-zinc-100 transition-all"
                    >
                      Cancelar
                    </button>
                  )}
                  {((editingItem && hasPermission('settings', 'edit')) || (!editingItem && hasPermission('settings', 'create'))) && (
                    <button 
                      type="submit"
                      disabled={loading || !paymentForm.name.trim()}
                      className="w-full sm:w-auto bg-zinc-900 text-white px-6 sm:px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-800 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {editingItem ? <Save size={16} /> : <Plus size={16} />}
                      {editingItem ? 'Actualizar' : 'Agregar'}
                    </button>
                  )}
                </div>
              </div>
            </form>

            <div className="grid grid-cols-1 gap-3">
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest px-2">Formas de Pago Registradas</h4>
              {paymentMethods.map((item) => (
                <div key={item.id} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white px-4 sm:px-6 py-4 rounded-2xl border ${item.activo ? 'border-zinc-100' : 'border-red-100 bg-red-50/30'} hover:border-zinc-200 transition-all group`}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-2 h-2 rounded-full ${item.activo ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    <div>
                      <span className={`font-bold break-words ${item.activo ? 'text-zinc-900' : 'text-zinc-400 line-through'}`}>{item.name}</span>
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{item.tipo}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all self-end sm:self-auto">
                    {hasPermission('settings', 'edit') && (
                      <button 
                        onClick={() => {
                          setEditingItem(item);
                          setPaymentForm({
                            name: item.name,
                            tipo: item.tipo || 'Efectivo',
                            activo: item.activo !== undefined ? item.activo : 1
                          });
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                        title="Editar"
                      >
                        <Sliders size={16} />
                      </button>
                    )}
                    {hasPermission('settings', 'delete') && (
                      <button 
                        onClick={() => handleDeleteItem('payment-methods', item.id)}
                        className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {paymentMethods.length === 0 && !loading && (
                <p className="text-center py-12 text-zinc-400 font-medium italic">No hay formas de pago registradas</p>
              )}
            </div>
          </div>
        );

      case 'categorias':
        return (
          <div className="space-y-6 sm:space-y-8 max-w-3xl w-full">
            <form onSubmit={handleSaveCategory} className="bg-white p-4 sm:p-6 lg:p-8 rounded-3xl sm:rounded-[32px] border border-zinc-200 shadow-sm space-y-5 sm:space-y-6">
              <h3 className="text-base sm:text-lg font-black text-zinc-900 uppercase tracking-widest">
                {editingItem ? 'Editar Categoría' : 'Nueva Categoría'}
              </h3>
              
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Nombre de Categoría</label>
                  <input 
                    type="text" 
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    placeholder="Ej: Lácteos, Bebidas, etc."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Descripción (Opcional)</label>
                  <textarea 
                    value={categoryForm.description}
                    onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all resize-none"
                    rows={3}
                    placeholder="Breve descripción de la categoría..."
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="cat-activo"
                    checked={categoryForm.estado === 'activo'}
                    onChange={(e) => setCategoryForm({ ...categoryForm, estado: e.target.checked ? 'activo' : 'inactivo' })}
                    className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                  />
                  <label htmlFor="cat-activo" className="text-sm font-bold text-zinc-700 leading-snug">Activa</label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  {editingItem && (
                    <button 
                      type="button"
                      onClick={() => {
                        setEditingItem(null);
                        setCategoryForm({ name: '', description: '', estado: 'activo' });
                      }}
                      className="w-full sm:w-auto px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs text-zinc-500 hover:bg-zinc-100 transition-all"
                    >
                      Cancelar
                    </button>
                  )}
                  {((editingItem && hasPermission('settings', 'edit')) || (!editingItem && hasPermission('settings', 'create'))) && (
                    <button 
                      type="submit"
                      disabled={loading || !categoryForm.name.trim()}
                      className="w-full sm:w-auto bg-zinc-900 text-white px-6 sm:px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-800 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {editingItem ? <Save size={16} /> : <Plus size={16} />}
                      {editingItem ? 'Actualizar' : 'Agregar'}
                    </button>
                  )}
                </div>
              </div>
            </form>

            <div className="grid grid-cols-1 gap-3">
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest px-2">Categorías Registradas</h4>
              {categories.map((item) => (
                <div key={item.id} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white px-4 sm:px-6 py-4 rounded-2xl border ${item.estado === 'activo' ? 'border-zinc-100' : 'border-red-100 bg-red-50/30'} hover:border-zinc-200 transition-all group`}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-2 h-2 rounded-full ${item.estado === 'activo' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    <div>
                      <span className={`font-bold break-words ${item.estado === 'activo' ? 'text-zinc-900' : 'text-zinc-400 line-through'}`}>{item.name}</span>
                      {item.description && (
                        <p className="text-[10px] font-medium text-zinc-400 line-clamp-2 sm:line-clamp-1">{item.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all self-end sm:self-auto">
                    {hasPermission('settings', 'edit') && (
                      <button 
                        onClick={() => {
                          setEditingItem(item);
                          setCategoryForm({
                            name: item.name,
                            description: item.description || '',
                            estado: item.estado || 'activo'
                          });
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                        title="Editar"
                      >
                        <Sliders size={16} />
                      </button>
                    )}
                    {hasPermission('settings', 'delete') && (
                      <button 
                        onClick={() => handleDeleteItem('product-categories', item.id)}
                        className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {categories.length === 0 && !loading && (
                <p className="text-center py-12 text-zinc-400 font-medium italic">No hay categorías registradas</p>
              )}
            </div>
          </div>
        );

      case 'familias':
        return (
          <div className="space-y-6 sm:space-y-8 max-w-3xl w-full">
            <form onSubmit={handleSaveFamily} className="bg-white p-4 sm:p-6 lg:p-8 rounded-3xl sm:rounded-[32px] border border-zinc-200 shadow-sm space-y-5 sm:space-y-6">
              <h3 className="text-base sm:text-lg font-black text-zinc-900 uppercase tracking-widest">
                {editingItem ? 'Editar Familia' : 'Nueva Familia'}
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Nombre de Familia</label>
                  <input 
                    type="text" 
                    value={familyForm.name}
                    onChange={(e) => setFamilyForm({ ...familyForm, name: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    placeholder="Ej: Almacén, Bebidas, etc."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Categoría Asociada</label>
                  <select 
                    value={familyForm.category_id || ''}
                    onChange={(e) => setFamilyForm({ ...familyForm, category_id: e.target.value ? parseInt(e.target.value) : null })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                  >
                    <option value="">Seleccionar categoría...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="fam-activo"
                    checked={familyForm.estado === 'activo'}
                    onChange={(e) => setFamilyForm({ ...familyForm, estado: e.target.checked ? 'activo' : 'inactivo' })}
                    className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                  />
                  <label htmlFor="fam-activo" className="text-sm font-bold text-zinc-700 leading-snug">Activa</label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  {editingItem && (
                    <button 
                      type="button"
                      onClick={() => {
                        setEditingItem(null);
                        setFamilyForm({ name: '', category_id: null, estado: 'activo' });
                      }}
                      className="w-full sm:w-auto px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs text-zinc-500 hover:bg-zinc-100 transition-all"
                    >
                      Cancelar
                    </button>
                  )}
                  {((editingItem && hasPermission('settings', 'edit')) || (!editingItem && hasPermission('settings', 'create'))) && (
                    <button 
                      type="submit"
                      disabled={loading || !familyForm.name.trim()}
                      className="w-full sm:w-auto bg-zinc-900 text-white px-6 sm:px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-800 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {editingItem ? <Save size={16} /> : <Plus size={16} />}
                      {editingItem ? 'Actualizar' : 'Agregar'}
                    </button>
                  )}
                </div>
              </div>
            </form>

            <div className="grid grid-cols-1 gap-3">
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest px-2">Familias Registradas</h4>
              {families.map((item) => (
                <div key={item.id} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white px-4 sm:px-6 py-4 rounded-2xl border ${item.estado === 'activo' ? 'border-zinc-100' : 'border-red-100 bg-red-50/30'} hover:border-zinc-200 transition-all group`}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-2 h-2 rounded-full ${item.estado === 'activo' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    <div>
                      <span className={`font-bold break-words ${item.estado === 'activo' ? 'text-zinc-900' : 'text-zinc-400 line-through'}`}>{item.name}</span>
                      {item.category_name && (
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{item.category_name}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all self-end sm:self-auto">
                    {hasPermission('settings', 'edit') && (
                      <button 
                        onClick={() => {
                          setEditingItem(item);
                          setFamilyForm({
                            name: item.name,
                            category_id: item.category_id || null,
                            estado: item.estado || 'activo'
                          });
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                        title="Editar"
                      >
                        <Sliders size={16} />
                      </button>
                    )}
                    {hasPermission('settings', 'delete') && (
                      <button 
                        onClick={() => handleDeleteItem('product-families', item.id)}
                        className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {families.length === 0 && !loading && (
                <p className="text-center py-12 text-zinc-400 font-medium italic">No hay familias registradas</p>
              )}
            </div>
          </div>
        );

      case 'parametros':
        return (
          <form onSubmit={handleSaveSettings} className="space-y-6 max-w-2xl w-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Moneda del Sistema</label>
                <select 
                  value={settings.system_currency || 'ARS'} 
                  onChange={(e) => setSettings({...settings, system_currency: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                >
                  <option value="ARS">Peso Argentino ($)</option>
                  <option value="USD">Dólar Estadounidense (USD)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">IVA Predeterminado (%)</label>
                <input 
                  type="number" 
                  value={settings.default_iva || '21'} 
                  onChange={(e) => setSettings({...settings, default_iva: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Margen de Ganancia Sugerido (%)</label>
                <input 
                  type="number" 
                  value={settings.default_markup || '30'} 
                  onChange={(e) => setSettings({...settings, default_markup: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Días Alerta Deuda Cliente</label>
                <input 
                  type="number" 
                  value={settings.customer_debt_alert_days || '7'} 
                  onChange={(e) => setSettings({...settings, customer_debt_alert_days: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Límite Crédito Default</label>
                <input 
                  type="number" 
                  value={settings.default_credit_limit || '0'} 
                  onChange={(e) => setSettings({...settings, default_credit_limit: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Método Cálculo Costo</label>
                <select 
                  value={settings.cost_calculation_method || 'PEPS'} 
                  onChange={(e) => setSettings({...settings, cost_calculation_method: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                >
                  <option value="PEPS">PEPS (Primero Entrado, Primero Salido)</option>
                  <option value="PPP">PPP (Precio Promedio Ponderado)</option>
                  <option value="UEPS">UEPS (Último Entrado, Primero Salido)</option>
                </select>
              </div>
            </div>
            <div className="flex items-start sm:items-center gap-3 p-4 bg-zinc-100 rounded-2xl border border-zinc-200">
              <input 
                type="checkbox" 
                id="allow-negative-stock"
                checked={settings.allow_negative_stock === 'true'} 
                onChange={(e) => setSettings({...settings, allow_negative_stock: e.target.checked ? 'true' : 'false'})}
                className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
              />
              <label htmlFor="allow-negative-stock" className="text-sm font-bold text-zinc-700 leading-snug">Permitir Ventas sin Stock (Stock Negativo)</label>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-zinc-900 text-white px-6 sm:px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-800 transition-all disabled:opacity-50"
            >
              <Save size={16} />
              Guardar Parámetros Comerciales
            </button>
          </form>
        );

      case 'numeraciones':
        return (
          <form onSubmit={handleSaveSettings} className="space-y-6 max-w-2xl w-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Próximo Número de Venta</label>
                <input 
                  type="number" 
                  value={settings.next_sale_number || '1'} 
                  onChange={(e) => setSettings({...settings, next_sale_number: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Próximo Número de Pedido</label>
                <input 
                  type="number" 
                  value={settings.next_order_number || '1'} 
                  onChange={(e) => setSettings({...settings, next_order_number: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Próximo Número de Pago/Recibo</label>
                <input 
                  type="number" 
                  value={settings.next_payment_number || '1'} 
                  onChange={(e) => setSettings({...settings, next_payment_number: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">Prefijo de Facturación</label>
                <input 
                  type="text" 
                  value={settings.billing_prefix || '0001'} 
                  onChange={(e) => setSettings({...settings, billing_prefix: e.target.value})}
                  className="w-full bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                />
              </div>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-zinc-900 text-white px-6 sm:px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-zinc-800 transition-all disabled:opacity-50"
            >
              <Save size={16} />
              Guardar Numeraciones
            </button>
          </form>
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 p-4 sm:p-6 lg:p-8 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight flex items-center gap-3">
              <Settings className="text-zinc-400" size={32} />
              CONFIGURACIÓN
            </h2>
            <p className="text-zinc-500 text-sm font-medium">Gestiona los parámetros y datos maestros del sistema</p>
          </div>
          
          {message && (
            <div className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold animate-in fade-in slide-in-from-top-2 w-full sm:w-auto ${
              message.type === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'
            }`}>
              {message.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {message.text}
            </div>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {renderTabs()}
        
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-12 bg-white custom-scrollbar">
          {renderContent()}
        </main>
      </div>

      {showResetModal && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6">
          <form
            onSubmit={handleResetAppData}
            className="bg-white w-full max-w-lg rounded-3xl sm:rounded-[40px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="p-5 sm:p-8 bg-red-600 text-white flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                <ShieldAlert size={26} />
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl font-black tracking-tight">Restablecer datos</h3>
                <p className="text-xs sm:text-sm text-white/80 font-bold mt-1">
                  Esta acción borra datos operativos y no se puede deshacer.
                </p>
              </div>
            </div>

            <div className="p-5 sm:p-8 space-y-5">
              <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-700 text-xs font-bold leading-relaxed">
                Se eliminarán productos, clientes, ventas, compras, finanzas, rutas, checklist,
                reportes operativos, pedidos a proveedor, proveedores, categorías y familias.
                Se conservarán usuarios, permisos, datos del negocio y formas de pago.
              </div>

              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-amber-800 text-xs font-bold leading-relaxed space-y-3">
                <p>
                  Antes de restablecer, se recomienda descargar una copia de seguridad JSON para poder volver a este punto.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  disabled={backupLoading}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-amber-600 text-white px-5 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-amber-700 transition-all disabled:opacity-50"
                >
                  <Download size={16} />
                  {backupLoading ? 'Descargando...' : 'Sí, descargar copia antes'}
                </button>
              </div>



              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">
                  Contraseña del administrador
                </label>
                <input
                  type="password"
                  value={resetAdminPassword}
                  onChange={(e) => setResetAdminPassword(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none transition-all"
                  placeholder="Ingrese la contraseña"
                  autoComplete="current-password"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-400">
                  Confirmación
                </label>
                <input
                  type="text"
                  value={resetConfirmation}
                  onChange={(e) => setResetConfirmation(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none transition-all"
                  placeholder="Escriba REESTABLECER"
                />
              </div>
            </div>

            <div className="p-5 sm:p-8 bg-zinc-50 border-t border-zinc-100 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(false);
                  setResetAdminPassword('');
                  setResetConfirmation('');
                }}
                disabled={resetLoading}
                className="w-full sm:w-auto px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs text-zinc-600 hover:bg-zinc-200 transition-all disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={resetLoading || !resetAdminPassword.trim() || resetConfirmation.trim() !== 'REESTABLECER'}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-red-600 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-red-700 transition-all disabled:opacity-50"
              >
                <RotateCcw size={16} />
                {resetLoading ? 'Restableciendo...' : 'Confirmar reset'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
