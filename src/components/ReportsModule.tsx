import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  Package, 
  DollarSign, 
  Wallet, 
  Calendar, 
  Download, 
  ArrowUpRight, 
  ArrowDownLeft,
  Filter,
  Search,
  ChevronRight,
  PieChart,
  LineChart as LineChartIcon,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart as RePieChart, 
  Pie, 
  Cell,
  AreaChart,
  Area
} from 'recharts';
import { apiFetch, unwrapResponse } from '../utils/api';

type ReportData = {
  ventas: {
    total: number;
    cantidad: number;
    promedio: number;
    porDia: { fecha: string; total: number; cantidad: number }[];
    porMetodoPago: { name: string; value: number }[];
    listaVentas: { id: number; fecha: string; nombre_cliente: string; total: number; metodo_pago: string }[];
  };
  clientes: {
    nuevos: number;
    activos: number;
    conDeuda: number;
    listadoClientes: { id: number; nombre: string; total: number; cantidad: number; ultima_compra: string }[];
  };
  productos: {
    listadoProductos: { name: string; cantidad: number; total: number; ultima_venta: string }[];
    porFamilia: { name: string; value: number }[];
    bajoStock: { name: string; stock: number }[];
  };
  deudas: {
    totalAdeudado: number;
    clientesDeudores: number;
    deudaVencida: number;
    rankingDeudores: { 
      id: number; 
      nombre: string; 
      saldo: number; 
      ventas_pendientes: number; 
      fecha_antigua: string 
    }[];
  };
  finanzas: {
    ingresos: number;
    egresos: number;
    balance: number;
    egresosPorCategoria: { name: string; value: number }[];
    flujoCaja: { fecha: string; ingresos: number; egresos: number }[];
  };
};

const COLORS = ['#18181b', '#71717a', '#a1a1aa', '#d4d4d8', '#e4e4e7'];

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  return 'No se pudieron cargar los datos del reporte.';
};

function ReportLoadingState({ message = 'Cargando datos del reporte...' }: { message?: string }) {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
        <Loader2 size={20} className="animate-spin text-zinc-900" />
        <div>
          <p className="text-sm font-black text-zinc-900">{message}</p>
          <p className="text-xs font-medium text-zinc-500">La información aparecerá apenas termine la consulta.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-36 animate-pulse rounded-[32px] border border-zinc-200 bg-white p-8">
            <div className="h-3 w-28 rounded bg-zinc-200" />
            <div className="mt-5 h-10 w-40 rounded bg-zinc-200" />
            <div className="mt-4 h-3 w-24 rounded bg-zinc-100" />
          </div>
        ))}
      </div>

      <div className="h-80 animate-pulse rounded-[40px] border border-zinc-200 bg-white p-8">
        <div className="h-5 w-52 rounded bg-zinc-200" />
        <div className="mt-8 h-56 rounded-3xl bg-zinc-100" />
      </div>
    </div>
  );
}

function ReportErrorState({
  message,
  onRetry,
  compact = false
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-[32px] border border-red-200 bg-red-50 text-center ${compact ? 'p-5' : 'p-10 md:p-14'}`}
      role="alert"
    >
      <AlertTriangle size={compact ? 24 : 34} className="mx-auto text-red-600" />
      <h3 className="mt-3 text-base font-black text-red-900">No se pudo cargar el reporte</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-medium text-red-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-red-800"
      >
        <RefreshCw size={15} />
        Reintentar
      </button>
    </div>
  );
}

function ReportEmptyState({
  title = 'No hay datos para mostrar',
  description = 'Probá otro período o revisá los filtros seleccionados.',
  compact = false
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-[28px] border border-dashed border-zinc-300 bg-zinc-50 text-center ${compact ? 'p-8' : 'p-12'}`}>
      <BarChart3 size={compact ? 28 : 36} className="mx-auto text-zinc-300" />
      <p className="mt-3 text-sm font-black text-zinc-700">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs font-medium text-zinc-500">{description}</p>
    </div>
  );
}

export default function ReportsModule() {
  const [activeTab, setActiveTab] = useState<'ventas' | 'clientes' | 'productos' | 'deudas' | 'finanzas' | 'ventas-periodo' | 'ventas-cliente' | 'productos-vendidos' | 'rentabilidad-producto' | 'cuentas-corrientes' | 'comisiones'>('ventas');
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });
  const [clienteId, setClienteId] = useState<string>('');
  const [clientes, setClientes] = useState<{ id: number; nombre_apellido: string }[]>([]);
  const [data, setData] = useState<ReportData | null>(null);
  const [salesPeriodData, setSalesPeriodData] = useState<{ sales: any[], summary: any } | null>(null);
  const [salesByClientData, setSalesByClientData] = useState<any[] | null>(null);
  const [bestSellingProductsData, setBestSellingProductsData] = useState<any[] | null>(null);
  const [profitabilityData, setProfitabilityData] = useState<any[] | null>(null);
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [currentAccountsData, setCurrentAccountsData] = useState<any[] | null>(null);
  const [commissionsData, setCommissionsData] = useState<{ sales: any[], summary: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSalesPeriod, setLoadingSalesPeriod] = useState(false);
  const [loadingSalesByClient, setLoadingSalesByClient] = useState(false);
  const [loadingBestSellingProducts, setLoadingBestSellingProducts] = useState(false);
  const [loadingProfitability, setLoadingProfitability] = useState(false);
  const [loadingCurrentAccounts, setLoadingCurrentAccounts] = useState(false);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [viewingClientSales, setViewingClientSales] = useState<{ id: number; nombre: string } | null>(null);
  const [clientSales, setClientSales] = useState<any[]>([]);
  const [loadingClientSales, setLoadingClientSales] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clientSalesError, setClientSalesError] = useState<string | null>(null);

  const clearError = (key: string) => {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const saveError = (key: string, error: unknown) => {
    setErrors((current) => ({ ...current, [key]: getErrorMessage(error) }));
  };

  const [productSort, setProductSort] = useState<'cantidad' | 'total'>('cantidad');
  const [bestSellingSort, setBestSellingSort] = useState<'cantidad_vendida' | 'total_facturado' | 'total_ganancia'>('cantidad_vendida');
  const [profitabilitySort, setProfitabilitySort] = useState<'ganancia' | 'cantidad_vendida'>('ganancia');
  const [currentAccountsSort, setCurrentAccountsSort] = useState<'monto_deuda' | 'dias_vencidos'>('monto_deuda');

  const fetchClientSales = async (clientId: number) => {
    setLoadingClientSales(true);
    setClientSalesError(null);
    try {
      const queryParams = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
        cliente_id: clientId.toString()
      });
      const res = await apiFetch(`/api/dashboard/sales-period?${queryParams.toString()}`);
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setClientSales(reportData.sales);
    } catch (error) {
      console.error("Error fetching client sales:", error);
      setClientSalesError(getErrorMessage(error));
    } finally {
      setLoadingClientSales(false);
    }
  };

  const fetchClientes = async () => {
    try {
      const res = await apiFetch('/api/clientes');
      const body = await res.json();
      const data = unwrapResponse(body);
      setClientes(data);
    } catch (error) {
      console.error("Error fetching clients:", error);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await apiFetch('/api/products');
      const body = await res.json();
      const data = unwrapResponse(body);
      setProducts(data);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  const fetchReportData = async () => {
    setLoading(true);
    clearError('base');
    try {
      const queryParams = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
      });
      if (clienteId) queryParams.append('cliente_id', clienteId);
      
      const res = await apiFetch(`/api/dashboard/reports?${queryParams.toString()}`);
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setData(reportData);
    } catch (error) {
      console.error("Error fetching report data:", error);
      saveError('base', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesPeriodData = async () => {
    setLoadingSalesPeriod(true);
    clearError('ventas-periodo');
    try {
      const queryParams = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
      });
      const res = await apiFetch(`/api/dashboard/sales-period?${queryParams.toString()}`);
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setSalesPeriodData(reportData);
    } catch (error) {
      console.error("Error fetching sales period data:", error);
      saveError('ventas-periodo', error);
    } finally {
      setLoadingSalesPeriod(false);
    }
  };

  const fetchSalesByClientData = async () => {
    setLoadingSalesByClient(true);
    clearError('ventas-cliente');
    try {
      const queryParams = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
      });
      const res = await apiFetch(`/api/dashboard/sales-by-client?${queryParams.toString()}`);
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setSalesByClientData(reportData);
    } catch (error) {
      console.error("Error fetching sales by client data:", error);
      saveError('ventas-cliente', error);
    } finally {
      setLoadingSalesByClient(false);
    }
  };

  const fetchBestSellingProductsData = async () => {
    setLoadingBestSellingProducts(true);
    clearError('productos-vendidos');
    try {
      const queryParams = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
      });
      const res = await apiFetch(`/api/dashboard/best-selling-products?${queryParams.toString()}`);
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setBestSellingProductsData(reportData);
    } catch (error) {
      console.error("Error fetching best selling products data:", error);
      saveError('productos-vendidos', error);
    } finally {
      setLoadingBestSellingProducts(false);
    }
  };

  const fetchProfitabilityData = async () => {
    setLoadingProfitability(true);
    clearError('rentabilidad-producto');
    try {
      const queryParams = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
        productId: selectedProductId
      });
      const res = await apiFetch(`/api/dashboard/product-profitability?${queryParams.toString()}`);
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setProfitabilityData(reportData);
    } catch (error) {
      console.error("Error fetching profitability data:", error);
      saveError('rentabilidad-producto', error);
    } finally {
      setLoadingProfitability(false);
    }
  };

  const fetchCurrentAccountsData = async () => {
    setLoadingCurrentAccounts(true);
    clearError('cuentas-corrientes');
    try {
      const res = await apiFetch('/api/dashboard/current-accounts');
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setCurrentAccountsData(reportData);
    } catch (error) {
      console.error("Error fetching current accounts data:", error);
      saveError('cuentas-corrientes', error);
    } finally {
      setLoadingCurrentAccounts(false);
    }
  };

  const fetchCommissionsData = async () => {
    setLoadingCommissions(true);
    clearError('comisiones');
    try {
      const queryParams = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
      });
      const res = await apiFetch(`/api/dashboard/commissions?${queryParams.toString()}`);
      const body = await res.json();
      const reportData = unwrapResponse(body);
      setCommissionsData(reportData);
    } catch (error) {
      console.error("Error fetching commissions data:", error);
      saveError('comisiones', error);
    } finally {
      setLoadingCommissions(false);
    }
  };

  const fetchActiveReport = () => {
    if (activeTab === 'ventas-periodo') {
      return fetchSalesPeriodData();
    }
    if (activeTab === 'ventas-cliente') {
      return fetchSalesByClientData();
    }
    if (activeTab === 'productos-vendidos') {
      return fetchBestSellingProductsData();
    }
    if (activeTab === 'rentabilidad-producto') {
      return fetchProfitabilityData();
    }
    if (activeTab === 'cuentas-corrientes') {
      return fetchCurrentAccountsData();
    }
    if (activeTab === 'comisiones') {
      return fetchCommissionsData();
    }
    return fetchReportData();
  };

  useEffect(() => {
    fetchClientes();
    fetchProducts();
  }, []);

  useEffect(() => {
    fetchActiveReport();
  }, [dateRange, clienteId, activeTab, selectedProductId]);

  const baseTabs = ['ventas', 'clientes', 'productos', 'deudas', 'finanzas'];
  const activeErrorKey = baseTabs.includes(activeTab) ? 'base' : activeTab;
  const activeError = errors[activeErrorKey] ?? null;

  const isActiveLoading =
    activeTab === 'ventas-periodo' ? loadingSalesPeriod :
    activeTab === 'ventas-cliente' ? loadingSalesByClient :
    activeTab === 'productos-vendidos' ? loadingBestSellingProducts :
    activeTab === 'rentabilidad-producto' ? loadingProfitability :
    activeTab === 'cuentas-corrientes' ? loadingCurrentAccounts :
    activeTab === 'comisiones' ? loadingCommissions :
    loading;

  const hasActiveData =
    activeTab === 'ventas-periodo' ? salesPeriodData !== null :
    activeTab === 'ventas-cliente' ? salesByClientData !== null :
    activeTab === 'productos-vendidos' ? bestSellingProductsData !== null :
    activeTab === 'rentabilidad-producto' ? profitabilityData !== null :
    activeTab === 'cuentas-corrientes' ? currentAccountsData !== null :
    activeTab === 'comisiones' ? commissionsData !== null :
    data !== null;

  return (
    <div className="h-full flex flex-col bg-zinc-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 p-8 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <h2 className="text-3xl font-black text-zinc-900 tracking-tight">REPORTES E INTELIGENCIA</h2>
            <p className="text-zinc-500 text-sm font-medium">Analiza el rendimiento de tu negocio con datos precisos</p>
          </div>
          
          <div className="flex items-center gap-3 bg-zinc-100 p-1.5 rounded-2xl border border-zinc-200">
            <div className="flex items-center gap-2 px-3">
              <Calendar size={16} className="text-zinc-400" />
              <input 
                type="date" 
                value={dateRange.from}
                onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                className="bg-transparent border-none text-xs font-bold outline-none focus:ring-0 w-32"
              />
            </div>
            <div className="text-zinc-300 font-bold">→</div>
            <div className="flex items-center gap-2 px-3">
              <input 
                type="date" 
                value={dateRange.to}
                onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                className="bg-transparent border-none text-xs font-bold outline-none focus:ring-0 w-32"
              />
            </div>
            <button
              type="button"
              onClick={fetchActiveReport}
              disabled={isActiveLoading}
              title="Actualizar reporte con los filtros seleccionados"
              aria-label="Actualizar reporte con los filtros seleccionados"
              className="bg-zinc-900 text-white p-2 rounded-xl hover:bg-zinc-800 transition-all disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isActiveLoading ? <Loader2 size={16} className="animate-spin" /> : <Filter size={16} />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-zinc-100 rounded-2xl w-fit overflow-x-auto max-w-full">
          {[
            { id: 'ventas', label: 'Ventas', icon: TrendingUp },
            { id: 'ventas-periodo', label: 'Ventas por Período', icon: Calendar },
            { id: 'ventas-cliente', label: 'Ventas por Cliente', icon: Users },
            { id: 'productos-vendidos', label: 'Productos más Vendidos', icon: Package },
            { id: 'rentabilidad-producto', label: 'Rentabilidad por Producto', icon: PieChart },
            { id: 'comisiones', label: 'Comisiones', icon: DollarSign },
            { id: 'cuentas-corrientes', label: 'Cuentas Corrientes', icon: DollarSign },
            { id: 'clientes', label: 'Clientes', icon: Users },
            { id: 'productos', label: 'Productos', icon: Package },
            { id: 'deudas', label: 'Deudas', icon: DollarSign },
            { id: 'finanzas', label: 'Finanzas', icon: Wallet }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {isActiveLoading && hasActiveData && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-blue-900" role="status" aria-live="polite">
            <Loader2 size={18} className="animate-spin" />
            <div>
              <p className="text-sm font-black">Actualizando reporte…</p>
              <p className="text-xs font-medium text-blue-700">Se mantienen visibles los últimos datos mientras termina la consulta.</p>
            </div>
          </div>
        )}

        {activeError && hasActiveData && (
          <div className="mb-6">
            <ReportErrorState message={activeError} onRetry={fetchActiveReport} compact />
          </div>
        )}

        {isActiveLoading && !hasActiveData ? (
          <ReportLoadingState />
        ) : activeError && !hasActiveData ? (
          <ReportErrorState message={activeError} onRetry={fetchActiveReport} />
        ) : !hasActiveData ? (
          <ReportEmptyState
            title="No hay información disponible"
            description="No se recibió información para este reporte. Probá actualizar o cambiar el período."
          />
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {activeTab === 'comisiones' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-2xl font-black tracking-tight">Reporte de Comisiones</h3>
                  <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-800 transition-all"
                  >
                    <Download size={16} />
                    Imprimir Reporte
                  </button>
                </div>

                {loadingCommissions ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Generando reporte...</p>
                  </div>
                ) : commissionsData && commissionsData.sales.length > 0 ? (
                  <>
                    <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden print:border-none print:shadow-none">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-zinc-50/50">
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Venta</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">% Comisión</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Comisión Generada</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-50">
                            {commissionsData.sales.map((s, i) => (
                              <tr key={i} className="hover:bg-zinc-50 transition-colors">
                                <td className="px-6 py-4">
                                  <p className="text-xs text-zinc-900 font-bold">{new Date(s.fecha).toLocaleDateString()}</p>
                                  <p className="text-[10px] text-zinc-400 font-mono">{new Date(s.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                </td>
                                <td className="px-6 py-4 text-xs font-bold text-zinc-900">{s.cliente}</td>
                                <td className="px-6 py-4 text-right text-xs font-black font-mono">${s.total_venta.toFixed(2)}</td>
                                <td className="px-6 py-4 text-center text-xs font-black font-mono">{s.porcentaje_comision}%</td>
                                <td className="px-6 py-4 text-right text-xs font-black font-mono text-emerald-600">${s.comision_generada.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <div className="bg-zinc-900 p-8 rounded-3xl text-white min-w-[300px]">
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Total Comisiones del Período</p>
                        <p className="text-3xl font-black font-mono">${commissionsData.summary.totalComisiones.toFixed(2)}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <ReportEmptyState
                    title="No hay operaciones en el período"
                    description="Probá ampliar las fechas o cambiar los filtros seleccionados."
                  />
                )}
              </div>
            )}
            {activeTab === 'cuentas-corrientes' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-2xl font-black tracking-tight">Cuentas Corrientes (Deudores)</h3>
                  <div className="flex items-center gap-2">
                    <div className="flex bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                      <button
                        onClick={() => setCurrentAccountsSort('monto_deuda')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          currentAccountsSort === 'monto_deuda' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Monto Deuda
                      </button>
                      <button
                        onClick={() => setCurrentAccountsSort('dias_vencidos')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          currentAccountsSort === 'dias_vencidos' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Días Vencidos
                      </button>
                    </div>
                    <button 
                      onClick={() => window.print()}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-800 transition-all"
                    >
                      <Download size={16} />
                      Imprimir
                    </button>
                  </div>
                </div>

                {loadingCurrentAccounts ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Generando reporte...</p>
                  </div>
                ) : currentAccountsData && currentAccountsData.length > 0 ? (
                  <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden print:border-none print:shadow-none">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50/50">
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Monto Deuda</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Ventas Pendientes</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Deuda más Antigua</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Días Vencidos</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {[...currentAccountsData]
                            .sort((a, b) => b[currentAccountsSort] - a[currentAccountsSort])
                            .map((c, i) => (
                            <tr key={i} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-6 py-4 text-xs font-bold text-zinc-900">{c.cliente}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono text-red-600">${c.monto_deuda.toFixed(2)}</td>
                              <td className="px-6 py-4 text-center text-xs font-black font-mono">{c.ventas_pendientes}</td>
                              <td className="px-6 py-4 text-center text-xs font-bold text-zinc-500">{c.fecha_antigua ? new Date(c.fecha_antigua).toLocaleDateString() : '-'}</td>
                              <td className="px-6 py-4 text-center">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                  c.dias_vencidos > 30 ? 'bg-red-100 text-red-600' : 
                                  c.dias_vencidos > 7 ? 'bg-amber-100 text-amber-600' : 
                                  'bg-zinc-100 text-zinc-600'
                                }`}>
                                  {c.dias_vencidos} días
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <ReportEmptyState
                    title="No hay clientes con deuda"
                    description="Las cuentas corrientes no registran saldos pendientes actualmente."
                  />
                )}
              </div>
            )}

            {activeTab === 'rentabilidad-producto' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-2xl font-black tracking-tight">Rentabilidad por Producto</h3>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Basado en costo real PEPS (FIFO)</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-2 rounded-xl shadow-sm">
                      <Package size={14} className="text-zinc-400" />
                      <select
                        value={selectedProductId}
                        onChange={(e) => setSelectedProductId(e.target.value)}
                        className="bg-transparent border-none text-[10px] font-bold uppercase tracking-widest outline-none focus:ring-0 min-w-[150px]"
                      >
                        <option value="all">Todos los Productos</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                      <button
                        onClick={() => setProfitabilitySort('ganancia')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          profitabilitySort === 'ganancia' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Ganancia
                      </button>
                      <button
                        onClick={() => setProfitabilitySort('cantidad_vendida')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          profitabilitySort === 'cantidad_vendida' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Cantidad
                      </button>
                    </div>
                    <button 
                      onClick={() => window.print()}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-800 transition-all"
                    >
                      <Download size={16} />
                      Imprimir
                    </button>
                  </div>
                </div>

                {loadingProfitability ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Generando reporte...</p>
                  </div>
                ) : profitabilityData && profitabilityData.length > 0 ? (
                  <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden print:border-none print:shadow-none">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50/50">
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Producto</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cant. Vendida</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Ventas Totales</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Costo Total</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Ganancia</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Margen %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {[...profitabilityData]
                            .sort((a, b) => b[profitabilitySort] - a[profitabilitySort])
                            .map((p, i) => (
                            <tr key={i} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-6 py-4 text-xs font-bold text-zinc-900">{p.producto}</td>
                              <td className="px-6 py-4 text-center text-xs font-black font-mono">{p.cantidad_vendida}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono">${p.ventas_totales.toFixed(2)}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono text-zinc-400">${p.costo_total.toFixed(2)}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono text-emerald-600">${p.ganancia.toFixed(2)}</td>
                              <td className="px-6 py-4 text-center">
                                <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${
                                  p.margen_porcentual >= 30 ? 'bg-emerald-50 text-emerald-600' : 
                                  p.margen_porcentual >= 15 ? 'bg-amber-50 text-amber-600' : 
                                  'bg-red-50 text-red-600'
                                }`}>
                                  {p.margen_porcentual.toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <ReportEmptyState
                    title="No hay operaciones en el período"
                    description="Probá ampliar las fechas o cambiar los filtros seleccionados."
                  />
                )}
              </div>
            )}

            {activeTab === 'productos-vendidos' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-2xl font-black tracking-tight">Productos más Vendidos</h3>
                  <div className="flex items-center gap-2">
                    <div className="flex bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                      <button
                        onClick={() => setBestSellingSort('cantidad_vendida')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          bestSellingSort === 'cantidad_vendida' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Cantidad
                      </button>
                      <button
                        onClick={() => setBestSellingSort('total_facturado')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          bestSellingSort === 'total_facturado' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Facturación
                      </button>
                      <button
                        onClick={() => setBestSellingSort('total_ganancia')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          bestSellingSort === 'total_ganancia' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Ganancia
                      </button>
                    </div>
                    <button 
                      onClick={() => window.print()}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-800 transition-all"
                    >
                      <Download size={16} />
                      Imprimir
                    </button>
                  </div>
                </div>

                {loadingBestSellingProducts ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Generando reporte...</p>
                  </div>
                ) : bestSellingProductsData && bestSellingProductsData.length > 0 ? (
                  <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden print:border-none print:shadow-none">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50/50">
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Producto</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cant. Vendida</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Facturado</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Ganancia</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {[...bestSellingProductsData]
                            .sort((a, b) => b[bestSellingSort] - a[bestSellingSort])
                            .map((p, i) => (
                            <tr key={i} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-6 py-4 text-xs font-bold text-zinc-900">{p.producto}</td>
                              <td className="px-6 py-4 text-center text-xs font-black font-mono">{p.cantidad_vendida}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono">${p.total_facturado.toFixed(2)}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono text-emerald-600">${p.total_ganancia.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <ReportEmptyState
                    title="No hay operaciones en el período"
                    description="Probá ampliar las fechas o cambiar los filtros seleccionados."
                  />
                )}
              </div>
            )}

            {activeTab === 'ventas-cliente' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-2xl font-black tracking-tight">Ventas por Cliente</h3>
                  <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-800 transition-all"
                  >
                    <Download size={16} />
                    Imprimir Reporte
                  </button>
                </div>

                {loadingSalesByClient ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Generando reporte...</p>
                  </div>
                ) : salesByClientData && salesByClientData.length > 0 ? (
                  <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden print:border-none print:shadow-none">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50/50">
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cant. Ventas</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Comprado</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Ganancia</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {salesByClientData.map((s, i) => (
                            <tr key={i} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-6 py-4 text-xs font-bold text-zinc-900">{s.cliente}</td>
                              <td className="px-6 py-4 text-center text-xs font-black font-mono">{s.cantidad_ventas}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono">${s.total_comprado.toFixed(2)}</td>
                              <td className="px-6 py-4 text-right text-xs font-black font-mono text-emerald-600">${s.total_ganancia.toFixed(2)}</td>
                              <td className="px-6 py-4 text-center">
                                <button 
                                  onClick={() => {
                                    setViewingClientSales({ id: s.cliente_id, nombre: s.cliente });
                                    fetchClientSales(s.cliente_id);
                                  }}
                                  className="px-3 py-1 bg-zinc-100 text-zinc-600 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-900 hover:text-white transition-all"
                                >
                                  Ver Detalle
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <ReportEmptyState
                    title="No hay operaciones en el período"
                    description="Probá ampliar las fechas o cambiar los filtros seleccionados."
                  />
                )}
              </div>
            )}

            {activeTab === 'ventas-periodo' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-2xl font-black tracking-tight">Ventas por Período</h3>
                  <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-800 transition-all"
                  >
                    <Download size={16} />
                    Imprimir Reporte
                  </button>
                </div>

                {loadingSalesPeriod ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Generando reporte...</p>
                  </div>
                ) : salesPeriodData && salesPeriodData.sales.length > 0 ? (
                  <>
                    <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden print:border-none print:shadow-none">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-zinc-50/50">
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Productos</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cant.</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Venta</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Costo Total</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Ganancia</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-50">
                            {salesPeriodData.sales.map((s, i) => (
                              <tr key={i} className="hover:bg-zinc-50 transition-colors">
                                <td className="px-6 py-4">
                                  <p className="text-xs text-zinc-900 font-bold">{new Date(s.fecha).toLocaleDateString()}</p>
                                  <p className="text-[10px] text-zinc-400 font-mono">{new Date(s.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                </td>
                                <td className="px-6 py-4 text-xs font-bold text-zinc-900">{s.cliente}</td>
                                <td className="px-6 py-4 text-[10px] text-zinc-500 max-w-xs truncate" title={s.productos}>{s.productos}</td>
                                <td className="px-6 py-4 text-center text-xs font-black font-mono">{s.cantidad}</td>
                                <td className="px-6 py-4 text-right text-xs font-black font-mono">${s.total_venta.toFixed(2)}</td>
                                <td className="px-6 py-4 text-right text-xs font-black font-mono text-zinc-400">${s.costo_total.toFixed(2)}</td>
                                <td className="px-6 py-4 text-right text-xs font-black font-mono text-emerald-600">${s.ganancia.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                      <div className="bg-zinc-900 p-6 rounded-3xl text-white">
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Total Ventas</p>
                        <p className="text-xl font-black font-mono">${salesPeriodData.summary.totalVentas.toFixed(2)}</p>
                      </div>
                      <div className="bg-white p-6 rounded-3xl border border-zinc-200">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Costo</p>
                        <p className="text-xl font-black font-mono text-zinc-900">${salesPeriodData.summary.totalCosto.toFixed(2)}</p>
                      </div>
                      <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100">
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Total Ganancia</p>
                        <p className="text-xl font-black font-mono text-emerald-700">${salesPeriodData.summary.totalGanancia.toFixed(2)}</p>
                      </div>
                      <div className="bg-white p-6 rounded-3xl border border-zinc-200">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Cant. Ventas</p>
                        <p className="text-xl font-black font-mono text-zinc-900">{salesPeriodData.summary.cantidadVentas}</p>
                      </div>
                      <div className="bg-white p-6 rounded-3xl border border-zinc-200">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Ticket Promedio</p>
                        <p className="text-xl font-black font-mono text-zinc-900">${salesPeriodData.summary.ticketPromedio.toFixed(2)}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <ReportEmptyState
                    title="No hay operaciones en el período"
                    description="Probá ampliar las fechas o cambiar los filtros seleccionados."
                  />
                )}
              </div>
            )}

            {activeTab === 'ventas' && (
              <div className="space-y-8">
                {/* Ventas Filters & Summary */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-2xl font-black tracking-tight">Reporte de Ventas</h3>
                  <div className="flex items-center gap-3">
                    <div className="relative min-w-[200px]">
                      <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                      <select
                        value={clienteId}
                        onChange={(e) => setClienteId(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900 shadow-sm appearance-none"
                      >
                        <option value="">Todos los Clientes</option>
                        {clientes.map(c => (
                          <option key={c.id} value={c.id}>{c.nombre_apellido}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Ventas Período</p>
                    <p className="text-4xl font-black text-zinc-900 font-mono tracking-tighter">${data.ventas.total.toFixed(2)}</p>
                    <div className="mt-4 flex items-center gap-2 text-emerald-600 text-[10px] font-bold uppercase">
                      <ArrowUpRight size={14} />
                      <span>En el periodo seleccionado</span>
                    </div>
                  </div>
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Cantidad de Ventas</p>
                    <p className="text-4xl font-black text-zinc-900 font-mono tracking-tighter">{data.ventas.cantidad}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Operaciones realizadas</p>
                  </div>
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Ticket Promedio</p>
                    <p className="text-4xl font-black text-zinc-900 font-mono tracking-tighter">${data.ventas.promedio.toFixed(2)}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Por cada venta</p>
                  </div>
                </div>

                {/* Sales Table */}
                <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
                  <div className="p-8 border-b border-zinc-100">
                    <h3 className="text-xl font-black tracking-tight">Detalle de Ventas</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-zinc-50/50">
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Nº Venta</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Forma de Pago</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {data.ventas.listaVentas.length > 0 ? data.ventas.listaVentas.map((v) => (
                          <tr key={v.id} className="hover:bg-zinc-50 transition-colors">
                            <td className="px-8 py-5">
                              <p className="text-xs text-zinc-900 font-bold">{new Date(v.fecha).toLocaleDateString()}</p>
                              <p className="text-[10px] text-zinc-400 font-mono">{new Date(v.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </td>
                            <td className="px-8 py-5 text-xs font-bold text-zinc-500">#{v.id}</td>
                            <td className="px-8 py-5 text-sm font-bold text-zinc-900">{v.nombre_cliente}</td>
                            <td className="px-8 py-5 text-right text-sm font-black text-zinc-900 font-mono">${v.total.toFixed(2)}</td>
                            <td className="px-8 py-5 text-center">
                              <span className="text-[10px] font-bold uppercase bg-zinc-100 text-zinc-600 px-3 py-1 rounded-full border border-zinc-200">
                                {v.metodo_pago}
                              </span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={5} className="px-8 py-20 text-center text-zinc-400 font-bold uppercase text-xs tracking-widest">
                              No se encontraron ventas para los filtros seleccionados
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="min-w-0 bg-white p-8 rounded-[40px] border border-zinc-200 shadow-xl">
                    <h3 className="text-xl font-black tracking-tight mb-8">Evolución de Ventas</h3>
                    {data.ventas.porDia.length > 0 ? (
                    <div className="h-[300px] min-h-[300px] min-w-0 w-full overflow-hidden">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        minWidth={0}
                        minHeight={300}
                        debounce={100}
                        initialDimension={{ width: 800, height: 300 }}
                      >
                        <AreaChart data={data.ventas.porDia}>
                          <defs>
                            <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#18181b" stopOpacity={0.1}/>
                              <stop offset="95%" stopColor="#18181b" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                          <XAxis 
                            dataKey="fecha" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize: 10, fontWeight: 600, fill: '#a1a1aa' }}
                            tickFormatter={(str) => new Date(str).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize: 10, fontWeight: 600, fill: '#a1a1aa' }}
                            tickFormatter={(val) => `$${val}`}
                          />
                          <Tooltip 
                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                            labelStyle={{ fontWeight: 800, color: '#18181b', marginBottom: '4px' }}
                          />
                          <Area type="monotone" dataKey="total" stroke="#18181b" strokeWidth={3} fillOpacity={1} fill="url(#colorTotal)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    ) : (
                      <ReportEmptyState
                        title="Sin evolución de ventas"
                        description="No hay ventas para graficar en el período seleccionado."
                        compact
                      />
                    )}
                  </div>

                  <div className="min-w-0 bg-white p-8 rounded-[40px] border border-zinc-200 shadow-xl">
                    <h3 className="text-xl font-black tracking-tight mb-8">Ventas por Método de Pago</h3>
                    {data.ventas.porMetodoPago.length > 0 ? (
                    <>
                    <div className="h-[300px] min-h-[300px] min-w-0 w-full overflow-hidden">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        minWidth={0}
                        minHeight={300}
                        debounce={100}
                        initialDimension={{ width: 800, height: 300 }}
                      >
                        <RePieChart>
                          <Pie
                            data={data.ventas.porMetodoPago}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {data.ventas.porMetodoPago.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap justify-center gap-4 mt-4">
                      {data.ventas.porMetodoPago.map((entry, index) => (
                        <div key={entry.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                    </>
                    ) : (
                      <ReportEmptyState
                        title="Sin medios de pago para mostrar"
                        description="No hay ventas registradas en el período seleccionado."
                        compact
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'clientes' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Nuevos Clientes</p>
                    <p className="text-4xl font-black text-zinc-900 font-mono tracking-tighter">{data.clientes.nuevos}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Registrados en el periodo</p>
                  </div>
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Clientes Activos</p>
                    <p className="text-4xl font-black text-zinc-900 font-mono tracking-tighter">{data.clientes.activos}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Con compras en el periodo</p>
                  </div>
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Con Deuda</p>
                    <p className="text-4xl font-black text-red-600 font-mono tracking-tighter">{data.clientes.conDeuda}</p>
                    <p className="mt-4 text-red-600/60 text-[10px] font-bold uppercase">Cuentas con saldo pendiente</p>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
                  <h3 className="text-xl font-black tracking-tight mb-8">Listado de Clientes (por volumen de compra)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-zinc-50/50">
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cant. Compras</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Comprado</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Última Compra</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {data.clientes.listadoClientes.length > 0 ? data.clientes.listadoClientes.map((c, i) => (
                          <tr 
                            key={i} 
                            className="hover:bg-zinc-50 transition-colors cursor-pointer group"
                            onClick={() => {
                              setViewingClientSales({ id: c.id, nombre: c.nombre });
                              fetchClientSales(c.id);
                            }}
                          >
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-900 group-hover:bg-zinc-900 group-hover:text-white flex items-center justify-center text-xs font-bold transition-all">
                                  {i + 1}
                                </div>
                                <span className="text-sm font-bold text-zinc-900">{c.nombre}</span>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-center text-sm font-bold text-zinc-500">{c.cantidad}</td>
                            <td className="px-8 py-5 text-right text-sm font-black text-zinc-900 font-mono">${c.total.toFixed(2)}</td>
                            <td className="px-8 py-5 text-right">
                              <p className="text-xs font-bold text-zinc-500">{new Date(c.ultima_compra).toLocaleDateString()}</p>
                              <p className="text-[10px] text-zinc-400 font-mono">{new Date(c.ultima_compra).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className="px-8 py-16 text-center text-xs font-bold uppercase tracking-widest text-zinc-400">
                              No hay clientes con compras en el período seleccionado
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Client Detail Modal/Overlay */}
            {viewingClientSales && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
                <div 
                  className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
                  onClick={() => setViewingClientSales(null)}
                ></div>
                <div className="relative bg-white w-full max-w-4xl max-h-[90vh] rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                    <div>
                      <h3 className="text-2xl font-black tracking-tight text-zinc-900">Historial de Compras</h3>
                      <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest">{viewingClientSales.nombre}</p>
                    </div>
                    <button 
                      onClick={() => setViewingClientSales(null)}
                      className="w-10 h-10 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-zinc-900 hover:border-zinc-900 transition-all shadow-sm"
                    >
                      <ChevronRight className="rotate-180" size={20} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {loadingClientSales ? (
                      <div className="flex items-center justify-center gap-3 py-20" role="status" aria-live="polite">
                        <Loader2 size={26} className="animate-spin text-zinc-900" />
                        <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Cargando historial…</p>
                      </div>
                    ) : clientSalesError ? (
                      <ReportErrorState
                        message={clientSalesError}
                        onRetry={() => viewingClientSales && fetchClientSales(viewingClientSales.id)}
                        compact
                      />
                    ) : clientSales.length === 0 ? (
                      <ReportEmptyState
                        title="Este cliente no tiene ventas en el período"
                        description="Probá ampliar el rango de fechas seleccionado."
                        compact
                      />
                    ) : (
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100">
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Comprado</p>
                            <p className="text-2xl font-black text-zinc-900 font-mono tracking-tighter">
                              ${clientSales.reduce((acc, s) => acc + s.total_venta, 0).toFixed(2)}
                            </p>
                          </div>
                          <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100">
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Cant. Compras</p>
                            <p className="text-2xl font-black text-zinc-900 font-mono tracking-tighter">{clientSales.length}</p>
                          </div>
                          <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100">
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Ticket Promedio</p>
                            <p className="text-2xl font-black text-zinc-900 font-mono tracking-tighter">
                              ${clientSales.length > 0 ? (clientSales.reduce((acc, s) => acc + s.total_venta, 0) / clientSales.length).toFixed(2) : '0.00'}
                            </p>
                          </div>
                        </div>

                        <div className="border border-zinc-100 rounded-3xl overflow-hidden">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-zinc-50">
                                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Nº Venta</th>
                                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total</th>
                                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Forma de Pago</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-50">
                              {clientSales.map((v) => (
                                <tr key={v.id} className="hover:bg-zinc-50/50 transition-colors">
                                  <td className="px-6 py-4">
                                    <p className="text-xs text-zinc-900 font-bold">{new Date(v.fecha).toLocaleDateString()}</p>
                                    <p className="text-[10px] text-zinc-400 font-mono">{new Date(v.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                  </td>
                                  <td className="px-6 py-4 text-xs font-bold text-zinc-500">#{v.id}</td>
                                  <td className="px-6 py-4 text-right text-sm font-black text-zinc-900 font-mono">${v.total_venta.toFixed(2)}</td>
                                  <td className="px-6 py-4 text-center">
                                    <span className="text-[10px] font-bold uppercase bg-white text-zinc-600 px-3 py-1 rounded-full border border-zinc-200">
                                      {v.metodo_pago}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'productos' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="min-w-0 bg-white p-8 rounded-[40px] border border-zinc-200 shadow-xl">
                    <h3 className="text-xl font-black tracking-tight mb-8">Ventas por Familia</h3>
                    {data.productos.porFamilia.length > 0 ? (
                    <>
                    <div className="h-[300px] min-h-[300px] min-w-0 w-full overflow-hidden">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        minWidth={0}
                        minHeight={300}
                        debounce={100}
                        initialDimension={{ width: 800, height: 300 }}
                      >
                        <RePieChart>
                          <Pie
                            data={data.productos.porFamilia}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {data.productos.porFamilia.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap justify-center gap-4 mt-4">
                      {data.productos.porFamilia.map((entry, index) => (
                        <div key={entry.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                    </>
                    ) : (
                      <ReportEmptyState
                        title="Sin ventas por familia"
                        description="No hay productos vendidos para agrupar en el período seleccionado."
                        compact
                      />
                    )}
                  </div>

                  <div className="bg-white p-8 rounded-[40px] border border-zinc-200 shadow-xl">
                    <h3 className="text-xl font-black tracking-tight mb-8">Alerta de Stock Bajo</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {data.productos.bajoStock.map((p, i) => (
                        <div key={i} className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-zinc-900 truncate">{p.name}</p>
                            <p className="text-[10px] text-red-600 font-bold uppercase">Stock: {p.stock}</p>
                          </div>
                          <TrendingDown size={16} className="text-red-400 shrink-0" />
                        </div>
                      ))}
                      {data.productos.bajoStock.length === 0 && (
                        <p className="col-span-full text-center py-8 text-zinc-400 font-bold uppercase text-xs tracking-widest">Todo el stock está al día</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
                  <div className="p-8 border-b border-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h3 className="text-xl font-black tracking-tight">Rendimiento de Productos</h3>
                    <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-xl">
                      <button
                        onClick={() => setProductSort('cantidad')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          productSort === 'cantidad' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Más Vendidos
                      </button>
                      <button
                        onClick={() => setProductSort('total')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                          productSort === 'total' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        Mayor Facturación
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-zinc-50/50">
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Producto</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cant. Vendida</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Facturado</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Última Venta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {data.productos.listadoProductos.length > 0 ? [...data.productos.listadoProductos]
                          .sort((a, b) => b[productSort] - a[productSort])
                          .map((p, i) => (
                          <tr key={i} className="hover:bg-zinc-50 transition-colors">
                            <td className="px-8 py-5">
                              <span className="text-sm font-bold text-zinc-900">{p.name}</span>
                            </td>
                            <td className="px-8 py-5 text-center text-sm font-black text-zinc-900 font-mono">{p.cantidad}</td>
                            <td className="px-8 py-5 text-right text-sm font-black text-zinc-900 font-mono">${p.total.toFixed(2)}</td>
                            <td className="px-8 py-5 text-right">
                              <p className="text-xs font-bold text-zinc-500">{new Date(p.ultima_venta).toLocaleDateString()}</p>
                              <p className="text-[10px] text-zinc-400 font-mono">{new Date(p.ultima_venta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className="px-8 py-16 text-center text-xs font-bold uppercase tracking-widest text-zinc-400">
                              No hay productos vendidos en el período seleccionado
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'deudas' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Adeudado</p>
                    <p className="text-4xl font-black text-red-600 font-mono tracking-tighter">${data.deudas.totalAdeudado.toFixed(2)}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Saldo total a cobrar</p>
                  </div>
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Clientes Deudores</p>
                    <p className="text-4xl font-black text-zinc-900 font-mono tracking-tighter">{data.deudas.clientesDeudores}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Cuentas con saldo</p>
                  </div>
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Deuda Vencida</p>
                    <p className="text-4xl font-black text-red-900 font-mono tracking-tighter">${data.deudas.deudaVencida.toFixed(2)}</p>
                    <p className="mt-4 text-red-900/60 text-[10px] font-bold uppercase">Mayor a 7 días</p>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
                  <h3 className="text-xl font-black tracking-tight mb-8">Listado de Deudores</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-zinc-50/50">
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Ventas Pendientes</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Deuda Antigua</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Adeudado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {data.deudas.rankingDeudores.length > 0 ? data.deudas.rankingDeudores.map((d, i) => (
                          <tr 
                            key={i} 
                            className="hover:bg-zinc-50 transition-colors cursor-pointer group"
                            onClick={() => {
                              setViewingClientSales({ id: d.id, nombre: d.nombre });
                              fetchClientSales(d.id);
                            }}
                          >
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-900 group-hover:bg-zinc-900 group-hover:text-white flex items-center justify-center text-xs font-bold transition-all">
                                  {i + 1}
                                </div>
                                <span className="text-sm font-bold text-zinc-900">{d.nombre}</span>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-center">
                              <span className="text-xs font-black text-zinc-400 bg-zinc-100 px-3 py-1 rounded-full">
                                {d.ventas_pendientes} comprobantes
                              </span>
                            </td>
                            <td className="px-8 py-5 text-right">
                              {d.fecha_antigua ? (
                                <>
                                  <p className="text-xs font-bold text-zinc-500">{new Date(d.fecha_antigua).toLocaleDateString()}</p>
                                  <p className="text-[10px] text-zinc-400 font-mono">
                                    {Math.floor((new Date().getTime() - new Date(d.fecha_antigua).getTime()) / (1000 * 60 * 60 * 24))} días de atraso
                                  </p>
                                </>
                              ) : (
                                <span className="text-[10px] font-bold text-zinc-300 uppercase">Sin registro</span>
                              )}
                            </td>
                            <td className="px-8 py-5 text-right">
                              <span className="text-sm font-black text-red-600 font-mono">${d.saldo.toFixed(2)}</span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className="px-8 py-16 text-center text-xs font-bold uppercase tracking-widest text-zinc-400">
                              No hay clientes con deuda pendiente
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'finanzas' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Ingresos</p>
                    <p className="text-4xl font-black text-emerald-600 font-mono tracking-tighter">${data.finanzas.ingresos.toFixed(2)}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Entradas de capital</p>
                  </div>
                  <div className="bg-white p-8 rounded-[32px] border border-zinc-200 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Egresos</p>
                    <p className="text-4xl font-black text-red-600 font-mono tracking-tighter">${data.finanzas.egresos.toFixed(2)}</p>
                    <p className="mt-4 text-zinc-400 text-[10px] font-bold uppercase">Salidas de capital</p>
                  </div>
                  <div className={`p-8 rounded-[32px] shadow-2xl ${data.finanzas.balance >= 0 ? 'bg-zinc-900 shadow-zinc-200' : 'bg-red-900 shadow-red-200'}`}>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Resultado Neto</p>
                    <p className="text-4xl font-black text-white font-mono tracking-tighter">${data.finanzas.balance.toFixed(2)}</p>
                    <p className="mt-4 text-white/40 text-[10px] font-bold uppercase">Resultado del periodo</p>
                  </div>
                </div>

                <div className="min-w-0 bg-white p-8 rounded-[40px] border border-zinc-200 shadow-xl">
                  <h3 className="text-xl font-black tracking-tight mb-8 text-center">Ingresos vs Egresos por Día</h3>
                  {data.finanzas.flujoCaja.length > 0 ? (
                  <div className="h-[400px] min-h-[400px] min-w-0 w-full overflow-hidden">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={0}
                      minHeight={400}
                      debounce={100}
                      initialDimension={{ width: 1000, height: 400 }}
                    >
                      <BarChart data={data.finanzas.flujoCaja}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                        <XAxis 
                          dataKey="fecha" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fontWeight: 600, fill: '#a1a1aa' }}
                          tickFormatter={(str) => new Date(str).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fontWeight: 600, fill: '#a1a1aa' }}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                        />
                        <Bar name="Ingresos" dataKey="ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar name="Egresos" dataKey="egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  ) : (
                    <ReportEmptyState
                      title="Sin movimientos financieros"
                      description="No hay ingresos ni egresos para graficar en el período seleccionado."
                      compact
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
