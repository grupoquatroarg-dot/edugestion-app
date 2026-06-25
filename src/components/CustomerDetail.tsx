import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  TrendingUp, 
  Calendar, 
  DollarSign, 
  Clock, 
  ShoppingBag, 
  ArrowLeft, 
  Package, 
  CreditCard,
  History,
  AlertCircle,
  CheckCircle2,
  Building2,
  MapPin,
  Phone,
  Mail,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight,
  Eye,
  FileDown,
  Download,
  Filter,
  RotateCcw,
  Search
} from 'lucide-react';
import { getSocket } from '../utils/socket';
import { generateSaleReceipt } from '../utils/pdfGenerator';
import { unwrapResponse, apiFetch } from '../utils/api';
import { formatBusinessDate, formatBusinessDateTime, getBusinessDateInputValue } from '../utils/businessDate';

const socket = getSocket();

interface CustomerDetailProps {
  clienteId: number;
  onClose: () => void;
  initialTab?: 'ventas' | 'movimientos' | 'pedidos';
}

export default function CustomerDetail({ clienteId, onClose, initialTab = 'ventas' }: CustomerDetailProps) {
  const [data, setData] = useState<any>(null);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'ventas' | 'movimientos' | 'pedidos'>(initialTab);
  const [accountSummary, setAccountSummary] = useState({ total_sales: 0, total_payments: 0, pending_balance: 0, pending_sales: 0, paid_sales: 0 });
  const [selectedMovement, setSelectedMovement] = useState<any>(null);
  const [movementFilters, setMovementFilters] = useState({
    dateFrom: '',
    dateTo: '',
    type: 'all',
    status: 'all',
    search: ''
  });
  const [downloadingSaleId, setDownloadingSaleId] = useState<number | null>(null);
  const [businessSettings, setBusinessSettings] = useState<Record<string, string>>({});
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    monto: '',
    fecha: getBusinessDateInputValue(),
    metodo_pago: '',
    observaciones: ''
  });
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const fetchStats = async (): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/clientes?endpoint=client-detail&id=${clienteId}`);
      const body = await res.json();
      const stats = unwrapResponse(body);
      setData(stats);
      return true;
    } catch (error) {
      console.error("Error fetching stats:", error);
      return false;
    }
  };

  const fetchMovimientos = async (): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/clientes?endpoint=client-account&id=${clienteId}`);
      const body = await res.json();
      const account = unwrapResponse(body) as any;
      setMovimientos(account.movements || []);
      setAccountSummary(account.summary || { total_sales: 0, total_payments: 0, pending_balance: 0, pending_sales: 0, paid_sales: 0 });
      return true;
    } catch (error) {
      console.error("Error fetching movements:", error);
      return false;
    }
  };

  const fetchSaleDetails = async (saleId: number) => {
    try {
      const res = await apiFetch(`/api/sales?id=${saleId}`);
      const body = await res.json();
      const sale = unwrapResponse(body);
      setSelectedSale(sale);
    } catch (error) {
      console.error("Error fetching sale details:", error);
    }
  };

  const fetchBusinessSettings = async () => {
    try {
      const res = await apiFetch('/api/config/settings');
      const body = await res.json();
      const data = unwrapResponse(body);
      setBusinessSettings(data);
    } catch (error) {
      console.error("Error fetching business settings:", error);
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const res = await apiFetch('/api/config/payment-methods?active=true');
      const body = await res.json();
      const data = unwrapResponse(body);
      setPaymentMethods(data);
      if (data.length > 0) {
        setPaymentForm(prev => ({ ...prev, metodo_pago: data[0].name }));
      }
    } catch (error) {
      console.error("Error fetching payment methods:", error);
    }
  };

  const handleDownloadReceipt = async (saleId: number) => {
    try {
      setDownloadingSaleId(saleId);
      const res = await apiFetch(`/api/sales?id=${saleId}`);
      const body = await res.json();
      const sale = unwrapResponse(body);
      generateSaleReceipt(sale, businessSettings);
    } catch (error) {
      console.error("Error generating receipt:", error);
    } finally {
      setDownloadingSaleId(null);
    }
  };

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.monto || parseFloat(paymentForm.monto) <= 0) return;

    try {
      setSubmittingPayment(true);
      const res = await apiFetch(`/api/clientes?endpoint=client-payment&id=${clienteId}`, {
        method: 'POST',
        body: JSON.stringify({
          monto: parseFloat(paymentForm.monto),
          fecha: paymentForm.fecha,
          metodo_pago: paymentForm.metodo_pago,
          observaciones: paymentForm.observaciones
        })
      });
      const body = await res.json();

      if (!res.ok) {
        const errorData = unwrapResponse(body);
        throw new Error(errorData.message || "Error al registrar el pago");
      }

      await Promise.all([fetchStats(), fetchMovimientos()]);
      setShowPaymentModal(false);
      setPaymentForm({
        monto: '',
        fecha: getBusinessDateInputValue(),
        metodo_pago: paymentMethods.length > 0 ? paymentMethods[0].name : '',
        observaciones: ''
      });
      alert("Pago registrado con éxito");
    } catch (error: any) {
      console.error("Error registering payment:", error);
      alert(error.message || "Error al registrar el pago");
    } finally {
      setSubmittingPayment(false);
    }
  };

  const loadCustomerData = async () => {
    setLoading(true);
    setLoadError(null);

    const [statsOk, movementsOk] = await Promise.all([fetchStats(), fetchMovimientos()]);
    await Promise.allSettled([fetchBusinessSettings(), fetchPaymentMethods()]);

    if (!statsOk || !movementsOk) {
      setLoadError('No se pudo cargar la ficha completa del cliente. Revisá tu conexión e intentá nuevamente.');
    }

    setLoading(false);
  };

  useEffect(() => {
    loadCustomerData();

    // Real-time updates
    socket.on('sale_confirmed', (sale) => {
      if (sale.cliente_id === clienteId) {
        fetchStats();
        fetchMovimientos();
      }
    });

    return () => {
      socket.off('sale_confirmed');
    };
  }, [clienteId]);

  const filteredMovements = useMemo(() => {
    const search = movementFilters.search.trim().toLowerCase();

    return movimientos.filter((movement: any) => {
      const movementDate = String(movement.fecha || '').slice(0, 10);

      if (movementFilters.dateFrom && movementDate < movementFilters.dateFrom) return false;
      if (movementFilters.dateTo && movementDate > movementFilters.dateTo) return false;
      if (movementFilters.type !== 'all' && movement.operation_type !== movementFilters.type) return false;

      if (movementFilters.status === 'pending') {
        if (movement.operation_type !== 'venta' || Number(movement.monto_pendiente || 0) <= 0) return false;
      }

      if (movementFilters.status === 'paid') {
        const isPaidSale = movement.operation_type === 'venta' && Number(movement.monto_pendiente || 0) <= 0;
        const isPayment = movement.operation_type === 'pago';
        if (!isPaidSale && !isPayment) return false;
      }

      if (search) {
        const haystack = [
          movement.descripcion,
          movement.numero_venta,
          movement.numero_pedido,
          movement.numero_pago,
          movement.metodo_pago,
          movement.estado,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }, [movimientos, movementFilters]);

  const resetMovementFilters = () => {
    setMovementFilters({ dateFrom: '', dateTo: '', type: 'all', status: 'all', search: '' });
  };


  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2
    }).format(Number(value || 0));

  const formatDateTime = (value: string) => formatBusinessDateTime(value, '-');

  const formatDate = (value: string) => formatBusinessDate(value, '-');

  const formatMovementDate = (movement: any) =>
    movement?.operation_type === 'venta'
      ? formatDateTime(movement.fecha)
      : formatDate(movement?.fecha);

  if (loading) {
    return (
      <div
        className="absolute inset-0 z-30 flex min-w-0 flex-col overflow-hidden bg-slate-50"
        role="status"
        aria-live="polite"
        aria-label="Cargando ficha del cliente"
      >
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3">
            <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Volver a clientes" title="Volver a clientes">
              <ArrowLeft size={21} />
            </button>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-6 w-52 max-w-full animate-pulse rounded-lg bg-slate-200" />
              <div className="h-3 w-80 max-w-full animate-pulse rounded bg-slate-100" />
            </div>
            <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Cerrar ficha" title="Cerrar">
              <X size={21} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4 lg:p-6">
          <div className="mx-auto max-w-[1500px] space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-3 text-sm font-bold text-slate-600">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
                Cargando ficha del cliente...
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
                  <div className="mt-3 h-8 w-32 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-40 max-w-full animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
              <div className="grid grid-cols-3 gap-px border-b border-slate-100 bg-slate-100 p-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-xl bg-white" />
                ))}
              </div>
              <div className="grid gap-3 p-3 xl:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !data || !data.cliente) {
    return (
      <div className="absolute inset-0 z-30 flex min-w-0 flex-col overflow-hidden bg-slate-50">
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Volver a clientes" title="Volver a clientes">
              <ArrowLeft size={21} />
            </button>
            <p className="text-sm font-black text-slate-700">Ficha del cliente</p>
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Cerrar ficha" title="Cerrar">
              <X size={21} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <div className="w-full max-w-lg rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertCircle size={28} />
            </div>
            <h2 className="text-xl font-black text-slate-950">No se pudo cargar la ficha</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {loadError || 'La respuesta del cliente no contiene la información esperada.'}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 min-[440px]:flex-row min-[440px]:justify-center">
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 font-bold text-slate-700 hover:bg-slate-50">
                Volver a clientes
              </button>
              <button type="button" onClick={loadCustomerData} className="min-h-11 rounded-xl bg-slate-950 px-5 font-bold text-white hover:bg-slate-800">
                Reintentar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { cliente, summary, sales, total_payments, pending_orders } = data;

  return (
    <div className="absolute inset-0 z-30 flex min-w-0 flex-col overflow-hidden bg-slate-50 animate-in slide-in-from-right duration-300">
      <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-3 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
              aria-label="Volver a clientes"
              title="Volver a clientes"
            >
              <ArrowLeft size={21} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words text-lg font-black leading-6 text-slate-950 sm:text-2xl">
                  {cliente.nombre_apellido}
                </h1>
                <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                  cliente.tipo_cliente === 'mayorista'
                    ? 'border-indigo-100 bg-indigo-50 text-indigo-700'
                    : 'border-emerald-100 bg-emerald-50 text-emerald-700'
                }`}>
                  {cliente.tipo_cliente}
                </span>
              </div>

              <div className="mt-1.5 flex flex-col gap-1 text-xs text-slate-500 min-[560px]:flex-row min-[560px]:flex-wrap min-[560px]:gap-x-4">
                {cliente.razon_social && (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <Building2 size={13} className="mt-0.5 shrink-0" />
                    <span className="break-words">{cliente.razon_social}</span>
                  </span>
                )}
                {(cliente.direccion || cliente.localidad) && (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <MapPin size={13} className="mt-0.5 shrink-0" />
                    <span className="break-words">{[cliente.direccion, cliente.localidad].filter(Boolean).join(', ')}</span>
                  </span>
                )}
                {cliente.telefono && (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <Phone size={13} className="mt-0.5 shrink-0" />
                    <span className="break-all">{cliente.telefono}</span>
                  </span>
                )}
                {cliente.email && (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <Mail size={13} className="mt-0.5 shrink-0" />
                    <span className="break-all">{cliente.email}</span>
                  </span>
                )}
              </div>
            </div>

            <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar ficha" title="Cerrar">
              <X size={21} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 min-[430px]:grid-cols-[minmax(0,1fr)_auto] lg:flex lg:items-center">
            <div className={`min-w-0 rounded-2xl border px-4 py-3 min-[430px]:text-right ${
              Number(cliente.saldo_cta_cte || 0) > 0
                ? 'border-red-100 bg-red-50'
                : 'border-emerald-100 bg-emerald-50'
            }`}>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Saldo cuenta corriente</p>
              <p className={`mt-1 break-words text-xl font-black ${
                Number(cliente.saldo_cta_cte || 0) > 0 ? 'text-red-600' : 'text-emerald-700'
              }`}>
                {formatCurrency(cliente.saldo_cta_cte)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-700"
            >
              <DollarSign size={18} />
              Registrar pago
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4 lg:p-6 custom-scrollbar">
        <div className="mx-auto max-w-[1500px] space-y-4 sm:space-y-5">
          <section className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Total vendido</p>
                  <p className="mt-2 break-words text-xl font-black text-slate-950 sm:text-2xl">{formatCurrency(summary.total_purchased || 0)}</p>
                  <p className="mt-1 text-xs text-slate-500">{summary.total_sales_count || 0} ventas registradas</p>
                </div>
                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><TrendingUp size={20} /></div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Total cobrado</p>
                  <p className="mt-2 break-words text-xl font-black text-emerald-700 sm:text-2xl">{formatCurrency(accountSummary.total_payments || total_payments || 0)}</p>
                  <p className="mt-1 text-xs text-slate-500">{accountSummary.paid_sales || 0} ventas pagadas</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600"><CreditCard size={20} /></div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Saldo pendiente</p>
                  <p className="mt-2 break-words text-xl font-black text-red-600 sm:text-2xl">{formatCurrency(accountSummary.pending_balance || cliente.saldo_cta_cte || 0)}</p>
                  <p className="mt-1 text-xs text-slate-500">{accountSummary.pending_sales || 0} ventas con saldo</p>
                </div>
                <div className="rounded-xl bg-red-50 p-2.5 text-red-600"><Clock size={20} /></div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Pedidos pendientes</p>
                  <p className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{pending_orders.length}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {summary.last_purchase_date ? `Última compra ${formatDate(summary.last_purchase_date)}` : 'Sin compras registradas'}
                  </p>
                </div>
                <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600"><Package size={20} /></div>
              </div>
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
            <div className="grid grid-cols-3 gap-1 border-b border-slate-100 bg-slate-50 p-2">
              <button
                type="button"
                onClick={() => setActiveTab('ventas')}
                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-[10px] font-black transition min-[500px]:flex-row min-[500px]:text-xs ${
                  activeTab === 'ventas' ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/70'
                }`}
              >
                <ShoppingBag size={16} />
                <span className="break-words">Ventas ({sales.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('movimientos')}
                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-[10px] font-black transition min-[500px]:flex-row min-[500px]:text-xs ${
                  activeTab === 'movimientos' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/70'
                }`}
              >
                <History size={16} />
                <span className="break-words">Cuenta corriente</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('pedidos')}
                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-[10px] font-black transition min-[500px]:flex-row min-[500px]:text-xs ${
                  activeTab === 'pedidos' ? 'bg-white text-amber-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/70'
                }`}
              >
                <Package size={16} />
                <span className="break-words">Pedidos ({pending_orders.length})</span>
              </button>
            </div>

            {activeTab === 'ventas' && (
              <div className="p-3 sm:p-4">
                {sales.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
                    <div className="mb-4 rounded-2xl bg-slate-100 p-4 text-slate-400"><ShoppingBag size={30} /></div>
                    <h3 className="font-black text-slate-950">No hay ventas registradas</h3>
                    <p className="mt-2 max-w-md text-sm text-slate-500">Las ventas del cliente aparecerán aquí con su estado de pago y comprobante.</p>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                    {sales.map((sale: any) => {
                      const pending = Number(sale.monto_pendiente || 0);
                      return (
                        <article key={sale.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                          <div className="p-4 sm:p-5">
                            <div className="flex min-w-0 flex-col gap-3 min-[460px]:flex-row min-[460px]:items-start min-[460px]:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-mono text-sm font-black text-slate-950">Venta #{sale.numero_venta || sale.id}</p>
                                  <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                                    pending > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                                  }`}>
                                    {pending > 0 ? 'Pendiente' : 'Pagada'}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{formatDateTime(sale.fecha)}</p>
                              </div>
                              <div className="rounded-2xl bg-slate-950 px-4 py-3 text-left text-white min-[460px]:text-right">
                                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total</p>
                                <p className="mt-1 break-words text-lg font-black">{formatCurrency(sale.total)}</p>
                              </div>
                            </div>

                            <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 min-[420px]:grid-cols-3">
                              <div className="min-w-0 bg-slate-50 p-3">
                                <dt className="text-[9px] font-black uppercase tracking-wider text-slate-400">Medio de pago</dt>
                                <dd className="mt-1 break-words text-xs font-black text-slate-700">{sale.metodo_pago || '-'}</dd>
                              </div>
                              <div className="min-w-0 bg-slate-50 p-3">
                                <dt className="text-[9px] font-black uppercase tracking-wider text-slate-400">Pagado</dt>
                                <dd className="mt-1 break-words text-xs font-black text-emerald-700">{formatCurrency(Number(sale.total || 0) - pending)}</dd>
                              </div>
                              <div className="min-w-0 bg-slate-50 p-3">
                                <dt className="text-[9px] font-black uppercase tracking-wider text-slate-400">Pendiente</dt>
                                <dd className={`mt-1 break-words text-xs font-black ${pending > 0 ? 'text-red-600' : 'text-slate-500'}`}>{formatCurrency(pending)}</dd>
                              </div>
                            </dl>
                          </div>

                          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/80 p-3 sm:p-4">
                            <button type="button" onClick={() => fetchSaleDetails(sale.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-black text-indigo-700 hover:bg-indigo-100">
                              <Eye size={16} />
                              Ver detalle
                            </button>
                            <button type="button" onClick={() => handleDownloadReceipt(sale.id)} disabled={downloadingSaleId === sale.id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                              {downloadingSaleId === sale.id ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" /> : <FileDown size={16} />}
                              PDF
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'movimientos' && (
              <div className="space-y-4 p-3 sm:p-4">
                <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Ventas</p>
                    <p className="mt-1 break-words text-xl font-black text-indigo-800">{formatCurrency(accountSummary.total_sales || 0)}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Cobrado</p>
                    <p className="mt-1 break-words text-xl font-black text-emerald-700">{formatCurrency(accountSummary.total_payments || 0)}</p>
                  </div>
                  <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-red-500">Pendiente</p>
                    <p className="mt-1 break-words text-xl font-black text-red-600">{formatCurrency(accountSummary.pending_balance || 0)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Estado</p>
                    <p className={`mt-1 text-sm font-black ${Number(accountSummary.pending_balance || 0) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {Number(accountSummary.pending_balance || 0) > 0 ? `${accountSummary.pending_sales || 0} operaciones pendientes` : 'Cuenta al día'}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
                    <div className="flex items-center gap-2">
                      <Filter size={17} className="text-indigo-600" />
                      <div>
                        <h3 className="text-sm font-black text-slate-950">Filtrar movimientos</h3>
                        <p className="text-xs text-slate-500">{filteredMovements.length} resultado{filteredMovements.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                    <button type="button" onClick={resetMovementFilters} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 hover:bg-slate-50">
                      <RotateCcw size={14} />
                      Limpiar filtros
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                    <div>
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Desde</label>
                      <input type="date" value={movementFilters.dateFrom} onChange={(event) => setMovementFilters({ ...movementFilters, dateFrom: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-indigo-100" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Hasta</label>
                      <input type="date" value={movementFilters.dateTo} onChange={(event) => setMovementFilters({ ...movementFilters, dateTo: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-indigo-100" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Operación</label>
                      <select value={movementFilters.type} onChange={(event) => setMovementFilters({ ...movementFilters, type: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-100">
                        <option value="all">Todas</option>
                        <option value="venta">Ventas</option>
                        <option value="pago">Pagos</option>
                        <option value="ajuste">Ajustes</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Estado</label>
                      <select value={movementFilters.status} onChange={(event) => setMovementFilters({ ...movementFilters, status: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-100">
                        <option value="all">Todos</option>
                        <option value="pending">Pendientes</option>
                        <option value="paid">Pagados</option>
                      </select>
                    </div>
                    <div className="min-[480px]:col-span-2 lg:col-span-1">
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Venta, pedido o pago</label>
                      <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="search" value={movementFilters.search} onChange={(event) => setMovementFilters({ ...movementFilters, search: event.target.value })} placeholder="Buscar referencia..." className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:ring-4 focus:ring-indigo-100" />
                      </div>
                    </div>
                  </div>
                </div>

                {filteredMovements.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
                    <CreditCard size={36} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-bold">No hay movimientos para los filtros seleccionados.</p>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                    {filteredMovements.map((movement: any) => {
                      const reference = movement.numero_venta
                        ? `Venta #${movement.numero_venta}`
                        : movement.numero_pago
                          ? `Pago #${movement.numero_pago}`
                          : movement.numero_pedido
                            ? `Pedido #${movement.numero_pedido}`
                            : 'Sin referencia';

                      return (
                        <article key={movement.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                          <div className="p-4">
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                                    movement.operation_type === 'venta'
                                      ? 'bg-violet-50 text-violet-700'
                                      : movement.operation_type === 'pago'
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {movement.operation_type}
                                  </span>
                                  <span className="break-all font-mono text-[10px] font-bold text-slate-500">{reference}</span>
                                </div>
                                <h4 className="mt-2 break-words text-sm font-black leading-5 text-slate-950">{movement.descripcion || 'Movimiento de cuenta corriente'}</h4>
                                <p className="mt-1 text-xs text-slate-400">{formatMovementDate(movement)}</p>
                              </div>
                              <button type="button" onClick={() => movement.venta_id ? fetchSaleDetails(Number(movement.venta_id)) : setSelectedMovement(movement)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50" title="Ver detalle" aria-label="Ver detalle del movimiento">
                                <Eye size={17} />
                              </button>
                            </div>

                            <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 min-[500px]:grid-cols-4">
                              <div className="min-w-0 bg-slate-50 p-3">
                                <dt className="text-[9px] font-black uppercase text-slate-400">Medio</dt>
                                <dd className="mt-1 break-words text-xs font-bold text-slate-700">{movement.metodo_pago || '-'}</dd>
                              </div>
                              <div className="min-w-0 bg-slate-50 p-3">
                                <dt className="text-[9px] font-black uppercase text-slate-400">Debe</dt>
                                <dd className="mt-1 break-words text-xs font-black text-red-600">{Number(movement.debe || 0) > 0 ? formatCurrency(movement.debe) : '-'}</dd>
                              </div>
                              <div className="min-w-0 bg-slate-50 p-3">
                                <dt className="text-[9px] font-black uppercase text-slate-400">Haber</dt>
                                <dd className="mt-1 break-words text-xs font-black text-emerald-700">{Number(movement.haber || 0) > 0 ? formatCurrency(movement.haber) : '-'}</dd>
                              </div>
                              <div className="min-w-0 bg-slate-50 p-3">
                                <dt className="text-[9px] font-black uppercase text-slate-400">Saldo posterior</dt>
                                <dd className="mt-1 break-words text-xs font-black text-slate-950">{formatCurrency(movement.saldo_resultante)}</dd>
                              </div>
                            </dl>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'pedidos' && (
              <div className="p-3 sm:p-4">
                {pending_orders.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
                    <div className="mb-4 rounded-2xl bg-emerald-50 p-4 text-emerald-600"><CheckCircle2 size={30} /></div>
                    <h3 className="font-black text-slate-950">No hay pedidos pendientes</h3>
                    <p className="mt-2 text-sm text-slate-500">El cliente no tiene productos pendientes de entrega.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {pending_orders.map((order: any) => (
                      <article key={order.id} className="min-w-0 rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm"><Package size={20} /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 min-[460px]:flex-row min-[460px]:items-start min-[460px]:justify-between">
                              <div className="min-w-0">
                                <h4 className="break-words text-sm font-black text-slate-950">{order.product_name}</h4>
                                <p className="mt-1 break-words text-xs font-bold text-slate-500">{order.company || 'Sin empresa'}</p>
                              </div>
                              <span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-black uppercase text-amber-700">Pendiente</span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <div className="rounded-xl bg-white p-3">
                                <p className="text-[9px] font-black uppercase text-slate-400">Cantidad</p>
                                <p className="mt-1 text-sm font-black text-slate-950">{order.quantity}</p>
                              </div>
                              <div className="rounded-xl bg-white p-3">
                                <p className="text-[9px] font-black uppercase text-slate-400">Fecha</p>
                                <p className="mt-1 text-sm font-black text-slate-950">{formatDate(order.order_date)}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {showPaymentModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-md sm:rounded-3xl">
            <div className="flex shrink-0 items-center justify-between gap-3 bg-emerald-600 p-4 text-white sm:p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-100">Cuenta corriente</p>
                <h3 className="mt-1 text-lg font-black">Registrar pago</h3>
              </div>
              <button type="button" onClick={() => setShowPaymentModal(false)} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10" aria-label="Cerrar pago" title="Cerrar">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleRegisterPayment} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Monto a pagar</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">$</span>
                    <input type="number" step="0.01" min="0.01" required className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-8 pr-4 text-lg font-black outline-none focus:ring-4 focus:ring-emerald-100" value={paymentForm.monto} onChange={(event) => setPaymentForm({ ...paymentForm, monto: event.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Fecha</label>
                    <input type="date" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-4 focus:ring-emerald-100" value={paymentForm.fecha} onChange={(event) => setPaymentForm({ ...paymentForm, fecha: event.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Medio de pago</label>
                    <select className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-100" value={paymentForm.metodo_pago} onChange={(event) => setPaymentForm({ ...paymentForm, metodo_pago: event.target.value })}>
                      {paymentMethods.map(method => <option key={method.id} value={method.name}>{method.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Observaciones</label>
                  <textarea className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-emerald-100" value={paymentForm.observaciones || ''} onChange={(event) => setPaymentForm({ ...paymentForm, observaciones: event.target.value })} placeholder="Ejemplo: pago parcial de factura..." />
                </div>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-2 min-[480px]:flex-row">
                <button type="button" onClick={() => setShowPaymentModal(false)} disabled={submittingPayment} className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Cancelar
                </button>
                <button type="submit" disabled={submittingPayment} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 font-black text-white hover:bg-emerald-700 disabled:opacity-50">
                  {submittingPayment && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  {submittingPayment ? 'Registrando…' : 'Confirmar pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedMovement && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-lg sm:rounded-3xl">
            <div className="flex shrink-0 items-center justify-between gap-3 bg-slate-950 p-4 text-white sm:p-5">
              <div className="min-w-0">
                <h3 className="text-lg font-black">Detalle del movimiento</h3>
                <p className="mt-1 text-xs text-slate-400">{formatMovementDate(selectedMovement)}</p>
              </div>
              <button type="button" onClick={() => setSelectedMovement(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" aria-label="Cerrar detalle" title="Cerrar">
                <X size={20} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Descripción</p>
                <p className="mt-1 break-words text-sm font-bold text-slate-950">{selectedMovement.descripcion}</p>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 min-[430px]:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-400">Número de pago</p>
                  <p className="mt-1 break-all font-black text-slate-950">{selectedMovement.numero_pago ? `#${selectedMovement.numero_pago}` : '-'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-400">Medio de pago</p>
                  <p className="mt-1 break-words font-black text-slate-950">{selectedMovement.metodo_pago || '-'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-400">Importe</p>
                  <p className="mt-1 break-words font-black text-emerald-700">{formatCurrency(selectedMovement.haber || selectedMovement.debe || 0)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-400">Saldo posterior</p>
                  <p className="mt-1 break-words font-black text-slate-950">{formatCurrency(selectedMovement.saldo_resultante || 0)}</p>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-slate-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => setSelectedMovement(null)} className="min-h-11 w-full rounded-xl bg-slate-950 px-6 font-bold text-white hover:bg-slate-800 sm:ml-auto sm:w-auto">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSale && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-3xl">
            <div className="flex shrink-0 items-center justify-between gap-3 bg-slate-950 p-4 text-white sm:p-5">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-black">Venta #{selectedSale.numero_venta || selectedSale.id}</h3>
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(selectedSale.fecha)}</p>
              </div>
              <button type="button" onClick={() => setSelectedSale(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" aria-label="Cerrar venta" title="Cerrar">
                <X size={20} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-400">Medio de pago</p>
                  <p className="mt-1 break-words text-sm font-black uppercase text-slate-950">{selectedSale.metodo_pago || '-'}</p>
                </div>
                <div className="rounded-2xl bg-slate-950 p-4 text-white min-[430px]:text-right">
                  <p className="text-[10px] font-black uppercase text-slate-400">Total de la venta</p>
                  <p className="mt-1 break-words text-xl font-black">{formatCurrency(selectedSale.total)}</p>
                </div>
              </div>

              <div className="mt-5">
                <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Productos</h4>
                <div className="mt-3 space-y-2">
                  {(selectedSale.items || []).map((item: any) => (
                    <div key={item.id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex min-w-0 flex-col gap-3 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><Package size={16} /></div>
                          <div className="min-w-0">
                            <p className="break-words text-sm font-black text-slate-950">{item.product_name}</p>
                            <p className="mt-1 break-words text-[10px] font-bold uppercase text-slate-400">{item.company || '-'}</p>
                          </div>
                        </div>
                        <div className="rounded-xl bg-white p-3 min-[430px]:text-right">
                          <p className="text-xs font-bold text-slate-600">{item.cantidad} × {formatCurrency(item.precio_venta)}</p>
                          <p className="mt-1 font-black text-slate-950">{formatCurrency(Number(item.cantidad || 0) * Number(item.precio_venta || 0))}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {Number(selectedSale.monto_pendiente || 0) > 0 && (
                <div className="mt-5 flex flex-col gap-2 rounded-2xl border border-red-100 bg-red-50 p-4 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertCircle size={20} />
                    <span className="text-sm font-black">Saldo pendiente</span>
                  </div>
                  <p className="break-words text-xl font-black text-red-600">{formatCurrency(selectedSale.monto_pendiente)}</p>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-slate-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="flex flex-col-reverse gap-2 min-[480px]:flex-row min-[480px]:justify-between">
                <button type="button" onClick={() => setSelectedSale(null)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 font-bold text-slate-700 hover:bg-slate-100">
                  Cerrar
                </button>
                <button type="button" onClick={() => generateSaleReceipt(selectedSale, businessSettings)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 font-black text-white hover:bg-emerald-700">
                  <Download size={17} />
                  Descargar comprobante
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
