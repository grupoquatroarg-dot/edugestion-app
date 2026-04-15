import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  TrendingUp, 
  Package, 
  Activity, 
  Users, 
  ShoppingCart, 
  AlertTriangle, 
  Clock, 
  Map, 
  ChevronRight, 
  ArrowUpRight, 
  ArrowDownRight,
  Filter,
  X,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { unwrapResponse, apiFetch } from '../utils/api';

interface DashboardSummary {
  finanzas: {
    cuentasCobrar: number;
    cuentasPagar: number;
    gananciaMes: number;
    gananciaPrevMes: number;
  };
  ventas: {
    mes: {
      total: number;
      cantidad: number;
      ticketPromedio: number;
      prevTotal: number;
    };
    dia: number;
    topClientes: { nombre_cliente: string; total: number }[];
    topProductos: { name: string; total_qty: number }[];
    topProductosRentables: { producto: string; ventas: number; costo: number; ganancia: number; margen: number }[];
  };
  stock: {
    valorizado: number;
    critico: number;
    pedidosPendientes: number;
  };
  operaciones: {
    rutaDia: {
      planificados: number;
      visitados: number;
      ventas: number;
    };
    alertasDeuda: number;
  };
}

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<{ type: string; title: string; data: any[] } | null>(null);
  const [cobrarFilter, setCobrarFilter] = useState<number | 'all'>(30);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    try {
      setError(null);
      const res = await apiFetch('/api/dashboard/summary');
      const body = await res.json();
      const data = unwrapResponse(body);
      setSummary(data);
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      setError("Error al cargar el resumen del dashboard");
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (type: string, title: string, params: any = {}) => {
    try {
      let url = `/api/dashboard/${type}`;
      if (Object.keys(params).length > 0) {
        const query = new URLSearchParams(params).toString();
        url += `?${query}`;
      }
      const res = await apiFetch(url);
      const body = await res.json();
      const data = unwrapResponse(body);
      setDetailModal({ type, title, data });
    } catch (error) {
      console.error(`Error fetching detail for ${type}:`, error);
    }
  };

  const handleUpdateMinStock = async (productId: number, newMin: number) => {
    try {
      const res = await apiFetch(`/api/products/${productId}/min-stock`, {
        method: 'POST',
        body: JSON.stringify({ stock_minimo: newMin })
      });
      const body = await res.json();
      unwrapResponse(body);

      // Refresh critical stock list if modal is open
      if (detailModal?.type === 'stock-critico') {
        const resDetail = await apiFetch('/api/dashboard/stock-critico');
        const bodyDetail = await resDetail.json();
        const data = unwrapResponse(bodyDetail);
        setDetailModal({ ...detailModal, data });
      }
      fetchSummary();
    } catch (error) {
      console.error("Error updating min stock:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertTriangle size={48} className="text-amber-500" />
        <p className="text-zinc-500 font-medium">{error || "No se pudo cargar el resumen"}</p>
        <button 
          onClick={() => { setLoading(true); fetchSummary(); }}
          className="px-6 py-2 bg-zinc-900 text-white rounded-xl font-bold uppercase tracking-widest text-xs"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);

  return (
    <div className="h-full overflow-y-auto bg-zinc-50 p-4 md:p-8 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8 md:space-y-12">
        <header>
          <h1 className="text-3xl md:text-4xl font-black text-zinc-900 tracking-tight">DASHBOARD</h1>
          <p className="text-sm md:text-base text-zinc-500 font-medium">Indicadores clave del negocio en tiempo real</p>
        </header>

        {/* FINANZAS */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white">
              <DollarSign size={20} />
            </div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-widest">Finanzas</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <DashboardCard 
              title="Cuentas a Cobrar"
              value={formatCurrency(summary?.finanzas?.cuentasCobrar ?? 0)}
              subtitle="Deuda total de clientes"
              icon={<Users className="text-blue-600" />}
              onClick={() => openDetail('cuentas-cobrar', 'Cuentas a Cobrar', { days: cobrarFilter })}
              footer={
                <div className="flex gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
                  {[7, 15, 30, 'all'].map(d => (
                    <button 
                      key={d}
                      onClick={() => setCobrarFilter(d as any)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${cobrarFilter === d ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'}`}
                    >
                      {d === 'all' ? 'Todas' : `${d}d`}
                    </button>
                  ))}
                </div>
              }
            />
            <DashboardCard 
              title="Cuentas a pagar"
              value={formatCurrency(summary?.finanzas?.cuentasPagar ?? 0)}
              subtitle="Deuda total a proveedores"
              icon={<ShoppingCart className="text-amber-600" />}
              onClick={() => openDetail('cuentas-pagar', 'Cuentas a Pagar Proveedores')}
            />
            <DashboardCard 
              title="Ganancia del mes"
              value={formatCurrency(summary?.finanzas?.gananciaMes ?? 0)}
              subtitle="Ventas - Costos (Mes actual)"
              icon={<TrendingUp className="text-emerald-600" />}
              onClick={() => openDetail('ganancia-mes-detalle', 'Ganancia del Mes')}
              trend={{
                value: (summary?.finanzas?.gananciaPrevMes ?? 0) > 0 
                  ? (((summary?.finanzas?.gananciaMes ?? 0) - (summary?.finanzas?.gananciaPrevMes ?? 0)) / (summary?.finanzas?.gananciaPrevMes ?? 1) * 100).toFixed(1) + '%'
                  : 'N/A',
                isUp: (summary?.finanzas?.gananciaMes ?? 0) >= (summary?.finanzas?.gananciaPrevMes ?? 0)
              }}
            />
          </div>
        </section>

        {/* VENTAS */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white">
              <ShoppingCart size={20} />
            </div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-widest">Ventas</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <DashboardCard 
              title="Ventas del Mes"
              value={formatCurrency(summary?.ventas?.mes?.total ?? 0)}
              subtitle={`${summary?.ventas?.mes?.cantidad ?? 0} ventas realizadas`}
              icon={<Activity className="text-indigo-600" />}
              onClick={() => openDetail('ventas-mes-detalle', 'Ventas del Mes')}
              footer={
                <p className="text-[10px] font-bold text-zinc-400 uppercase mt-4">
                  Ticket Promedio: {formatCurrency(summary?.ventas?.mes?.ticketPromedio ?? 0)}
                </p>
              }
            />
            <DashboardCard 
              title="Ventas del Día"
              value={formatCurrency(summary?.ventas?.dia ?? 0)}
              subtitle="Total facturado hoy"
              icon={<Clock className="text-zinc-600" />}
            />
            <DashboardCard 
              title="Comparativo Mensual"
              value={(() => {
                const current = summary?.ventas?.mes?.total ?? 0;
                const prev = summary?.ventas?.mes?.prevTotal ?? 0;
                if (prev === 0) return current > 0 ? '+100%' : '0%';
                const diff = ((current - prev) / prev) * 100;
                return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
              })()}
              subtitle="vs. Mes Anterior"
              icon={(() => {
                const diff = (summary?.ventas?.mes?.total ?? 0) - (summary?.ventas?.mes?.prevTotal ?? 0);
                return diff >= 0 ? <TrendingUp className="text-emerald-600" /> : <TrendingUp className="text-red-600 rotate-180" />;
              })()}
              footer={
                <div className="flex flex-col gap-1 mt-4">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">
                    Mes Actual: {formatCurrency(summary?.ventas?.mes?.total ?? 0)}
                  </p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">
                    Mes Anterior: {formatCurrency(summary?.ventas?.mes?.prevTotal ?? 0)}
                  </p>
                </div>
              }
            />
            <div className="bg-white p-6 md:p-8 rounded-3xl md:rounded-[40px] border border-zinc-200 shadow-sm col-span-1 md:col-span-2">
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-6">Top Clientes del Mes</h3>
              <div className="space-y-4">
                {(summary?.ventas?.topClientes ?? []).map((c, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-zinc-300">0{i+1}</span>
                      <span className="text-sm font-bold text-zinc-900">{c.nombre_cliente}</span>
                    </div>
                    <span className="text-sm font-black text-zinc-900 font-mono">{formatCurrency(c.total)}</span>
                  </div>
                ))}
                {(summary?.ventas?.topClientes ?? []).length === 0 && <p className="text-sm text-zinc-400 italic">Sin datos este mes</p>}
              </div>
            </div>
          </div>
        </section>

        {/* STOCK */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white">
              <Package size={20} />
            </div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-widest">Stock</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <DashboardCard 
              title="Valor del stock"
              value={formatCurrency(summary?.stock?.valorizado ?? 0)}
              subtitle="Costo total de mercadería"
              icon={<DollarSign className="text-emerald-600" />}
              onClick={() => openDetail('stock-valorizado-detalle', 'Valor del Stock')}
            />
            <DashboardCard 
              title="Stock crítico"
              value={(summary?.stock?.critico ?? 0).toString()}
              subtitle="Productos bajo stock mínimo"
              icon={<AlertTriangle className="text-red-600" />}
              onClick={() => openDetail('stock-critico', 'Productos con Stock Crítico')}
              highlight={(summary?.stock?.critico ?? 0) > 0}
            />
            <DashboardCard 
              title="Pedidos pendientes"
              value={(summary?.stock?.pedidosPendientes ?? 0).toString()}
              subtitle="Pedidos a proveedor sin recibir"
              icon={<Clock className="text-amber-600" />}
              onClick={() => openDetail('pedidos-pendientes', 'Pedidos Pendientes')}
              highlight={(summary?.stock?.pedidosPendientes ?? 0) > 0}
            />
            <div className="bg-white p-6 md:p-8 rounded-3xl md:rounded-[40px] border border-zinc-200 shadow-sm">
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-6">Productos Más Vendidos</h3>
              <div className="space-y-4">
                {(summary?.ventas?.topProductos ?? []).map((p, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-900 truncate pr-4">{p.name}</span>
                    <span className="text-sm font-black text-zinc-400 shrink-0">{p.total_qty} un.</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* OPERACIONES */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white">
              <Activity size={20} />
            </div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-widest">Operaciones</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <DashboardCard 
              title="Pedidos Pendientes"
              value={(summary?.stock?.pedidosPendientes ?? 0).toString()}
              subtitle="Órdenes a proveedor activas"
              icon={<ShoppingCart className="text-amber-600" />}
              onClick={() => openDetail('pedidos-pendientes', 'Pedidos Pendientes a Proveedor')}
            />
            <DashboardCard 
              title="Ruta del Día"
              value={`${summary?.operaciones?.rutaDia?.visitados ?? 0}/${summary?.operaciones?.rutaDia?.planificados ?? 0}`}
              subtitle="Clientes visitados hoy"
              icon={<Map className="text-blue-600" />}
              footer={
                <p className="text-[10px] font-bold text-zinc-400 uppercase mt-4">
                  Ventas realizadas: {summary?.operaciones?.rutaDia?.ventas ?? 0}
                </p>
              }
            />
            <DashboardCard 
              title="Alertas de Deuda"
              value={(summary?.operaciones?.alertasDeuda ?? 0).toString()}
              subtitle="Clientes con deuda > 7 días"
              icon={<AlertTriangle className="text-red-600" />}
              onClick={() => openDetail('deuda-vencida', 'Clientes con Deuda Vencida')}
              highlight={(summary?.operaciones?.alertasDeuda ?? 0) > 0}
            />
          </div>
        </section>

        {/* RENTABILIDAD */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white">
              <TrendingUp size={20} />
            </div>
            <h2 className="text-xl font-black text-zinc-900 uppercase tracking-widest">Rentabilidad</h2>
          </div>
          <div className="bg-white p-6 md:p-8 rounded-3xl md:rounded-[40px] border border-zinc-200 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
              <div>
                <h3 className="text-xl font-black tracking-tight text-zinc-900">Productos más rentables del mes</h3>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mt-1">Basado en costo real PEPS</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-50">
                    <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Producto</th>
                    <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Ventas</th>
                    <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right text-zinc-400">Costo</th>
                    <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Ganancia</th>
                    <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Margen %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {(summary?.ventas?.topProductosRentables ?? []).map((p, i) => (
                    <tr key={i} className="group">
                      <td className="py-4">
                        <span className="text-sm font-bold text-zinc-900 group-hover:text-emerald-600 transition-colors">{p.producto}</span>
                      </td>
                      <td className="py-4 text-right text-sm font-bold text-zinc-500 font-mono">${(p.ventas ?? 0).toFixed(2)}</td>
                      <td className="py-4 text-right text-sm font-bold text-zinc-400 font-mono">${(p.costo ?? 0).toFixed(2)}</td>
                      <td className="py-4 text-right text-sm font-black text-emerald-600 font-mono">${(p.ganancia ?? 0).toFixed(2)}</td>
                      <td className="py-4 text-right">
                        <span className={`text-xs font-black px-2 py-1 rounded-lg ${
                          (p.margen ?? 0) >= 30 ? 'bg-emerald-50 text-emerald-600' : 
                          (p.margen ?? 0) >= 15 ? 'bg-amber-50 text-amber-600' : 
                          'bg-red-50 text-red-600'
                        }`}>
                          {(p.margen ?? 0).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(summary?.ventas?.topProductosRentables ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs font-bold text-zinc-400 uppercase tracking-widest">
                        No hay datos suficientes este mes
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {detailModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[40px] w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                <div>
                  <h2 className="text-2xl font-black text-zinc-900">{detailModal.title}</h2>
                  <p className="text-sm font-medium text-zinc-500">Desglose detallado de indicadores.</p>
                </div>
                {detailModal.type === 'cuentas-cobrar' && (
                  <div className="flex gap-2">
                    {[7, 15, 30, 'all'].map(d => (
                      <button 
                        key={d}
                        onClick={() => {
                          setCobrarFilter(d as any);
                          openDetail('cuentas-cobrar', 'Cuentas a Cobrar', { days: d });
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all shadow-sm border ${cobrarFilter === d ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-400 border-zinc-100 hover:border-zinc-300'}`}
                      >
                        {d === 'all' ? 'Todas' : `${d}d`}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setDetailModal(null)}
                  className="p-3 hover:bg-white rounded-2xl transition-all text-zinc-400 hover:text-zinc-900 shadow-sm"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {detailModal.type === 'stock-valorizado-detalle' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Producto</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Stock</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Costo Unit.</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Valor Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4 font-bold text-zinc-900">{item.producto}</td>
                          <td className="py-4 text-center font-mono text-zinc-600">{item.stock}</td>
                          <td className="py-4 text-right font-mono text-zinc-400">{formatCurrency(item.costo)}</td>
                          <td className="py-4 text-right font-black text-emerald-600 font-mono">
                            {formatCurrency(item.valor_total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailModal.type === 'ganancia-mes-detalle' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Venta</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Costo</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Ganancia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4 text-sm text-zinc-500">{new Date(item.fecha).toLocaleDateString()}</td>
                          <td className="py-4 font-bold text-zinc-900">{item.cliente}</td>
                          <td className="py-4 text-right font-mono text-zinc-600">{formatCurrency(item.venta)}</td>
                          <td className="py-4 text-right font-mono text-zinc-400">{formatCurrency(item.costo)}</td>
                          <td className="py-4 text-right font-black text-emerald-600 font-mono">
                            {formatCurrency(item.ganancia)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailModal.type === 'ventas-mes-detalle' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Productos</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Forma de Pago</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4 text-sm text-zinc-500">{new Date(item.fecha).toLocaleDateString()}</td>
                          <td className="py-4 font-bold text-zinc-900">{item.cliente}</td>
                          <td className="py-4 text-xs text-zinc-500 max-w-xs truncate" title={item.productos}>
                            {item.productos}
                          </td>
                          <td className="py-4 text-right text-xs font-bold uppercase text-zinc-400">
                            {item.forma_pago}
                          </td>
                          <td className="py-4 text-right font-black text-zinc-900 font-mono">
                            {formatCurrency(item.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailModal.type === 'cuentas-cobrar' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Monto Deuda</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Fecha de Venta</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Días Vencido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4 font-bold text-zinc-900">{item.cliente}</td>
                          <td className="py-4 text-right font-black text-red-600 font-mono">{formatCurrency(item.deuda)}</td>
                          <td className="py-4 text-right text-sm text-zinc-500">
                            {item.fecha_venta ? new Date(item.fecha_venta).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="py-4 text-right">
                            <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${item.dias_atraso > 7 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                              {item.dias_atraso} días
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailModal.type === 'cuentas-pagar' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Proveedor</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Monto</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Fecha</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4 font-bold text-zinc-900">{item.proveedor}</td>
                          <td className="py-4 text-right font-black text-amber-600 font-mono">{formatCurrency(item.monto)}</td>
                          <td className="py-4 text-right text-sm text-zinc-500">{new Date(item.fecha).toLocaleDateString()}</td>
                          <td className="py-4 text-right">
                            <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700">
                              {item.estado}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailModal.type === 'stock-critico' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">producto</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">stock_actual</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">stock_minimo</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4">
                            <p className="font-bold text-zinc-900">{item.name}</p>
                            <p className="text-[10px] text-zinc-400 font-mono">{item.codigo_unico}</p>
                          </td>
                          <td className="py-4 text-center">
                            <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full font-black font-mono">
                              {item.stock}
                            </span>
                          </td>
                          <td className="py-4 text-center">
                            <input 
                              type="number"
                              defaultValue={item.stock_minimo}
                              onBlur={(e) => handleUpdateMinStock(item.id, parseInt(e.target.value))}
                              className="w-20 px-2 py-1 bg-zinc-100 border border-zinc-200 rounded-lg text-center font-bold outline-none focus:ring-2 focus:ring-zinc-900"
                            />
                          </td>
                          <td className="py-4 text-right">
                            <button className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors">
                              <Settings size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailModal.type === 'pedidos-pendientes' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Fecha</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4 font-bold text-zinc-900">{item.cliente}</td>
                          <td className="py-4 text-right text-sm text-zinc-500">{new Date(item.fecha).toLocaleDateString()}</td>
                          <td className="py-4 text-right">
                            <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-bold uppercase">
                              {item.estado}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailModal.type === 'deuda-vencida' && (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Deuda</th>
                        <th className="pb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Días Atraso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {detailModal.data.map((item, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="py-4 font-bold text-zinc-900">{item.cliente}</td>
                          <td className="py-4 text-right font-black text-red-600 font-mono">{formatCurrency(item.deuda)}</td>
                          <td className="py-4 text-right">
                            <span className="px-2 py-1 bg-red-600 text-white rounded-lg text-[10px] font-bold uppercase">
                              {item.dias_atraso} días
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DashboardCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  onClick, 
  trend, 
  footer,
  highlight = false
}: { 
  title: string; 
  value: string; 
  subtitle: string; 
  icon: React.ReactNode; 
  onClick?: () => void;
  trend?: { value: string; isUp: boolean };
  footer?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <motion.div 
      whileHover={onClick ? { y: -4, scale: 1.01 } : {}}
      onClick={onClick}
      className={`bg-white p-6 md:p-8 rounded-3xl md:rounded-[40px] border transition-all ${onClick ? 'cursor-pointer hover:shadow-xl hover:border-zinc-300' : ''} ${highlight ? 'border-red-200 bg-red-50/30' : 'border-zinc-200 shadow-sm'}`}
    >
      <div className="flex items-start justify-between mb-6">
        <div className="w-12 h-12 bg-zinc-50 rounded-2xl flex items-center justify-center shadow-inner">
          {icon}
        </div>
        {trend && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black ${trend.isUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {trend.isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {trend.value}
          </div>
        )}
        {onClick && <ChevronRight size={16} className="text-zinc-300" />}
      </div>
      <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">{title}</h3>
      <p className="text-3xl font-black text-zinc-900 font-mono tracking-tighter">{value}</p>
      <p className="text-xs font-medium text-zinc-500 mt-1">{subtitle}</p>
      {footer}
    </motion.div>
  );
}
