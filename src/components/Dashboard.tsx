import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleDollarSign,
  Clock,
  DollarSign,
  Loader2,
  Map,
  Package,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { apiFetch, unwrapResponse } from '../utils/api';

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
    topProductosRentables: {
      producto: string;
      ventas: number;
      costo: number;
      ganancia: number;
      margen: number;
    }[];
    pedidosClientesPendientes: number;
    pedidosClientesEsperandoStock: number;
    pedidosClientesListosEntrega: number;
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

type DetailModal = {
  type: string;
  title: string;
  data: any[];
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-AR');
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleString('es-AR');
};

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModal | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [updatingMinStockId, setUpdatingMinStockId] = useState<number | null>(null);
  const [cobrarFilter, setCobrarFilter] = useState<number | 'all'>(30);

  useEffect(() => {
    void fetchSummary(true);
  }, []);

  const fetchSummary = async (initial = false) => {
    if (initial || !summary) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const response = await apiFetch('/api/dashboard/summary');
      const body = await response.json();
      const data = unwrapResponse<DashboardSummary>(body);

      if (!data || typeof data !== 'object') {
        throw new Error('La respuesta del Dashboard no contiene datos válidos.');
      }

      setSummary(data);
    } catch (fetchError: any) {
      console.error('Error fetching dashboard summary:', fetchError);
      setError(fetchError?.message || 'No se pudo cargar el resumen del Dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const openDetail = async (type: string, title: string, params: Record<string, string | number> = {}) => {
    setDetailModal({ type, title, data: [] });
    setDetailLoading(true);
    setDetailError('');

    try {
      let url = `/api/dashboard/${type}`;
      if (Object.keys(params).length > 0) {
        url += `?${new URLSearchParams(
          Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
            acc[key] = String(value);
            return acc;
          }, {})
        ).toString()}`;
      }

      const response = await apiFetch(url);
      const body = await response.json();
      const data = unwrapResponse<any[]>(body);
      setDetailModal({ type, title, data: Array.isArray(data) ? data : [] });
    } catch (detailFetchError: any) {
      console.error(`Error fetching detail for ${type}:`, detailFetchError);
      setDetailError(detailFetchError?.message || 'No se pudo cargar este detalle.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleUpdateMinStock = async (productId: number, newMin: number) => {
    if (!Number.isFinite(newMin) || newMin < 0) {
      setDetailError('El stock mínimo debe ser un número igual o mayor que cero.');
      return;
    }

    setUpdatingMinStockId(productId);
    setDetailError('');

    try {
      const response = await apiFetch(`/api/products/${productId}/min-stock`, {
        method: 'POST',
        body: JSON.stringify({ stock_minimo: newMin }),
      });
      const body = await response.json();
      unwrapResponse(body);

      if (detailModal?.type === 'stock-critico') {
        const detailResponse = await apiFetch('/api/dashboard/stock-critico');
        const detailBody = await detailResponse.json();
        const data = unwrapResponse<any[]>(detailBody);
        setDetailModal({
          ...detailModal,
          data: Array.isArray(data) ? data : [],
        });
      }

      await fetchSummary();
    } catch (updateError: any) {
      console.error('Error updating min stock:', updateError);
      setDetailError(updateError?.message || 'No se pudo actualizar el stock mínimo.');
    } finally {
      setUpdatingMinStockId(null);
    }
  };

  if (loading) {
    return <DashboardLoadingState />;
  }

  if (error || !summary) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-5 lg:p-7 custom-scrollbar">
        <div className="mx-auto flex min-h-full max-w-7xl items-center justify-center">
          <div
            role="alert"
            className="w-full max-w-2xl rounded-[2rem] border border-amber-200 bg-white p-6 text-center shadow-xl shadow-slate-200/50 sm:p-10"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <AlertTriangle size={32} />
            </div>
            <h1 className="mt-5 text-xl font-black text-slate-950 sm:text-2xl">No pudimos cargar el Dashboard</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm font-medium leading-6 text-slate-500">
              {error || 'Revisá la conexión e intentá nuevamente.'}
            </p>
            <button
              type="button"
              onClick={() => void fetchSummary(true)}
              className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200"
            >
              <RefreshCw size={17} />
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeCustomerOrders =
    (summary.ventas.pedidosClientesPendientes || 0) +
    (summary.ventas.pedidosClientesEsperandoStock || 0) +
    (summary.ventas.pedidosClientesListosEntrega || 0);

  const currentMonth = summary.ventas.mes.total || 0;
  const previousMonth = summary.ventas.mes.prevTotal || 0;
  const monthlyDifference = previousMonth === 0 ? (currentMonth > 0 ? 100 : 0) : ((currentMonth - previousMonth) / previousMonth) * 100;

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-5 lg:p-7 custom-scrollbar">
      <div className="mx-auto max-w-[1500px] space-y-5 sm:space-y-7">
        <header className="overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-5 text-white shadow-2xl shadow-slate-300/40 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-100">
                <BarChart3 size={14} />
                Vista ejecutiva
              </div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">Dashboard general</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-300 sm:text-base">
                Ventas, finanzas, stock y operaciones reunidas en una vista clara para tomar decisiones rápidas.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void fetchSummary()}
              disabled={refreshing}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              aria-label="Actualizar indicadores del Dashboard"
            >
              {refreshing ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
              {refreshing ? 'Actualizando…' : 'Actualizar datos'}
            </button>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <HeroStat label="Ventas del mes" value={formatCurrency(summary.ventas.mes.total)} />
            <HeroStat label="Ganancia del mes" value={formatCurrency(summary.finanzas.gananciaMes)} />
            <HeroStat label="Stock valorizado" value={formatCurrency(summary.stock.valorizado)} />
            <HeroStat label="Pedidos activos" value={String(activeCustomerOrders + summary.stock.pedidosPendientes)} />
          </div>
        </header>

        <DashboardSection
          icon={<CircleDollarSign size={20} />}
          title="Finanzas"
          description="Saldos pendientes y resultado económico del mes."
          iconClass="bg-indigo-600 text-white"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <DashboardCard
              title="Cuentas a cobrar"
              value={formatCurrency(summary.finanzas.cuentasCobrar)}
              subtitle="Deuda total de clientes"
              icon={<Users className="text-indigo-600" />}
              onClick={() => void openDetail('cuentas-cobrar', 'Cuentas a cobrar', { days: cobrarFilter })}
              footer={
                <div className="mt-4 grid grid-cols-4 gap-2" onClick={(event) => event.stopPropagation()}>
                  {[7, 15, 30, 'all'].map((days) => (
                    <button
                      type="button"
                      key={days}
                      onClick={() => setCobrarFilter(days as number | 'all')}
                      className={`min-h-9 rounded-lg px-2 text-[10px] font-black uppercase transition ${
                        cobrarFilter === days
                          ? 'bg-slate-950 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {days === 'all' ? 'Todas' : `${days}d`}
                    </button>
                  ))}
                </div>
              }
            />
            <DashboardCard
              title="Cuentas a pagar"
              value={formatCurrency(summary.finanzas.cuentasPagar)}
              subtitle="Deuda total a proveedores"
              icon={<ShoppingCart className="text-amber-600" />}
              onClick={() => void openDetail('cuentas-pagar', 'Cuentas a pagar a proveedores')}
            />
            <DashboardCard
              title="Ganancia del mes"
              value={formatCurrency(summary.finanzas.gananciaMes)}
              subtitle="Ventas menos costos del mes actual"
              icon={<TrendingUp className="text-emerald-600" />}
              onClick={() => void openDetail('ganancia-mes-detalle', 'Ganancia del mes')}
              trend={{
                value:
                  summary.finanzas.gananciaPrevMes > 0
                    ? `${(
                        ((summary.finanzas.gananciaMes - summary.finanzas.gananciaPrevMes) /
                          summary.finanzas.gananciaPrevMes) *
                        100
                      ).toFixed(1)}%`
                    : 'N/A',
                isUp: summary.finanzas.gananciaMes >= summary.finanzas.gananciaPrevMes,
              }}
            />
          </div>
        </DashboardSection>

        <DashboardSection
          icon={<ShoppingCart size={20} />}
          title="Ventas"
          description="Actividad comercial y seguimiento de pedidos del portal."
          iconClass="bg-emerald-600 text-white"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <DashboardCard
              title="Ventas del mes"
              value={formatCurrency(summary.ventas.mes.total)}
              subtitle={`${summary.ventas.mes.cantidad} ventas realizadas`}
              icon={<Activity className="text-indigo-600" />}
              onClick={() => void openDetail('ventas-mes-detalle', 'Ventas del mes')}
              footer={
                <p className="mt-4 break-words text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Ticket promedio: {formatCurrency(summary.ventas.mes.ticketPromedio)}
                </p>
              }
            />
            <DashboardCard
              title="Ventas del día"
              value={formatCurrency(summary.ventas.dia)}
              subtitle="Total facturado hoy"
              icon={<Clock className="text-slate-600" />}
            />
            <DashboardCard
              title="Pedidos de clientes"
              value={String(activeCustomerOrders)}
              subtitle="Pedidos activos del portal"
              icon={<ShoppingCart className="text-emerald-600" />}
              onClick={() => void openDetail('pedidos-clientes', 'Seguimiento de pedidos de clientes')}
              highlight={activeCustomerOrders > 0}
              footer={
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <MiniStatus label="Aprobar" value={summary.ventas.pedidosClientesPendientes} className="text-amber-700" />
                  <MiniStatus label="Stock" value={summary.ventas.pedidosClientesEsperandoStock} className="text-orange-700" />
                  <MiniStatus label="Entregar" value={summary.ventas.pedidosClientesListosEntrega} className="text-blue-700" />
                </div>
              }
            />
            <DashboardCard
              title="Comparativo mensual"
              value={`${monthlyDifference > 0 ? '+' : ''}${monthlyDifference.toFixed(1)}%`}
              subtitle="Respecto del mes anterior"
              icon={
                monthlyDifference >= 0 ? (
                  <TrendingUp className="text-emerald-600" />
                ) : (
                  <TrendingUp className="rotate-180 text-red-600" />
                )
              }
              footer={
                <div className="mt-4 space-y-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  <p className="break-words">Actual: {formatCurrency(currentMonth)}</p>
                  <p className="break-words">Anterior: {formatCurrency(previousMonth)}</p>
                </div>
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RankingCard
              title="Top clientes del mes"
              icon={<Users size={18} />}
              emptyMessage="Todavía no hay ventas de clientes este mes."
              items={summary.ventas.topClientes.map((client, index) => ({
                label: client.nombre_cliente,
                value: formatCurrency(client.total),
                position: index + 1,
              }))}
            />
            <RankingCard
              title="Productos más vendidos"
              icon={<Package size={18} />}
              emptyMessage="Todavía no hay productos vendidos este mes."
              items={summary.ventas.topProductos.map((product, index) => ({
                label: product.name,
                value: `${product.total_qty} un.`,
                position: index + 1,
              }))}
            />
          </div>
        </DashboardSection>

        <DashboardSection
          icon={<Package size={20} />}
          title="Stock"
          description="Valorización, faltantes y pedidos a proveedor."
          iconClass="bg-amber-500 text-white"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <DashboardCard
              title="Valor del stock"
              value={formatCurrency(summary.stock.valorizado)}
              subtitle="Costo total de la mercadería"
              icon={<DollarSign className="text-emerald-600" />}
              onClick={() => void openDetail('stock-valorizado-detalle', 'Valor del stock')}
            />
            <DashboardCard
              title="Stock crítico"
              value={String(summary.stock.critico)}
              subtitle="Productos en o debajo del mínimo"
              icon={<AlertTriangle className="text-red-600" />}
              onClick={() => void openDetail('stock-critico', 'Productos con stock crítico')}
              highlight={summary.stock.critico > 0}
            />
            <DashboardCard
              title="Pedidos pendientes"
              value={String(summary.stock.pedidosPendientes)}
              subtitle="Pedidos a proveedor sin recibir"
              icon={<Clock className="text-amber-600" />}
              onClick={() => void openDetail('pedidos-pendientes', 'Pedidos pendientes a proveedor')}
              highlight={summary.stock.pedidosPendientes > 0}
            />
          </div>
        </DashboardSection>

        <DashboardSection
          icon={<Activity size={20} />}
          title="Operaciones"
          description="Seguimiento de visitas, pedidos y alertas comerciales."
          iconClass="bg-blue-600 text-white"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <DashboardCard
              title="Pedidos a proveedor"
              value={String(summary.stock.pedidosPendientes)}
              subtitle="Órdenes activas pendientes"
              icon={<ShoppingCart className="text-amber-600" />}
              onClick={() => void openDetail('pedidos-pendientes', 'Pedidos pendientes a proveedor')}
            />
            <DashboardCard
              title="Ruta del día"
              value={`${summary.operaciones.rutaDia.visitados}/${summary.operaciones.rutaDia.planificados}`}
              subtitle="Clientes visitados hoy"
              icon={<Map className="text-blue-600" />}
              footer={
                <p className="mt-4 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Ventas realizadas: {summary.operaciones.rutaDia.ventas}
                </p>
              }
            />
            <DashboardCard
              title="Alertas de deuda"
              value={String(summary.operaciones.alertasDeuda)}
              subtitle="Clientes con deuda mayor a 7 días"
              icon={<AlertTriangle className="text-red-600" />}
              onClick={() => void openDetail('deuda-vencida', 'Clientes con deuda vencida')}
              highlight={summary.operaciones.alertasDeuda > 0}
            />
          </div>
        </DashboardSection>

        <DashboardSection
          icon={<TrendingUp size={20} />}
          title="Rentabilidad"
          description="Productos con mejor resultado según costo real PEPS."
          iconClass="bg-emerald-600 text-white"
        >
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            {summary.ventas.topProductosRentables.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {summary.ventas.topProductosRentables.map((product, index) => (
                  <article
                    key={`${product.producto}-${index}`}
                    className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/30"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Producto #{index + 1}</p>
                        <h3 className="mt-1 break-words text-base font-black text-slate-950">{product.producto}</h3>
                      </div>
                      <span
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-black ${
                          product.margen >= 30
                            ? 'bg-emerald-100 text-emerald-700'
                            : product.margen >= 15
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {product.margen.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
                      <DataTile label="Ventas" value={formatCurrency(product.ventas)} />
                      <DataTile label="Costo" value={formatCurrency(product.costo)} />
                      <DataTile label="Ganancia" value={formatCurrency(product.ganancia)} valueClass="text-emerald-700" />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<TrendingUp size={25} />}
                title="Sin datos de rentabilidad"
                description="Todavía no hay ventas suficientes para calcular productos rentables este mes."
              />
            )}
          </div>
        </DashboardSection>
      </div>

      <AnimatePresence>
        {detailModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.98 }}
              className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-[2rem]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dashboard-detail-title"
            >
              <div className="relative border-b border-slate-200 bg-slate-50 px-4 py-5 pr-16 sm:px-6 sm:py-6">
                <h2 id="dashboard-detail-title" className="break-words text-lg font-black text-slate-950 sm:text-2xl">
                  {detailModal.title}
                </h2>
                <p className="mt-1 text-xs font-medium text-slate-500 sm:text-sm">Detalle actualizado del indicador seleccionado.</p>

                {detailModal.type === 'cuentas-cobrar' && (
                  <div className="mt-4 grid grid-cols-4 gap-2 sm:max-w-md">
                    {[7, 15, 30, 'all'].map((days) => (
                      <button
                        type="button"
                        key={days}
                        onClick={() => {
                          setCobrarFilter(days as number | 'all');
                          void openDetail('cuentas-cobrar', 'Cuentas a cobrar', { days: days as string | number });
                        }}
                        className={`min-h-10 rounded-xl px-2 text-[10px] font-black uppercase transition sm:text-xs ${
                          cobrarFilter === days
                            ? 'bg-slate-950 text-white'
                            : 'border border-slate-200 bg-white text-slate-500 hover:border-indigo-300'
                        }`}
                      >
                        {days === 'all' ? 'Todas' : `${days}d`}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setDetailModal(null)}
                  aria-label="Cerrar detalle"
                  title="Cerrar detalle"
                  className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-950 sm:right-5 sm:top-5"
                >
                  <X size={21} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 custom-scrollbar">
                {detailLoading ? (
                  <DetailLoadingState />
                ) : detailError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
                    <AlertTriangle className="mx-auto text-red-600" size={28} />
                    <p className="mt-3 text-sm font-black text-red-800">No se pudo cargar el detalle</p>
                    <p className="mt-1 text-sm text-red-700">{detailError}</p>
                  </div>
                ) : (
                  <DashboardDetailContent
                    type={detailModal.type}
                    data={detailModal.data}
                    updatingMinStockId={updatingMinStockId}
                    onUpdateMinStock={handleUpdateMinStock}
                  />
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DashboardSection({
  icon,
  title,
  description,
  iconClass,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconClass: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex min-w-0 items-start gap-3 px-1">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${iconClass}`}>{icon}</div>
        <div className="min-w-0">
          <h2 className="text-lg font-black tracking-tight text-slate-950 sm:text-xl">{title}</h2>
          <p className="mt-0.5 text-xs font-medium leading-5 text-slate-500 sm:text-sm">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">{label}</p>
      <p className="mt-2 break-words text-lg font-black leading-tight text-white sm:text-xl">{value}</p>
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
  highlight = false,
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
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <motion.div
      whileHover={onClick ? { y: -2 } : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Ver detalle de ${title}` : undefined}
      className={`min-w-0 rounded-[1.5rem] border p-5 shadow-sm transition focus:outline-none focus:ring-4 focus:ring-indigo-100 sm:p-6 ${
        onClick ? 'cursor-pointer hover:border-indigo-300 hover:shadow-lg' : ''
      } ${highlight ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 shadow-inner">{icon}</div>
        <div className="flex min-w-0 items-center gap-2">
          {trend && (
            <span
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black ${
                trend.isUp ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {trend.isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {trend.value}
            </span>
          )}
          {onClick && <ChevronRight size={18} className="shrink-0 text-slate-300" />}
        </div>
      </div>
      <p className="mt-5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{title}</p>
      <p className="mt-1 break-words text-[clamp(1.45rem,5vw,2rem)] font-black leading-tight tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-xs font-medium leading-5 text-slate-500">{subtitle}</p>
      {footer}
    </motion.div>
  );
}

function MiniStatus({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/70 p-2">
      <p className="truncate text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-black ${className}`}>{value}</p>
    </div>
  );
}

function RankingCard({
  title,
  icon,
  items,
  emptyMessage,
}: {
  title: string;
  icon: React.ReactNode;
  items: { label: string; value: string; position: number }[];
  emptyMessage: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2 text-slate-950">
        {icon}
        <h3 className="text-sm font-black uppercase tracking-wider">{title}</h3>
      </div>
      {items.length > 0 ? (
        <div className="mt-5 space-y-2">
          {items.map((item) => (
            <div key={`${item.label}-${item.position}`} className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-[10px] font-black text-white">
                {String(item.position).padStart(2, '0')}
              </span>
              <p className="min-w-0 flex-1 break-words text-sm font-bold text-slate-800">{item.label}</p>
              <p className="shrink-0 text-sm font-black text-slate-950">{item.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={icon} title="Sin información" description={emptyMessage} compact />
      )}
    </div>
  );
}

function DataTile({ label, value, valueClass = 'text-slate-950' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 break-words text-sm font-black ${valueClass}`}>{value}</p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  compact = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={`text-center ${compact ? 'py-7' : 'rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-10 px-4'}`}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>
      <p className="mt-3 text-sm font-black text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs font-medium leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function DashboardDetailContent({
  type,
  data,
  updatingMinStockId,
  onUpdateMinStock,
}: {
  type: string;
  data: any[];
  updatingMinStockId: number | null;
  onUpdateMinStock: (productId: number, value: number) => Promise<void>;
}) {
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<Activity size={24} />}
        title="No hay información para mostrar"
        description="No se encontraron registros para este indicador y el filtro seleccionado."
      />
    );
  }

  if (type === 'stock-valorizado-detalle') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.producto}-${index}`} title={item.producto} eyebrow="Producto">
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
              <DataTile label="Stock" value={String(item.stock ?? 0)} />
              <DataTile label="Costo unitario" value={formatCurrency(item.costo)} />
              <DataTile label="Valor total" value={formatCurrency(item.valor_total)} valueClass="text-emerald-700" />
            </div>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  if (type === 'ganancia-mes-detalle') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.fecha}-${item.cliente}-${index}`} title={item.cliente} eyebrow={formatDate(item.fecha)}>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
              <DataTile label="Venta" value={formatCurrency(item.venta)} />
              <DataTile label="Costo" value={formatCurrency(item.costo)} />
              <DataTile label="Ganancia" value={formatCurrency(item.ganancia)} valueClass="text-emerald-700" />
            </div>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  if (type === 'pedidos-clientes') {
    return (
      <DetailGrid>
        {data.map((item, index) => {
          const statusLabel =
            item.estado === 'pendiente_aprobacion'
              ? 'Pendiente de aprobación'
              : item.stock_status === 'esperando_stock'
              ? 'Esperando reposición'
              : 'Listo para entregar';
          const statusClass =
            item.estado === 'pendiente_aprobacion'
              ? 'bg-amber-100 text-amber-800'
              : item.stock_status === 'esperando_stock'
              ? 'bg-orange-100 text-orange-800'
              : 'bg-blue-100 text-blue-800';

          return (
            <DetailCard key={`${item.id}-${index}`} title={`Pedido #${item.numero_pedido}`} eyebrow={item.cliente}>
              <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-end min-[420px]:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">{formatDateTime(item.fecha)} · {item.items} productos</p>
                  <span className={`mt-2 inline-flex rounded-lg px-2.5 py-1 text-[10px] font-black uppercase ${statusClass}`}>
                    {statusLabel}
                  </span>
                </div>
                <p className="break-words text-xl font-black text-slate-950">{formatCurrency(item.total_final)}</p>
              </div>
            </DetailCard>
          );
        })}
      </DetailGrid>
    );
  }

  if (type === 'ventas-mes-detalle') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.fecha}-${item.cliente}-${index}`} title={item.cliente} eyebrow={formatDate(item.fecha)}>
            <p className="break-words text-xs font-medium leading-5 text-slate-500">{item.productos || 'Sin detalle de productos'}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <DataTile label="Forma de pago" value={item.forma_pago || 'Sin informar'} />
              <DataTile label="Total" value={formatCurrency(item.total)} valueClass="text-indigo-700" />
            </div>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  if (type === 'cuentas-cobrar') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.cliente}-${index}`} title={item.cliente} eyebrow={formatDate(item.fecha_venta)}>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <DataTile label="Monto de deuda" value={formatCurrency(item.deuda)} valueClass="text-red-700" />
              <DataTile label="Días vencido" value={`${item.dias_atraso ?? 0} días`} valueClass={(item.dias_atraso ?? 0) > 7 ? 'text-red-700' : 'text-amber-700'} />
            </div>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  if (type === 'cuentas-pagar') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.proveedor}-${item.fecha}-${index}`} title={item.proveedor} eyebrow={formatDate(item.fecha)}>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <DataTile label="Monto pendiente" value={formatCurrency(item.monto)} valueClass="text-amber-700" />
              <DataTile label="Estado" value={item.estado || 'Pendiente'} />
            </div>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  if (type === 'stock-critico') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.id}-${index}`} title={item.name} eyebrow={item.codigo_unico || 'Sin código'}>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <DataTile label="Stock actual" value={String(item.stock ?? 0)} valueClass="text-red-700" />
              <label className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Stock mínimo</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    defaultValue={item.stock_minimo}
                    disabled={updatingMinStockId === item.id}
                    onBlur={(event) => void onUpdateMinStock(item.id, Number(event.target.value))}
                    className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:opacity-60"
                    aria-label={`Stock mínimo de ${item.name}`}
                  />
                  {updatingMinStockId === item.id && <Loader2 size={17} className="shrink-0 animate-spin text-indigo-600" />}
                </div>
              </label>
            </div>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  if (type === 'pedidos-pendientes') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.cliente}-${item.fecha}-${index}`} title={item.cliente || 'Pedido a proveedor'} eyebrow={formatDate(item.fecha)}>
            <span className="inline-flex rounded-lg bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-800">
              {item.estado || 'Pendiente'}
            </span>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  if (type === 'deuda-vencida') {
    return (
      <DetailGrid>
        {data.map((item, index) => (
          <DetailCard key={`${item.cliente}-${index}`} title={item.cliente} eyebrow="Cuenta corriente vencida">
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <DataTile label="Deuda" value={formatCurrency(item.deuda)} valueClass="text-red-700" />
              <DataTile label="Días de atraso" value={`${item.dias_atraso ?? 0} días`} valueClass="text-red-700" />
            </div>
          </DetailCard>
        ))}
      </DetailGrid>
    );
  }

  return (
    <EmptyState
      icon={<Activity size={24} />}
      title="Detalle no disponible"
      description="Este indicador no tiene una vista de detalle configurada."
    />
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{children}</div>;
}

function DetailCard({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      {eyebrow && <p className="break-words text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{eyebrow}</p>}
      <h3 className="mt-1 break-words text-base font-black text-slate-950">{title}</h3>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function DetailLoadingState() {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700">
        <Loader2 size={18} className="animate-spin" />
        Cargando detalle…
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-5 w-2/3 rounded bg-slate-200" />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="h-16 rounded-xl bg-white" />
              <div className="h-16 rounded-xl bg-white" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-3 sm:p-5 lg:p-7 custom-scrollbar" role="status" aria-live="polite" aria-busy="true">
      <div className="mx-auto max-w-[1500px] space-y-5 sm:space-y-7">
        <div className="animate-pulse rounded-[1.75rem] bg-slate-900 p-5 sm:p-7 lg:p-8">
          <div className="h-6 w-36 rounded bg-white/15" />
          <div className="mt-4 h-9 w-2/3 max-w-md rounded bg-white/15" />
          <div className="mt-3 h-4 w-full max-w-xl rounded bg-white/10" />
          <div className="mt-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 rounded-2xl bg-white/10" />
            ))}
          </div>
        </div>

        {Array.from({ length: 4 }).map((_, sectionIndex) => (
          <section key={sectionIndex} className="animate-pulse space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-slate-200" />
              <div>
                <div className="h-5 w-32 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-52 max-w-[60vw] rounded bg-slate-200" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, cardIndex) => (
                <div key={cardIndex} className="h-52 rounded-[1.5rem] border border-slate-200 bg-white p-5">
                  <div className="h-11 w-11 rounded-2xl bg-slate-100" />
                  <div className="mt-5 h-3 w-28 rounded bg-slate-200" />
                  <div className="mt-3 h-8 w-2/3 rounded bg-slate-200" />
                  <div className="mt-3 h-3 w-1/2 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <span className="sr-only">Cargando datos del Dashboard.</span>
    </div>
  );
}
