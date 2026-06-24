/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Map,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X as CloseIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import BulkPriceUpdate from './components/BulkPriceUpdate';
import ChecklistModule from './components/ChecklistModule';
import ConfigModule from './components/ConfigModule';
import CustomerModule from './components/CustomerModule';
import Dashboard from './components/Dashboard';
import FinanceModule from './components/FinanceModule';
import Login from './components/Login';
import ProductModule from './components/ProductModule';
import PurchaseInvoiceModule from './components/PurchaseInvoiceModule';
import ReportsModule from './components/ReportsModule';
import RouteModule from './components/RouteModule';
import SalesModule from './components/SalesModule';
import SupplierOrders from './components/SupplierOrders';
import UserManagement from './components/UserManagement';
import { useAuth } from './contexts/AuthContext';

type NavigationGroup = 'Principal' | 'Operación' | 'Gestión' | 'Control' | 'Sistema';

const allNavItems = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    description: 'Resumen general del negocio y principales indicadores.',
    icon: LayoutDashboard,
    module: 'dashboard',
    group: 'Principal' as NavigationGroup,
  },
  {
    id: 'sales',
    label: 'Ventas',
    shortLabel: 'Ventas',
    description: 'Registrá operaciones, cobros y comprobantes de clientes.',
    icon: ShoppingCart,
    module: 'sales',
    group: 'Operación' as NavigationGroup,
  },
  {
    id: 'purchase-invoices',
    label: 'Facturas de compra',
    shortLabel: 'Facturas',
    description: 'Administrá facturas, compras e ingresos de mercadería.',
    icon: FileText,
    module: 'suppliers',
    group: 'Operación' as NavigationGroup,
  },
  {
    id: 'supplier-orders',
    label: 'Pedidos a proveedor',
    shortLabel: 'Pedidos',
    description: 'Seguimiento de pedidos, entregas y recepción de stock.',
    icon: ClipboardList,
    module: 'suppliers',
    group: 'Operación' as NavigationGroup,
  },
  {
    id: 'products',
    label: 'Productos',
    shortLabel: 'Productos',
    description: 'Inventario, precios, stock y alertas de productos.',
    icon: Package,
    module: 'products',
    group: 'Gestión' as NavigationGroup,
  },
  {
    id: 'bulk-prices',
    label: 'Cambio de precios',
    shortLabel: 'Precios',
    description: 'Actualizaciones individuales o masivas con vista previa.',
    icon: TrendingUp,
    module: 'products',
    group: 'Gestión' as NavigationGroup,
  },
  {
    id: 'clients',
    label: 'Clientes',
    shortLabel: 'Clientes',
    description: 'Datos, cuenta corriente, ventas y seguimiento de clientes.',
    icon: Users,
    module: 'customers',
    group: 'Gestión' as NavigationGroup,
  },
  {
    id: 'route',
    label: 'Ruta del día',
    shortLabel: 'Ruta',
    description: 'Planificación y seguimiento de visitas y entregas.',
    icon: Map,
    module: 'routes',
    group: 'Gestión' as NavigationGroup,
  },
  {
    id: 'checklist',
    label: 'Checklist',
    shortLabel: 'Checklist',
    description: 'Controles diarios, tareas y progreso operativo.',
    icon: ClipboardList,
    module: 'checklist',
    group: 'Control' as NavigationGroup,
  },
  {
    id: 'finances',
    label: 'Finanzas',
    shortLabel: 'Finanzas',
    description: 'Caja, ingresos, egresos, cheques y cuentas corrientes.',
    icon: Wallet,
    module: 'current_accounts',
    group: 'Control' as NavigationGroup,
  },
  {
    id: 'reports',
    label: 'Reportes',
    shortLabel: 'Reportes',
    description: 'Análisis de ventas, productos, clientes y rentabilidad.',
    icon: BarChart3,
    module: 'dashboard',
    group: 'Control' as NavigationGroup,
  },
  {
    id: 'users',
    label: 'Usuarios',
    shortLabel: 'Usuarios',
    description: 'Administración de accesos, roles y permisos.',
    icon: Users,
    module: 'users',
    group: 'Sistema' as NavigationGroup,
  },
  {
    id: 'config',
    label: 'Configuración',
    shortLabel: 'Configuración',
    description: 'Parámetros generales, métodos de pago y mantenimiento.',
    icon: Settings,
    module: 'settings',
    group: 'Sistema' as NavigationGroup,
  },
];

const navigationGroups: NavigationGroup[] = ['Principal', 'Operación', 'Gestión', 'Control', 'Sistema'];

export default function App() {
  const { user, isAuthenticated, isLoading, logout, hasPermission } = useAuth();
  const [activeModule, setActiveModule] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navItems = useMemo(
    () => allNavItems.filter((item) => hasPermission(item.module, 'view')),
    [hasPermission],
  );

  const activeItem = allNavItems.find((item) => item.id === activeModule) ?? allNavItems[0];

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [activeModule]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSidebarOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-slate-200 bg-white px-10 py-9 shadow-xl shadow-slate-200/60">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-200">
            <Loader2 className="animate-spin" size={28} aria-hidden="true" />
          </div>
          <div className="text-center">
            <p className="font-black text-slate-950">Preparando Edugestión</p>
            <p className="mt-1 text-sm text-slate-500">Cargando tu espacio de trabajo…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  const renderActiveModule = () => {
    switch (activeModule) {
      case 'dashboard':
        return <Dashboard />;
      case 'products':
        return <ProductModule />;
      case 'sales':
        return <SalesModule />;
      case 'purchase-invoices':
        return <PurchaseInvoiceModule />;
      case 'bulk-prices':
        return <BulkPriceUpdate />;
      case 'supplier-orders':
        return <SupplierOrders />;
      case 'clients':
        return <CustomerModule />;
      case 'finances':
        return <FinanceModule />;
      case 'reports':
        return <ReportsModule />;
      case 'route':
        return <RouteModule />;
      case 'checklist':
        return <ChecklistModule />;
      case 'users':
        return <UserManagement />;
      case 'config':
        return <ConfigModule />;
      default:
        return (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-400">
            <BarChart3 size={48} className="mb-4 opacity-20" aria-hidden="true" />
            <p className="text-lg font-bold text-slate-600">Módulo en desarrollo</p>
            <p className="mt-1 text-sm">Estamos trabajando para conectar toda tu información.</p>
          </div>
        );
    }
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-slate-100 font-sans text-slate-900">
      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default bg-slate-950/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Cerrar menú lateral"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[286px] shrink-0 flex-col overflow-hidden border-r border-white/10 bg-slate-950 text-white shadow-2xl shadow-slate-950/30 transition-transform duration-300 ease-out lg:static lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Navegación principal"
      >
        <div className="relative overflow-hidden border-b border-white/10 px-5 py-5">
          <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-indigo-600 text-sm font-black tracking-tight text-white shadow-lg shadow-indigo-950/40">
                EG
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-black tracking-tight">Edugestión</p>
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Gestión comercial</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 lg:hidden"
              title="Cerrar menú"
              aria-label="Cerrar menú"
            >
              <CloseIcon size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav className="custom-scrollbar flex-1 overflow-y-auto px-3 py-4">
          {navigationGroups.map((group) => {
            const groupItems = navItems.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;

            return (
              <div key={group} className="mb-5 last:mb-0">
                {group !== 'Principal' && (
                  <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {group}
                  </p>
                )}
                <div className="space-y-1">
                  {groupItems.map((item) => {
                    const isActive = activeModule === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveModule(item.id)}
                        className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400/80 ${
                          isActive
                            ? 'bg-white text-slate-950 shadow-lg shadow-slate-950/20'
                            : 'text-slate-400 hover:bg-white/7 hover:text-white'
                        }`}
                        title={item.label}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                            isActive
                              ? 'bg-indigo-50 text-indigo-600'
                              : 'bg-white/5 text-slate-400 group-hover:bg-white/10 group-hover:text-indigo-300'
                          }`}
                        >
                          <item.icon size={18} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <ChevronRight
                          size={15}
                          className={`shrink-0 transition ${isActive ? 'text-indigo-500' : 'text-slate-600 opacity-0 group-hover:opacity-100'}`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-600 text-sm font-black text-white shadow-lg shadow-indigo-950/30">
                {user?.avatar || user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{user?.name || 'Usuario'}</p>
                <p className="truncate text-[11px] font-medium capitalize text-slate-400">{user?.role || 'Invitado'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/15 bg-red-500/10 px-3 py-2.5 text-xs font-black text-red-300 transition hover:border-red-400/25 hover:bg-red-500/15 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400/50"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogOut size={16} aria-hidden="true" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-30 flex min-h-[72px] shrink-0 items-center border-b border-slate-200/80 bg-white/90 px-3 backdrop-blur-xl sm:px-5 lg:min-h-[82px] lg:px-7">
          <div className="flex w-full min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 lg:hidden"
              title="Abrir menú"
              aria-label="Abrir menú"
            >
              <Menu size={22} aria-hidden="true" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="hidden items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 sm:flex">
                <span>Edugestión</span>
                <ChevronRight size={12} aria-hidden="true" />
                <span className="truncate text-indigo-600">{activeItem.group}</span>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-3">
                <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 sm:flex">
                  <activeItem.icon size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-black tracking-tight text-slate-950 sm:text-xl">{activeItem.label}</h1>
                  <p className="hidden truncate text-xs text-slate-500 md:block">{activeItem.description}</p>
                </div>
              </div>
            </div>

            <div className="hidden items-center gap-3 lg:flex">
              <div className="flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">
                <Sparkles size={15} aria-hidden="true" />
                Espacio de trabajo
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="text-right">
                <p className="max-w-44 truncate text-sm font-black text-slate-900">{user?.name || 'Usuario'}</p>
                <p className="max-w-44 truncate text-[11px] capitalize text-slate-500">{user?.role || 'Invitado'}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-black text-white shadow-sm">
                {user?.avatar || user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
            </div>
          </div>
        </header>

        <div className="app-content-bg custom-scrollbar relative flex-1 overflow-y-auto">
          {renderActiveModule()}
        </div>
      </main>
    </div>
  );
}
