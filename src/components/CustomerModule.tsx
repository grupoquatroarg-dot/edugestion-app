import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, UserPlus, User, Phone, Mail, MapPin, Edit2, Power, X, AlertCircle, Building2, CreditCard, Eye, KeyRound, Users, WalletCards, AlertTriangle, ShieldCheck, RefreshCw, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import CustomerDetail from './CustomerDetail';
import AddressAutocomplete from './AddressAutocomplete';
import { getSocket } from '../utils/socket';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

const socket = getSocket();

interface Cliente {
  id: number;
  nombre_apellido: string;
  razon_social?: string;
  cuit?: string;
  localidad?: string;
  provincia?: string;
  codigo_postal?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  latitud?: number;
  longitud?: number;
  observaciones?: string;
  tipo_cliente: 'minorista' | 'mayorista';
  lista_precio: string;
  limite_credito: number;
  saldo_cta_cte: number;
  fecha_alta: string;
  activo: boolean;
  tiene_deuda_vencida?: number;
  portal_enabled?: number | boolean;
  portal_username?: string;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
  deactivation_reason?: string | null;
}

export default function CustomerModule() {
  const { hasPermission } = useAuth();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedClienteId, setSelectedClienteId] = useState<number | null>(null);
  const [initialDetailTab, setInitialDetailTab] = useState<'ventas' | 'movimientos' | 'pedidos'>('ventas');
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<{ cliente: Cliente; action: 'deactivate' | 'reactivate' } | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const customerFormRef = useRef<HTMLFormElement | null>(null);
  const customerNameInputRef = useRef<HTMLInputElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    nombre_apellido: '',
    razon_social: '',
    cuit: '',
    localidad: '',
    provincia: '',
    codigo_postal: '',
    telefono: '',
    email: '',
    direccion: '',
    latitud: 0,
    longitud: 0,
    observaciones: '',
    tipo_cliente: 'minorista' as 'minorista' | 'mayorista',
    lista_precio: 'lista1',
    limite_credito: 0,
    portal_enabled: false,
    portal_username: '',
    portal_password: ''
  });

  useEffect(() => {
    fetchClientes(true);

    socket.on('sale_confirmed', () => {
      fetchClientes(false);
    });

    return () => {
      socket.off('sale_confirmed');
    };
  }, []);

  useEffect(() => {
    if (!isModalOpen) return;

    const frameId = window.requestAnimationFrame(() => {
      customerFormRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      customerFormRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      customerNameInputRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isModalOpen, editingCliente?.id]);

  const fetchClientes = async (showInitialLoader = false) => {
    if (showInitialLoader) setLoading(true);
    else setRefreshing(true);

    try {
      setLoadError(null);
      const res = await apiFetch('/api/clientes');
      const body = await res.json();
      const data = unwrapResponse(body);

      if (!Array.isArray(data)) {
        throw new Error('La respuesta de clientes no tiene el formato esperado');
      }

      setClientes(data);
    } catch (error) {
      console.error("Error fetching customers:", error);
      setLoadError('No se pudieron cargar los clientes. Revisá tu conexión e intentá nuevamente.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const retryFetchClientes = () => {
    fetchClientes(true);
  };

  const filteredClientes = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    if (!query) return clientes;
    return clientes.filter(c => 
      (c.nombre_apellido || '').toLowerCase().includes(query) ||
      (c.razon_social || '').toLowerCase().includes(query) ||
      (c.localidad || '').toLowerCase().includes(query) ||
      (c.provincia || '').toLowerCase().includes(query) ||
      (c.codigo_postal || '').toLowerCase().includes(query) ||
      (c.direccion || '').toLowerCase().includes(query) ||
      (c.cuit || '').toLowerCase().includes(query) ||
      (c.telefono || '').toLowerCase().includes(query) ||
      (c.email || '').toLowerCase().includes(query)
    );
  }, [clientes, searchTerm]);

  const getLocalArgentinaPhone = (rawPhone: string) => {
    let digits = String(rawPhone || '').replace(/\D/g, '');

    if (digits.startsWith('549')) return digits.slice(3);
    if (digits.startsWith('54')) return digits.slice(2);
    if (digits.startsWith('9') && digits.length === 11) return digits.slice(1);

    return digits;
  };

  const normalizeArgentinaPhone = (rawPhone: string) => {
    const localPhone = getLocalArgentinaPhone(rawPhone);

    if (!localPhone) return '';

    return `+549${localPhone}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingCliente ? `/api/clientes?id=${editingCliente.id}` : '/api/clientes';
    const method = editingCliente ? 'PUT' : 'POST';

    try {
      const direccion = formData.direccion.trim();
      const hasCoordinates = Number.isFinite(Number(formData.latitud)) && Number.isFinite(Number(formData.longitud)) && Number(formData.latitud) !== 0 && Number(formData.longitud) !== 0;
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify({
          ...formData,
          direccion,
          localidad: formData.localidad.trim() || (direccion ? 'Carcarañá' : ''),
          provincia: formData.provincia.trim() || (direccion ? 'Santa Fe' : ''),
          codigo_postal: formData.codigo_postal.trim() || (direccion ? '2138' : ''),
          latitud: hasCoordinates ? Number(formData.latitud) : null,
          longitud: hasCoordinates ? Number(formData.longitud) : null,
          telefono: normalizeArgentinaPhone(formData.telefono)
        })
      });
      
      const body = await res.json();
      unwrapResponse(body);

      fetchClientes(false);
      closeModal();
    } catch (error) {
      console.error("Error saving customer:", error);
      alert("Error al guardar el cliente");
    }
  };

  const openLifecycleModal = (cliente: Cliente) => {
    setLifecycleTarget({
      cliente,
      action: cliente.activo === false || Number(cliente.activo) === 0 ? 'reactivate' : 'deactivate',
    });
    setLifecycleReason('');
  };

  const closeLifecycleModal = () => {
    if (lifecycleLoading) return;
    setLifecycleTarget(null);
    setLifecycleReason('');
  };

  const handleLifecycleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lifecycleTarget) return;

    const motivo = lifecycleReason.trim();
    if (motivo.length < 3) return;

    setLifecycleLoading(true);
    try {
      const response = await apiFetch(
        `/api/clientes?id=${lifecycleTarget.cliente.id}&action=${lifecycleTarget.action}`,
        { method: 'POST', body: JSON.stringify({ motivo }) }
      );
      const body = await response.json();
      unwrapResponse(body);
      await fetchClientes(false);
      setLifecycleTarget(null);
      setLifecycleReason('');
    } catch (error: any) {
      console.error('Error updating customer lifecycle:', error);
      alert(error?.message || 'No se pudo actualizar el estado del cliente.');
    } finally {
      setLifecycleLoading(false);
    }
  };

  const openModal = async (cliente?: Cliente) => {
    lastTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (cliente) {
      setEditingCliente(cliente);
      setFormData({
        nombre_apellido: cliente.nombre_apellido,
        razon_social: cliente.razon_social || '',
        cuit: cliente.cuit || '',
        localidad: cliente.localidad || '',
        provincia: cliente.provincia || '',
        codigo_postal: cliente.codigo_postal || '',
        telefono: getLocalArgentinaPhone(cliente.telefono || ''),
        email: cliente.email || '',
        direccion: cliente.direccion || '',
        latitud: cliente.latitud || 0,
        longitud: cliente.longitud || 0,
        observaciones: cliente.observaciones || '',
        tipo_cliente: cliente.tipo_cliente,
        lista_precio: cliente.lista_precio || 'lista1',
        limite_credito: cliente.limite_credito,
        portal_enabled: cliente.portal_enabled === 1 || cliente.portal_enabled === true,
        portal_username: cliente.portal_username || '',
        portal_password: ''
      });
    } else {
      let defaultLimit = 0;
      try {
        const res = await apiFetch('/api/config/settings');
        const body = await res.json();
        const settings = unwrapResponse(body);
        defaultLimit = parseFloat(settings.default_credit_limit || '0');
      } catch (e) {
        console.error("Error fetching default credit limit:", e);
      }

      setEditingCliente(null);
      setFormData({
        nombre_apellido: '',
        razon_social: '',
        cuit: '',
        localidad: '',
        provincia: '',
        codigo_postal: '',
        telefono: '',
        email: '',
        direccion: '',
        latitud: 0,
        longitud: 0,
        observaciones: '',
        tipo_cliente: 'minorista',
        lista_precio: 'lista1',
        limite_credito: defaultLimit,
        portal_enabled: false,
        portal_username: '',
        portal_password: ''
      });
    }
    setIsModalOpen(true);
  };


  const restoreTriggerFocus = () => {
    const target = lastTriggerRef.current;
    lastTriggerRef.current = null;

    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCliente(null);
    restoreTriggerFocus();
  };

  const openDetail = (clienteId: number, tab: 'ventas' | 'movimientos' | 'pedidos' = 'ventas') => {
    lastTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInitialDetailTab(tab);
    setSelectedClienteId(clienteId);
    setIsDetailOpen(true);
  };

  const closeDetail = () => {
    setIsDetailOpen(false);
    setSelectedClienteId(null);
    restoreTriggerFocus();
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2
    }).format(Number(value || 0));

  const hasValidCoordinates = (latitud?: number | null, longitud?: number | null) =>
    Number.isFinite(Number(latitud)) &&
    Number.isFinite(Number(longitud)) &&
    Number(latitud) !== 0 &&
    Number(longitud) !== 0;

  const getLocationLabel = (cliente: Cliente) => {
    const locationParts = [
      cliente.localidad,
      cliente.provincia,
      cliente.codigo_postal ? `CP ${cliente.codigo_postal}` : ''
    ].filter(Boolean);

    if (locationParts.length > 0) return locationParts.join(', ');
    if (cliente.direccion) return 'Dirección cargada';
    return 'Sin dirección cargada';
  };

  const customerSummary = useMemo(() => {
    const active = clientes.filter(cliente => cliente.activo !== false).length;
    const debtors = clientes.filter(cliente => Number(cliente.saldo_cta_cte || 0) > 0).length;
    const overdue = clientes.filter(cliente => cliente.tiene_deuda_vencida === 1).length;
    const portalEnabled = clientes.filter(cliente => cliente.portal_enabled === 1 || cliente.portal_enabled === true).length;
    const totalBalance = clientes.reduce((sum, cliente) => sum + Number(cliente.saldo_cta_cte || 0), 0);

    return { active, debtors, overdue, portalEnabled, totalBalance };
  }, [clientes]);

  if (loading) {
    return (
      <div
        className="min-h-full min-w-0 bg-slate-50/70 px-2 py-3 sm:px-4 sm:py-5 lg:px-6 lg:py-6"
        role="status"
        aria-live="polite"
        aria-label="Cargando clientes"
      >
        <div className="mx-auto min-w-0 max-w-[1500px] space-y-4 sm:space-y-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-5 py-7 sm:px-8 sm:py-9">
              <div className="h-4 w-32 animate-pulse rounded-full bg-white/15" />
              <div className="mt-4 h-9 w-72 max-w-full animate-pulse rounded-xl bg-white/20" />
              <div className="mt-3 h-4 w-[32rem] max-w-full animate-pulse rounded bg-white/10" />
            </div>
            <div className="grid grid-cols-1 gap-px bg-slate-200 min-[420px]:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="bg-white p-5">
                  <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
                  <div className="mt-3 h-8 w-20 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-36 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-5">
            <div className="flex items-center gap-3 text-sm font-bold text-slate-600">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
              Cargando clientes...
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex gap-3">
                  <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-slate-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-5 w-1/2 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  {Array.from({ length: 4 }).map((__, cell) => (
                    <div key={cell} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((__, action) => (
                    <div key={action} className="h-11 animate-pulse rounded-xl bg-slate-100" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError && clientes.length === 0) {
    return (
      <div className="min-h-full min-w-0 bg-slate-50/70 px-3 py-6 sm:px-6">
        <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
          <div className="w-full rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertCircle size={28} />
            </div>
            <h2 className="text-xl font-black text-slate-950">No se pudieron cargar los clientes</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{loadError}</p>
            <button
              type="button"
              onClick={retryFetchClientes}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 py-3 font-bold text-white transition hover:bg-slate-800 sm:w-auto"
            >
              <RefreshCw size={17} />
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full min-w-0 bg-slate-50/70 px-2 py-3 sm:px-4 sm:py-5 lg:px-6 lg:py-6">
      <div className="mx-auto min-w-0 max-w-[1500px] space-y-4 sm:space-y-5">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-5 py-6 text-white sm:px-8 sm:py-8">
            <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100">
                  <Users size={14} />
                  Gestión comercial
                </div>
                <h1 className="text-2xl font-black tracking-tight sm:text-4xl">Clientes</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                  Administrá datos comerciales, acceso al portal, ventas y cuenta corriente desde una vista clara y adaptable.
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 min-[480px]:flex-row lg:w-auto">
                <button
                  type="button"
                  onClick={() => fetchClientes(false)}
                  disabled={refreshing}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
                  title="Actualizar listado de clientes"
                  aria-label="Actualizar listado de clientes"
                >
                  <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Actualizando…' : 'Actualizar'}
                </button>

                {hasPermission('customers', 'create') && (
                  <button
                    type="button"
                    onClick={() => openModal()}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 lg:w-auto"
                  >
                    <UserPlus size={18} />
                    Nuevo cliente
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px bg-slate-200 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Clientes activos</p>
                  <p className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{customerSummary.active}</p>
                  <p className="mt-1 text-xs text-slate-500">de {clientes.length} registrados</p>
                </div>
                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><Users size={20} /></div>
              </div>
            </div>
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Saldo pendiente total</p>
                  <p className="mt-2 break-words text-xl font-black text-slate-950 sm:text-2xl">{formatCurrency(customerSummary.totalBalance)}</p>
                  <p className="mt-1 text-xs text-slate-500">{customerSummary.debtors} clientes con saldo</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600"><WalletCards size={20} /></div>
              </div>
            </div>
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Deudas vencidas</p>
                  <p className={`mt-2 text-2xl font-black sm:text-3xl ${customerSummary.overdue > 0 ? 'text-red-600' : 'text-slate-950'}`}>{customerSummary.overdue}</p>
                  <p className="mt-1 text-xs text-slate-500">requieren seguimiento</p>
                </div>
                <div className={`rounded-xl p-2.5 ${customerSummary.overdue > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}><AlertTriangle size={20} /></div>
              </div>
            </div>
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Portal habilitado</p>
                  <p className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{customerSummary.portalEnabled}</p>
                  <p className="mt-1 text-xs text-slate-500">clientes con acceso</p>
                </div>
                <div className="rounded-xl bg-cyan-50 p-2.5 text-cyan-700"><ShieldCheck size={20} /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-950">Listado de clientes</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {filteredClientes.length} resultado{filteredClientes.length === 1 ? '' : 's'} de {clientes.length}
                </p>
              </div>

              <div className="relative w-full lg:max-w-xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="search"
                  aria-label="Buscar clientes por nombre, razón social, CUIT, teléfono, email o localidad"
                  placeholder="Nombre, razón social, CUIT, teléfono, email o localidad..."
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                    aria-label="Limpiar búsqueda"
                    title="Limpiar búsqueda"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            {loadError && (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <span>{loadError}</span>
                </div>
                <button type="button" onClick={() => fetchClientes(false)} className="min-h-10 rounded-xl bg-amber-700 px-4 font-bold text-white hover:bg-amber-800">
                  Reintentar
                </button>
              </div>
            )}
          </div>

          {filteredClientes.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-4 rounded-2xl bg-slate-100 p-4 text-slate-500"><User size={30} /></div>
              <h3 className="text-lg font-black text-slate-950">
                {clientes.length === 0 ? 'Todavía no hay clientes' : 'No encontramos resultados'}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                {clientes.length === 0
                  ? 'Creá el primer cliente para comenzar a registrar ventas, pedidos y movimientos.'
                  : 'Probá con otro nombre, CUIT, teléfono o localidad.'}
              </p>
              <div className="mt-5 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
                {searchTerm && (
                  <button type="button" onClick={() => setSearchTerm('')} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 font-bold text-slate-700 hover:bg-slate-50">
                    Limpiar búsqueda
                  </button>
                )}
                {clientes.length === 0 && hasPermission('customers', 'create') && (
                  <button type="button" onClick={() => openModal()} className="min-h-11 rounded-xl bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700">
                    Crear cliente
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid min-w-0 gap-4 p-3 sm:p-4 xl:grid-cols-2">
              {filteredClientes.map((cliente) => {
                const hasBalance = Number(cliente.saldo_cta_cte || 0) > 0;
                const creditExceeded = Number(cliente.saldo_cta_cte || 0) > Number(cliente.limite_credito || 0) && Number(cliente.limite_credito || 0) > 0;
                const portalEnabled = cliente.portal_enabled === 1 || cliente.portal_enabled === true;
                const isActive = cliente.activo !== false && Number(cliente.activo) !== 0;

                return (
                  <article
                    key={cliente.id}
                    className={`min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                      !isActive ? 'border-slate-300 bg-slate-50/70' : cliente.tiene_deuda_vencida === 1 ? 'border-red-200' : 'border-slate-200'
                    }`}
                  >
                    <div className="p-4 sm:p-5">
                      <div className="flex min-w-0 flex-col gap-4 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${
                            cliente.tiene_deuda_vencida === 1
                              ? 'border-red-100 bg-red-50 text-red-600'
                              : 'border-indigo-100 bg-indigo-50 text-indigo-600'
                          }`}>
                            <User size={22} />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="min-w-0 break-words text-base font-black leading-5 text-slate-950">
                                {cliente.nombre_apellido}
                              </h3>
                              <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                                cliente.tipo_cliente === 'mayorista'
                                  ? 'border-indigo-100 bg-indigo-50 text-indigo-700'
                                  : 'border-emerald-100 bg-emerald-50 text-emerald-700'
                              }`}>
                                {cliente.tipo_cliente}
                              </span>
                              {!isActive && (
                                <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-600">
                                  Inactivo
                                </span>
                              )}
                              {portalEnabled && isActive && (
                                <span className="rounded-full border border-cyan-100 bg-cyan-50 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-cyan-700">
                                  Portal activo
                                </span>
                              )}
                            </div>
                            <p className="mt-1 break-words text-xs font-bold text-slate-500">
                              {cliente.razon_social || 'Sin razón social'}
                            </p>
                            {cliente.cuit && (
                              <p className="mt-1 break-all font-mono text-[10px] font-bold text-slate-400">CUIT: {cliente.cuit}</p>
                            )}
                            {!isActive && (cliente.deactivation_reason || cliente.deactivated_at) && (
                              <div className="mt-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-[10px] font-bold leading-4 text-slate-600">
                                <p className="font-black text-slate-700">Cliente dado de baja</p>
                                {cliente.deactivation_reason && <p className="mt-1 break-words">{cliente.deactivation_reason}</p>}
                                {(cliente.deactivated_by || cliente.deactivated_at) && (
                                  <p className="mt-1 text-slate-400">
                                    {cliente.deactivated_by || 'Usuario no informado'}
                                    {cliente.deactivated_at ? ` · ${new Date(cliente.deactivated_at).toLocaleString('es-AR')}` : ''}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className={`shrink-0 rounded-2xl px-4 py-3 text-left min-[480px]:text-right ${
                          hasBalance ? 'bg-red-50' : 'bg-emerald-50'
                        }`}>
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Saldo actual</p>
                          <p className={`mt-1 break-words text-xl font-black ${hasBalance ? 'text-red-600' : 'text-emerald-700'}`}>
                            {formatCurrency(cliente.saldo_cta_cte)}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500">
                            Límite {formatCurrency(cliente.limite_credito)}
                          </p>
                        </div>
                      </div>

                      {(cliente.tiene_deuda_vencida === 1 || creditExceeded) && (
                        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-700">
                          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                          <span>
                            {creditExceeded
                              ? 'El saldo supera el límite de crédito configurado.'
                              : 'Tiene una deuda vencida con más de 7 días.'}
                          </span>
                        </div>
                      )}

                      <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 min-[420px]:grid-cols-2">
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400"><MapPin size={13} /> Ubicación</dt>
                          <dd className="mt-1 break-words text-sm font-bold text-slate-700">
                            {getLocationLabel(cliente)}
                          </dd>
                          {cliente.direccion && <p className="mt-1 break-words text-xs text-slate-500">{cliente.direccion}</p>}
                          {cliente.direccion && !hasValidCoordinates(cliente.latitud, cliente.longitud) && (
                            <p className="mt-2 inline-flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-bold leading-4 text-amber-700">
                              <AlertCircle size={13} className="mt-0.5 shrink-0" />
                              Dirección cargada sin coordenadas
                            </p>
                          )}
                        </div>
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400"><Phone size={13} /> Contacto</dt>
                          <dd className="mt-1 break-all text-sm font-bold text-slate-700">{cliente.telefono || 'Sin teléfono'}</dd>
                          {cliente.email && <p className="mt-1 break-all text-xs text-slate-500">{cliente.email}</p>}
                        </div>
                      </dl>
                    </div>

                    <div className="border-t border-slate-100 bg-slate-50/80 p-3 sm:p-4">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Acciones</p>
                      <div className="grid grid-cols-2 gap-2 min-[600px]:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                        <button
                          type="button"
                          onClick={() => openDetail(cliente.id, 'ventas')}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-2 py-2.5 text-xs font-black text-indigo-700 transition hover:bg-indigo-100"
                          title={`Ver ficha de ${cliente.nombre_apellido}`}
                          aria-label={`Ver ficha de ${cliente.nombre_apellido}`}
                        >
                          <Eye size={16} />
                          Ver ficha
                        </button>
                        <button
                          type="button"
                          onClick={() => openDetail(cliente.id, 'movimientos')}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2.5 text-xs font-black text-emerald-700 transition hover:bg-emerald-100"
                          title={`Ver cuenta corriente de ${cliente.nombre_apellido}`}
                          aria-label={`Ver cuenta corriente de ${cliente.nombre_apellido}`}
                        >
                          <CreditCard size={16} />
                          Cuenta corriente
                        </button>
                        {hasPermission('customers', 'edit') && (
                          <button
                            type="button"
                            onClick={() => openModal(cliente)}
                            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-xs font-black text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                            title={`Editar ${cliente.nombre_apellido}`}
                            aria-label={`Editar cliente ${cliente.nombre_apellido}`}
                          >
                            <Edit2 size={16} />
                            Editar
                          </button>
                        )}
                        {hasPermission('customers', 'delete') && cliente.id !== 1 && (
                          <button
                            type="button"
                            onClick={() => openLifecycleModal(cliente)}
                            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border bg-white px-2 py-2.5 text-xs font-black transition ${
                              isActive
                                ? 'border-red-200 text-red-600 hover:bg-red-50'
                                : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                            }`}
                            title={isActive ? `Dar de baja ${cliente.nombre_apellido}` : `Reactivar ${cliente.nombre_apellido}`}
                            aria-label={isActive ? `Dar de baja cliente ${cliente.nombre_apellido}` : `Reactivar cliente ${cliente.nombre_apellido}`}
                          >
                            {isActive ? <Power size={16} /> : <RotateCcw size={16} />}
                            {isActive ? 'Dar de baja' : 'Reactivar'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {lifecycleTarget && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="customer-lifecycle-title">
          <form onSubmit={handleLifecycleSubmit} className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-lg sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div className="flex min-w-0 items-start gap-3">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${lifecycleTarget.action === 'deactivate' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {lifecycleTarget.action === 'deactivate' ? <Power size={22} /> : <RotateCcw size={22} />}
                </div>
                <div className="min-w-0">
                  <h2 id="customer-lifecycle-title" className="text-xl font-black text-slate-950">
                    {lifecycleTarget.action === 'deactivate' ? 'Dar de baja cliente' : 'Reactivar cliente'}
                  </h2>
                  <p className="mt-1 break-words text-sm text-slate-500">{lifecycleTarget.cliente.nombre_apellido}</p>
                </div>
              </div>
              <button type="button" onClick={closeLifecycleModal} disabled={lifecycleLoading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto p-5 sm:p-6">
              <div className={`rounded-2xl border p-4 text-sm leading-6 ${lifecycleTarget.action === 'deactivate' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                {lifecycleTarget.action === 'deactivate' ? (
                  <>El cliente dejará de estar disponible para ventas, pedidos, rutas y acceso al portal. Todo su historial se conservará. La baja será bloqueada si tiene saldo, pedidos, rutas o cheques activos.</>
                ) : (
                  <>El cliente volverá a estar disponible para ventas, pedidos y rutas. El acceso al portal deberá habilitarse nuevamente desde Editar cliente.</>
                )}
              </div>

              <label className="mt-5 block">
                <span className="text-xs font-black uppercase tracking-wider text-slate-600">Motivo obligatorio</span>
                <textarea value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value.slice(0, 500))} rows={4} autoFocus className="mt-2 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" placeholder={lifecycleTarget.action === 'deactivate' ? 'Ej.: Cliente que dejó de operar con la empresa' : 'Ej.: El cliente vuelve a operar'} disabled={lifecycleLoading} />
              </label>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className={lifecycleReason.trim().length > 0 && lifecycleReason.trim().length < 3 ? 'text-red-600' : 'text-slate-400'}>Mínimo 3 caracteres</span>
                <span className="text-slate-400">{lifecycleReason.length}/500</span>
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2 sm:p-6">
              <button type="button" onClick={closeLifecycleModal} disabled={lifecycleLoading} className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button type="submit" disabled={lifecycleLoading || lifecycleReason.trim().length < 3} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 ${lifecycleTarget.action === 'deactivate' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {lifecycleLoading && <Loader2 size={17} className="animate-spin" />}
                {lifecycleTarget.action === 'deactivate' ? 'Confirmar baja' : 'Confirmar reactivación'}
              </button>
            </div>
          </form>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200 sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-3xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Datos comerciales</p>
                <h2 id="customer-form-title" className="mt-1 break-words text-xl font-black text-slate-950 sm:text-2xl">
                  {editingCliente ? 'Editar cliente' : 'Nuevo cliente'}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Cerrar formulario de cliente"
                title="Cerrar"
              >
                <X size={20} />
              </button>
            </div>

            <form ref={customerFormRef} onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
              <div className="space-y-5">
                <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-black text-slate-950">Identificación y contacto</h3>
                    <p className="mt-1 text-xs text-slate-500">Información principal para ventas, comprobantes y comunicaciones.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="customer-name" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Nombre y apellido *</label>
                      <input ref={customerNameInputRef} id="customer-name" required type="text" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.nombre_apellido} onChange={(event) => setFormData({ ...formData, nombre_apellido: event.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="customer-business-name" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Razón social</label>
                      <input id="customer-business-name" type="text" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.razon_social} onChange={(event) => setFormData({ ...formData, razon_social: event.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="customer-tax-id" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">CUIT / CUIL</label>
                      <input id="customer-tax-id" type="text" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.cuit} onChange={(event) => setFormData({ ...formData, cuit: event.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="customer-email" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Email</label>
                      <input id="customer-email" type="email" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="customer-phone" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">WhatsApp / teléfono</label>
                      <div className="flex min-w-0">
                        <div className="flex min-h-11 shrink-0 items-center rounded-l-xl border border-slate-200 bg-slate-100 px-3 text-sm font-black text-slate-700">+54 9</div>
                        <input id="customer-phone" type="tel" inputMode="numeric" placeholder="3413111555" className="min-h-11 min-w-0 flex-1 rounded-r-xl border border-l-0 border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.telefono} onChange={(event) => setFormData({ ...formData, telefono: event.target.value.replace(/\D/g, '') })} />
                      </div>
                      <p className="mt-1.5 text-[10px] font-bold leading-4 text-slate-400">Ingresá código de área y celular, sin 0 ni 15. Ejemplo: 3413111555.</p>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-black text-slate-950">Condiciones comerciales</h3>
                    <p className="mt-1 text-xs text-slate-500">Tipo de cliente, lista de precios y crédito disponible.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
                    <div>
                      <label htmlFor="customer-type" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Tipo de cliente</label>
                      <select id="customer-type" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-bold outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.tipo_cliente} onChange={(event) => setFormData({ ...formData, tipo_cliente: event.target.value as any })}>
                        <option value="minorista">Minorista</option>
                        <option value="mayorista">Mayorista</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="customer-price-list" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Lista de precios</label>
                      <select id="customer-price-list" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-bold outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.lista_precio} onChange={(event) => setFormData({ ...formData, lista_precio: event.target.value })}>
                        <option value="lista1">Lista 1 (Minorista)</option>
                        <option value="lista2">Lista 2 (Mayorista)</option>
                        <option value="lista3">Lista 3 (Especial)</option>
                      </select>
                    </div>
                    <div className="min-[480px]:col-span-2">
                      <label htmlFor="customer-credit-limit" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Límite de crédito</label>
                      <input id="customer-credit-limit" type="number" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.limite_credito} onChange={(event) => setFormData({ ...formData, limite_credito: parseFloat(event.target.value) || 0 })} />
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-black text-slate-950">Domicilio</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Priorizamos Carcarañá, Santa Fe, CP 2138. Podés elegir una sugerencia o completar todo manualmente.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="customer-address" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Dirección</label>
                    <AddressAutocomplete
                      value={formData.direccion}
                      onInputChange={(direccion) => setFormData((current) => ({
                        ...current,
                        direccion,
                        localidad: direccion ? (current.localidad || 'Carcarañá') : '',
                        provincia: direccion ? (current.provincia || 'Santa Fe') : '',
                        codigo_postal: direccion ? (current.codigo_postal || '2138') : '',
                        latitud: 0,
                        longitud: 0
                      }))}
                      onChange={(address) => setFormData((current) => ({
                        ...current,
                        direccion: address.direccion,
                        localidad: address.localidad,
                        provincia: address.provincia,
                        codigo_postal: address.codigo_postal,
                        latitud: address.latitud,
                        longitud: address.longitud
                      }))}
                      placeholder="Ej.: Av. Belgrano 123, Carcarañá"
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label htmlFor="customer-locality" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Localidad</label>
                      <input
                        id="customer-locality"
                        type="text"
                        autoComplete="address-level2"
                        placeholder="Carcarañá"
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                        value={formData.localidad}
                        onChange={(event) => setFormData({ ...formData, localidad: event.target.value, latitud: 0, longitud: 0 })}
                      />
                    </div>
                    <div>
                      <label htmlFor="customer-province" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Provincia</label>
                      <input
                        id="customer-province"
                        type="text"
                        autoComplete="address-level1"
                        placeholder="Santa Fe"
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                        value={formData.provincia}
                        onChange={(event) => setFormData({ ...formData, provincia: event.target.value, latitud: 0, longitud: 0 })}
                      />
                    </div>
                    <div className="min-[480px]:col-span-2 lg:col-span-1">
                      <label htmlFor="customer-postal-code" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Código postal</label>
                      <input
                        id="customer-postal-code"
                        type="text"
                        inputMode="text"
                        autoComplete="postal-code"
                        maxLength={10}
                        placeholder="2138"
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                        value={formData.codigo_postal}
                        onChange={(event) => setFormData({ ...formData, codigo_postal: event.target.value, latitud: 0, longitud: 0 })}
                      />
                    </div>
                  </div>

                  {formData.direccion && (
                    <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs font-bold leading-5 ${
                      hasValidCoordinates(formData.latitud, formData.longitud)
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : 'border-amber-100 bg-amber-50 text-amber-800'
                    }`}>
                      <MapPin size={16} className="mt-0.5 shrink-0" />
                      <span>
                        {hasValidCoordinates(formData.latitud, formData.longitud)
                          ? 'Dirección geolocalizada. Estará disponible para mapas y Ruta del día.'
                          : 'Dirección cargada sin coordenadas. Se guardará igualmente, pero no aparecerá en el mapa hasta elegir una sugerencia geolocalizada.'}
                      </span>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-cyan-100 p-2 text-cyan-700"><KeyRound size={18} /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-black text-slate-950">Acceso al portal del cliente</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">Opcional. Permite consultar productos, pedidos, pagos y cuenta corriente.</p>
                    </div>
                  </div>
                  <label htmlFor="customer-portal-enabled" className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-cyan-100 bg-white px-3 py-2.5 text-sm font-bold text-slate-700">
                    <input id="customer-portal-enabled" type="checkbox" checked={formData.portal_enabled} onChange={(event) => setFormData({ ...formData, portal_enabled: event.target.checked })} className="h-5 w-5 accent-cyan-600" />
                    Habilitar acceso al portal
                  </label>
                  {formData.portal_enabled && (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="customer-portal-username" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Usuario del portal</label>
                        <input id="customer-portal-username" type="text" className="min-h-11 w-full rounded-xl border border-cyan-100 bg-white px-4 py-2.5 outline-none focus:ring-4 focus:ring-cyan-100" value={formData.portal_username} onChange={(event) => setFormData({ ...formData, portal_username: event.target.value })} placeholder="cliente123" />
                      </div>
                      <div>
                        <label htmlFor="customer-portal-password" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Contraseña del portal</label>
                        <input id="customer-portal-password" type="password" className="min-h-11 w-full rounded-xl border border-cyan-100 bg-white px-4 py-2.5 outline-none focus:ring-4 focus:ring-cyan-100" value={formData.portal_password} onChange={(event) => setFormData({ ...formData, portal_password: event.target.value })} placeholder={editingCliente ? 'Dejar vacío para no cambiar' : 'Mínimo 6 caracteres'} />
                      </div>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <label htmlFor="customer-notes" className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Observaciones</label>
                  <textarea id="customer-notes" className="min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" value={formData.observaciones || ''} onChange={(event) => setFormData({ ...formData, observaciones: event.target.value })} placeholder="Notas internas, referencias o condiciones especiales..." />
                </section>
              </div>

              <div className="sticky bottom-0 -mx-4 mt-6 border-t border-slate-100 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:-mx-6 sm:px-6">
                <div className="flex flex-col-reverse gap-2 min-[480px]:flex-row min-[480px]:justify-end">
                  <button type="button" onClick={closeModal} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 font-bold text-slate-700 hover:bg-slate-50">
                    Cancelar
                  </button>
                  <button type="submit" className="min-h-11 rounded-xl bg-indigo-600 px-6 font-black text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700">
                    {editingCliente ? 'Guardar cambios' : 'Crear cliente'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDetailOpen && selectedClienteId && (
        <CustomerDetail
          clienteId={selectedClienteId}
          initialTab={initialDetailTab}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
