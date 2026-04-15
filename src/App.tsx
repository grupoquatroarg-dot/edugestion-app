/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LayoutDashboard, Package, Users, Map, ClipboardList, Wallet, BarChart3, Settings, ShoppingCart, TrendingUp, FileText, Menu, X as CloseIcon } from 'lucide-react';
import ProductModule from './components/ProductModule';
import SalesModule from './components/SalesModule';
import BulkPriceUpdate from './components/BulkPriceUpdate';
import SupplierOrders from './components/SupplierOrders';
import CustomerModule from './components/CustomerModule';
import FinanceModule from './components/FinanceModule';
import ReportsModule from './components/ReportsModule';
import ConfigModule from './components/ConfigModule';
import RouteModule from './components/RouteModule';
import ChecklistModule from './components/ChecklistModule';
import PurchaseInvoiceModule from './components/PurchaseInvoiceModule';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { LogOut, Loader2 } from 'lucide-react';

export default function App() {
  const { user, isAuthenticated, isLoading, logout, hasPermission } = useAuth();
  const [activeModule, setActiveModule] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Close sidebar on mobile when module changes
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [activeModule]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-zinc-400" size={48} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  const allNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard' },
    { id: 'sales', label: 'Ventas', icon: ShoppingCart, module: 'sales' },
    { id: 'purchase-invoices', label: 'Facturas Compra', icon: FileText, module: 'suppliers' },
    { id: 'supplier-orders', label: 'Pedidos a Proveedor', icon: ClipboardList, module: 'suppliers' },
    { id: 'products', label: 'Productos', icon: Package, module: 'products' },
    { id: 'bulk-prices', label: 'Cambio de Precios', icon: TrendingUp, module: 'products' },
    { id: 'clients', label: 'Clientes', icon: Users, module: 'customers' },
    { id: 'route', label: 'Ruta del Día', icon: Map, module: 'routes' },
    { id: 'checklist', label: 'Checklist', icon: ClipboardList, module: 'checklist' },
    { id: 'finances', label: 'Finanzas', icon: Wallet, module: 'current_accounts' },
    { id: 'reports', label: 'Reportes', icon: BarChart3, module: 'dashboard' },
    { id: 'users', label: 'Usuarios', icon: Users, module: 'users' },
    { id: 'config', label: 'Configuración', icon: Settings, module: 'settings' },
  ];

  const navItems = allNavItems.filter(item => hasPermission(item.module, 'view'));

  return (
    <div className="flex h-[100dvh] bg-zinc-50 font-sans overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-zinc-200 flex flex-col shrink-0 transition-transform duration-300 ease-in-out
        lg:translate-x-0 lg:static
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 lg:p-6 flex items-center justify-between">
          <h1 className="text-xl lg:text-2xl font-black text-zinc-900 tracking-tight">EDU<span className="text-zinc-400">GESTIÓN</span></h1>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="p-2 text-zinc-400 hover:text-zinc-900 lg:hidden"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeModule === item.id
                  ? 'bg-zinc-900 text-white shadow-md'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              <item.icon size={18} />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-100 flex flex-col gap-2">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user?.avatar || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 truncate">{user?.name || 'Usuario'}</p>
              <p className="text-xs text-zinc-500 truncate capitalize">{user?.role || 'Invitado'}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition-all"
          >
            <LogOut size={18} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Header */}
        <header className="lg:hidden h-16 bg-white border-b border-zinc-200 flex items-center px-4 shrink-0">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-zinc-500 hover:text-zinc-900"
          >
            <Menu size={24} />
          </button>
          <h1 className="ml-4 text-lg font-black text-zinc-900 tracking-tight">EDU<span className="text-zinc-400">GESTIÓN</span></h1>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          {activeModule === 'dashboard' ? (
            <Dashboard />
          ) : activeModule === 'products' ? (
            <ProductModule />
          ) : activeModule === 'sales' ? (
            <SalesModule />
          ) : activeModule === 'purchase-invoices' ? (
            <PurchaseInvoiceModule />
          ) : activeModule === 'bulk-prices' ? (
            <BulkPriceUpdate />
          ) : activeModule === 'supplier-orders' ? (
            <SupplierOrders />
          ) : activeModule === 'clients' ? (
            <CustomerModule />
          ) : activeModule === 'finances' ? (
            <FinanceModule />
          ) : activeModule === 'reports' ? (
            <ReportsModule />
          ) : activeModule === 'route' ? (
            <RouteModule />
          ) : activeModule === 'checklist' ? (
            <ChecklistModule />
          ) : activeModule === 'users' ? (
            <UserManagement />
          ) : activeModule === 'config' ? (
            <ConfigModule />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 p-8 text-center">
              <BarChart3 size={48} className="mb-4 opacity-20" />
              <p className="text-lg font-medium">Módulo "{navItems.find(i => i.id === activeModule)?.label}" en desarrollo</p>
              <p className="text-sm">Estamos trabajando para conectar toda tu información.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
