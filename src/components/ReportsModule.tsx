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

  const reportData = data as ReportData;

  const money = (value: unknown) =>
    `$${(Number(value) || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;

  const number = (value: unknown) =>
    (Number(value) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });

  const formatDate = (value: unknown) => {
    if (!value) return 'Sin fecha';
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? 'Sin fecha' : parsed.toLocaleDateString('es-AR');
  };

  const formatTime = (value: unknown) => {
    if (!value) return '';
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? ''
      : parsed.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  };

  const openClientHistory = (id: number, nombre: string) => {
    setViewingClientSales({ id, nombre });
    fetchClientSales(id);
  };

  const tabItems = [
    { id: 'ventas', label: 'Ventas', description: 'Resumen general', icon: TrendingUp },
    { id: 'ventas-periodo', label: 'Por período', description: 'Detalle y margen', icon: Calendar },
    { id: 'ventas-cliente', label: 'Por cliente', description: 'Ranking y detalle', icon: Users },
    { id: 'productos-vendidos', label: 'Más vendidos', description: 'Cantidad y facturación', icon: Package },
    { id: 'rentabilidad-producto', label: 'Rentabilidad', description: 'Costo PEPS y margen', icon: PieChart },
    { id: 'comisiones', label: 'Comisiones', description: 'Mayoristas', icon: DollarSign },
    { id: 'cuentas-corrientes', label: 'Cuentas corrientes', description: 'Saldos pendientes', icon: Wallet },
    { id: 'clientes', label: 'Clientes', description: 'Actividad comercial', icon: Users },
    { id: 'productos', label: 'Productos', description: 'Familias y stock', icon: Package },
    { id: 'deudas', label: 'Deudas', description: 'Mora y cobranza', icon: AlertTriangle },
    { id: 'finanzas', label: 'Finanzas', description: 'Ingresos y egresos', icon: BarChart3 }
  ] as const;

  const toneClasses = {
    slate: 'border-slate-200 bg-white text-slate-950',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    amber: 'border-amber-200 bg-amber-50 text-amber-950',
    red: 'border-red-200 bg-red-50 text-red-950',
    dark: 'border-slate-900 bg-slate-950 text-white'
  };

  const MetricCard = ({
    label,
    value,
    helper,
    icon,
    tone = 'slate'
  }: {
    label: string;
    value: React.ReactNode;
    helper?: string;
    icon?: React.ReactNode;
    tone?: keyof typeof toneClasses;
  }) => (
    <article className={`min-w-0 rounded-[26px] border p-5 shadow-sm sm:p-6 ${toneClasses[tone]}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${tone === 'dark' ? 'text-white/50' : 'text-slate-500'}`}>
            {label}
          </p>
          <p className="mt-2 break-words text-2xl font-black tracking-tight sm:text-3xl">{value}</p>
          {helper && (
            <p className={`mt-2 text-xs font-semibold ${tone === 'dark' ? 'text-white/55' : 'text-slate-500'}`}>
              {helper}
            </p>
          )}
        </div>
        {icon && (
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone === 'dark' ? 'bg-white/10 text-white' : 'bg-white text-slate-700 shadow-sm'}`}>
            {icon}
          </div>
        )}
      </div>
    </article>
  );

  const ReportHeading = ({
    title,
    description,
    children
  }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
  }) => (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h3 className="break-words text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h3>
        {description && <p className="mt-1 text-sm font-medium text-slate-500">{description}</p>}
      </div>
      {children && <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">{children}</div>}
    </div>
  );

  const PrintButton = ({ label = 'Imprimir reporte' }: { label?: string }) => (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-indigo-700 sm:w-auto"
    >
      <Download size={16} aria-hidden="true" />
      {label}
    </button>
  );

  const SegmentedButtons = ({ children }: { children: React.ReactNode }) => (
    <div className="grid min-w-0 grid-cols-1 gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 min-[390px]:grid-cols-2 sm:flex">
      {children}
    </div>
  );

  const activeTabMeta = tabItems.find((item) => item.id === activeTab) ?? tabItems[0];
  const ActiveTabIcon = activeTabMeta.icon;

  return (
    <div className="min-h-full p-3 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-5 sm:space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-5 text-white shadow-xl shadow-slate-900/10 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-100">
                <BarChart3 size={14} aria-hidden="true" />
                Inteligencia de negocio
              </div>
              <h2 className="break-words text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">Reportes</h2>
              <p className="mt-2 max-w-2xl text-sm font-medium text-slate-300 sm:text-base">
                Analizá ventas, clientes, productos, rentabilidad y finanzas sin perder comodidad en ningún dispositivo.
              </p>
            </div>

            <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:w-auto xl:grid-cols-[minmax(150px,190px)_minmax(150px,190px)_auto]">
              <label className="min-w-0 rounded-2xl border border-white/10 bg-white/10 p-3">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-300">Desde</span>
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(event) => setDateRange({ ...dateRange, from: event.target.value })}
                  className="min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-slate-950/50 px-3 text-sm font-bold text-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20"
                />
              </label>
              <label className="min-w-0 rounded-2xl border border-white/10 bg-white/10 p-3">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-300">Hasta</span>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(event) => setDateRange({ ...dateRange, to: event.target.value })}
                  className="min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-slate-950/50 px-3 text-sm font-bold text-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20"
                />
              </label>
              <button
                type="button"
                onClick={fetchActiveReport}
                disabled={isActiveLoading}
                className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-2xl bg-white px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-950 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2 xl:col-span-1"
              >
                {isActiveLoading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
                Actualizar
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex min-w-0 items-center gap-3 rounded-2xl bg-slate-50 p-3 sm:hidden">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <ActiveTabIcon size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-950">{activeTabMeta.label}</p>
              <p className="truncate text-xs font-medium text-slate-500">{activeTabMeta.description}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" role="tablist" aria-label="Tipos de reporte">
            {tabItems.map((tab) => {
              const TabIcon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-w-0 rounded-2xl border p-3 text-left transition sm:p-4 ${
                    selected
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-950 shadow-sm'
                      : 'border-transparent bg-slate-50 text-slate-600 hover:border-slate-200 hover:bg-white'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 shadow-sm'}`}>
                      <TabIcon size={17} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-xs font-black leading-tight sm:text-sm">{tab.label}</p>
                      <p className="mt-0.5 hidden truncate text-[11px] font-medium opacity-65 sm:block">{tab.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {isActiveLoading && hasActiveData && (
          <div className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-indigo-950" role="status" aria-live="polite">
            <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin" />
            <div className="min-w-0">
              <p className="text-sm font-black">Actualizando reporte…</p>
              <p className="text-xs font-medium text-indigo-700">Los últimos datos permanecen visibles mientras termina la consulta.</p>
            </div>
          </div>
        )}

        {activeError && hasActiveData && <ReportErrorState message={activeError} onRetry={fetchActiveReport} compact />}

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
          <main className="space-y-6 pb-8 sm:space-y-8">
            {activeTab === 'comisiones' && commissionsData && (
              <section className="space-y-5">
                <ReportHeading title="Comisiones" description="Ventas mayoristas y comisión generada en el período seleccionado.">
                  <PrintButton />
                </ReportHeading>

                {commissionsData.sales.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <MetricCard
                        label="Total comisiones"
                        value={money(commissionsData.summary.totalComisiones)}
                        helper="Acumulado del período"
                        tone="dark"
                        icon={<DollarSign size={20} />}
                      />
                      <MetricCard
                        label="Operaciones"
                        value={number(commissionsData.sales.length)}
                        helper="Ventas mayoristas computadas"
                        icon={<BarChart3 size={20} />}
                      />
                      <MetricCard
                        label="Comisión promedio"
                        value={money(commissionsData.sales.length ? commissionsData.summary.totalComisiones / commissionsData.sales.length : 0)}
                        helper="Promedio por operación"
                        tone="indigo"
                        icon={<TrendingUp size={20} />}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                      {commissionsData.sales.map((sale: any) => (
                        <article key={sale.id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words text-base font-black text-slate-950">{sale.cliente}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(sale.fecha)} · {formatTime(sale.fecha)}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-700">
                              {number(sale.porcentaje_comision)}%
                            </span>
                          </div>
                          <div className="mt-5 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Venta</p>
                              <p className="mt-1 break-words text-sm font-black text-slate-950">{money(sale.total_venta)}</p>
                            </div>
                            <div className="rounded-2xl bg-emerald-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Comisión</p>
                              <p className="mt-1 break-words text-sm font-black text-emerald-800">{money(sale.comision_generada)}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <ReportEmptyState title="No hay operaciones en el período" description="Probá ampliar las fechas seleccionadas." />
                )}
              </section>
            )}

            {activeTab === 'cuentas-corrientes' && currentAccountsData && (
              <section className="space-y-5">
                <ReportHeading title="Cuentas corrientes" description="Clientes con saldos pendientes y antigüedad de deuda.">
                  <SegmentedButtons>
                    <button
                      type="button"
                      onClick={() => setCurrentAccountsSort('monto_deuda')}
                      className={`min-h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider ${currentAccountsSort === 'monto_deuda' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                    >
                      Por monto
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentAccountsSort('dias_vencidos')}
                      className={`min-h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider ${currentAccountsSort === 'dias_vencidos' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                    >
                      Por antigüedad
                    </button>
                  </SegmentedButtons>
                  <PrintButton />
                </ReportHeading>

                {currentAccountsData.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <MetricCard
                        label="Deuda total"
                        value={money(currentAccountsData.reduce((sum: number, item: any) => sum + Number(item.monto_deuda || 0), 0))}
                        tone="red"
                        icon={<DollarSign size={20} />}
                      />
                      <MetricCard label="Clientes deudores" value={number(currentAccountsData.length)} icon={<Users size={20} />} />
                      <MetricCard
                        label="Mayor antigüedad"
                        value={`${Math.max(...currentAccountsData.map((item: any) => Number(item.dias_vencidos || 0)))} días`}
                        tone="amber"
                        icon={<Calendar size={20} />}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                      {[...currentAccountsData]
                        .sort((a: any, b: any) => Number(b[currentAccountsSort] || 0) - Number(a[currentAccountsSort] || 0))
                        .map((account: any) => (
                          <article key={account.cliente_id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-words text-base font-black text-slate-950">{account.cliente}</p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                  Deuda más antigua: {account.fecha_antigua ? formatDate(account.fecha_antigua) : 'Sin fecha'}
                                </p>
                              </div>
                              <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                                account.dias_vencidos > 30
                                  ? 'bg-red-100 text-red-700'
                                  : account.dias_vencidos > 7
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}>
                                {number(account.dias_vencidos)} días
                              </span>
                            </div>
                            <div className="mt-5 grid grid-cols-2 gap-3">
                              <div className="rounded-2xl bg-red-50 p-3">
                                <p className="text-[10px] font-black uppercase tracking-wider text-red-600">Saldo</p>
                                <p className="mt-1 break-words text-sm font-black text-red-800">{money(account.monto_deuda)}</p>
                              </div>
                              <div className="rounded-2xl bg-slate-50 p-3">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ventas pendientes</p>
                                <p className="mt-1 text-sm font-black text-slate-950">{number(account.ventas_pendientes)}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => openClientHistory(account.cliente_id, account.cliente)}
                              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
                            >
                              Ver ventas
                              <ChevronRight size={16} />
                            </button>
                          </article>
                        ))}
                    </div>
                  </>
                ) : (
                  <ReportEmptyState title="No hay clientes con deuda" description="Las cuentas corrientes no registran saldos pendientes." />
                )}
              </section>
            )}

            {activeTab === 'rentabilidad-producto' && profitabilityData && (
              <section className="space-y-5">
                <ReportHeading title="Rentabilidad por producto" description="Resultados calculados con costo real PEPS/FIFO.">
                  <label className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:min-w-56">
                    <span className="sr-only">Producto</span>
                    <select
                      value={selectedProductId}
                      onChange={(event) => setSelectedProductId(event.target.value)}
                      className="min-h-10 w-full min-w-0 bg-transparent text-xs font-black text-slate-700 outline-none"
                    >
                      <option value="all">Todos los productos</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                  </label>
                  <SegmentedButtons>
                    <button
                      type="button"
                      onClick={() => setProfitabilitySort('ganancia')}
                      className={`min-h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider ${profitabilitySort === 'ganancia' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                    >
                      Ganancia
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfitabilitySort('cantidad_vendida')}
                      className={`min-h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider ${profitabilitySort === 'cantidad_vendida' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                    >
                      Cantidad
                    </button>
                  </SegmentedButtons>
                  <PrintButton />
                </ReportHeading>

                {profitabilityData.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricCard label="Ventas totales" value={money(profitabilityData.reduce((sum: number, item: any) => sum + Number(item.ventas_totales || 0), 0))} icon={<TrendingUp size={20} />} />
                      <MetricCard label="Costo total" value={money(profitabilityData.reduce((sum: number, item: any) => sum + Number(item.costo_total || 0), 0))} icon={<ArrowDownLeft size={20} />} />
                      <MetricCard label="Ganancia" value={money(profitabilityData.reduce((sum: number, item: any) => sum + Number(item.ganancia || 0), 0))} tone="emerald" icon={<DollarSign size={20} />} />
                      <MetricCard label="Productos" value={number(profitabilityData.length)} tone="indigo" icon={<Package size={20} />} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                      {[...profitabilityData]
                        .sort((a: any, b: any) => Number(b[profitabilitySort] || 0) - Number(a[profitabilitySort] || 0))
                        .map((product: any) => (
                          <article key={product.product_id ?? product.producto} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <p className="break-words text-base font-black text-slate-950">{product.producto}</p>
                              <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black ${
                                product.margen_porcentual >= 30
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : product.margen_porcentual >= 15
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-red-100 text-red-700'
                              }`}>
                                {number(product.margen_porcentual)}%
                              </span>
                            </div>
                            <div className="mt-5 grid grid-cols-2 gap-3">
                              <div className="rounded-2xl bg-slate-50 p-3">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cantidad</p>
                                <p className="mt-1 text-sm font-black text-slate-950">{number(product.cantidad_vendida)}</p>
                              </div>
                              <div className="rounded-2xl bg-slate-50 p-3">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ventas</p>
                                <p className="mt-1 break-words text-sm font-black text-slate-950">{money(product.ventas_totales)}</p>
                              </div>
                              <div className="rounded-2xl bg-red-50 p-3">
                                <p className="text-[10px] font-black uppercase tracking-wider text-red-500">Costo</p>
                                <p className="mt-1 break-words text-sm font-black text-red-800">{money(product.costo_total)}</p>
                              </div>
                              <div className="rounded-2xl bg-emerald-50 p-3">
                                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Ganancia</p>
                                <p className="mt-1 break-words text-sm font-black text-emerald-800">{money(product.ganancia)}</p>
                              </div>
                            </div>
                          </article>
                        ))}
                    </div>
                  </>
                ) : (
                  <ReportEmptyState title="No hay operaciones en el período" description="Probá ampliar las fechas o seleccionar otro producto." />
                )}
              </section>
            )}

            {activeTab === 'productos-vendidos' && bestSellingProductsData && (
              <section className="space-y-5">
                <ReportHeading title="Productos más vendidos" description="Ranking por volumen, facturación o ganancia.">
                  <div className="grid grid-cols-1 gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 min-[390px]:grid-cols-3 sm:flex">
                    {[
                      ['cantidad_vendida', 'Cantidad'],
                      ['total_facturado', 'Facturación'],
                      ['total_ganancia', 'Ganancia']
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setBestSellingSort(key as typeof bestSellingSort)}
                        className={`min-h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider ${bestSellingSort === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <PrintButton />
                </ReportHeading>

                {bestSellingProductsData.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {[...bestSellingProductsData]
                      .sort((a: any, b: any) => Number(b[bestSellingSort] || 0) - Number(a[bestSellingSort] || 0))
                      .map((product: any, index: number) => (
                        <article key={product.producto} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-black text-indigo-700">#{index + 1}</div>
                            <p className="min-w-0 break-words text-base font-black text-slate-950">{product.producto}</p>
                          </div>
                          <div className="mt-5 grid grid-cols-1 gap-3 min-[390px]:grid-cols-3">
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cantidad</p>
                              <p className="mt-1 text-sm font-black text-slate-950">{number(product.cantidad_vendida)}</p>
                            </div>
                            <div className="rounded-2xl bg-indigo-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Facturado</p>
                              <p className="mt-1 break-words text-sm font-black text-indigo-900">{money(product.total_facturado)}</p>
                            </div>
                            <div className="rounded-2xl bg-emerald-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Ganancia</p>
                              <p className="mt-1 break-words text-sm font-black text-emerald-800">{money(product.total_ganancia)}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                ) : (
                  <ReportEmptyState title="No hay productos vendidos" description="Probá ampliar el período seleccionado." />
                )}
              </section>
            )}

            {activeTab === 'ventas-cliente' && salesByClientData && (
              <section className="space-y-5">
                <ReportHeading title="Ventas por cliente" description="Ranking comercial y acceso al historial individual.">
                  <PrintButton />
                </ReportHeading>

                {salesByClientData.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <MetricCard label="Clientes con ventas" value={number(salesByClientData.length)} icon={<Users size={20} />} />
                      <MetricCard label="Total comprado" value={money(salesByClientData.reduce((sum: number, item: any) => sum + Number(item.total_comprado || 0), 0))} tone="indigo" icon={<TrendingUp size={20} />} />
                      <MetricCard label="Ganancia total" value={money(salesByClientData.reduce((sum: number, item: any) => sum + Number(item.total_ganancia || 0), 0))} tone="emerald" icon={<DollarSign size={20} />} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                      {salesByClientData.map((client: any, index: number) => (
                        <article key={client.cliente_id ?? client.cliente} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">#{index + 1}</div>
                            <p className="min-w-0 break-words text-base font-black text-slate-950">{client.cliente}</p>
                          </div>
                          <div className="mt-5 grid grid-cols-1 gap-3 min-[390px]:grid-cols-3">
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ventas</p>
                              <p className="mt-1 text-sm font-black text-slate-950">{number(client.cantidad_ventas)}</p>
                            </div>
                            <div className="rounded-2xl bg-indigo-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Comprado</p>
                              <p className="mt-1 break-words text-sm font-black text-indigo-900">{money(client.total_comprado)}</p>
                            </div>
                            <div className="rounded-2xl bg-emerald-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Ganancia</p>
                              <p className="mt-1 break-words text-sm font-black text-emerald-800">{money(client.total_ganancia)}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openClientHistory(client.cliente_id, client.cliente)}
                            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
                          >
                            Ver historial
                            <ChevronRight size={16} />
                          </button>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <ReportEmptyState title="No hay ventas por cliente" description="Probá ampliar el período seleccionado." />
                )}
              </section>
            )}

            {activeTab === 'ventas-periodo' && salesPeriodData && (
              <section className="space-y-5">
                <ReportHeading title="Ventas por período" description="Detalle de operaciones, costo y ganancia.">
                  <PrintButton />
                </ReportHeading>

                {salesPeriodData.sales.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                      <MetricCard label="Total ventas" value={money(salesPeriodData.summary.totalVentas)} tone="dark" icon={<TrendingUp size={20} />} />
                      <MetricCard label="Total costo" value={money(salesPeriodData.summary.totalCosto)} icon={<ArrowDownLeft size={20} />} />
                      <MetricCard label="Ganancia" value={money(salesPeriodData.summary.totalGanancia)} tone="emerald" icon={<DollarSign size={20} />} />
                      <MetricCard label="Cantidad" value={number(salesPeriodData.summary.cantidadVentas)} icon={<BarChart3 size={20} />} />
                      <MetricCard label="Ticket promedio" value={money(salesPeriodData.summary.ticketPromedio)} tone="indigo" icon={<Wallet size={20} />} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {salesPeriodData.sales.map((sale: any) => (
                        <article key={sale.id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex min-w-0 flex-col gap-3 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-black text-white">Venta #{sale.id}</span>
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">{sale.metodo_pago}</span>
                              </div>
                              <p className="mt-3 break-words text-base font-black text-slate-950">{sale.cliente}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(sale.fecha)} · {formatTime(sale.fecha)}</p>
                            </div>
                            <p className="break-words text-xl font-black text-slate-950">{money(sale.total_venta)}</p>
                          </div>
                          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Productos · {number(sale.cantidad)} unidades</p>
                            <p className="mt-2 break-words text-sm font-semibold leading-relaxed text-slate-700">{sale.productos || 'Sin detalle de productos'}</p>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-red-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-red-500">Costo</p>
                              <p className="mt-1 break-words text-sm font-black text-red-800">{money(sale.costo_total)}</p>
                            </div>
                            <div className="rounded-2xl bg-emerald-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Ganancia</p>
                              <p className="mt-1 break-words text-sm font-black text-emerald-800">{money(sale.ganancia)}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <ReportEmptyState title="No hay operaciones en el período" description="Probá ampliar las fechas seleccionadas." />
                )}
              </section>
            )}

            {activeTab === 'ventas' && reportData && (
              <section className="space-y-5">
                <ReportHeading title="Reporte de ventas" description="Resumen, operaciones y evolución del período.">
                  <label className="relative min-w-0 sm:min-w-64">
                    <Users className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <select
                      value={clienteId}
                      onChange={(event) => setClienteId(event.target.value)}
                      className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    >
                      <option value="">Todos los clientes</option>
                      {clientes.map((client) => <option key={client.id} value={client.id}>{client.nombre_apellido}</option>)}
                    </select>
                  </label>
                  <PrintButton />
                </ReportHeading>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <MetricCard label="Total ventas" value={money(reportData.ventas.total)} helper="Período seleccionado" tone="dark" icon={<TrendingUp size={20} />} />
                  <MetricCard label="Cantidad" value={number(reportData.ventas.cantidad)} helper="Operaciones realizadas" icon={<BarChart3 size={20} />} />
                  <MetricCard label="Ticket promedio" value={money(reportData.ventas.promedio)} helper="Promedio por venta" tone="indigo" icon={<Wallet size={20} />} />
                </div>

                {reportData.ventas.listaVentas.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {reportData.ventas.listaVentas.map((sale) => (
                      <article key={sale.id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-black text-white">#{sale.id}</span>
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">{sale.metodo_pago}</span>
                            </div>
                            <p className="mt-3 break-words text-base font-black text-slate-950">{sale.nombre_cliente}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(sale.fecha)} · {formatTime(sale.fecha)}</p>
                          </div>
                          <p className="max-w-[48%] break-words text-right text-lg font-black text-slate-950">{money(sale.total)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <ReportEmptyState title="No se encontraron ventas" description="Probá otro cliente o período." compact />
                )}

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <article className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <h4 className="text-lg font-black text-slate-950">Evolución de ventas</h4>
                    <p className="mt-1 text-xs font-medium text-slate-500">Total diario del período seleccionado.</p>
                    {reportData.ventas.porDia.length > 0 ? (
                      <div className="mt-5 h-[280px] min-h-[280px] min-w-0 w-full overflow-hidden sm:h-[340px] sm:min-h-[340px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280} debounce={100} initialDimension={{ width: 640, height: 300 }}>
                          <AreaChart data={reportData.ventas.porDia} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                            <defs>
                              <linearGradient id="reportSalesGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis dataKey="fecha" axisLine={false} tickLine={false} minTickGap={28} tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} tickFormatter={(value) => formatDate(value).slice(0, 5)} />
                            <YAxis axisLine={false} tickLine={false} width={54} tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} tickFormatter={(value) => `$${Number(value).toLocaleString('es-AR', { notation: 'compact' })}`} />
                            <Tooltip contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 12px 24px rgb(15 23 42 / 0.1)' }} formatter={(value: number) => [money(value), 'Ventas']} labelFormatter={(value) => formatDate(value)} />
                            <Area type="monotone" dataKey="total" stroke="#4f46e5" strokeWidth={3} fill="url(#reportSalesGradient)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="mt-5"><ReportEmptyState title="Sin evolución para mostrar" description="No hay ventas para graficar." compact /></div>
                    )}
                  </article>

                  <article className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <h4 className="text-lg font-black text-slate-950">Métodos de pago</h4>
                    <p className="mt-1 text-xs font-medium text-slate-500">Distribución del total vendido.</p>
                    {reportData.ventas.porMetodoPago.length > 0 ? (
                      <>
                        <div className="mt-5 h-[260px] min-h-[260px] min-w-0 w-full overflow-hidden sm:h-[320px] sm:min-h-[320px]">
                          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260} debounce={100} initialDimension={{ width: 520, height: 280 }}>
                            <RePieChart>
                              <Pie data={reportData.ventas.porMetodoPago} cx="50%" cy="50%" innerRadius={48} outerRadius={88} paddingAngle={4} dataKey="value">
                                {reportData.ventas.porMetodoPago.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />)}
                              </Pie>
                              <Tooltip contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 12px 24px rgb(15 23 42 / 0.1)' }} formatter={(value: number) => money(value)} />
                            </RePieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                          {reportData.ventas.porMetodoPago.map((entry, index) => (
                            <div key={entry.name} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                              <span className="min-w-0 flex-1 break-words text-xs font-bold text-slate-600">{entry.name}</span>
                              <span className="shrink-0 text-xs font-black text-slate-950">{money(entry.value)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="mt-5"><ReportEmptyState title="Sin métodos de pago" description="No hay ventas registradas." compact /></div>
                    )}
                  </article>
                </div>
              </section>
            )}

            {activeTab === 'clientes' && reportData && (
              <section className="space-y-5">
                <ReportHeading title="Clientes" description="Altas, actividad y volumen de compra.">
                  <PrintButton />
                </ReportHeading>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <MetricCard label="Nuevos clientes" value={number(reportData.clientes.nuevos)} helper="Registrados en el período" icon={<Users size={20} />} />
                  <MetricCard label="Clientes activos" value={number(reportData.clientes.activos)} helper="Con compras en el período" tone="indigo" icon={<TrendingUp size={20} />} />
                  <MetricCard label="Con deuda" value={number(reportData.clientes.conDeuda)} helper="Cuentas con saldo pendiente" tone="red" icon={<AlertTriangle size={20} />} />
                </div>
                {reportData.clientes.listadoClientes.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {reportData.clientes.listadoClientes.map((client, index) => (
                      <article key={client.id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-black text-indigo-700">#{index + 1}</div>
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-base font-black text-slate-950">{client.nombre}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">Última compra: {formatDate(client.ultima_compra)}</p>
                          </div>
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <div className="rounded-2xl bg-slate-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Compras</p>
                            <p className="mt-1 text-sm font-black text-slate-950">{number(client.cantidad)}</p>
                          </div>
                          <div className="rounded-2xl bg-indigo-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Total</p>
                            <p className="mt-1 break-words text-sm font-black text-indigo-900">{money(client.total)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openClientHistory(client.id, client.nombre)}
                          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
                        >
                          Ver historial
                          <ChevronRight size={16} />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <ReportEmptyState title="No hay clientes con compras" description="No se registraron compras en el período seleccionado." />
                )}
              </section>
            )}

            {activeTab === 'productos' && reportData && (
              <section className="space-y-5">
                <ReportHeading title="Productos" description="Rendimiento por familia, stock y facturación.">
                  <PrintButton />
                </ReportHeading>
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <article className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <h4 className="text-lg font-black text-slate-950">Ventas por familia</h4>
                    {reportData.productos.porFamilia.length > 0 ? (
                      <>
                        <div className="mt-4 h-[260px] min-h-[260px] min-w-0 w-full overflow-hidden sm:h-[320px] sm:min-h-[320px]">
                          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260} debounce={100} initialDimension={{ width: 520, height: 280 }}>
                            <RePieChart>
                              <Pie data={reportData.productos.porFamilia} cx="50%" cy="50%" innerRadius={48} outerRadius={88} paddingAngle={4} dataKey="value">
                                {reportData.productos.porFamilia.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />)}
                              </Pie>
                              <Tooltip contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0' }} formatter={(value: number) => money(value)} />
                            </RePieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                          {reportData.productos.porFamilia.map((entry, index) => (
                            <div key={entry.name} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                              <span className="min-w-0 flex-1 break-words text-xs font-bold text-slate-600">{entry.name}</span>
                              <span className="shrink-0 text-xs font-black text-slate-950">{money(entry.value)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="mt-4"><ReportEmptyState title="Sin ventas por familia" description="No hay productos para agrupar." compact /></div>
                    )}
                  </article>

                  <article className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <h4 className="text-lg font-black text-slate-950">Stock bajo</h4>
                    <p className="mt-1 text-xs font-medium text-slate-500">Productos que requieren revisión.</p>
                    {reportData.productos.bajoStock.length > 0 ? (
                      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {reportData.productos.bajoStock.map((product) => (
                          <div key={product.name} className="flex min-w-0 items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-red-600"><TrendingDown size={18} /></div>
                            <div className="min-w-0">
                              <p className="break-words text-sm font-black text-slate-950">{product.name}</p>
                              <p className="mt-1 text-xs font-bold text-red-600">Stock actual: {number(product.stock)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4"><ReportEmptyState title="Stock al día" description="No hay productos con stock bajo." compact /></div>
                    )}
                  </article>
                </div>

                <div className="space-y-4">
                  <ReportHeading title="Rendimiento de productos">
                    <SegmentedButtons>
                      <button type="button" onClick={() => setProductSort('cantidad')} className={`min-h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider ${productSort === 'cantidad' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>Más vendidos</button>
                      <button type="button" onClick={() => setProductSort('total')} className={`min-h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider ${productSort === 'total' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>Facturación</button>
                    </SegmentedButtons>
                  </ReportHeading>
                  {reportData.productos.listadoProductos.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                      {[...reportData.productos.listadoProductos]
                        .sort((a, b) => Number(b[productSort]) - Number(a[productSort]))
                        .map((product, index) => (
                          <article key={product.name} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">#{index + 1}</div>
                              <p className="min-w-0 break-words text-base font-black text-slate-950">{product.name}</p>
                            </div>
                            <div className="mt-5 grid grid-cols-1 gap-3 min-[390px]:grid-cols-3">
                              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cantidad</p><p className="mt-1 text-sm font-black text-slate-950">{number(product.cantidad)}</p></div>
                              <div className="rounded-2xl bg-indigo-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Facturado</p><p className="mt-1 break-words text-sm font-black text-indigo-900">{money(product.total)}</p></div>
                              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Última venta</p><p className="mt-1 text-sm font-black text-slate-950">{formatDate(product.ultima_venta)}</p></div>
                            </div>
                          </article>
                        ))}
                    </div>
                  ) : (
                    <ReportEmptyState title="No hay productos vendidos" description="No se registraron ventas de productos en el período." />
                  )}
                </div>
              </section>
            )}

            {activeTab === 'deudas' && reportData && (
              <section className="space-y-5">
                <ReportHeading title="Deudas" description="Saldos pendientes, mora y clientes deudores.">
                  <PrintButton />
                </ReportHeading>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <MetricCard label="Total adeudado" value={money(reportData.deudas.totalAdeudado)} helper="Saldo total a cobrar" tone="red" icon={<DollarSign size={20} />} />
                  <MetricCard label="Clientes deudores" value={number(reportData.deudas.clientesDeudores)} helper="Cuentas con saldo" icon={<Users size={20} />} />
                  <MetricCard label="Deuda vencida" value={money(reportData.deudas.deudaVencida)} helper="Mayor a siete días" tone="amber" icon={<AlertTriangle size={20} />} />
                </div>
                {reportData.deudas.rankingDeudores.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {reportData.deudas.rankingDeudores.map((debtor, index) => {
                      const delayDays = debtor.fecha_antigua
                        ? Math.max(0, Math.floor((Date.now() - new Date(debtor.fecha_antigua).getTime()) / 86400000))
                        : 0;
                      return (
                        <article key={debtor.id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-sm font-black text-red-700">#{index + 1}</div>
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-base font-black text-slate-950">{debtor.nombre}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">{debtor.ventas_pendientes} comprobantes pendientes</p>
                            </div>
                          </div>
                          <div className="mt-5 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-red-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-red-500">Adeudado</p><p className="mt-1 break-words text-sm font-black text-red-800">{money(debtor.saldo)}</p></div>
                            <div className="rounded-2xl bg-amber-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-amber-600">Antigüedad</p><p className="mt-1 text-sm font-black text-amber-900">{debtor.fecha_antigua ? `${delayDays} días` : 'Sin fecha'}</p></div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openClientHistory(debtor.id, debtor.nombre)}
                            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
                          >
                            Ver historial
                            <ChevronRight size={16} />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <ReportEmptyState title="No hay clientes con deuda" description="No existen saldos pendientes en el período." />
                )}
              </section>
            )}

            {activeTab === 'finanzas' && reportData && (
              <section className="space-y-5">
                <ReportHeading title="Finanzas" description="Ingresos, egresos y resultado neto del período.">
                  <PrintButton />
                </ReportHeading>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <MetricCard label="Ingresos" value={money(reportData.finanzas.ingresos)} helper="Entradas de capital" tone="emerald" icon={<ArrowUpRight size={20} />} />
                  <MetricCard label="Egresos" value={money(reportData.finanzas.egresos)} helper="Salidas de capital" tone="red" icon={<ArrowDownLeft size={20} />} />
                  <MetricCard label="Resultado neto" value={money(reportData.finanzas.balance)} helper="Resultado del período" tone={reportData.finanzas.balance >= 0 ? 'dark' : 'red'} icon={<Wallet size={20} />} />
                </div>
                <article className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                  <h4 className="text-lg font-black text-slate-950">Ingresos vs egresos</h4>
                  <p className="mt-1 text-xs font-medium text-slate-500">Flujo diario del período seleccionado.</p>
                  {reportData.finanzas.flujoCaja.length > 0 ? (
                    <div className="mt-5 h-[300px] min-h-[300px] min-w-0 w-full overflow-hidden sm:h-[400px] sm:min-h-[400px]">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300} debounce={100} initialDimension={{ width: 800, height: 360 }}>
                        <BarChart data={reportData.finanzas.flujoCaja} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="fecha" axisLine={false} tickLine={false} minTickGap={28} tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} tickFormatter={(value) => formatDate(value).slice(0, 5)} />
                          <YAxis axisLine={false} tickLine={false} width={54} tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} tickFormatter={(value) => `$${Number(value).toLocaleString('es-AR', { notation: 'compact' })}`} />
                          <Tooltip contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0' }} formatter={(value: number, name: string) => [money(value), name === 'ingresos' ? 'Ingresos' : 'Egresos']} labelFormatter={(value) => formatDate(value)} />
                          <Bar name="Ingresos" dataKey="ingresos" fill="#10b981" radius={[5, 5, 0, 0]} />
                          <Bar name="Egresos" dataKey="egresos" fill="#ef4444" radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="mt-5"><ReportEmptyState title="Sin movimientos financieros" description="No hay ingresos ni egresos para graficar." compact /></div>
                  )}
                </article>
              </section>
            )}
          </main>
        )}
      </div>

      {viewingClientSales && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="client-history-title">
          <button
            type="button"
            aria-label="Cerrar historial"
            className="absolute inset-0 cursor-default bg-slate-950/65 backdrop-blur-sm"
            onClick={() => setViewingClientSales(null)}
          />
          <div className="relative flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[30px] bg-white shadow-2xl sm:rounded-[30px]">
            <header className="flex min-w-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h3 id="client-history-title" className="break-words text-xl font-black text-slate-950 sm:text-2xl">Historial de compras</h3>
                <p className="mt-1 break-words text-sm font-semibold text-slate-500">{viewingClientSales.nombre}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingClientSales(null)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-950"
                aria-label="Cerrar"
              >
                <ChevronRight className="rotate-180" size={20} />
              </button>
            </header>
            <div className="custom-scrollbar flex-1 overflow-y-auto p-4 sm:p-6">
              {loadingClientSales ? (
                <div className="flex min-h-52 flex-col items-center justify-center gap-3" role="status" aria-live="polite">
                  <Loader2 size={28} className="animate-spin text-indigo-600" />
                  <p className="text-xs font-black uppercase tracking-wider text-slate-500">Cargando historial…</p>
                </div>
              ) : clientSalesError ? (
                <ReportErrorState message={clientSalesError} onRetry={() => fetchClientSales(viewingClientSales.id)} compact />
              ) : clientSales.length === 0 ? (
                <ReportEmptyState title="Sin ventas en el período" description="Probá ampliar el rango de fechas." compact />
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <MetricCard label="Total comprado" value={money(clientSales.reduce((sum, sale) => sum + Number(sale.total_venta || 0), 0))} tone="indigo" />
                    <MetricCard label="Cantidad" value={number(clientSales.length)} />
                    <MetricCard label="Ticket promedio" value={money(clientSales.length ? clientSales.reduce((sum, sale) => sum + Number(sale.total_venta || 0), 0) / clientSales.length : 0)} tone="emerald" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {clientSales.map((sale) => (
                      <article key={sale.id} className="min-w-0 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-black text-white">Venta #{sale.id}</span>
                              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 shadow-sm">{sale.metodo_pago}</span>
                            </div>
                            <p className="mt-3 text-xs font-semibold text-slate-500">{formatDate(sale.fecha)} · {formatTime(sale.fecha)}</p>
                          </div>
                          <p className="max-w-[46%] break-words text-right text-base font-black text-slate-950">{money(sale.total_venta)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
