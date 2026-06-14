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
    fecha: new Date().toISOString().split('T')[0],
    metodo_pago: '',
    observaciones: ''
  });
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const fetchStats = async () => {
    try {
      const res = await apiFetch(`/api/clientes?endpoint=client-detail&id=${clienteId}`);
      const body = await res.json();
      const stats = unwrapResponse(body);
      setData(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const fetchMovimientos = async () => {
    try {
      const res = await apiFetch(`/api/clientes?endpoint=client-account&id=${clienteId}`);
      const body = await res.json();
      const account = unwrapResponse(body) as any;
      setMovimientos(account.movements || []);
      setAccountSummary(account.summary || { total_sales: 0, total_payments: 0, pending_balance: 0, pending_sales: 0, paid_sales: 0 });
    } catch (error) {
      console.error("Error fetching movements:", error);
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
        fecha: new Date().toISOString().split('T')[0],
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

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchStats(), fetchMovimientos(), fetchBusinessSettings(), fetchPaymentMethods()]);
      setLoading(false);
    };
    init();

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

  if (loading) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  if (!data || !data.cliente) return null;

  const { cliente, summary, sales, total_payments, pending_orders, top_products } = data;

  return (
    <div className="fixed inset-0 bg-zinc-50 z-50 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-100 rounded-full transition-all text-zinc-500"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-zinc-900">{cliente.nombre_apellido}</h1>
              <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                cliente.tipo_cliente === 'mayorista' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                {cliente.tipo_cliente}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] sm:text-xs text-zinc-500 mt-0.5">
              <span className="flex items-center gap-1"><Building2 size={12}/> {cliente.razon_social}</span>
              <span className="flex items-center gap-1"><MapPin size={12}/> {cliente.direccion ? `${cliente.direccion}, ` : ''}{cliente.localidad}</span>
              {cliente.telefono && <span className="flex items-center gap-1"><Phone size={12}/> {cliente.telefono}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6">
          <div className="text-right">
            <p className="text-[10px] font-bold text-zinc-400 uppercase">Saldo Cuenta Corriente</p>
            <p className={`text-2xl font-black font-mono ${cliente.saldo_cta_cte > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              ${cliente.saldo_cta_cte.toFixed(2)}
            </p>
          </div>
          <button 
            onClick={() => setShowPaymentModal(true)}
            className="px-3 sm:px-6 py-2 bg-emerald-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2"
          >
            <DollarSign size={18} />
            Registrar Pago
          </button>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-100 rounded-full transition-all text-zinc-400"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-8 custom-scrollbar">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                <TrendingUp size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase">Total Comprado</p>
                <p className="text-2xl font-black text-zinc-900 font-mono">${(summary.total_purchased || 0).toFixed(2)}</p>
                <p className="text-[10px] text-zinc-400">{summary.total_sales_count} ventas realizadas</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shrink-0">
                <Calendar size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase">Última Compra</p>
                <p className="text-xl font-bold text-zinc-900">
                  {summary.last_purchase_date ? new Date(summary.last_purchase_date).toLocaleDateString() : 'Sin ventas'}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {summary.last_purchase_date ? new Date(summary.last_purchase_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
                <Clock size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase">Pedidos Pendientes</p>
                <p className="text-2xl font-black text-zinc-900 font-mono">{pending_orders.length}</p>
                <p className="text-[10px] text-zinc-400">Productos por entregar</p>
              </div>
            </div>
          </div>

          {/* Main Content Sections */}
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
            {/* Tabs */}
            <div className="flex border-b border-zinc-100 px-2 sm:px-6 overflow-x-auto no-scrollbar shrink-0">
              <button 
                onClick={() => setActiveTab('ventas')}
                className={`px-4 sm:px-6 py-4 text-xs sm:text-sm whitespace-nowrap font-bold transition-all border-b-2 ${
                  activeTab === 'ventas' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
                }`}
              >
                Historial de Ventas
              </button>
              <button 
                onClick={() => setActiveTab('movimientos')}
                className={`px-4 sm:px-6 py-4 text-xs sm:text-sm whitespace-nowrap font-bold transition-all border-b-2 ${
                  activeTab === 'movimientos' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
                }`}
              >
                Cuenta Corriente
              </button>
              <button 
                onClick={() => setActiveTab('pedidos')}
                className={`px-4 sm:px-6 py-4 text-xs sm:text-sm whitespace-nowrap font-bold transition-all border-b-2 ${
                  activeTab === 'pedidos' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
                }`}
              >
                Pedidos Pendientes ({pending_orders.length})
              </button>
            </div>

            <div className="flex-1 overflow-x-auto">
              {activeTab === 'ventas' && (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/50">
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">N° Venta</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Método</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Saldo</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {sales.map((sale: any) => (
                      <tr key={sale.id} className="hover:bg-zinc-50/50 transition-colors group">
                        <td className="px-6 py-4 text-xs font-mono text-zinc-400">#{sale.numero_venta || sale.id}</td>
                        <td className="px-6 py-4 text-xs text-zinc-600">
                          {new Date(sale.fecha).toLocaleDateString()} {new Date(sale.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[10px] font-bold uppercase bg-zinc-100 text-zinc-600 px-2 py-1 rounded-md">
                            {sale.metodo_pago}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-right">
                          <span className={sale.monto_pendiente > 0 ? 'text-red-600 font-bold' : 'text-zinc-400'}>
                            ${sale.monto_pendiente.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-black text-zinc-900 font-mono text-right">
                          ${sale.total.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button 
                              onClick={() => fetchSaleDetails(sale.id)}
                              className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                              title="Ver Detalle"
                            >
                              <Eye size={16} />
                            </button>
                            <button 
                              onClick={() => handleDownloadReceipt(sale.id)}
                              disabled={downloadingSaleId === sale.id}
                              className="p-2 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-50"
                              title="Descargar Comprobante"
                            >
                              {downloadingSaleId === sale.id ? (
                                <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <FileDown size={16} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {sales.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-zinc-400">
                          <ShoppingBag size={40} className="mx-auto mb-2 opacity-10" />
                          <p className="text-sm">No hay ventas registradas</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'movimientos' && (
                <div className="p-4 sm:p-6 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Ventas registradas</p>
                      <p className="mt-1 text-xl font-black font-mono text-zinc-900">${Number(accountSummary.total_sales || 0).toFixed(2)}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-100 bg-emerald-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Pagos registrados</p>
                      <p className="mt-1 text-xl font-black font-mono text-emerald-700">${Number(accountSummary.total_payments || 0).toFixed(2)}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-100 bg-red-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Saldo pendiente</p>
                      <p className="mt-1 text-xl font-black font-mono text-red-600">${Number(accountSummary.pending_balance || 0).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Filter size={17} className="text-zinc-500" />
                        <h3 className="text-sm font-black text-zinc-900">Filtrar cuenta corriente</h3>
                      </div>
                      <button
                        type="button"
                        onClick={resetMovementFilters}
                        className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-100"
                      >
                        <RotateCcw size={14} /> Limpiar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-black uppercase text-zinc-400">Desde</label>
                        <input
                          type="date"
                          value={movementFilters.dateFrom}
                          onChange={(e) => setMovementFilters({ ...movementFilters, dateFrom: e.target.value })}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-black uppercase text-zinc-400">Hasta</label>
                        <input
                          type="date"
                          value={movementFilters.dateTo}
                          onChange={(e) => setMovementFilters({ ...movementFilters, dateTo: e.target.value })}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-black uppercase text-zinc-400">Operación</label>
                        <select
                          value={movementFilters.type}
                          onChange={(e) => setMovementFilters({ ...movementFilters, type: e.target.value })}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900"
                        >
                          <option value="all">Todas</option>
                          <option value="venta">Ventas</option>
                          <option value="pago">Pagos</option>
                          <option value="ajuste">Ajustes</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-black uppercase text-zinc-400">Estado</label>
                        <select
                          value={movementFilters.status}
                          onChange={(e) => setMovementFilters({ ...movementFilters, status: e.target.value })}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900"
                        >
                          <option value="all">Todos</option>
                          <option value="pending">Pendientes</option>
                          <option value="paid">Pagados</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-black uppercase text-zinc-400">Buscar</label>
                        <div className="relative">
                          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                          <input
                            type="text"
                            value={movementFilters.search}
                            onChange={(e) => setMovementFilters({ ...movementFilters, search: e.target.value })}
                            placeholder="Venta, pedido, pago..."
                            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900"
                          />
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs font-bold text-zinc-400">
                      {filteredMovements.length} movimiento{filteredMovements.length === 1 ? '' : 's'} encontrado{filteredMovements.length === 1 ? '' : 's'}
                    </p>
                  </div>

                  <div className="hidden md:block overflow-x-auto custom-scrollbar rounded-2xl border border-zinc-100">
                    <table className="w-full min-w-[1050px] text-left border-collapse">
                      <thead>
                        <tr className="bg-zinc-50">
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase">Tipo</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase">Fecha</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase">Referencia</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase">Descripción</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase">Medio</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase text-right">Debe</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase text-right">Haber</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase text-right">Saldo</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-zinc-400 uppercase text-center">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {filteredMovements.map((movement: any) => (
                          <tr key={movement.id} className="hover:bg-zinc-50/60">
                            <td className="px-4 py-4">
                              <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${
                                movement.operation_type === 'venta'
                                  ? 'bg-violet-50 text-violet-700'
                                  : movement.operation_type === 'pago'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-zinc-100 text-zinc-600'
                              }`}>
                                {movement.operation_type}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-xs text-zinc-600 whitespace-nowrap">{new Date(movement.fecha).toLocaleString('es-AR')}</td>
                            <td className="px-4 py-4 text-xs font-mono text-zinc-500">
                              {movement.numero_venta ? `Venta #${movement.numero_venta}` : movement.numero_pago ? `Pago #${movement.numero_pago}` : '-'}
                              {movement.numero_pedido ? <div className="text-[10px]">Pedido #{movement.numero_pedido}</div> : null}
                            </td>
                            <td className="px-4 py-4 text-xs font-medium text-zinc-900 max-w-[260px]">{movement.descripcion}</td>
                            <td className="px-4 py-4 text-xs font-bold text-zinc-600">{movement.metodo_pago || '-'}</td>
                            <td className="px-4 py-4 text-xs font-mono text-right text-red-600">{Number(movement.debe || 0) > 0 ? `$${Number(movement.debe).toFixed(2)}` : '-'}</td>
                            <td className="px-4 py-4 text-xs font-mono text-right text-emerald-600">{Number(movement.haber || 0) > 0 ? `$${Number(movement.haber).toFixed(2)}` : '-'}</td>
                            <td className="px-4 py-4 text-xs font-black font-mono text-right text-zinc-900">${Number(movement.saldo_resultante || 0).toFixed(2)}</td>
                            <td className="px-4 py-4 text-center">
                              <button
                                onClick={() => movement.venta_id ? fetchSaleDetails(Number(movement.venta_id)) : setSelectedMovement(movement)}
                                className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
                                title="Ver detalle de la operación"
                              >
                                <Eye size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="md:hidden space-y-3">
                    {filteredMovements.map((movement: any) => (
                      <button
                        type="button"
                        key={movement.id}
                        onClick={() => movement.venta_id ? fetchSaleDetails(Number(movement.venta_id)) : setSelectedMovement(movement)}
                        className="w-full rounded-2xl border border-zinc-100 bg-white p-4 text-left shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${
                              movement.operation_type === 'venta'
                                ? 'bg-violet-50 text-violet-700'
                                : movement.operation_type === 'pago'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-zinc-100 text-zinc-600'
                            }`}>
                              {movement.operation_type}
                            </span>
                            <p className="mt-2 text-sm font-black text-zinc-900">{movement.descripcion}</p>
                            <p className="mt-1 text-xs text-zinc-400">{new Date(movement.fecha).toLocaleString('es-AR')}</p>
                          </div>
                          <ChevronRight size={18} className="text-zinc-300" />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3">
                          <div>
                            <p className="text-[9px] font-black uppercase text-zinc-400">Debe</p>
                            <p className="text-xs font-black font-mono text-red-600">{Number(movement.debe || 0) > 0 ? `$${Number(movement.debe).toFixed(2)}` : '-'}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-zinc-400">Haber</p>
                            <p className="text-xs font-black font-mono text-emerald-600">{Number(movement.haber || 0) > 0 ? `$${Number(movement.haber).toFixed(2)}` : '-'}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[9px] font-black uppercase text-zinc-400">Saldo</p>
                            <p className="text-xs font-black font-mono text-zinc-900">${Number(movement.saldo_resultante || 0).toFixed(2)}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {filteredMovements.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center text-zinc-400">
                      <CreditCard size={40} className="mx-auto mb-2 opacity-10" />
                      <p className="text-sm font-bold">No hay movimientos para los filtros seleccionados.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'pedidos' && (
                <div className="p-6 space-y-4">
                  {pending_orders.map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-zinc-400 shadow-sm">
                          <Package size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-zinc-900">{order.product_name}</p>
                          <p className="text-[10px] text-zinc-400 uppercase font-bold">{order.company} • Cantidad: {order.quantity}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-zinc-500">{new Date(order.order_date).toLocaleDateString()}</p>
                        <span className="text-[9px] font-bold uppercase text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Pendiente</span>
                      </div>
                    </div>
                  ))}
                  {pending_orders.length === 0 && (
                    <div className="text-center py-12 text-zinc-400">
                      <CheckCircle2 size={40} className="mx-auto mb-2 opacity-10 text-emerald-500" />
                      <p className="text-sm">No hay pedidos pendientes</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-emerald-600 text-white">
              <h3 className="text-lg font-bold">Registrar Pago</h3>
              <button 
                onClick={() => setShowPaymentModal(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleRegisterPayment} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Monto a Pagar</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full pl-8 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-600 outline-none font-black text-xl"
                    value={paymentForm.monto}
                    onChange={(e) => setPaymentForm({ ...paymentForm, monto: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Fecha</label>
                  <input
                    type="date"
                    required
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-600 outline-none text-sm"
                    value={paymentForm.fecha}
                    onChange={(e) => setPaymentForm({ ...paymentForm, fecha: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Método</label>
                  <select
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-600 outline-none text-sm font-bold"
                    value={paymentForm.metodo_pago}
                    onChange={(e) => setPaymentForm({ ...paymentForm, metodo_pago: e.target.value })}
                  >
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.name}>{pm.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Observaciones</label>
                <textarea
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-600 outline-none text-sm min-h-[80px]"
                  value={paymentForm.observaciones || ''}
                  onChange={(e) => setPaymentForm({ ...paymentForm, observaciones: e.target.value })}
                  placeholder="Ej: Pago parcial de factura..."
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 py-3 bg-zinc-100 text-zinc-900 rounded-xl font-bold hover:bg-zinc-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50"
                >
                  {submittingPayment ? 'Registrando...' : 'Confirmar Pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Movement Detail Modal */}
      {selectedMovement && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-900 text-white">
              <div>
                <h3 className="text-lg font-bold">Detalle del movimiento</h3>
                <p className="text-xs text-white/60">{new Date(selectedMovement.fecha).toLocaleString('es-AR')}</p>
              </div>
              <button onClick={() => setSelectedMovement(null)} className="p-2 hover:bg-white/10 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
                <p className="text-[10px] font-black uppercase text-zinc-400">Descripción</p>
                <p className="mt-1 text-sm font-bold text-zinc-900">{selectedMovement.descripcion}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-zinc-100 p-4">
                  <p className="text-[10px] font-black uppercase text-zinc-400">N° de pago</p>
                  <p className="mt-1 font-black text-zinc-900">{selectedMovement.numero_pago ? `#${selectedMovement.numero_pago}` : '-'}</p>
                </div>
                <div className="rounded-2xl border border-zinc-100 p-4">
                  <p className="text-[10px] font-black uppercase text-zinc-400">Medio de pago</p>
                  <p className="mt-1 font-black text-zinc-900">{selectedMovement.metodo_pago || '-'}</p>
                </div>
                <div className="rounded-2xl border border-zinc-100 p-4">
                  <p className="text-[10px] font-black uppercase text-zinc-400">Importe</p>
                  <p className="mt-1 font-black font-mono text-emerald-600">${Number(selectedMovement.haber || selectedMovement.debe || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-2xl border border-zinc-100 p-4">
                  <p className="text-[10px] font-black uppercase text-zinc-400">Saldo posterior</p>
                  <p className="mt-1 font-black font-mono text-zinc-900">${Number(selectedMovement.saldo_resultante || 0).toFixed(2)}</p>
                </div>
              </div>
            </div>
            <div className="p-5 bg-zinc-50 border-t border-zinc-100 flex justify-end">
              <button onClick={() => setSelectedMovement(null)} className="px-6 py-2 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-900 text-white">
              <div>
                <h3 className="text-lg font-bold">Detalle de Venta #{selectedSale.numero_venta || selectedSale.id}</h3>
                <p className="text-xs text-white/60">{selectedSale.fecha ? new Date(selectedSale.fecha).toLocaleString() : ''}</p>
              </div>
              <button 
                onClick={() => setSelectedSale(null)}
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Método de Pago</p>
                  <p className="text-sm font-bold text-zinc-900 uppercase">{selectedSale.metodo_pago}</p>
                </div>
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 text-right">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Total Venta</p>
                  <p className="text-xl font-black text-zinc-900 font-mono">${selectedSale.total.toFixed(2)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Productos</h4>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {selectedSale.items.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-zinc-400 border border-zinc-100">
                          <Package size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-zinc-900">{item.product_name}</p>
                          <p className="text-[10px] text-zinc-400 uppercase font-bold">{item.company}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-zinc-900">{item.cantidad} x ${item.precio_venta.toFixed(2)}</p>
                        <p className="text-sm font-black text-zinc-900 font-mono">${(item.cantidad * item.precio_venta).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedSale.monto_pendiente > 0 && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle size={20} />
                    <span className="text-sm font-bold">Saldo Pendiente</span>
                  </div>
                  <p className="text-xl font-black text-red-600 font-mono">${selectedSale.monto_pendiente.toFixed(2)}</p>
                </div>
              )}
            </div>
            <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center">
              <button 
                onClick={() => generateSaleReceipt(selectedSale, businessSettings)}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
              >
                <Download size={18} />
                Descargar Comprobante
              </button>
              <button 
                onClick={() => setSelectedSale(null)}
                className="px-6 py-2 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
