import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  Database,
  Download,
  Edit3,
  FileJson,
  Gauge,
  Hash,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
  Store,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, unwrapResponse } from '../utils/api';

type Section = 'negocio' | 'pagos' | 'categorias' | 'familias' | 'parametros' | 'numeraciones';

type Message = { type: 'success' | 'error'; text: string };

interface ConfigItem {
  id: number;
  name: string;
  description?: string;
  tipo?: string;
  activo?: number;
  estado?: string;
  category_id?: number | null;
  category_name?: string;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
  deactivation_reason?: string | null;
  content_version?: number;
  content_changed_at?: string | null;
  content_changed_by?: string | null;
  content_change_reason?: string | null;
}

interface LifecycleTarget {
  endpoint: string;
  id: number;
  name: string;
  label: string;
  action: 'deactivate' | 'reactivate';
}

const tabs: Array<{
  id: Section;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    id: 'negocio',
    label: 'Datos del negocio',
    shortLabel: 'Negocio',
    description: 'Identidad, contacto y seguridad de datos',
    icon: Store,
  },
  {
    id: 'pagos',
    label: 'Formas de pago',
    shortLabel: 'Pagos',
    description: 'Medios disponibles para ventas y cobros',
    icon: CreditCard,
  },
  {
    id: 'categorias',
    label: 'Categorías de productos',
    shortLabel: 'Categorías',
    description: 'Clasificación general del catálogo',
    icon: Tags,
  },
  {
    id: 'familias',
    label: 'Familias de productos',
    shortLabel: 'Familias',
    description: 'Agrupaciones usadas por productos y reportes',
    icon: Layers,
  },
  {
    id: 'parametros',
    label: 'Parámetros comerciales',
    shortLabel: 'Parámetros',
    description: 'Moneda, impuestos, crédito y costos',
    icon: Gauge,
  },
  {
    id: 'numeraciones',
    label: 'Numeraciones del sistema',
    shortLabel: 'Numeraciones',
    description: 'Próximos números de comprobantes',
    icon: Hash,
  },
];

const inputClass =
  'w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';
const labelClass = 'block text-[11px] font-black uppercase tracking-[0.16em] text-slate-500';
const primaryButtonClass =
  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto';
const secondaryButtonClass =
  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto';

export default function ConfigModule() {
  const { hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<Section>('negocio');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [loadError, setLoadError] = useState('');

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [settingsContentVersion, setSettingsContentVersion] = useState(0);
  const [settingsChangeReason, setSettingsChangeReason] = useState('');
  const [settingsChangedAt, setSettingsChangedAt] = useState('');
  const [settingsChangedBy, setSettingsChangedBy] = useState('');
  const [settingsLastReason, setSettingsLastReason] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<ConfigItem[]>([]);
  const [categories, setCategories] = useState<ConfigItem[]>([]);
  const [families, setFamilies] = useState<ConfigItem[]>([]);

  const [editingItem, setEditingItem] = useState<ConfigItem | null>(null);
  const [paymentForm, setPaymentForm] = useState({ name: '', tipo: 'Efectivo' });
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [familyForm, setFamilyForm] = useState({
    name: '',
    category_id: null as number | null,
  });
  const [contentChangeReason, setContentChangeReason] = useState('');

  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  const [backupLoading, setBackupLoading] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupAdminPassword, setBackupAdminPassword] = useState('');
  const [backupReason, setBackupReason] = useState('');
  const [backupConfirmation, setBackupConfirmation] = useState('');

  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreAdminPassword, setRestoreAdminPassword] = useState('');
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreConfirmation, setRestoreConfirmation] = useState('');

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetAdminPassword, setResetAdminPassword] = useState('');
  const [resetReason, setResetReason] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const currentTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTab) || tabs[0],
    [activeTab],
  );

  const showStatus = (text: string, type: Message['type']) => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 4000);
  };

  const resetEditor = () => {
    setEditingItem(null);
    setPaymentForm({ name: '', tipo: 'Efectivo' });
    setCategoryForm({ name: '', description: '' });
    setFamilyForm({ name: '', category_id: null });
    setContentChangeReason('');
    setSettingsChangeReason('');
  };

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError('');

    try {
      if (activeTab === 'negocio' || activeTab === 'parametros' || activeTab === 'numeraciones') {
        const response = await apiFetch('/api/config/settings');
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message || 'No se pudo cargar la configuración');
        const loadedSettings = unwrapResponse(body) || {};
        setSettingsContentVersion(Number(loadedSettings.settings_content_version || 0));
        setSettingsChangedAt(String(loadedSettings.settings_content_changed_at || ''));
        setSettingsChangedBy(String(loadedSettings.settings_content_changed_by || ''));
        setSettingsLastReason(String(loadedSettings.settings_content_change_reason || ''));
        const {
          settings_content_version: _settingsContentVersion,
          settings_content_changed_at: _settingsContentChangedAt,
          settings_content_changed_by: _settingsContentChangedBy,
          settings_content_change_reason: _settingsContentChangeReason,
          ...editableSettings
        } = loadedSettings;
        setSettings(editableSettings);
      } else if (activeTab === 'pagos') {
        const response = await apiFetch('/api/config/payment-methods');
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message || 'No se pudieron cargar las formas de pago');
        setPaymentMethods(unwrapResponse(body) || []);
      } else if (activeTab === 'categorias') {
        const response = await apiFetch('/api/config/product-categories');
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message || 'No se pudieron cargar las categorías');
        setCategories(unwrapResponse(body) || []);
      } else if (activeTab === 'familias') {
        const [familiesResponse, categoriesResponse] = await Promise.all([
          apiFetch('/api/config/product-families'),
          apiFetch('/api/config/product-categories'),
        ]);
        const [familiesBody, categoriesBody] = await Promise.all([
          familiesResponse.json(),
          categoriesResponse.json(),
        ]);
        if (!familiesResponse.ok) {
          throw new Error(familiesBody?.message || 'No se pudieron cargar las familias');
        }
        if (!categoriesResponse.ok) {
          throw new Error(categoriesBody?.message || 'No se pudieron cargar las categorías');
        }
        setFamilies(unwrapResponse(familiesBody) || []);
        setCategories(unwrapResponse(categoriesBody) || []);
      }
    } catch (error: any) {
      const text = error?.message || 'No se pudieron cargar los datos';
      setLoadError(text);
      showStatus(text, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    resetEditor();
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    const reason = settingsChangeReason.trim();
    if (reason.length < 3) {
      showStatus('El motivo debe tener al menos 3 caracteres', 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await apiFetch('/api/config/settings', {
        method: 'POST',
        body: JSON.stringify({
          settings,
          motivo: reason,
          expectedContentVersion: settingsContentVersion,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || 'No se pudo guardar la configuración');
      showStatus('Configuración general actualizada con trazabilidad', 'success');
      setSettingsChangeReason('');
      await fetchData(true);
    } catch (error: any) {
      showStatus(error?.message || 'Error al guardar la configuración', 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePaymentMethod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentForm.name.trim()) return;
    if (editingItem && contentChangeReason.trim().length < 3) {
      showStatus('El motivo debe tener al menos 3 caracteres', 'error');
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch(
        editingItem ? `/api/config/payment-methods/${editingItem.id}` : '/api/config/payment-methods',
        {
          method: editingItem ? 'PUT' : 'POST',
          body: JSON.stringify(
            editingItem
              ? {
                  ...paymentForm,
                  motivo: contentChangeReason,
                  expectedContentVersion: Number(editingItem.content_version || 0),
                }
              : paymentForm,
          ),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || 'No se pudo guardar la forma de pago');
      showStatus(editingItem ? 'Forma de pago actualizada' : 'Forma de pago agregada', 'success');
      resetEditor();
      await fetchData(true);
    } catch (error: any) {
      showStatus(error?.message || 'Error al guardar la forma de pago', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!categoryForm.name.trim()) return;
    if (editingItem && contentChangeReason.trim().length < 3) {
      showStatus('El motivo debe tener al menos 3 caracteres', 'error');
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch(
        editingItem
          ? `/api/config/product-categories/${editingItem.id}`
          : '/api/config/product-categories',
        {
          method: editingItem ? 'PUT' : 'POST',
          body: JSON.stringify(
            editingItem
              ? {
                  ...categoryForm,
                  motivo: contentChangeReason,
                  expectedContentVersion: Number(editingItem.content_version || 0),
                }
              : categoryForm,
          ),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || 'No se pudo guardar la categoría');
      showStatus(editingItem ? 'Categoría actualizada' : 'Categoría agregada', 'success');
      resetEditor();
      await fetchData(true);
    } catch (error: any) {
      showStatus(error?.message || 'Error al guardar la categoría', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveFamily = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!familyForm.name.trim()) return;
    if (editingItem && contentChangeReason.trim().length < 3) {
      showStatus('El motivo debe tener al menos 3 caracteres', 'error');
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch(
        editingItem ? `/api/config/product-families/${editingItem.id}` : '/api/config/product-families',
        {
          method: editingItem ? 'PUT' : 'POST',
          body: JSON.stringify(
            editingItem
              ? {
                  ...familyForm,
                  motivo: contentChangeReason,
                  expectedContentVersion: Number(editingItem.content_version || 0),
                }
              : familyForm,
          ),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || 'No se pudo guardar la familia');
      showStatus(editingItem ? 'Familia actualizada' : 'Familia agregada', 'success');
      resetEditor();
      await fetchData(true);
    } catch (error: any) {
      showStatus(error?.message || 'Error al guardar la familia', 'error');
    } finally {
      setSaving(false);
    }
  };

  const changeLifecycle = async () => {
    if (!lifecycleTarget) return;
    const reason = lifecycleReason.trim();
    if (reason.length < 3) {
      showStatus('El motivo debe tener al menos 3 caracteres', 'error');
      return;
    }

    setLifecycleLoading(true);
    try {
      const response = await apiFetch(`/api/config/${lifecycleTarget.endpoint}/${lifecycleTarget.id}`, {
        method: 'POST',
        body: JSON.stringify({
          action: lifecycleTarget.action,
          motivo: reason,
        }),
      });
      const body = await response.json().catch(() => ({}));
      const actionLabel = lifecycleTarget.action === 'deactivate' ? 'dar de baja' : 'reactivar';
      if (!response.ok) throw new Error(body?.message || `No se pudo ${actionLabel} ${lifecycleTarget.label.toLowerCase()}`);
      showStatus(
        lifecycleTarget.action === 'deactivate'
          ? `${lifecycleTarget.label} dada de baja correctamente`
          : `${lifecycleTarget.label} reactivada correctamente`,
        'success',
      );
      setLifecycleTarget(null);
      setLifecycleReason('');
      resetEditor();
      await fetchData(true);
    } catch (error: any) {
      showStatus(error?.message || 'No se pudo cambiar el estado', 'error');
    } finally {
      setLifecycleLoading(false);
    }
  };

  const downloadJsonFile = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8',
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
    return `edugestion_backup_integro_v2_${date}_${time}.json`;
  };

  const openBackupModal = () => {
    setBackupAdminPassword('');
    setBackupReason('');
    setBackupConfirmation('');
    setShowBackupModal(true);
  };

  const closeBackupModal = () => {
    if (backupLoading) return;
    setShowBackupModal(false);
    setBackupAdminPassword('');
    setBackupReason('');
    setBackupConfirmation('');
  };

  const downloadBackup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !backupAdminPassword ||
      backupReason.trim().length < 3 ||
      backupConfirmation.trim() !== 'RESPALDAR'
    ) return;

    setBackupLoading(true);
    try {
      const response = await apiFetch('/api/config/backup-data', {
        method: 'POST',
        body: JSON.stringify({
          adminPassword: backupAdminPassword,
          motivo: backupReason,
          confirmation: backupConfirmation.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || 'No se pudo generar la copia de seguridad');
      downloadJsonFile(unwrapResponse(body), buildBackupFileName());
      setShowBackupModal(false);
      setBackupAdminPassword('');
      setBackupReason('');
      setBackupConfirmation('');
      showStatus('Copia íntegra verificada y auditada correctamente', 'success');
    } catch (error: any) {
      showStatus(error?.message || 'Error al descargar la copia de seguridad', 'error');
    } finally {
      setBackupLoading(false);
    }
  };

  const openRestoreModal = (file: File | null) => {
    if (!file) return;
    setRestoreFile(file);
    setRestoreAdminPassword('');
    setRestoreReason('');
    setRestoreConfirmation('');
    setShowRestoreModal(true);
  };

  const closeRestoreModal = () => {
    if (restoreLoading) return;
    setShowRestoreModal(false);
    setRestoreFile(null);
    setRestoreAdminPassword('');
    setRestoreReason('');
    setRestoreConfirmation('');
  };

  const restoreBackup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !restoreFile ||
      !restoreAdminPassword ||
      restoreReason.trim().length < 3 ||
      restoreConfirmation.trim() !== 'RESTAURAR'
    ) return;

    setRestoreLoading(true);
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);
      if (
        backup?.app !== 'edugestion' ||
        backup?.type !== 'verified-operational-backup' ||
        backup?.version !== 2 ||
        backup?.schema_version !== 2 ||
        !backup?.manifest?.checksum_sha256
      ) {
        throw new Error('La copia no pertenece al formato íntegro compatible de EduGestión');
      }
      const response = await apiFetch('/api/config/restore-app-data', {
        method: 'POST',
        body: JSON.stringify({
          adminPassword: restoreAdminPassword,
          motivo: restoreReason,
          confirmation: 'RESTAURAR',
          backup,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || 'No se pudo restaurar la copia de seguridad');
      setShowRestoreModal(false);
      setRestoreFile(null);
      setRestoreAdminPassword('');
      setRestoreReason('');
      setRestoreConfirmation('');
      await fetchData(true);
      showStatus('Copia íntegra verificada y restaurada correctamente', 'success');
    } catch (error: any) {
      showStatus(error?.message || 'Error al restaurar la copia de seguridad', 'error');
    } finally {
      setRestoreLoading(false);
    }
  };

  const resetAppData = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !resetAdminPassword ||
      resetReason.trim().length < 3 ||
      resetConfirmation.trim() !== 'REESTABLECER'
    ) return;

    setResetLoading(true);
    try {
      const response = await apiFetch('/api/config/reset-app-data', {
        method: 'POST',
        body: JSON.stringify({
          adminPassword: resetAdminPassword,
          motivo: resetReason,
          confirmation: resetConfirmation.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || 'No se pudo restablecer la aplicación');

      setShowResetModal(false);
      setResetAdminPassword('');
      setResetReason('');
      setResetConfirmation('');
      setSettings({});
      setPaymentMethods([]);
      setCategories([]);
      setFamilies([]);
      await fetchData(true);
      showStatus('Datos restablecidos correctamente', 'success');
    } catch (error: any) {
      showStatus(error?.message || 'Error al restablecer los datos', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  const SectionTitle = ({
    icon: Icon,
    title,
    description,
    badge,
  }: {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    title: string;
    description: string;
    badge?: string;
  }) => (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
        <Icon size={21} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-words text-lg font-black tracking-tight text-slate-950 sm:text-xl">{title}</h3>
          {badge && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium leading-relaxed text-slate-500">{description}</p>
      </div>
    </div>
  );

  const EmptyState = ({ title, description }: { title: string; description: string }) => (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
      <Settings className="mx-auto text-slate-300" size={34} />
      <h4 className="mt-3 text-sm font-black text-slate-800">{title}</h4>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );

  const renderSettingsSave = (buttonLabel: string) => (
    <div className="mt-6 rounded-3xl border border-indigo-100 bg-indigo-50/60 p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="space-y-2">
          <span className={labelClass}>Motivo del cambio</span>
          <textarea
            className={`${inputClass} min-h-24 resize-y`}
            value={settingsChangeReason}
            onChange={(event) => setSettingsChangeReason(event.target.value)}
            placeholder="Explicá por qué se modifica esta configuración"
            maxLength={500}
            required
          />
          <span className="block text-xs text-slate-500">
            Obligatorio. Se guardará junto con el usuario, la fecha y los valores anteriores.
          </span>
        </label>
        <button type="submit" disabled={saving} className={`${primaryButtonClass} w-full lg:w-auto`}>
          <Save size={16} /> {saving ? 'Guardando...' : buttonLabel}
        </button>
      </div>
      {(settingsChangedAt || settingsChangedBy || settingsLastReason) && (
        <div className="mt-4 rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
          <span className="font-black text-slate-800">Última modificación:</span>{' '}
          {settingsChangedAt ? new Date(settingsChangedAt).toLocaleString('es-AR') : 'Sin fecha'}
          {settingsChangedBy ? ` · ${settingsChangedBy}` : ''}
          {settingsLastReason ? ` · ${settingsLastReason}` : ''}
          <span className="ml-1 font-bold text-indigo-700">Versión {settingsContentVersion}</span>
        </div>
      )}
    </div>
  );

  const renderBusiness = () => (
    <form onSubmit={saveSettings} className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-7">
        <SectionTitle
          icon={Building2}
          title="Identidad del negocio"
          description="Estos datos aparecen en comprobantes, reportes y documentos emitidos por el sistema."
        />

        <div className="mt-6 grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className={labelClass}>Logo del negocio</p>
            <div className="mt-3 flex flex-col items-center gap-3">
              <label className="group relative flex h-36 w-full cursor-pointer items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-slate-300 bg-white transition hover:border-indigo-400">
                {settings.business_logo ? (
                  <img src={settings.business_logo} alt="Logo del negocio" className="h-full w-full object-contain p-3" />
                ) : (
                  <div className="text-center text-slate-400">
                    <Store className="mx-auto" size={34} />
                    <span className="mt-2 block text-xs font-bold">Seleccionar imagen</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onloadend = () =>
                      setSettings((current) => ({ ...current, business_logo: reader.result as string }));
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <p className="text-center text-xs leading-relaxed text-slate-500">PNG o JPG. Se adapta automáticamente a comprobantes y reportes.</p>
              {settings.business_logo && (
                <button
                  type="button"
                  onClick={() => setSettings((current) => ({ ...current, business_logo: '' }))}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-red-600 transition hover:bg-red-100"
                >
                  <Trash2 size={15} /> Quitar logo
                </button>
              )}
            </div>
          </div>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className={labelClass}>Nombre del negocio</span>
              <input
                className={inputClass}
                value={settings.business_name || ''}
                onChange={(event) => setSettings({ ...settings, business_name: event.target.value })}
                placeholder="Ej.: Mi Negocio"
              />
            </label>
            <label className="space-y-2">
              <span className={labelClass}>Razón social</span>
              <input
                className={inputClass}
                value={settings.business_razon_social || ''}
                onChange={(event) => setSettings({ ...settings, business_razon_social: event.target.value })}
                placeholder="Ej.: Mi Negocio S.A."
              />
            </label>
            <label className="space-y-2">
              <span className={labelClass}>CUIT</span>
              <input
                className={inputClass}
                value={settings.business_cuit || ''}
                onChange={(event) => setSettings({ ...settings, business_cuit: event.target.value })}
                placeholder="00-00000000-0"
              />
            </label>
            <label className="space-y-2">
              <span className={labelClass}>Teléfono</span>
              <input
                className={inputClass}
                value={settings.business_phone || ''}
                onChange={(event) => setSettings({ ...settings, business_phone: event.target.value })}
                placeholder="Código de área y número"
              />
            </label>
            <label className="space-y-2 sm:col-span-2">
              <span className={labelClass}>Email de contacto</span>
              <input
                type="email"
                className={inputClass}
                value={settings.business_email || ''}
                onChange={(event) => setSettings({ ...settings, business_email: event.target.value })}
                placeholder="contacto@negocio.com"
              />
            </label>
            <label className="space-y-2">
              <span className={labelClass}>Dirección</span>
              <input
                className={inputClass}
                value={settings.business_address || ''}
                onChange={(event) => setSettings({ ...settings, business_address: event.target.value })}
                placeholder="Calle y número"
              />
            </label>
            <label className="space-y-2">
              <span className={labelClass}>Localidad</span>
              <input
                className={inputClass}
                value={settings.business_localidad || ''}
                onChange={(event) => setSettings({ ...settings, business_localidad: event.target.value })}
                placeholder="Localidad"
              />
            </label>
          </div>
        </div>

        {hasPermission('settings', 'edit') && renderSettingsSave('Guardar datos del negocio')}
      </section>

      {hasPermission('settings', 'delete') && (
        <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm sm:p-6 lg:p-7">
          <SectionTitle
            icon={Database}
            title="Copias y recuperación"
            description="Generá una copia operativa íntegra con 64 tablas, manifiesto de esquema y checksum SHA-256."
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={openBackupModal} disabled={backupLoading} className={secondaryButtonClass}>
              <Download size={17} /> {backupLoading ? 'Generando copia...' : 'Descargar copia JSON'}
            </button>
            <label className={`${secondaryButtonClass} cursor-pointer`}>
              <Upload size={17} /> Seleccionar copia para restaurar
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                disabled={restoreLoading}
                onChange={(event) => {
                  openRestoreModal(event.target.files?.[0] || null);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </section>
      )}

      {hasPermission('settings', 'delete') && (
        <section className="rounded-3xl border border-red-200 bg-red-50/70 p-4 shadow-sm sm:p-6 lg:p-7">
          <SectionTitle
            icon={ShieldAlert}
            title="Zona de peligro"
            description="El restablecimiento borra datos operativos. Usuarios, permisos, datos del negocio y formas de pago se conservan."
          />
          <div className="mt-5 rounded-2xl border border-red-200 bg-white/80 p-4 text-sm font-medium leading-relaxed text-red-700">
            Se eliminarán productos, clientes, ventas, compras, movimientos financieros, rutas, checklist, pedidos a proveedor, proveedores, categorías y familias.
          </div>
          <button
            type="button"
            onClick={() => setShowResetModal(true)}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-red-700 sm:w-auto"
          >
            <RotateCcw size={17} /> Restablecer datos de la aplicación
          </button>
        </section>
      )}
    </form>
  );

  const renderPayments = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <form onSubmit={savePaymentMethod} className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <SectionTitle
          icon={CreditCard}
          title={editingItem ? 'Editar forma de pago' : 'Nueva forma de pago'}
          description="Definí cómo se registran ventas, cobros y movimientos financieros."
        />
        <div className="mt-5 space-y-4">
          <label className="space-y-2">
            <span className={labelClass}>Nombre</span>
            <input
              className={inputClass}
              value={paymentForm.name}
              onChange={(event) => setPaymentForm({ ...paymentForm, name: event.target.value })}
              placeholder="Ej.: Tarjeta de crédito"
            />
          </label>
          <label className="space-y-2">
            <span className={labelClass}>Tipo</span>
            <select
              className={inputClass}
              value={paymentForm.tipo}
              onChange={(event) => setPaymentForm({ ...paymentForm, tipo: event.target.value })}
            >
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Digital">Digital (billeteras)</option>
              <option value="Crédito">Crédito / Cuenta corriente</option>
            </select>
          </label>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-xs font-semibold leading-relaxed text-indigo-800">
            El estado se administra desde Dar de baja o Reactivar para conservar la auditoría.
          </div>
          {editingItem && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <label className="space-y-2">
                <span className={labelClass}>Motivo del cambio</span>
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  value={contentChangeReason}
                  onChange={(event) => setContentChangeReason(event.target.value)}
                  placeholder="Explicá por qué se modifica esta configuración"
                  maxLength={500}
                />
              </label>
              <div className="text-xs leading-relaxed text-amber-900">
                <p><span className="font-black">Versión actual:</span> {Number(editingItem.content_version || 0)}</p>
                {editingItem.content_changed_by && <p><span className="font-black">Último cambio:</span> {editingItem.content_changed_by}</p>}
                {editingItem.content_changed_at && <p><span className="font-black">Fecha:</span> {new Date(editingItem.content_changed_at).toLocaleString('es-AR')}</p>}
                {editingItem.content_change_reason && <p><span className="font-black">Motivo anterior:</span> {editingItem.content_change_reason}</p>}
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {editingItem && (
            <button type="button" onClick={resetEditor} className={secondaryButtonClass}>Cancelar</button>
          )}
          {((editingItem && hasPermission('settings', 'edit')) ||
            (!editingItem && hasPermission('settings', 'create'))) && (
            <button type="submit" disabled={saving || !paymentForm.name.trim() || Boolean(editingItem && contentChangeReason.trim().length < 3)} className={primaryButtonClass}>
              {editingItem ? <Save size={16} /> : <Plus size={16} />}
              {saving ? 'Guardando...' : editingItem ? 'Actualizar' : 'Agregar'}
            </button>
          )}
        </div>
      </form>

      <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <SectionTitle
          icon={FileJson}
          title="Formas de pago registradas"
          description="Revisá el estado y tipo de cada medio disponible."
          badge={`${paymentMethods.length} registradas`}
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {paymentMethods.map((item) => {
            const active = item.activo !== 0;
            const systemRequired = item.name.trim().toLowerCase() === 'cta cte';
            return (
              <article key={item.id} className="min-w-0 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <h4 className="break-words text-sm font-black text-slate-900">{item.name}</h4>
                    </div>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">{item.tipo || 'Sin tipo'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {active ? 'Activa' : 'Inactiva'}
                  </span>
                </div>
                {!active && (
                  <div className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-3 text-xs leading-relaxed text-red-800">
                    <p><span className="font-black">Motivo:</span> {item.deactivation_reason || 'Sin trazabilidad'}</p>
                    {item.deactivated_by && <p className="mt-1"><span className="font-black">Usuario:</span> {item.deactivated_by}</p>}
                    {item.deactivated_at && <p className="mt-1"><span className="font-black">Fecha:</span> {new Date(item.deactivated_at).toLocaleString('es-AR')}</p>}
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {hasPermission('settings', 'edit') && active && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem(item);
                        setContentChangeReason('');
                        setPaymentForm({
                          name: item.name,
                          tipo: item.tipo || 'Efectivo',
                        });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
                      aria-label={`Editar forma de pago ${item.name}`}
                    >
                      <Edit3 size={15} /> Editar
                    </button>
                  )}
                  {hasPermission('settings', 'delete') && (
                    systemRequired ? (
                      <div className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 text-center text-xs font-black text-indigo-700">
                        <ShieldAlert size={15} /> Requerida por el sistema
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setLifecycleReason('');
                          setLifecycleTarget({
                            endpoint: 'payment-methods',
                            id: item.id,
                            name: item.name,
                            label: 'Forma de pago',
                            action: active ? 'deactivate' : 'reactivate',
                          });
                        }}
                        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-3 text-xs font-black transition ${active ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                        aria-label={`${active ? 'Dar de baja' : 'Reactivar'} forma de pago ${item.name}`}
                      >
                        {active ? <ShieldAlert size={15} /> : <RotateCcw size={15} />}
                        {active ? 'Dar de baja' : 'Reactivar'}
                      </button>
                    )
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!loading && paymentMethods.length === 0 && (
          <div className="mt-5"><EmptyState title="No hay formas de pago" description="Agregá el primer medio para utilizarlo en ventas, compras y cobranzas." /></div>
        )}
      </section>
    </div>
  );

  const renderCategories = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <form onSubmit={saveCategory} className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <SectionTitle
          icon={Tags}
          title={editingItem ? 'Editar categoría' : 'Nueva categoría'}
          description="Clasificación general para ordenar y buscar productos."
        />
        <div className="mt-5 space-y-4">
          <label className="space-y-2">
            <span className={labelClass}>Nombre</span>
            <input className={inputClass} value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} placeholder="Ej.: Bebidas" />
          </label>
          <label className="space-y-2">
            <span className={labelClass}>Descripción</span>
            <textarea className={`${inputClass} min-h-28 resize-y`} value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} placeholder="Descripción opcional" />
          </label>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-xs font-semibold leading-relaxed text-indigo-800">
            El estado se administra desde Dar de baja o Reactivar para conservar la auditoría.
          </div>
          {editingItem && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <label className="space-y-2">
                <span className={labelClass}>Motivo del cambio</span>
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  value={contentChangeReason}
                  onChange={(event) => setContentChangeReason(event.target.value)}
                  placeholder="Explicá por qué se modifica esta configuración"
                  maxLength={500}
                />
              </label>
              <div className="text-xs leading-relaxed text-amber-900">
                <p><span className="font-black">Versión actual:</span> {Number(editingItem.content_version || 0)}</p>
                {editingItem.content_changed_by && <p><span className="font-black">Último cambio:</span> {editingItem.content_changed_by}</p>}
                {editingItem.content_changed_at && <p><span className="font-black">Fecha:</span> {new Date(editingItem.content_changed_at).toLocaleString('es-AR')}</p>}
                {editingItem.content_change_reason && <p><span className="font-black">Motivo anterior:</span> {editingItem.content_change_reason}</p>}
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {editingItem && <button type="button" onClick={resetEditor} className={secondaryButtonClass}>Cancelar</button>}
          {((editingItem && hasPermission('settings', 'edit')) || (!editingItem && hasPermission('settings', 'create'))) && (
            <button type="submit" disabled={saving || !categoryForm.name.trim() || Boolean(editingItem && contentChangeReason.trim().length < 3)} className={primaryButtonClass}>
              {editingItem ? <Save size={16} /> : <Plus size={16} />}
              {saving ? 'Guardando...' : editingItem ? 'Actualizar' : 'Agregar'}
            </button>
          )}
        </div>
      </form>

      <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <SectionTitle icon={Tags} title="Categorías registradas" description="Listado actual de categorías del catálogo." badge={`${categories.length} registradas`} />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {categories.map((item) => {
            const active = item.estado !== 'inactivo';
            return (
              <article key={item.id} className="min-w-0 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-sm font-black text-slate-900">{item.name}</h4>
                    <p className="mt-1 break-words text-sm leading-relaxed text-slate-500">{item.description || 'Sin descripción'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {active ? 'Activa' : 'Inactiva'}
                  </span>
                </div>
                {!active && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-100 p-3 text-xs leading-relaxed text-slate-700">
                    <p><span className="font-black">Motivo:</span> {item.deactivation_reason || 'Sin trazabilidad'}</p>
                    {item.deactivated_by && <p className="mt-1"><span className="font-black">Usuario:</span> {item.deactivated_by}</p>}
                    {item.deactivated_at && <p className="mt-1"><span className="font-black">Fecha:</span> {new Date(item.deactivated_at).toLocaleString('es-AR')}</p>}
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {hasPermission('settings', 'edit') && active && (
                    <button type="button" onClick={() => {
                      setEditingItem(item);
                      setContentChangeReason('');
                      setCategoryForm({ name: item.name, description: item.description || '' });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700">
                      <Edit3 size={15} /> Editar
                    </button>
                  )}
                  {hasPermission('settings', 'delete') && (
                    <button
                      type="button"
                      onClick={() => {
                        setLifecycleReason('');
                        setLifecycleTarget({
                          endpoint: 'product-categories',
                          id: item.id,
                          name: item.name,
                          label: 'Categoría',
                          action: active ? 'deactivate' : 'reactivate',
                        });
                      }}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-3 text-xs font-black transition ${active ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                    >
                      {active ? <ShieldAlert size={15} /> : <RotateCcw size={15} />}
                      {active ? 'Dar de baja' : 'Reactivar'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!loading && categories.length === 0 && <div className="mt-5"><EmptyState title="No hay categorías" description="Creá una categoría para clasificar el catálogo de productos." /></div>}
      </section>
    </div>
  );

  const renderFamilies = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <form onSubmit={saveFamily} className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <SectionTitle icon={Layers} title={editingItem ? 'Editar familia' : 'Nueva familia'} description="Agrupación utilizada para productos, filtros, precios y reportes." />
        <div className="mt-5 space-y-4">
          <label className="space-y-2">
            <span className={labelClass}>Nombre</span>
            <input className={inputClass} value={familyForm.name} onChange={(event) => setFamilyForm({ ...familyForm, name: event.target.value })} placeholder="Ej.: Gaseosas" />
          </label>
          <label className="space-y-2">
            <span className={labelClass}>Categoría asociada</span>
            <select className={inputClass} value={familyForm.category_id || ''} onChange={(event) => setFamilyForm({ ...familyForm, category_id: event.target.value ? Number(event.target.value) : null })}>
              <option value="">Sin categoría asociada</option>
              {categories
                .filter((category) => category.estado !== 'inactivo' || category.id === familyForm.category_id)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}{category.estado === 'inactivo' ? ' (inactiva)' : ''}
                  </option>
                ))}
            </select>
            <span className="block text-xs leading-relaxed text-slate-500">La asociación es informativa y no reemplaza la categoría propia de cada producto.</span>
          </label>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-xs font-semibold leading-relaxed text-indigo-800">
            El estado se administra desde Dar de baja o Reactivar para conservar la auditoría.
          </div>
          {editingItem && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <label className="space-y-2">
                <span className={labelClass}>Motivo del cambio</span>
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  value={contentChangeReason}
                  onChange={(event) => setContentChangeReason(event.target.value)}
                  placeholder="Explicá por qué se modifica esta configuración"
                  maxLength={500}
                />
              </label>
              <div className="text-xs leading-relaxed text-amber-900">
                <p><span className="font-black">Versión actual:</span> {Number(editingItem.content_version || 0)}</p>
                {editingItem.content_changed_by && <p><span className="font-black">Último cambio:</span> {editingItem.content_changed_by}</p>}
                {editingItem.content_changed_at && <p><span className="font-black">Fecha:</span> {new Date(editingItem.content_changed_at).toLocaleString('es-AR')}</p>}
                {editingItem.content_change_reason && <p><span className="font-black">Motivo anterior:</span> {editingItem.content_change_reason}</p>}
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {editingItem && <button type="button" onClick={resetEditor} className={secondaryButtonClass}>Cancelar</button>}
          {((editingItem && hasPermission('settings', 'edit')) || (!editingItem && hasPermission('settings', 'create'))) && (
            <button type="submit" disabled={saving || !familyForm.name.trim() || Boolean(editingItem && contentChangeReason.trim().length < 3)} className={primaryButtonClass}>
              {editingItem ? <Save size={16} /> : <Plus size={16} />}
              {saving ? 'Guardando...' : editingItem ? 'Actualizar' : 'Agregar'}
            </button>
          )}
        </div>
      </form>

      <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <SectionTitle icon={Layers} title="Familias registradas" description="Listado actual de agrupaciones utilizadas por los productos." badge={`${families.length} registradas`} />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {families.map((item) => {
            const active = item.estado !== 'inactivo';
            return (
              <article key={item.id} className="min-w-0 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-sm font-black text-slate-900">{item.name}</h4>
                    <p className="mt-1 break-words text-xs font-bold text-slate-500">Categoría: {item.category_name || 'Sin asociación'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {active ? 'Activa' : 'Inactiva'}
                  </span>
                </div>
                {!active && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-100 p-3 text-xs leading-relaxed text-slate-700">
                    <p><span className="font-black">Motivo:</span> {item.deactivation_reason || 'Sin trazabilidad'}</p>
                    {item.deactivated_by && <p className="mt-1"><span className="font-black">Usuario:</span> {item.deactivated_by}</p>}
                    {item.deactivated_at && <p className="mt-1"><span className="font-black">Fecha:</span> {new Date(item.deactivated_at).toLocaleString('es-AR')}</p>}
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {hasPermission('settings', 'edit') && active && (
                    <button type="button" onClick={() => {
                      setEditingItem(item);
                      setContentChangeReason('');
                      setFamilyForm({ name: item.name, category_id: item.category_id || null });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700">
                      <Edit3 size={15} /> Editar
                    </button>
                  )}
                  {hasPermission('settings', 'delete') && (
                    <button
                      type="button"
                      onClick={() => {
                        setLifecycleReason('');
                        setLifecycleTarget({
                          endpoint: 'product-families',
                          id: item.id,
                          name: item.name,
                          label: 'Familia',
                          action: active ? 'deactivate' : 'reactivate',
                        });
                      }}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-3 text-xs font-black transition ${active ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                    >
                      {active ? <ShieldAlert size={15} /> : <RotateCcw size={15} />}
                      {active ? 'Dar de baja' : 'Reactivar'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!loading && families.length === 0 && <div className="mt-5"><EmptyState title="No hay familias" description="Creá una familia para organizar productos y reportes." /></div>}
      </section>
    </div>
  );

  const renderParameters = () => (
    <form onSubmit={saveSettings} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-7">
      <SectionTitle icon={Gauge} title="Parámetros comerciales" description="Valores predeterminados que utiliza la operación diaria." />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2">
          <span className={labelClass}>Moneda del sistema</span>
          <select className={inputClass} value={settings.system_currency || 'ARS'} onChange={(event) => setSettings({ ...settings, system_currency: event.target.value })}>
            <option value="ARS">Peso argentino ($)</option>
            <option value="USD">Dólar estadounidense (USD)</option>
          </select>
        </label>
        <label className="space-y-2">
          <span className={labelClass}>IVA predeterminado (%)</span>
          <input type="number" className={inputClass} value={settings.default_iva || '21'} onChange={(event) => setSettings({ ...settings, default_iva: event.target.value })} />
        </label>
        <label className="space-y-2">
          <span className={labelClass}>Margen sugerido (%)</span>
          <input type="number" className={inputClass} value={settings.default_markup || '30'} onChange={(event) => setSettings({ ...settings, default_markup: event.target.value })} />
        </label>
        <label className="space-y-2">
          <span className={labelClass}>Días para alerta de deuda</span>
          <input type="number" className={inputClass} value={settings.customer_debt_alert_days || '7'} onChange={(event) => setSettings({ ...settings, customer_debt_alert_days: event.target.value })} />
        </label>
        <label className="space-y-2">
          <span className={labelClass}>Límite de crédito inicial</span>
          <input type="number" className={inputClass} value={settings.default_credit_limit || '0'} onChange={(event) => setSettings({ ...settings, default_credit_limit: event.target.value })} />
        </label>
        <label className="space-y-2">
          <span className={labelClass}>Método de cálculo de costo</span>
          <select className={inputClass} value={settings.cost_calculation_method || 'PEPS'} onChange={(event) => setSettings({ ...settings, cost_calculation_method: event.target.value })}>
            <option value="PEPS">PEPS (Primero entrado, primero salido)</option>
            <option value="PPP">PPP (Precio promedio ponderado)</option>
            <option value="UEPS">UEPS (Último entrado, primero salido)</option>
          </select>
        </label>
      </div>
      <label className="mt-5 flex cursor-pointer items-start justify-between gap-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 sm:items-center">
        <div>
          <span className="block text-sm font-black text-amber-900">Permitir ventas sin stock</span>
          <span className="mt-1 block text-xs leading-relaxed text-amber-700">Habilita stock negativo. Activar solamente si el flujo comercial realmente lo necesita.</span>
        </div>
        <input type="checkbox" checked={settings.allow_negative_stock === 'true'} onChange={(event) => setSettings({ ...settings, allow_negative_stock: event.target.checked ? 'true' : 'false' })} className="mt-1 h-5 w-5 shrink-0 rounded border-amber-300 text-indigo-600 focus:ring-indigo-500 sm:mt-0" />
      </label>
      {hasPermission('settings', 'edit') && renderSettingsSave('Guardar parámetros')}
    </form>
  );

  const renderNumbering = () => (
    <form onSubmit={saveSettings} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-7">
      <SectionTitle icon={Hash} title="Numeraciones del sistema" description="Próximos identificadores que utilizarán ventas, pedidos y recibos." />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-2"><span className={labelClass}>Próxima venta</span><input type="number" className={inputClass} value={settings.next_sale_number || '1'} onChange={(event) => setSettings({ ...settings, next_sale_number: event.target.value })} /></label>
        <label className="space-y-2"><span className={labelClass}>Próximo pedido</span><input type="number" className={inputClass} value={settings.next_order_number || '1'} onChange={(event) => setSettings({ ...settings, next_order_number: event.target.value })} /></label>
        <label className="space-y-2"><span className={labelClass}>Próximo pago / recibo</span><input type="number" className={inputClass} value={settings.next_payment_number || '1'} onChange={(event) => setSettings({ ...settings, next_payment_number: event.target.value })} /></label>
        <label className="space-y-2"><span className={labelClass}>Prefijo de facturación</span><input className={inputClass} value={settings.billing_prefix || '0001'} onChange={(event) => setSettings({ ...settings, billing_prefix: event.target.value })} /></label>
      </div>
      <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-relaxed text-indigo-800">
        Cambiar estos valores modifica el próximo número emitido. No altera comprobantes ya registrados.
      </div>
      {hasPermission('settings', 'edit') && renderSettingsSave('Guardar numeraciones')}
    </form>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-4" role="status" aria-live="polite">
          <div className="h-32 animate-pulse rounded-3xl bg-slate-200" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-56 animate-pulse rounded-3xl bg-slate-100" />
            <div className="h-56 animate-pulse rounded-3xl bg-slate-100" />
          </div>
          <p className="text-center text-sm font-bold text-slate-500">Cargando configuración...</p>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto text-red-500" size={34} />
          <h3 className="mt-3 text-lg font-black text-red-800">No se pudo cargar esta sección</h3>
          <p className="mt-1 text-sm text-red-700">{loadError}</p>
          <button type="button" onClick={() => fetchData()} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700">
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      );
    }

    switch (activeTab) {
      case 'negocio': return renderBusiness();
      case 'pagos': return renderPayments();
      case 'categorias': return renderCategories();
      case 'familias': return renderFamilies();
      case 'parametros': return renderParameters();
      case 'numeraciones': return renderNumbering();
      default: return null;
    }
  };

  return (
    <div className="min-h-full bg-slate-50/70 pb-8">
      <header className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
              <Settings size={25} />
            </div>
            <div className="min-w-0">
              <h2 className="break-words text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Configuración</h2>
              <p className="mt-1 text-sm font-medium leading-relaxed text-slate-500">Datos maestros, parámetros comerciales, numeraciones y seguridad de la aplicación.</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {message && (
              <div className={`flex min-h-11 min-w-0 items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-bold ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`} role="status">
                {message.type === 'success' ? <CheckCircle2 size={17} className="shrink-0" /> : <AlertCircle size={17} className="shrink-0" />}
                <span className="break-words">{message.text}</span>
              </div>
            )}
            <button type="button" onClick={() => fetchData(true)} disabled={refreshing || loading} className={secondaryButtonClass}>
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Secciones de configuración">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-w-0 rounded-2xl border p-3 text-left transition focus:outline-none focus:ring-4 focus:ring-indigo-100 sm:p-4 ${active ? 'border-indigo-500 bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50'}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={19} className={active ? 'text-white' : 'text-indigo-600'} />
                <span className="mt-2 block break-words text-xs font-black leading-tight sm:hidden">{tab.shortLabel}</span>
                <span className="mt-2 hidden break-words text-xs font-black leading-tight sm:block">{tab.label}</span>
                <span className={`mt-1 hidden break-words text-[11px] leading-snug lg:block ${active ? 'text-indigo-100' : 'text-slate-500'}`}>{tab.description}</span>
              </button>
            );
          })}
        </nav>

        <section className="mt-5">
          <div className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700"><currentTab.icon size={19} /></div>
              <div className="min-w-0"><h3 className="break-words text-base font-black text-slate-900">{currentTab.label}</h3><p className="break-words text-sm text-slate-500">{currentTab.description}</p></div>
            </div>
          </div>
          {renderContent()}
        </section>
      </div>

      {lifecycleTarget && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:max-w-md sm:rounded-[28px]">
            <div className={`flex items-start justify-between gap-4 border-b p-5 sm:p-6 ${lifecycleTarget.action === 'deactivate' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${lifecycleTarget.action === 'deactivate' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                  {lifecycleTarget.action === 'deactivate' ? <ShieldAlert size={21} /> : <RotateCcw size={21} />}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-950">
                    {lifecycleTarget.action === 'deactivate' ? 'Dar de baja' : 'Reactivar'} {lifecycleTarget.label.toLowerCase()}
                  </h3>
                  <p className="mt-1 break-words text-sm text-slate-600">{lifecycleTarget.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLifecycleTarget(null);
                  setLifecycleReason('');
                }}
                disabled={lifecycleLoading}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-slate-500 hover:bg-white/70"
                aria-label="Cerrar cambio de estado"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              <p className="text-sm leading-relaxed text-slate-600">
                {lifecycleTarget.action === 'deactivate'
                  ? 'El elemento conservará todo su historial, pero dejará de estar disponible para operaciones nuevas.'
                  : 'El elemento volverá a estar disponible para operaciones nuevas.'}
              </p>
              <label className="space-y-2">
                <span className={labelClass}>Motivo obligatorio</span>
                <textarea
                  className={`${inputClass} min-h-28 resize-y`}
                  value={lifecycleReason}
                  onChange={(event) => setLifecycleReason(event.target.value.slice(0, 500))}
                  placeholder={lifecycleTarget.action === 'deactivate' ? 'Ej.: Ya no se utiliza en la operación' : 'Ej.: Vuelve a utilizarse'}
                  autoFocus
                />
                <span className="block text-xs text-slate-500">{lifecycleReason.trim().length}/500 caracteres</span>
              </label>
            </div>
            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2 sm:p-6">
              <button
                type="button"
                onClick={() => {
                  setLifecycleTarget(null);
                  setLifecycleReason('');
                }}
                disabled={lifecycleLoading}
                className={secondaryButtonClass}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={changeLifecycle}
                disabled={lifecycleLoading || lifecycleReason.trim().length < 3}
                className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 ${lifecycleTarget.action === 'deactivate' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              >
                {lifecycleTarget.action === 'deactivate' ? <ShieldAlert size={16} /> : <RotateCcw size={16} />}
                {lifecycleLoading
                  ? 'Procesando...'
                  : lifecycleTarget.action === 'deactivate'
                    ? 'Dar de baja'
                    : 'Reactivar'}
              </button>
            </div>
          </div>
        </div>
      )}


      {showBackupModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <form onSubmit={downloadBackup} className="max-h-[100dvh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-4 bg-indigo-600 p-5 text-white sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Download size={22} /></div>
                <div>
                  <h3 className="text-xl font-black">Descargar copia de seguridad</h3>
                  <p className="mt-1 text-sm font-medium text-indigo-100">Incluye 64 tablas operativas, manifiesto de esquema y checksum SHA-256. Excluye credenciales y seguridad de usuarios.</p>
                </div>
              </div>
              <button type="button" onClick={closeBackupModal} disabled={backupLoading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white hover:bg-white/15" aria-label="Cerrar descarga de respaldo"><X size={20} /></button>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              <label className="space-y-2">
                <span className={labelClass}>Motivo obligatorio</span>
                <textarea className={`${inputClass} min-h-24 resize-y`} value={backupReason} onChange={(event) => setBackupReason(event.target.value.slice(0, 500))} placeholder="Ej.: Respaldo previo al cierre mensual" autoFocus />
                <span className="block text-xs text-slate-500">{backupReason.trim().length}/500 caracteres</span>
              </label>
              <label className="space-y-2">
                <span className={labelClass}>Contraseña actual del administrador</span>
                <input type="password" className={inputClass} value={backupAdminPassword} onChange={(event) => setBackupAdminPassword(event.target.value)} autoComplete="current-password" placeholder="Ingrese su contraseña actual" />
              </label>
              <label className="space-y-2">
                <span className={labelClass}>Confirmación escrita</span>
                <input className={inputClass} value={backupConfirmation} onChange={(event) => setBackupConfirmation(event.target.value)} placeholder="Escriba RESPALDAR" />
                <span className="block text-xs text-slate-500">Escribí exactamente RESPALDAR para habilitar la descarga.</span>
              </label>
            </div>
            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2 sm:p-6">
              <button type="button" onClick={closeBackupModal} disabled={backupLoading} className={secondaryButtonClass}>Cancelar</button>
              <button type="submit" disabled={backupLoading || !backupAdminPassword || backupReason.trim().length < 3 || backupConfirmation.trim() !== 'RESPALDAR'} className={primaryButtonClass}><Download size={16} /> {backupLoading ? 'Generando...' : 'Generar y descargar'}</button>
            </div>
          </form>
        </div>
      )}

      {showRestoreModal && restoreFile && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <form onSubmit={restoreBackup} className="max-h-[100dvh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-4 bg-amber-500 p-5 text-white sm:p-6">
              <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20"><Upload size={21} /></div><div><h3 className="text-xl font-black">Restaurar copia de seguridad</h3><p className="mt-1 text-sm font-medium text-amber-50">Los datos actuales serán reemplazados por el archivo seleccionado.</p></div></div>
              <button type="button" onClick={closeRestoreModal} disabled={restoreLoading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white hover:bg-white/15" aria-label="Cerrar restauración de respaldo"><X size={20} /></button>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-black uppercase tracking-widest text-amber-700">Archivo seleccionado</p><p className="mt-1 break-all text-sm font-bold text-amber-900">{restoreFile.name}</p></div>
              <label className="space-y-2"><span className={labelClass}>Motivo obligatorio</span><textarea className={`${inputClass} min-h-24 resize-y`} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value.slice(0, 500))} placeholder="Ej.: Recuperación por error operativo" /><span className="block text-xs text-slate-500">{restoreReason.trim().length}/500 caracteres</span></label>
              <label className="space-y-2"><span className={labelClass}>Contraseña actual del administrador</span><input type="password" className={inputClass} value={restoreAdminPassword} onChange={(event) => setRestoreAdminPassword(event.target.value)} autoComplete="current-password" placeholder="Ingrese su contraseña actual" /></label>
              <label className="space-y-2"><span className={labelClass}>Confirmación escrita</span><input className={inputClass} value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder="Escriba RESTAURAR" /><span className="block text-xs text-slate-500">Escribí exactamente RESTAURAR para habilitar la acción.</span></label>
            </div>
            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2 sm:p-6"><button type="button" onClick={closeRestoreModal} disabled={restoreLoading} className={secondaryButtonClass}>Cancelar</button><button type="submit" disabled={restoreLoading || !restoreAdminPassword || restoreReason.trim().length < 3 || restoreConfirmation.trim() !== 'RESTAURAR'} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-amber-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-amber-700 disabled:opacity-50"><Upload size={16} /> {restoreLoading ? 'Restaurando...' : 'Restaurar datos'}</button></div>
          </form>
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <form onSubmit={resetAppData} className="max-h-[100dvh] w-full overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-4 bg-red-600 p-5 text-white sm:p-6">
              <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15"><ShieldAlert size={22} /></div><div><h3 className="text-xl font-black">Restablecer datos</h3><p className="mt-1 text-sm font-medium text-red-100">Esta acción no se puede deshacer sin una copia JSON.</p></div></div>
              <button type="button" onClick={() => { if (!resetLoading) { setShowResetModal(false); setResetAdminPassword(''); setResetReason(''); setResetConfirmation(''); } }} disabled={resetLoading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white hover:bg-white/15" aria-label="Cerrar reinicio de datos"><X size={20} /></button>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium leading-relaxed text-red-800">Se eliminarán los datos operativos. Usuarios, permisos, datos del negocio y formas de pago se conservarán.</div>
              <button type="button" onClick={openBackupModal} disabled={backupLoading} className={secondaryButtonClass}><Download size={16} /> {backupLoading ? 'Generando copia...' : 'Descargar copia antes'}</button>
              <label className="space-y-2"><span className={labelClass}>Motivo obligatorio</span><textarea className={`${inputClass} min-h-24 resize-y`} value={resetReason} onChange={(event) => setResetReason(event.target.value.slice(0, 500))} placeholder="Ej.: Reinicio controlado del entorno de pruebas" /><span className="block text-xs text-slate-500">{resetReason.trim().length}/500 caracteres</span></label>
              <label className="space-y-2"><span className={labelClass}>Contraseña actual del administrador</span><input type="password" className={inputClass} value={resetAdminPassword} onChange={(event) => setResetAdminPassword(event.target.value)} autoComplete="current-password" placeholder="Ingrese su contraseña actual" /></label>
              <label className="space-y-2"><span className={labelClass}>Confirmación escrita</span><input className={inputClass} value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder="Escriba REESTABLECER" /><span className="block text-xs text-slate-500">Escribí exactamente REESTABLECER para habilitar la acción.</span></label>
            </div>
            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2 sm:p-6"><button type="button" onClick={() => { setShowResetModal(false); setResetAdminPassword(''); setResetReason(''); setResetConfirmation(''); }} disabled={resetLoading} className={secondaryButtonClass}>Cancelar</button><button type="submit" disabled={resetLoading || !resetAdminPassword || resetReason.trim().length < 3 || resetConfirmation.trim() !== 'REESTABLECER'} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-50"><RotateCcw size={16} /> {resetLoading ? 'Restableciendo...' : 'Confirmar restablecimiento'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
