import React, { useState, useEffect } from 'react';
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
  Download
} from 'lucide-react';
import { getSocket } from '../utils/socket';
import { generateSaleReceipt } from '../utils/pdfGenerator';
import { unwrapResponse, apiFetch } from '../utils/api';

const socket = getSocket();

interface CustomerDetailProps {
  clienteId: number;
  onClose: () => void;
}

export default function CustomerDetail({ clienteId, onClose }: CustomerDetailProps) {
  const [data, setData] = useState<any>(null);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'ventas' | 'movimientos' | 'pedidos'>('ventas');
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
      const res = await apiFetch(`/api/clientes/${clienteId}/stats`);
      const body = await res.json();
      const stats = unwrapResponse(body);
      setData(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const fetchMovimientos = async () => {
    try {
      const res = await apiFetch(`/api/clientes/${clienteId}/movimientos`);
      const body = await res.json();
      const movs = unwrapResponse(body);
      setMovimientos(movs);
    } catch (error) {
      console.error("Error fetching movements:", error);
    }
  };

  const fetchSaleDetails = async (saleId: number) => {
    try {
      const res = await apiFetch(`/api/sales/${saleId}`);
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
      const res = await apiFetch(`/api/sales/${saleId}`);
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
      const res = await apiFetch(`/api/clientes/${clienteId}/pagos`, {
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
      <div className="bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-100 rounded-full transition-all text-zinc-500"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-zinc-900">{cliente.nombre_apellido}</h1>
              <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                cliente.tipo_cliente === 'mayorista' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                {cliente.tipo_cliente}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 mt-0.5">
              <span className="flex items-center gap-1"><Building2 size={12}/> {cliente.razon_social}</span>
              <span className="flex items-center gap-1"><MapPin size={12}/> {cliente.direccion ? `${cliente.direccion}, ` : ''}{cliente.localidad}</span>
              {cliente.telefono && <span className="flex items-center gap-1"><Phone size={12}/> {cliente.telefono}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] font-bold text-zinc-400 uppercase">Saldo Cuenta Corriente</p>
            <p className={`text-2xl font-black font-mono ${cliente.saldo_cta_cte > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              ${cliente.saldo_cta_cte.toFixed(2)}
            </p>
          </div>
          <button 
            onClick={() => setShowPaymentModal(true)}
            className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2"
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

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
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
            <div className="flex border-b border-zinc-100 px-6">
              <button 
                onClick={() => setActiveTab('ventas')}
                className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
                  activeTab === 'ventas' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
                }`}
              >
                Historial de Ventas
              </button>
              <button 
                onClick={() => setActiveTab('movimientos')}
                className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
                  activeTab === 'movimientos' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
                }`}
              >
                Cuenta Corriente
              </button>
              <button 
                onClick={() => setActiveTab('pedidos')}
                className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
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
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/50">
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">N° Pago</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Descripción</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Deuda</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Pago</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {movimientos.map((mov: any) => (
                      <tr key={mov.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs font-mono text-zinc-400">
                          {mov.numero_pago ? `#${mov.numero_pago}` : '-'}
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-600">
                          {new Date(mov.fecha).toLocaleDateString()} {new Date(mov.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-900 font-medium">
                          {mov.descripcion}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-right text-red-600">
                          {mov.debe > 0 ? `$${mov.debe.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-right text-emerald-600">
                          {mov.haber > 0 ? `$${mov.haber.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-right font-bold text-zinc-900">
                          ${mov.saldo_resultante.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {movimientos.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-zinc-400">
                          <CreditCard size={40} className="mx-auto mb-2 opacity-10" />
                          <p className="text-sm">No hay movimientos registrados</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
