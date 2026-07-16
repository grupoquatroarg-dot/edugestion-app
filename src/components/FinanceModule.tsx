import React, { useState, useEffect, useMemo } from 'react';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Calendar, 
  Search, 
  Download, 
  Plus, 
  Filter,
  DollarSign,
  CreditCard,
  FileText,
  Clock,
  History,
  User,
  CheckCircle2,
  AlertCircle,
  X,
  Eye,
  RefreshCw,
  Loader2,
  Landmark,
  Receipt,
  Building2,
  ChevronRight,
  RotateCcw,
  BadgeDollarSign,
  Banknote,
  Smartphone,
  Ban
} from 'lucide-react';
import { getSocket } from '../utils/socket';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';
import {
  formatBusinessDate,
  formatBusinessDateTime,
  formatBusinessTime,
  addBusinessDays,
  getBusinessDateInputValue,
  getBusinessDateKey,
} from '../utils/businessDate';

type Movimiento = {
  id: number;
  fecha: string;
  fecha_dia?: string;
  tipo: 'ingreso' | 'egreso';
  origen: 'venta' | 'pago_cc' | 'egreso_manual' | 'ajuste' | 'compra' | 'cobranza' | 'anulacion_venta' | 'anulacion_compra' | 'anulacion_egreso_manual';
  cliente_id: number | null;
  venta_id: number | null;
  descripcion: string;
  categoria?: string;
  forma_pago: string;
  monto: number;
  usuario: string;
  nombre_cliente?: string;
  estado?: string;
  reversion_version?: number;
  anulada_at?: string | null;
  anulada_por?: string | null;
  anulacion_motivo?: string | null;
  reversed_movement_id?: number | null;
  financial_movement_cancellation_id?: number | null;
};

type ConfigPaymentMethod = {
  id: number;
  name: string;
  tipo?: string;
};

const isCurrentAccountMethod = (value: unknown) =>
  String(value || '').trim().toLowerCase() === 'cta cte';

const toFinancePaymentValue = (name: string) => {
  const normalized = name.trim().toLowerCase();
  const aliases: Record<string, string> = {
    efectivo: 'efectivo',
    transferencia: 'transferencia',
    'mercado pago': 'mercado_pago',
    cheque: 'cheque_en_cartera',
  };
  return aliases[normalized] || name.trim();
};

const getPreferredExpensePayment = (methods: ConfigPaymentMethod[]) => {
  const values = methods
    .filter((method) => !isCurrentAccountMethod(method.name))
    .map((method) => toFinancePaymentValue(method.name));
  return values.find((value) => value.toLowerCase() === 'efectivo') || values[0] || '';
};

const readApiJson = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      response.ok
        ? 'El servidor devolvió una respuesta inválida.'
        : `No se pudo completar la solicitud al servidor (${response.status}).`
    );
  }

  const body = await response.json();
  return unwrapResponse(body);
};

export default function FinanceModule() {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'resumen' | 'caja' | 'egresos' | 'movimientos' | 'cheques'>('resumen');
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cheques, setCheques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getBusinessDateInputValue());
  const [showEgresoModal, setShowEgresoModal] = useState(false);
  const [movimientosSearch, setMovimientosSearch] = useState('');
  const [movimientosTypeFilter, setMovimientosTypeFilter] = useState<'todos' | 'ingreso' | 'egreso'>('todos');
  const [movimientosDateFilter, setMovimientosDateFilter] = useState('');
  const [chequesSearch, setChequesSearch] = useState('');
  const [chequesEstadoFilter, setChequesEstadoFilter] = useState('todos');
  const [chequesVencimientoFilter, setChequesVencimientoFilter] = useState('');
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ConfigPaymentMethod[]>([]);
  const [proveedoresLoading, setProveedoresLoading] = useState(false);
  const [proveedoresError, setProveedoresError] = useState('');
  const [selectedCheque, setSelectedCheque] = useState<any>(null);
  const [showChequeDetailModal, setShowChequeDetailModal] = useState(false);
  const [dataError, setDataError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmittingEgreso, setIsSubmittingEgreso] = useState(false);
  const [updatingChequeId, setUpdatingChequeId] = useState<number | null>(null);
  const [egresoError, setEgresoError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [cancellationTarget, setCancellationTarget] = useState<Movimiento | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationError, setCancellationError] = useState('');
  const [isCancellingExpense, setIsCancellingExpense] = useState(false);
  const [egresoForm, setEgresoForm] = useState({
    monto: '',
    descripcion: '',
    categoria: 'Otros',
    forma_pago: '',
    fecha: getBusinessDateInputValue(),
    cheque_id: '',
    proveedor_id: ''
  });

  const fetchMovimientos = async () => {
    try {
      const res = await apiFetch('/api/finanzas?endpoint=movimientos');
      const data = await readApiJson(res);
      setMovimientos(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching movements:", error);
      setDataError('No se pudieron cargar los movimientos financieros.');
    }
  };

  const fetchCheques = async () => {
    try {
      const res = await apiFetch('/api/finanzas?endpoint=cheques');
      const data = await readApiJson(res);
      setCheques(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching cheques:", error);
      setDataError((current) => current || 'No se pudieron cargar los cheques.');
    }
  };

  const fetchProveedores = async () => {
    setProveedoresLoading(true);
    setProveedoresError('');

    try {
      const res = await apiFetch('/api/finanzas?endpoint=proveedores');
      const data = await readApiJson(res);

      if (!Array.isArray(data)) {
        throw new Error('La respuesta de proveedores no tiene el formato esperado.');
      }

      setProveedores(data);
    } catch (error: any) {
      console.error("Error fetching suppliers:", error);
      setProveedores([]);
      setProveedoresError(error?.message || 'No se pudieron cargar los proveedores.');
    } finally {
      setProveedoresLoading(false);
    }
  };

  const fetchPaymentMethods = async () => {
    const res = await apiFetch('/api/finanzas?endpoint=payment-methods');
    const data = await readApiJson(res);
    const activeMethods = Array.isArray(data) ? data as ConfigPaymentMethod[] : [];
    setPaymentMethods(activeMethods);

    const availableValues = activeMethods
      .filter((method) => !isCurrentAccountMethod(method.name))
      .map((method) => toFinancePaymentValue(method.name));
    setEgresoForm((previous) => ({
      ...previous,
      forma_pago: availableValues.includes(previous.forma_pago)
        ? previous.forma_pago
        : getPreferredExpensePayment(activeMethods),
    }));
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setDataError('');
      await Promise.all([fetchMovimientos(), fetchCheques(), fetchProveedores(), fetchPaymentMethods()]);
      setLoading(false);
    };
    loadData();

    const socket = getSocket();
    socket.on('financial_movement_created', fetchMovimientos);
    socket.on('sale_confirmed', () => {
      fetchMovimientos();
      fetchCheques();
    });
    return () => {
      socket.off('financial_movement_created');
      socket.off('sale_confirmed');
    };
  }, []);

  const handleEgresoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingEgreso) return;

    setIsSubmittingEgreso(true);
    setEgresoError('');

    try {
      const res = await apiFetch('/api/finanzas?endpoint=egresos', {
        method: 'POST',
        body: JSON.stringify({
          ...egresoForm,
          monto: parseFloat(egresoForm.monto)
        })
      });

      const body = await res.json();
      unwrapResponse(body);

      setShowEgresoModal(false);
      setSuccessMessage('Egreso registrado correctamente.');
      setEgresoForm({
        monto: '',
        descripcion: '',
        categoria: 'Otros',
        forma_pago: getPreferredExpensePayment(paymentMethods),
        fecha: getBusinessDateInputValue(),
        cheque_id: '',
        proveedor_id: ''
      });
      await Promise.all([fetchMovimientos(), fetchCheques()]);
    } catch (error: any) {
      console.error("Error saving expense:", error);
      setEgresoError(error?.message || 'No se pudo registrar el egreso.');
    } finally {
      setIsSubmittingEgreso(false);
    }
  };

  const metricMovements = useMemo(
    () => movimientos.filter((movement) =>
      String(movement.estado || 'Activo').toLowerCase() !== 'anulado' &&
      movement.origen !== 'anulacion_egreso_manual'
    ),
    [movimientos]
  );

  const stats = useMemo(() => {
    const todayStr = getBusinessDateInputValue();
    const monthStr = todayStr.slice(0, 7);

    const ingresosDia = metricMovements
      .filter(m => m.tipo === 'ingreso' && (m.fecha_dia || getBusinessDateKey(m.fecha)) === todayStr)
      .reduce((acc, m) => acc + m.monto, 0);
    
    const egresosDia = metricMovements
      .filter(m => m.tipo === 'egreso' && (m.fecha_dia || getBusinessDateKey(m.fecha)) === todayStr)
      .reduce((acc, m) => acc + m.monto, 0);

    const ingresosMes = metricMovements
      .filter(m => m.tipo === 'ingreso' && (m.fecha_dia || getBusinessDateKey(m.fecha)).startsWith(monthStr))
      .reduce((acc, m) => acc + m.monto, 0);
    
    const egresosMes = metricMovements
      .filter(m => m.tipo === 'egreso' && (m.fecha_dia || getBusinessDateKey(m.fecha)).startsWith(monthStr))
      .reduce((acc, m) => acc + m.monto, 0);

    return {
      ingresosDia,
      egresosDia,
      resultadoDia: ingresosDia - egresosDia,
      ingresosMes,
      egresosMes,
      resultadoMes: ingresosMes - egresosMes
    };
  }, [metricMovements]);

  const cajaDiaria = useMemo(() => {
    return metricMovements.filter(m => (m.fecha_dia || getBusinessDateKey(m.fecha)) === selectedDate);
  }, [metricMovements, selectedDate]);

  const cajaStats = useMemo(() => {
    const ingresos = cajaDiaria.filter(m => m.tipo === 'ingreso');
    const egresos = cajaDiaria.filter(m => m.tipo === 'egreso');

    const efectivo = ingresos
      .filter(m => m.forma_pago.toLowerCase() === 'efectivo')
      .reduce((acc, m) => acc + m.monto, 0);
    
    const transferencia = ingresos
      .filter(m => m.forma_pago.toLowerCase() === 'transferencia')
      .reduce((acc, m) => acc + m.monto, 0);
    
    const mercadoPago = ingresos
      .filter(m => m.forma_pago.toLowerCase() === 'mercado_pago')
      .reduce((acc, m) => acc + m.monto, 0);

    const totalIngresos = ingresos.reduce((acc, m) => acc + m.monto, 0);
    const totalEgresos = egresos.reduce((acc, m) => acc + m.monto, 0);

    return {
      efectivo,
      transferencia,
      mercadoPago,
      totalIngresos,
      totalEgresos,
      resultadoNeto: totalIngresos - totalEgresos
    };
  }, [cajaDiaria]);

  const egresosList = useMemo(() => {
    return movimientos.filter(m => m.tipo === 'egreso' && m.origen !== 'anulacion_egreso_manual');
  }, [movimientos]);

  const handleUpdateChequeStatus = async (id: number, nuevoEstado: string) => {
    if (updatingChequeId === id) return;

    setUpdatingChequeId(id);
    setDataError('');

    try {
      const res = await apiFetch(`/api/finanzas?endpoint=cheques/${id}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado })
      });

      const body = await res.json();
      unwrapResponse(body);
      setSuccessMessage('Estado del cheque actualizado.');
      await fetchCheques();
    } catch (error: any) {
      console.error("Error updating cheque status:", error);
      setDataError(error?.message || 'No se pudo actualizar el estado del cheque.');
    } finally {
      setUpdatingChequeId(null);
    }
  };

  const canCancelManualExpense = (movement: Movimiento) =>
    movement.tipo === 'egreso' &&
    movement.origen === 'egreso_manual' &&
    Number(movement.reversion_version || 0) === 1 &&
    String(movement.estado || 'Activo').toLowerCase() !== 'anulado';

  const openExpenseCancellation = (movement: Movimiento) => {
    setCancellationTarget(movement);
    setCancellationReason('');
    setCancellationError('');
  };

  const closeExpenseCancellation = () => {
    if (isCancellingExpense) return;
    setCancellationTarget(null);
    setCancellationReason('');
    setCancellationError('');
  };

  const handleCancelManualExpense = async () => {
    if (!cancellationTarget || isCancellingExpense) return;

    const reason = cancellationReason.trim();
    if (reason.length < 3) {
      setCancellationError('El motivo debe tener al menos 3 caracteres.');
      return;
    }

    setIsCancellingExpense(true);
    setCancellationError('');

    try {
      const response = await apiFetch(
        `/api/finanzas?endpoint=manual-expense-cancel&id=${cancellationTarget.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ motivo: reason }),
        }
      );
      await readApiJson(response);
      setSuccessMessage('Egreso anulado correctamente.');
      setCancellationTarget(null);
      setCancellationReason('');
      await Promise.all([fetchMovimientos(), fetchCheques()]);
    } catch (error: any) {
      setCancellationError(error?.message || 'No se pudo anular el egreso.');
    } finally {
      setIsCancellingExpense(false);
    }
  };

  const filteredMovimientos = useMemo(() => {
    return movimientos.filter(m => {
      const matchesSearch = !movimientosSearch || 
        m.descripcion.toLowerCase().includes(movimientosSearch.toLowerCase()) ||
        (m.nombre_cliente && m.nombre_cliente.toLowerCase().includes(movimientosSearch.toLowerCase()));
      
      const matchesType = movimientosTypeFilter === 'todos' || m.tipo === movimientosTypeFilter;
      
      const matchesDate = !movimientosDateFilter || (m.fecha_dia || getBusinessDateKey(m.fecha)) === movimientosDateFilter;
      
      return matchesSearch && matchesType && matchesDate;
    });
  }, [movimientos, movimientosSearch, movimientosTypeFilter, movimientosDateFilter]);

  const filteredCheques = useMemo(() => {
    return cheques.filter(c => {
      const matchesSearch = !chequesSearch || 
        c.numero_cheque.toLowerCase().includes(chequesSearch.toLowerCase()) ||
        (c.nombre_cliente && c.nombre_cliente.toLowerCase().includes(chequesSearch.toLowerCase())) ||
        c.banco.toLowerCase().includes(chequesSearch.toLowerCase());
      
      const matchesEstado = chequesEstadoFilter === 'todos' || c.estado === chequesEstadoFilter;
      
      const matchesVencimiento = !chequesVencimientoFilter || c.fecha_vencimiento === chequesVencimientoFilter;
      
      return matchesSearch && matchesEstado && matchesVencimiento;
    });
  }, [cheques, chequesSearch, chequesEstadoFilter, chequesVencimientoFilter]);

  const chequesProximosAVencer = useMemo(() => {
    const today = getBusinessDateInputValue();
    const limit = addBusinessDays(today, 7);

    return cheques.filter(c => {
      if (c.estado !== 'en_cartera') return false;
      const dueDate = getBusinessDateKey(c.fecha_vencimiento);
      return Boolean(dueDate) && dueDate >= today && dueDate <= limit;
    });
  }, [cheques]);

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    setDataError('');
    await Promise.all([fetchMovimientos(), fetchCheques(), fetchProveedores()]);
    setIsRefreshing(false);
  };

  const formatCurrency = (value: number | string | null | undefined) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);

  const formatDate = (value: string, includeTime = false) =>
    includeTime ? formatBusinessDateTime(value, '-') : formatBusinessDate(value, '-');

  const paymentLabel = (value?: string) => {
    const labels: Record<string, string> = {
      efectivo: 'Efectivo',
      transferencia: 'Transferencia',
      mercado_pago: 'Mercado Pago',
      cheque: 'Cheque',
      cheque_en_cartera: 'Cheque en cartera',
      cuenta_corriente: 'Cuenta corriente',
      mixto: 'Pago mixto'
    };

    return labels[value || ''] || (value || 'Sin informar').replace(/_/g, ' ');
  };

  const originLabel = (value?: string) => {
    const labels: Record<string, string> = {
      venta: 'Venta',
      pago_cc: 'Pago de cuenta corriente',
      egreso_manual: 'Egreso manual',
      ajuste: 'Ajuste',
      anulacion_venta: 'Anulación de venta',
      anulacion_compra: 'Anulación de compra',
      anulacion_egreso_manual: 'Anulación de egreso manual'
    };

    return labels[value || ''] || (value || 'Sin origen').replace(/_/g, ' ');
  };

  const chequeStatusLabel = (value?: string) => {
    const labels: Record<string, string> = {
      en_cartera: 'En cartera',
      depositado: 'Depositado',
      entregado_proveedor: 'Entregado a proveedor',
      cobrado: 'Cobrado',
      rechazado: 'Rechazado',
      anulado: 'Anulado'
    };

    return labels[value || ''] || (value || 'Sin estado').replace(/_/g, ' ');
  };

  const chequeStatusClasses = (value?: string) => {
    if (value === 'en_cartera') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (value === 'depositado') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (value === 'cobrado') return 'border-slate-200 bg-slate-100 text-slate-700';
    if (value === 'rechazado') return 'border-red-200 bg-red-50 text-red-700';
    if (value === 'anulado') return 'border-zinc-300 bg-zinc-100 text-zinc-600';
    return 'border-amber-200 bg-amber-50 text-amber-700';
  };

  const tabItems = [
    { id: 'resumen', label: 'Resumen', icon: Wallet },
    { id: 'caja', label: 'Caja diaria', icon: Clock },
    { id: 'egresos', label: 'Egresos', icon: TrendingDown },
    { id: 'movimientos', label: 'Movimientos', icon: History },
    { id: 'cheques', label: 'Cheques', icon: CreditCard }
  ] as const;

  const summaryCard = (
    label: string,
    value: number,
    Icon: React.ComponentType<{ size?: number; className?: string }>,
    tone: 'emerald' | 'red' | 'indigo' | 'slate',
    formatAsCurrency = true
  ) => {
    const tones = {
      emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
      red: 'border-red-100 bg-red-50/70 text-red-700',
      indigo: 'border-indigo-100 bg-indigo-50/70 text-indigo-700',
      slate: 'border-slate-200 bg-slate-900 text-white'
    };

    return (
      <article className={`min-w-0 rounded-3xl border p-5 shadow-sm sm:p-6 ${tones[tone]}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={`text-[11px] font-black uppercase tracking-[0.16em] ${tone === 'slate' ? 'text-slate-300' : 'opacity-70'}`}>
              {label}
            </p>
            <p className="mt-3 break-words text-2xl font-black tracking-tight sm:text-3xl">
              {formatAsCurrency ? formatCurrency(value) : new Intl.NumberFormat('es-AR').format(value)}
            </p>
          </div>
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone === 'slate' ? 'bg-white/10' : 'bg-white/80'}`}>
            <Icon size={22} />
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="min-h-full min-w-0 bg-transparent">
      <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-5 px-3 pb-8 pt-3 sm:gap-6 sm:px-5 sm:pt-5 xl:px-7">
        <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950 text-white shadow-xl shadow-slate-950/10">
          <div className="relative p-5 sm:p-7">
            <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="relative flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex items-center gap-2 text-indigo-300">
                  <BadgeDollarSign size={18} />
                  <span className="text-[11px] font-black uppercase tracking-[0.2em]">Gestión financiera</span>
                </div>
                <h2 className="break-words text-2xl font-black tracking-tight sm:text-3xl">Finanzas y Caja</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  Controlá ingresos, egresos, movimientos diarios y cheques desde una vista clara y adaptable.
                </p>
              </div>

              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-auto">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  title="Actualizar datos financieros"
                  aria-label="Actualizar datos financieros"
                >
                  <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                  {isRefreshing ? 'Actualizando' : 'Actualizar'}
                </button>

                {hasPermission('current_accounts', 'create') && (
                  <button
                    type="button"
                    onClick={() => {
                      setEgresoError('');
                      setShowEgresoModal(true);
                    }}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-red-950/20 transition hover:bg-red-500"
                  >
                    <Plus size={18} />
                    Registrar egreso
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {successMessage && (
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800" role="status">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
            <p className="min-w-0 flex-1 break-words text-sm font-bold">{successMessage}</p>
            <button
              type="button"
              onClick={() => setSuccessMessage('')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-emerald-100"
              aria-label="Cerrar mensaje"
              title="Cerrar mensaje"
            >
              <X size={17} />
            </button>
          </div>
        )}

        {dataError && (
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-red-800 sm:flex-row sm:items-center" role="alert">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <p className="min-w-0 break-words text-sm font-bold">{dataError}</p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              <RotateCcw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              Reintentar
            </button>
          </div>
        )}

        <nav className="grid min-w-0 grid-cols-2 gap-2 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-3 xl:grid-cols-5" aria-label="Secciones de Finanzas">
          {tabItems.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-2xl px-3 py-3 text-xs font-black uppercase tracking-wide transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={17} className="shrink-0" />
                <span className="min-w-0 truncate">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {loading ? (
          <section className="space-y-4" aria-live="polite" aria-busy="true">
            <div className="flex items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-indigo-700">
              <Loader2 size={20} className="animate-spin" />
              <p className="text-sm font-bold">Cargando información financiera…</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div key={item} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white p-5">
                  <div className="h-4 w-28 rounded bg-slate-200" />
                  <div className="mt-6 h-8 w-40 rounded bg-slate-200" />
                  <div className="mt-5 h-3 w-full rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </section>
        ) : (
          <>
            {activeTab === 'resumen' && (
              <section className="space-y-6">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Clock size={18} className="text-indigo-600" />
                    <h3 className="text-base font-black text-slate-950">Resumen del día</h3>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {summaryCard('Ingresos del día', stats.ingresosDia, ArrowUpRight, 'emerald')}
                    {summaryCard('Egresos del día', stats.egresosDia, ArrowDownLeft, 'red')}
                    {summaryCard('Resultado del día', stats.resultadoDia, DollarSign, 'slate')}
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Calendar size={18} className="text-indigo-600" />
                    <h3 className="text-base font-black text-slate-950">Resumen del mes</h3>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {summaryCard('Ingresos del mes', stats.ingresosMes, TrendingUp, 'emerald')}
                    {summaryCard('Egresos del mes', stats.egresosMes, TrendingDown, 'red')}
                    {summaryCard('Resultado del mes', stats.resultadoMes, Wallet, 'indigo')}
                  </div>
                </div>

                <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <header className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                    <div>
                      <h3 className="text-lg font-black text-slate-950">Actividad reciente</h3>
                      <p className="mt-1 text-sm text-slate-500">Últimos movimientos registrados en la aplicación.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('movimientos')}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-200"
                    >
                      Ver movimientos
                      <ChevronRight size={16} />
                    </button>
                  </header>

                  {movimientos.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {movimientos.slice(0, 5).map((movement) => (
                        <div key={movement.id} className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                              movement.tipo === 'ingreso'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700'
                            }`}>
                              {movement.tipo === 'ingreso' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                            </div>
                            <div className="min-w-0">
                              <p className="break-words text-sm font-black text-slate-900">{movement.descripcion}</p>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs font-bold text-slate-500">
                                <span>{paymentLabel(movement.forma_pago)}</span>
                                <span>•</span>
                                <span>{formatDate(movement.fecha_dia || movement.fecha, true)}</span>
                                {movement.nombre_cliente && (
                                  <>
                                    <span>•</span>
                                    <span className="break-words">{movement.nombre_cliente}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <p className={`shrink-0 text-xl font-black ${
                            movement.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'
                          }`}>
                            {movement.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(movement.monto)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-10 text-center">
                      <History size={32} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-black text-slate-700">Todavía no hay movimientos</p>
                      <p className="mt-1 text-sm text-slate-500">Las ventas, cobros y egresos aparecerán aquí.</p>
                    </div>
                  )}
                </article>
              </section>
            )}

            {activeTab === 'caja' && (
              <section className="space-y-5">
                <div className="flex min-w-0 flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-xl font-black text-slate-950">Caja diaria</h3>
                    <p className="mt-1 break-words text-sm text-slate-500">
                      {formatBusinessDate(selectedDate)}
                    </p>
                  </div>
                  <label className="min-w-0 lg:w-64">
                    <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Fecha de caja</span>
                    <div className="relative">
                      <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(event) => setSelectedDate(event.target.value)}
                        className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      />
                    </div>
                  </label>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {summaryCard('Efectivo', cajaStats.efectivo, Banknote, 'emerald')}
                  {summaryCard('Transferencias', cajaStats.transferencia, Landmark, 'indigo')}
                  {summaryCard('Mercado Pago', cajaStats.mercadoPago, Smartphone, 'slate')}
                  {summaryCard('Resultado neto', cajaStats.resultadoNeto, Wallet, cajaStats.resultadoNeto >= 0 ? 'emerald' : 'red')}
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  {cajaDiaria.length > 0 ? cajaDiaria.map((movement) => (
                    <article key={movement.id} className={`min-w-0 rounded-3xl border p-5 shadow-sm ${String(movement.estado || 'Activo').toLowerCase() === 'anulado' ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`}>
                      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                            movement.tipo === 'ingreso'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-700'
                          }`}>
                            {movement.tipo === 'ingreso' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                          </div>
                          <div className="min-w-0">
                            <p className="break-words text-sm font-black text-slate-950">{movement.descripcion}</p>
                            <p className="mt-1 text-xs font-bold text-slate-500">{originLabel(movement.origen)}</p>
                          </div>
                        </div>
                        <p className={`shrink-0 text-xl font-black ${
                          movement.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {movement.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(movement.monto)}
                        </p>
                      </div>

                      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 border-t border-slate-100 pt-4 min-[420px]:grid-cols-2">
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Hora</p>
                          <p className="mt-1 text-sm font-bold text-slate-800">
                            {movement.fecha_dia ? 'Sin hora registrada' : formatBusinessTime(movement.fecha)}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Forma de pago</p>
                          <p className="mt-1 break-words text-sm font-bold text-slate-800">{paymentLabel(movement.forma_pago)}</p>
                        </div>
                      </div>
                    </article>
                  )) : (
                    <div className="col-span-full rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
                      <Clock size={32} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-black text-slate-700">No hay movimientos para esta fecha</p>
                      <p className="mt-1 text-sm text-slate-500">Elegí otra fecha o registrá una operación.</p>
                    </div>
                  )}
                </div>

                <article className="grid min-w-0 grid-cols-1 gap-3 rounded-3xl bg-slate-950 p-5 text-white sm:grid-cols-3 sm:p-6">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Ingresos del día</p>
                    <p className="mt-2 break-words text-xl font-black text-emerald-400">{formatCurrency(cajaStats.totalIngresos)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Egresos del día</p>
                    <p className="mt-2 break-words text-xl font-black text-red-400">{formatCurrency(cajaStats.totalEgresos)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Resultado</p>
                    <p className={`mt-2 break-words text-xl font-black ${cajaStats.resultadoNeto >= 0 ? 'text-white' : 'text-red-300'}`}>
                      {formatCurrency(cajaStats.resultadoNeto)}
                    </p>
                  </div>
                </article>
              </section>
            )}

            {activeTab === 'egresos' && (
              <section className="space-y-5">
                <div className="flex min-w-0 flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-xl font-black text-slate-950">Historial de egresos</h3>
                    <p className="mt-1 text-sm text-slate-500">Gastos manuales y salidas registradas en Finanzas.</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-red-700">
                    <p className="text-[10px] font-black uppercase tracking-wide text-red-500">Total del mes</p>
                    <p className="mt-1 break-words text-xl font-black">{formatCurrency(stats.egresosMes)}</p>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {egresosList.length > 0 ? egresosList.map((expense) => (
                    <article key={expense.id} className={`min-w-0 rounded-3xl border p-5 shadow-sm ${String(expense.estado || 'Activo').toLowerCase() === 'anulado' ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`}>
                      <div className="flex min-w-0 items-start justify-between gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-700">
                          <TrendingDown size={20} />
                        </div>
                        <div className="min-w-0 text-right">
                          <p className="break-words text-xl font-black text-red-600">-{formatCurrency(expense.monto)}</p>
                          <span className="mt-2 inline-flex max-w-full rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                            <span className="truncate">{expense.categoria || 'Otros'}</span>
                          </span>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap items-center gap-2">
                        <p className={`break-words text-sm font-black ${String(expense.estado || 'Activo').toLowerCase() === 'anulado' ? 'text-red-900 line-through' : 'text-slate-950'}`}>{expense.descripcion}</p>
                        {String(expense.estado || 'Activo').toLowerCase() === 'anulado' && (
                          <span className="rounded-full border border-red-200 bg-red-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-red-700">Anulado</span>
                        )}
                      </div>
                      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Fecha</p>
                          <p className="mt-1 text-sm font-bold text-slate-800">{formatDate(expense.fecha_dia || expense.fecha)}</p>
                        </div>
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Forma de pago</p>
                          <p className="mt-1 break-words text-sm font-bold text-slate-800">{paymentLabel(expense.forma_pago)}</p>
                        </div>
                      </div>

                      {String(expense.estado || 'Activo').toLowerCase() === 'anulado' && (
                        <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-800">
                          <p className="font-black">Egreso anulado</p>
                          <p className="mt-1 break-words">Motivo: {expense.anulacion_motivo || 'Sin motivo informado'}</p>
                          <p className="mt-1 text-xs font-bold text-red-600">
                            {expense.anulada_por || 'Sistema'}
                            {expense.anulada_at ? ` · ${formatDate(expense.anulada_at, true)}` : ''}
                          </p>
                        </div>
                      )}

                      {hasPermission('current_accounts', 'delete') && canCancelManualExpense(expense) && (
                        <button
                          type="button"
                          onClick={() => openExpenseCancellation(expense)}
                          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-red-700 hover:bg-red-100"
                        >
                          <Ban size={17} />
                          Anular egreso
                        </button>
                      )}

                      {expense.origen === 'egreso_manual' && Number(expense.reversion_version || 0) !== 1 && String(expense.estado || 'Activo').toLowerCase() !== 'anulado' && expense.categoria !== 'Cheque Rechazado' && (
                        <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                          Egreso histórico sin trazabilidad para anular.
                        </p>
                      )}
                    </article>
                  )) : (
                    <div className="col-span-full rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
                      <TrendingDown size={32} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-black text-slate-700">No hay egresos registrados</p>
                      <p className="mt-1 text-sm text-slate-500">Los gastos aparecerán aquí cuando se registren.</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'movimientos' && (
              <section className="space-y-5">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-xl font-black text-slate-950">Todos los movimientos</h3>
                      <p className="mt-1 text-sm text-slate-500">{filteredMovimientos.length} resultados visibles.</p>
                    </div>
                    {(movimientosSearch || movimientosTypeFilter !== 'todos' || movimientosDateFilter) && (
                      <button
                        type="button"
                        onClick={() => {
                          setMovimientosSearch('');
                          setMovimientosTypeFilter('todos');
                          setMovimientosDateFilter('');
                        }}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-200"
                      >
                        <RotateCcw size={16} />
                        Limpiar filtros
                      </button>
                    )}
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="min-w-0 sm:col-span-2">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Buscar</span>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                        <input
                          type="text"
                          placeholder="Cliente o descripción"
                          value={movimientosSearch}
                          onChange={(event) => setMovimientosSearch(event.target.value)}
                          className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                        />
                      </div>
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Fecha</span>
                      <input
                        type="date"
                        value={movimientosDateFilter}
                        onChange={(event) => setMovimientosDateFilter(event.target.value)}
                        className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Tipo</span>
                      <select
                        value={movimientosTypeFilter}
                        onChange={(event) => setMovimientosTypeFilter(event.target.value as 'todos' | 'ingreso' | 'egreso')}
                        className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      >
                        <option value="todos">Todos</option>
                        <option value="ingreso">Ingresos</option>
                        <option value="egreso">Egresos</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  {filteredMovimientos.length > 0 ? filteredMovimientos.map((movement) => (
                    <article key={movement.id} className={`min-w-0 rounded-3xl border p-5 shadow-sm ${String(movement.estado || 'Activo').toLowerCase() === 'anulado' ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`}>
                      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                            movement.tipo === 'ingreso'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-700'
                          }`}>
                            {movement.tipo === 'ingreso' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${
                                movement.tipo === 'ingreso'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-red-200 bg-red-50 text-red-700'
                              }`}>
                                {movement.tipo}
                              </span>
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                                {originLabel(movement.origen)}
                              </span>
                              {String(movement.estado || 'Activo').toLowerCase() === 'anulado' && (
                                <span className="rounded-full border border-red-200 bg-red-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-red-700">
                                  Anulado
                                </span>
                              )}
                            </div>
                            <p className={`mt-3 break-words text-sm font-black ${String(movement.estado || 'Activo').toLowerCase() === 'anulado' ? 'text-red-900 line-through' : 'text-slate-950'}`}>{movement.descripcion}</p>
                          </div>
                        </div>
                        <p className={`shrink-0 break-words text-xl font-black ${
                          movement.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {movement.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(movement.monto)}
                        </p>
                      </div>

                      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 border-t border-slate-100 pt-4 min-[420px]:grid-cols-2">
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Fecha</p>
                          <p className="mt-1 break-words text-sm font-bold text-slate-800">{formatDate(movement.fecha_dia || movement.fecha, true)}</p>
                        </div>
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Forma de pago</p>
                          <p className="mt-1 break-words text-sm font-bold text-slate-800">{paymentLabel(movement.forma_pago)}</p>
                        </div>
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3 min-[420px]:col-span-2">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Cliente</p>
                          <p className="mt-1 break-words text-sm font-bold text-slate-800">{movement.nombre_cliente || 'Sin cliente asociado'}</p>
                        </div>
                      </div>

                      {String(movement.estado || 'Activo').toLowerCase() === 'anulado' && (
                        <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-800">
                          <p className="font-black">Egreso anulado</p>
                          <p className="mt-1 break-words">Motivo: {movement.anulacion_motivo || 'Sin motivo informado'}</p>
                          <p className="mt-1 text-xs font-bold text-red-600">
                            {movement.anulada_por || 'Sistema'}
                            {movement.anulada_at ? ` · ${formatDate(movement.anulada_at, true)}` : ''}
                          </p>
                        </div>
                      )}

                      {hasPermission('current_accounts', 'delete') && canCancelManualExpense(movement) && (
                        <button
                          type="button"
                          onClick={() => openExpenseCancellation(movement)}
                          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-red-700 hover:bg-red-100"
                        >
                          <Ban size={17} />
                          Anular egreso
                        </button>
                      )}

                      {movement.tipo === 'egreso' && movement.origen === 'egreso_manual' && Number(movement.reversion_version || 0) !== 1 && String(movement.estado || 'Activo').toLowerCase() !== 'anulado' && movement.categoria !== 'Cheque Rechazado' && (
                        <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                          Egreso histórico sin trazabilidad para anular.
                        </p>
                      )}
                    </article>
                  )) : (
                    <div className="col-span-full rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
                      <Search size={32} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-black text-slate-700">No hay movimientos para estos filtros</p>
                      <p className="mt-1 text-sm text-slate-500">Probá limpiar los filtros o elegir otra fecha.</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'cheques' && (
              <section className="space-y-5">
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {summaryCard('Cheques en cartera', cheques.filter((cheque) => cheque.estado === 'en_cartera').length, CreditCard, 'emerald', false)}
                  {summaryCard('Importe total', cheques.reduce((total, cheque) => total + Number(cheque.importe || 0), 0), Wallet, 'indigo')}
                  {summaryCard('Próximos a vencer', chequesProximosAVencer.length, AlertCircle, chequesProximosAVencer.length > 0 ? 'red' : 'slate', false)}
                </div>

                {chequesProximosAVencer.length > 0 && (
                  <article className="rounded-3xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
                    <div className="flex items-start gap-3 text-amber-900">
                      <AlertCircle size={22} className="mt-0.5 shrink-0" />
                      <div>
                        <h3 className="font-black">Cheques próximos a vencer</h3>
                        <p className="mt-1 text-sm text-amber-700">Vencen dentro de los próximos siete días.</p>
                      </div>
                    </div>
                    <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {chequesProximosAVencer.map((cheque) => (
                        <div key={cheque.id} className="min-w-0 rounded-2xl border border-amber-200 bg-white/80 p-4">
                          <p className="break-words text-sm font-black text-slate-950">{cheque.banco} · N.º {cheque.numero_cheque}</p>
                          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold text-amber-700">Vence {formatDate(cheque.fecha_vencimiento)}</span>
                            <span className="break-words text-sm font-black text-slate-950">{formatCurrency(cheque.importe)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                )}

                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-xl font-black text-slate-950">Cartera de cheques</h3>
                      <p className="mt-1 text-sm text-slate-500">{filteredCheques.length} resultados visibles.</p>
                    </div>
                    {(chequesSearch || chequesEstadoFilter !== 'todos' || chequesVencimientoFilter) && (
                      <button
                        type="button"
                        onClick={() => {
                          setChequesSearch('');
                          setChequesEstadoFilter('todos');
                          setChequesVencimientoFilter('');
                        }}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-200"
                      >
                        <RotateCcw size={16} />
                        Limpiar filtros
                      </button>
                    )}
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="min-w-0 sm:col-span-2">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Buscar</span>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                        <input
                          type="text"
                          placeholder="Cliente, banco o número"
                          value={chequesSearch}
                          onChange={(event) => setChequesSearch(event.target.value)}
                          className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                        />
                      </div>
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Vencimiento</span>
                      <input
                        type="date"
                        value={chequesVencimientoFilter}
                        onChange={(event) => setChequesVencimientoFilter(event.target.value)}
                        className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Estado</span>
                      <select
                        value={chequesEstadoFilter}
                        onChange={(event) => setChequesEstadoFilter(event.target.value)}
                        className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      >
                        <option value="todos">Todos</option>
                        <option value="en_cartera">En cartera</option>
                        <option value="depositado">Depositado</option>
                        <option value="entregado_proveedor">Entregado a proveedor</option>
                        <option value="cobrado">Cobrado</option>
                        <option value="rechazado">Rechazado</option>
                        <option value="anulado">Anulado</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  {filteredCheques.length > 0 ? filteredCheques.map((cheque) => (
                    <article key={cheque.id} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                            <CreditCard size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="break-words text-base font-black text-slate-950">{cheque.banco}</p>
                            <p className="mt-1 break-all text-xs font-bold uppercase tracking-wide text-slate-500">N.º {cheque.numero_cheque}</p>
                          </div>
                        </div>
                        <div className="min-w-0 text-left sm:text-right">
                          <p className="break-words text-xl font-black text-slate-950">{formatCurrency(cheque.importe)}</p>
                          <span className={`mt-2 inline-flex max-w-full rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${chequeStatusClasses(cheque.estado)}`}>
                            <span className="truncate">{chequeStatusLabel(cheque.estado)}</span>
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 border-t border-slate-100 pt-4 min-[420px]:grid-cols-2">
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Cliente</p>
                          <p className="mt-1 break-words text-sm font-bold text-slate-800">{cheque.nombre_cliente || 'Sin cliente'}</p>
                        </div>
                        <div className="min-w-0 rounded-2xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Vencimiento</p>
                          <p className={`mt-1 text-sm font-bold ${
                            getBusinessDateKey(cheque.fecha_vencimiento) < getBusinessDateInputValue() && cheque.estado === 'en_cartera'
                              ? 'text-red-700'
                              : 'text-slate-800'
                          }`}>
                            {formatDate(cheque.fecha_vencimiento)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCheque(cheque);
                            setShowChequeDetailModal(true);
                          }}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100"
                          title="Ver detalle del cheque"
                          aria-label={`Ver detalle del cheque ${cheque.numero_cheque}`}
                        >
                          <Eye size={17} />
                          Ver detalle
                        </button>

                        {hasPermission('current_accounts', 'edit') ? (
                          <label className="min-w-0">
                            <span className="sr-only">Cambiar estado del cheque</span>
                            <select
                              value={cheque.estado}
                              disabled={updatingChequeId === cheque.id || cheque.estado === 'anulado'}
                              onChange={(event) => handleUpdateChequeStatus(cheque.id, event.target.value)}
                              className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-black uppercase tracking-wide text-slate-800 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={`Cambiar estado del cheque ${cheque.numero_cheque}`}
                            >
                              <option value="en_cartera">En cartera</option>
                              <option value="depositado">Depositado</option>
                              <option value="entregado_proveedor">Entregado a proveedor</option>
                              <option value="cobrado">Cobrado</option>
                              <option value="rechazado">Rechazado</option>
                              {cheque.estado === 'anulado' && <option value="anulado">Anulado</option>}
                            </select>
                          </label>
                        ) : (
                          <div className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                            {chequeStatusLabel(cheque.estado)}
                          </div>
                        )}
                      </div>

                      {updatingChequeId === cheque.id && (
                        <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">
                          <Loader2 size={15} className="animate-spin" />
                          Actualizando estado…
                        </div>
                      )}
                    </article>
                  )) : (
                    <div className="col-span-full rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
                      <CreditCard size={32} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-black text-slate-700">No hay cheques para estos filtros</p>
                      <p className="mt-1 text-sm text-slate-500">Limpiá los filtros para volver a ver la cartera completa.</p>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {showChequeDetailModal && selectedCheque && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[30px] bg-white shadow-2xl sm:max-h-[90dvh] sm:max-w-xl sm:rounded-[30px]">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-slate-950 p-5 text-white sm:p-6">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-300">Detalle de cheque</p>
                <h3 className="mt-2 break-words text-xl font-black">{selectedCheque.banco}</h3>
                <p className="mt-1 break-all text-sm font-bold text-slate-300">N.º {selectedCheque.numero_cheque}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowChequeDetailModal(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 hover:bg-white/15"
                aria-label="Cerrar detalle del cheque"
                title="Cerrar"
              >
                <X size={20} />
              </button>
            </header>

            <div className="min-w-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
              <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <div className="min-w-0 rounded-2xl bg-indigo-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wide text-indigo-500">Importe</p>
                  <p className="mt-2 break-words text-2xl font-black text-indigo-950">{formatCurrency(selectedCheque.importe)}</p>
                </div>
                <div className="min-w-0 rounded-2xl bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Estado</p>
                  <span className={`mt-2 inline-flex max-w-full rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${chequeStatusClasses(selectedCheque.estado)}`}>
                    <span className="truncate">{chequeStatusLabel(selectedCheque.estado)}</span>
                  </span>
                </div>
              </div>

              <dl className="space-y-3">
                <div className="grid min-w-0 grid-cols-1 gap-1 rounded-2xl border border-slate-100 p-4 min-[420px]:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Cliente emisor</dt>
                  <dd className="break-words text-sm font-bold text-slate-900 min-[420px]:text-right">{selectedCheque.nombre_cliente || 'Sin cliente'}</dd>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-1 rounded-2xl border border-slate-100 p-4 min-[420px]:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Venta asociada</dt>
                  <dd className="break-words text-sm font-bold text-slate-900 min-[420px]:text-right">
                    {selectedCheque.numero_venta ? `Venta N.º ${selectedCheque.numero_venta}` : 'No asociada a venta'}
                  </dd>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-1 rounded-2xl border border-slate-100 p-4 min-[420px]:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Vencimiento</dt>
                  <dd className="text-sm font-bold text-slate-900 min-[420px]:text-right">{formatDate(selectedCheque.fecha_vencimiento)}</dd>
                </div>
                {selectedCheque.proveedor_id && (
                  <div className="grid min-w-0 grid-cols-1 gap-1 rounded-2xl border border-slate-100 p-4 min-[420px]:grid-cols-[140px_minmax(0,1fr)]">
                    <dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Proveedor</dt>
                    <dd className="break-words text-sm font-bold text-slate-900 min-[420px]:text-right">
                      {selectedCheque.nombre_proveedor || 'Proveedor asociado'}
                      {selectedCheque.fecha_entrega && (
                        <span className="mt-1 block text-xs text-slate-500">Entregado el {formatDate(selectedCheque.fecha_entrega)}</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {selectedCheque.observaciones && (
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Observaciones</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{selectedCheque.observaciones}</p>
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-slate-100 bg-white p-4 sm:p-5">
              <button
                type="button"
                onClick={() => setShowChequeDetailModal(false)}
                className="min-h-11 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black uppercase tracking-wide text-white hover:bg-slate-800"
              >
                Cerrar detalle
              </button>
            </footer>
          </div>
        </div>
      )}

      {cancellationTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div className="min-w-0">
                <h3 className="text-xl font-black text-slate-950">Anular egreso manual</h3>
                <p className="mt-1 break-words text-sm text-slate-500">
                  {cancellationTarget.descripcion} · {formatCurrency(cancellationTarget.monto)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeExpenseCancellation}
                disabled={isCancellingExpense}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Cerrar anulación de egreso"
              >
                <X size={20} />
              </button>
            </header>

            <div className="space-y-4 p-5 sm:p-6">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
                El egreso permanecerá como historial. Se creará un contramovimiento y, si utilizó un cheque todavía entregado al proveedor, volverá a quedar en cartera.
              </div>

              <label className="block">
                <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Motivo obligatorio</span>
                <textarea
                  value={cancellationReason}
                  onChange={(event) => {
                    setCancellationReason(event.target.value.slice(0, 500));
                    setCancellationError('');
                  }}
                  rows={4}
                  maxLength={500}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
                  placeholder="Ej.: Egreso cargado por duplicado"
                />
              </label>

              {cancellationError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">
                  {cancellationError}
                </div>
              )}
            </div>

            <footer className="grid grid-cols-1 gap-3 border-t border-slate-100 p-5 sm:grid-cols-2 sm:p-6">
              <button
                type="button"
                onClick={closeExpenseCancellation}
                disabled={isCancellingExpense}
                className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleCancelManualExpense}
                disabled={isCancellingExpense || cancellationReason.trim().length < 3}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-sm font-black uppercase tracking-wide text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancellingExpense ? <Loader2 size={18} className="animate-spin" /> : <Ban size={18} />}
                {isCancellingExpense ? 'Anulando…' : 'Confirmar anulación'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {showEgresoModal && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[30px] bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-[30px]">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-red-100 bg-red-600 p-5 text-white sm:p-6">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-100">Nueva salida de fondos</p>
                <h3 className="mt-2 text-xl font-black">Registrar egreso</h3>
                <p className="mt-1 text-sm text-red-100">Completá los datos del gasto antes de confirmar.</p>
              </div>
              <button
                type="button"
                onClick={() => !isSubmittingEgreso && setShowEgresoModal(false)}
                disabled={isSubmittingEgreso}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 hover:bg-white/15 disabled:opacity-50"
                aria-label="Cerrar formulario de egreso"
                title="Cerrar"
              >
                <X size={20} />
              </button>
            </header>

            <form onSubmit={handleEgresoSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-w-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
                {egresoError && (
                  <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" />
                    <p className="min-w-0 break-words text-sm font-bold">{egresoError}</p>
                  </div>
                )}

                <label className="block min-w-0">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Monto del gasto</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-black text-slate-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      autoFocus
                      value={egresoForm.monto}
                      onChange={(event) => setEgresoForm({ ...egresoForm, monto: event.target.value })}
                      className="min-h-14 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-2xl font-black text-slate-950 outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
                      placeholder="0,00"
                    />
                  </div>
                </label>

                <label className="block min-w-0">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Descripción o concepto</span>
                  <input
                    type="text"
                    required
                    value={egresoForm.descripcion}
                    onChange={(event) => setEgresoForm({ ...egresoForm, descripcion: event.target.value })}
                    className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
                    placeholder="Ej.: Alquiler, servicio, compra o impuesto"
                  />
                </label>

                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="min-w-0">
                    <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Categoría</span>
                    <select
                      value={egresoForm.categoria}
                      onChange={(event) => setEgresoForm({ ...egresoForm, categoria: event.target.value })}
                      className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
                    >
                      <option value="Proveedor">Proveedor</option>
                      <option value="Servicios">Servicios</option>
                      <option value="Impuestos">Impuestos</option>
                      <option value="Sueldos">Sueldos</option>
                      <option value="Otros">Otros</option>
                    </select>
                  </label>

                  <label className="min-w-0">
                    <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Forma de pago</span>
                    <select
                      value={egresoForm.forma_pago}
                      onChange={(event) => setEgresoForm({
                        ...egresoForm,
                        forma_pago: event.target.value,
                        cheque_id: event.target.value === 'cheque_en_cartera' ? egresoForm.cheque_id : '',
                        proveedor_id: event.target.value === 'cheque_en_cartera' ? egresoForm.proveedor_id : ''
                      })}
                      className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
                    >
                      {paymentMethods.filter((method) => !isCurrentAccountMethod(method.name)).length === 0 && (
                        <option value="">No hay formas de pago activas</option>
                      )}
                      {paymentMethods
                        .filter((method) => !isCurrentAccountMethod(method.name))
                        .map((method) => {
                          const value = toFinancePaymentValue(method.name);
                          return (
                            <option key={method.id} value={value}>
                              {value === 'cheque_en_cartera' ? 'Cheque en cartera' : method.name}
                            </option>
                          );
                        })}
                    </select>
                  </label>
                </div>

                {egresoForm.forma_pago === 'cheque_en_cartera' && (
                  <div className="space-y-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
                    <label className="block min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-amber-800">Seleccionar cheque</span>
                      <select
                        required
                        value={egresoForm.cheque_id}
                        onChange={(event) => {
                          const cheque = cheques.find((item) => item.id === parseInt(event.target.value, 10));
                          setEgresoForm({
                            ...egresoForm,
                            cheque_id: event.target.value,
                            monto: cheque ? cheque.importe.toString() : egresoForm.monto,
                            descripcion: cheque
                              ? `Pago con Cheque N.º ${cheque.numero_cheque} - ${cheque.banco}`
                              : egresoForm.descripcion
                          });
                        }}
                        className="min-h-11 w-full min-w-0 rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
                      >
                        <option value="">Seleccionar cheque…</option>
                        {cheques.filter((cheque) => cheque.estado === 'en_cartera').map((cheque) => (
                          <option key={cheque.id} value={cheque.id}>
                            N.º {cheque.numero_cheque} · {cheque.banco} · {formatCurrency(cheque.importe)} · {formatDate(cheque.fecha_vencimiento)}
                          </option>
                        ))}
                      </select>
                    </label>

                    {egresoForm.categoria === 'Proveedor' && (
                      <div className="space-y-3">
                        <label className="block min-w-0">
                          <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-amber-800">Proveedor destino</span>
                          <select
                            required
                            disabled={proveedoresLoading || Boolean(proveedoresError)}
                            value={egresoForm.proveedor_id}
                            onChange={(event) => setEgresoForm({ ...egresoForm, proveedor_id: event.target.value })}
                            className="min-h-11 w-full min-w-0 rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="">
                              {proveedoresLoading
                                ? 'Cargando proveedores…'
                                : proveedores.length === 0
                                  ? 'No hay proveedores disponibles'
                                  : 'Seleccionar proveedor…'}
                            </option>
                            {proveedores.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.nombre}</option>
                            ))}
                          </select>
                        </label>

                        {proveedoresError && (
                          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center" role="alert">
                            <div className="flex min-w-0 flex-1 items-start gap-2">
                              <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
                              <p className="min-w-0 break-words text-xs font-bold text-red-700">{proveedoresError}</p>
                            </div>
                            <button
                              type="button"
                              onClick={fetchProveedores}
                              className="min-h-11 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-red-700 hover:bg-red-100"
                            >
                              Reintentar
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <label className="block min-w-0">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Fecha</span>
                  <input
                    type="date"
                    required
                    value={egresoForm.fecha}
                    onChange={(event) => setEgresoForm({ ...egresoForm, fecha: event.target.value })}
                    className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
                  />
                </label>
              </div>

              <footer className="grid shrink-0 grid-cols-1 gap-3 border-t border-slate-100 bg-white p-4 sm:grid-cols-2 sm:p-5">
                <button
                  type="button"
                  onClick={() => setShowEgresoModal(false)}
                  disabled={isSubmittingEgreso}
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEgreso}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-red-200 hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmittingEgreso ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  {isSubmittingEgreso ? 'Registrando…' : 'Confirmar egreso'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
