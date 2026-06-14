import React, { useEffect, useMemo, useState } from 'react';
import {
  LogIn,
  Package,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  History,
  Wallet,
  LogOut,
  AlertCircle,
  Loader2,
  Download,
  ReceiptText,
  Truck,
  CreditCard,
  CircleDollarSign,
  Filter,
  RotateCcw,
} from 'lucide-react';
import { unwrapResponse } from '../utils/api';
import { generateCustomerOrderPdf } from '../utils/customerOrderPdf';
import { generateSaleReceipt } from '../utils/pdfGenerator';
import { generatePaymentReceiptPdf } from '../utils/paymentReceiptPdf';

type PortalCustomer = {
  id: number;
  nombre_apellido: string;
  razon_social?: string;
  saldo_cta_cte?: number;
};

type PortalProduct = {
  id: number;
  code?: string;
  name: string;
  description?: string;
  sale_price: number;
  stock?: number;
  family_name?: string;
  category_name?: string;
};

type PortalOrder = {
  id: number;
  numero_pedido: number;
  fecha: string;
  estado: string;
  stock_status?: 'esperando_stock' | 'listo_entrega' | null;
  subtotal: number;
  descuento_tipo: string;
  descuento_valor: number;
  descuento_monto: number;
  total_final: number;
  sale_id?: number | null;
  numero_venta?: string | number | null;
  sale_total?: number;
  sale_monto_pagado?: number;
  sale_monto_pendiente?: number;
  sale_estado?: string | null;
  aprobado_at?: string | null;
  entregado_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  admin_notes?: string;
  rejection_reason?: string;
  cancel_reason?: string;
  cliente?: string;
  items: any[];
};

type PortalMovements = {
  sales: any[];
  movements: any[];
};

const portalFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('customer_portal_token');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
};

const formatCurrency = (value: number) =>
  `$${Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value?: string | null) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('es-AR');
};

const getSalePaymentStatus = (sale: any): 'pending' | 'partial' | 'paid' => {
  const paid = Number(sale?.monto_pagado || 0);
  const pending = Number(sale?.monto_pendiente || 0);
  if (pending <= 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
};

const getSalePaymentStatusLabel = (sale: any) => {
  const status = sale?.payment_status || getSalePaymentStatus(sale);
  if (status === 'partial') return 'Pago parcial';
  if (status === 'paid') return 'Pagada';
  return 'Pendiente';
};

const getSalePaymentStatusClass = (sale: any) => {
  const status = sale?.payment_status || getSalePaymentStatus(sale);
  if (status === 'partial') return 'bg-amber-50 text-amber-700';
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700';
  return 'bg-red-50 text-red-600';
};

const getStatusLabel = (order: PortalOrder) => {
  if (order.estado === 'aprobado_pendiente_entrega' && order.stock_status === 'esperando_stock') {
    return 'Esperando reposición';
  }

  if (order.estado === 'aprobado_pendiente_entrega' && order.stock_status === 'listo_entrega') {
    return 'Listo para entregar';
  }

  switch (order.estado) {
    case 'pendiente_aprobacion':
      return 'Pendiente de aprobación';
    case 'aprobado_pendiente_entrega':
      return 'Aprobado - pendiente de entrega';
    case 'entregado':
      return order.sale_estado === 'Pagada' ? 'Entregado y pagado' : 'Entregado';
    case 'rechazado':
      return 'Rechazado';
    case 'cancelado':
      return 'Cancelado';
    default:
      return order.estado || 'Pendiente';
  }
};

const getStatusClass = (order: PortalOrder) => {
  if (order.estado === 'aprobado_pendiente_entrega' && order.stock_status === 'esperando_stock') {
    return 'bg-orange-50 text-orange-700 border-orange-100';
  }

  if (order.estado === 'aprobado_pendiente_entrega' && order.stock_status === 'listo_entrega') {
    return 'bg-blue-50 text-blue-700 border-blue-100';
  }

  switch (order.estado) {
    case 'pendiente_aprobacion':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'entregado':
      return order.sale_estado === 'Pagada'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
        : 'bg-violet-50 text-violet-700 border-violet-100';
    case 'rechazado':
      return 'bg-red-50 text-red-700 border-red-100';
    case 'cancelado':
      return 'bg-zinc-100 text-zinc-600 border-zinc-200';
    default:
      return 'bg-zinc-50 text-zinc-600 border-zinc-100';
  }
};

const buildOrderTimeline = (order: PortalOrder) => {
  if (order.estado === 'rechazado') {
    return [
      { label: 'Pedido realizado', date: order.fecha, done: true },
      { label: 'Pedido rechazado', date: order.rejected_at, done: true, danger: true },
    ];
  }

  if (order.estado === 'cancelado') {
    return [
      { label: 'Pedido realizado', date: order.fecha, done: true },
      { label: 'Pedido cancelado', date: order.cancelled_at, done: true, danger: true },
    ];
  }

  const approved =
    order.estado === 'aprobado_pendiente_entrega' || order.estado === 'entregado';
  const delivered = order.estado === 'entregado';
  const paid = delivered && order.sale_estado === 'Pagada';

  return [
    { label: 'Pedido realizado', date: order.fecha, done: true },
    {
      label:
        order.stock_status === 'esperando_stock'
          ? 'Aprobado - esperando reposición'
          : 'Pedido aprobado',
      date: order.aprobado_at,
      done: approved,
    },
    {
      label:
        order.stock_status === 'listo_entrega' && !delivered
          ? 'Listo para entregar'
          : 'Pedido entregado',
      date: order.entregado_at,
      done: delivered || order.stock_status === 'listo_entrega',
    },
    { label: 'Pedido pagado', date: null, done: paid },
  ];
};

export default function CustomerPortal({ onBackToAdmin }: { onBackToAdmin?: () => void }) {
  const [token, setToken] = useState(() => localStorage.getItem('customer_portal_token') || '');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [products, setProducts] = useState<PortalProduct[]>([]);
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [movements, setMovements] = useState<PortalMovements>({ sales: [], movements: [] });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'catalogo' | 'pedidos' | 'cuenta'>('catalogo');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<{ product: PortalProduct; quantity: number }[]>([]);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [downloadingSaleId, setDownloadingSaleId] = useState<number | null>(null);
  const [accountFilters, setAccountFilters] = useState({ dateFrom: '', dateTo: '', status: 'all' as 'all' | 'pending' | 'partial' | 'paid' });

  const filteredProducts = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return products;

    return products.filter(
      (product) =>
        (product.name || '').toLowerCase().includes(q) ||
        (product.code || '').toLowerCase().includes(q) ||
        (product.family_name || '').toLowerCase().includes(q) ||
        (product.category_name || '').toLowerCase().includes(q)
    );
  }, [products, searchTerm]);

  const cartTotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + item.quantity * Number(item.product.sale_price || 0),
        0
      ),
    [cart]
  );

  const portalSummary = useMemo(
    () => ({
      pendingApproval: orders.filter((order) => order.estado === 'pendiente_aprobacion').length,
      approved: orders.filter(
        (order) =>
          order.estado === 'aprobado_pendiente_entrega' &&
          order.stock_status !== 'esperando_stock'
      ).length,
      waitingStock: orders.filter(
        (order) =>
          order.estado === 'aprobado_pendiente_entrega' &&
          order.stock_status === 'esperando_stock'
      ).length,
      delivered: orders.filter((order) => order.estado === 'entregado').length,
    }),
    [orders]
  );

  const isWithinAccountDateRange = (value?: string | null) => {
    if (!value) return false;
    const date = String(value).slice(0, 10);
    if (accountFilters.dateFrom && date < accountFilters.dateFrom) return false;
    if (accountFilters.dateTo && date > accountFilters.dateTo) return false;
    return true;
  };

  const filteredAccountSales = useMemo(() => {
    return (movements.sales || []).filter((sale: any) => {
      if (!isWithinAccountDateRange(sale.fecha)) return false;

      const status = sale.payment_status || getSalePaymentStatus(sale);
      if (accountFilters.status !== 'all' && status !== accountFilters.status) return false;

      return true;
    });
  }, [movements.sales, accountFilters]);

  const filteredAccountMovements = useMemo(() => {
    if (accountFilters.status === 'pending' || accountFilters.status === 'partial') return [];
    return (movements.movements || []).filter((movement: any) =>
      isWithinAccountDateRange(movement.fecha)
    );
  }, [movements.movements, accountFilters]);

  const resetAccountFilters = () => {
    setAccountFilters({ dateFrom: '', dateTo: '', status: 'all' });
  };

  const loadPortalData = async () => {
    setLoading(true);

    try {
      const [meRes, productsRes, ordersRes, movementsRes] = await Promise.all([
        portalFetch('/api/clientes?endpoint=portal-me'),
        portalFetch('/api/clientes?endpoint=portal-products'),
        portalFetch('/api/clientes?endpoint=portal-orders'),
        portalFetch('/api/clientes?endpoint=portal-movements'),
      ]);

      if (!meRes.ok) throw new Error('Sesión cliente vencida');

      const meBody = await meRes.json();
      const productsBody = await productsRes.json();
      const ordersBody = await ordersRes.json();
      const movementsBody = await movementsRes.json();

      setCustomer(unwrapResponse(meBody));
      setProducts(unwrapResponse(productsBody));
      setOrders(unwrapResponse(ordersBody));
      setMovements(unwrapResponse(movementsBody));
    } catch (error) {
      console.error('Error portal cliente:', error);
      localStorage.removeItem('customer_portal_token');
      setToken('');
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) loadPortalData();
  }, [token]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const response = await fetch('/api/clientes?endpoint=portal-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const body = await response.json();
      const data = unwrapResponse(body);

      localStorage.setItem('customer_portal_token', data.token);
      setToken(data.token);
      setLoginForm({ username: '', password: '' });
    } catch (error: any) {
      setLoginError(error?.message || 'Usuario o contraseña inválidos');
    } finally {
      setLoginLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('customer_portal_token');
    setToken('');
    setCustomer(null);
    setCart([]);
  };

  const addToCart = (product: PortalProduct) => {
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);

      if (existing) {
        return current.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...current, { product, quantity: 1 }];
    });
  };

  const updateCartQty = (productId: number, quantity: number) => {
    const safeQuantity = Math.max(1, Number(quantity || 1));
    setCart((current) =>
      current.map((item) =>
        item.product.id === productId
          ? { ...item, quantity: safeQuantity }
          : item
      )
    );
  };

  const removeFromCart = (productId: number) => {
    setCart((current) => current.filter((item) => item.product.id !== productId));
  };

  const submitOrder = async () => {
    if (cart.length === 0) return;
    if (!window.confirm('¿Confirmar pedido para aprobación del administrador?')) return;

    setSubmittingOrder(true);

    try {
      const response = await portalFetch('/api/clientes?endpoint=portal-orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((item) => ({
            product_id: item.product.id,
            cantidad: item.quantity,
          })),
        }),
      });
      const body = await response.json();
      unwrapResponse(body);

      setCart([]);
      setActiveTab('pedidos');
      await loadPortalData();
      alert('Pedido enviado correctamente. Queda pendiente de aprobación.');
    } catch (error: any) {
      alert(error?.message || 'No se pudo enviar el pedido');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const cancelOrder = async (order: PortalOrder) => {
    if (
      !window.confirm(
        '¿Cancelar este pedido? Solo se puede cancelar mientras está pendiente de aprobación.'
      )
    ) {
      return;
    }

    setActionLoading(order.id);

    try {
      const response = await portalFetch(
        `/api/clientes?endpoint=portal-order-cancel&id=${order.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ motivo: 'Cancelado por el cliente' }),
        }
      );
      const body = await response.json();
      unwrapResponse(body);

      await loadPortalData();
      alert('Pedido cancelado correctamente');
    } catch (error: any) {
      alert(error?.message || 'No se pudo cancelar el pedido');
    } finally {
      setActionLoading(null);
    }
  };

  const downloadOrderPdf = (order: PortalOrder) => {
    generateCustomerOrderPdf({
      ...order,
      cliente: order.cliente || customer?.nombre_apellido || 'Cliente',
    });
  };

  const downloadSalePdf = async (saleId: number) => {
    setDownloadingSaleId(saleId);

    try {
      const response = await portalFetch(
        `/api/clientes?endpoint=portal-sale-detail&id=${saleId}`
      );
      const body = await response.json();
      const sale = unwrapResponse(body);
      generateSaleReceipt(sale);
    } catch (error: any) {
      alert(error?.message || 'No se pudo descargar el comprobante de venta');
    } finally {
      setDownloadingSaleId(null);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-zinc-200 overflow-hidden">
          <div className="p-8">
            <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-6">
              <ShoppingCart size={32} />
            </div>

            <h1 className="text-2xl font-black text-zinc-900 text-center mb-2">
              Portal de Clientes
            </h1>
            <p className="text-sm text-zinc-500 text-center mb-8">
              Ingresá para ver productos, pedidos y cuenta corriente
            </p>

            {loginError && (
              <div className="mb-5 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex gap-2">
                <AlertCircle size={18} />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                  Usuario
                </label>
                <input
                  required
                  value={loginForm.username}
                  onChange={(event) =>
                    setLoginForm({ ...loginForm, username: event.target.value })
                  }
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 text-sm"
                  placeholder="cliente123"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                  Contraseña
                </label>
                <input
                  required
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm({ ...loginForm, password: event.target.value })
                  }
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 text-sm"
                  placeholder="••••••••"
                />
              </div>

              <button
                disabled={loginLoading}
                className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loginLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <LogIn size={18} />
                )}
                Entrar al Portal
              </button>
            </form>

            {onBackToAdmin && (
              <button
                onClick={onBackToAdmin}
                className="w-full mt-4 py-3 text-zinc-500 hover:text-zinc-900 text-xs font-bold uppercase tracking-widest"
              >
                Volver a ingreso administrador
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading || !customer) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-600" size={42} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-zinc-900">
              Portal de Clientes
            </h1>
            <p className="text-xs sm:text-sm text-zinc-500 font-bold">
              {customer.nombre_apellido}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-2 rounded-xl bg-zinc-50 border border-zinc-100 text-xs font-black text-zinc-700">
              Saldo: {formatCurrency(customer.saldo_cta_cte || 0)}
            </div>
            <button
              onClick={logout}
              className="p-3 text-red-500 hover:bg-red-50 rounded-xl"
              title="Cerrar sesión"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-2 sm:px-6 flex overflow-x-auto no-scrollbar">
          {[
            { id: 'catalogo', label: 'Productos', icon: Package },
            { id: 'pedidos', label: 'Pedidos', icon: History },
            { id: 'cuenta', label: 'Cuenta corriente', icon: Wallet },
          ].map((tab: any) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-4 text-sm font-black border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-zinc-400'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl w-full mx-auto p-4 sm:p-6 flex-1 space-y-6">
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="bg-white border border-zinc-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-zinc-400">
              Pendientes
            </p>
            <p className="text-2xl font-black text-amber-600">
              {portalSummary.pendingApproval}
            </p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-zinc-400">
              Esperando stock
            </p>
            <p className="text-2xl font-black text-orange-600">
              {portalSummary.waitingStock}
            </p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-zinc-400">
              Para entregar
            </p>
            <p className="text-2xl font-black text-blue-600">
              {portalSummary.approved}
            </p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-zinc-400">
              Entregados
            </p>
            <p className="text-2xl font-black text-emerald-600">
              {portalSummary.delivered}
            </p>
          </div>
          <div className="col-span-2 lg:col-span-1 bg-zinc-900 text-white rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-zinc-400">
              Saldo pendiente
            </p>
            <p className="text-xl font-black">
              {formatCurrency(customer.saldo_cta_cte || 0)}
            </p>
          </div>
        </section>

        {activeTab === 'catalogo' && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
            <div className="space-y-4">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar producto..."
                className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-600/20"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm flex flex-col gap-4"
                  >
                    <div className="flex-1">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                        {product.code || 'Producto'}
                      </p>
                      <h3 className="font-black text-zinc-900 leading-tight mt-1">
                        {product.name}
                      </h3>
                      {product.description && (
                        <p className="text-xs text-zinc-500 mt-2 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-lg font-black text-emerald-700 font-mono">
                        {formatCurrency(product.sale_price)}
                      </p>
                      <button
                        onClick={() => addToCart(product)}
                        className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase flex items-center gap-2"
                      >
                        <Plus size={16} /> Agregar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="bg-white rounded-3xl border border-zinc-200 shadow-xl p-5 h-fit xl:sticky xl:top-32">
              <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-4">
                <ShoppingCart size={20} /> Carrito
              </h2>

              {cart.length === 0 ? (
                <p className="text-sm text-zinc-400 py-8 text-center">
                  Agregá productos para armar tu pedido.
                </p>
              ) : (
                <div className="space-y-4">
                  {cart.map((item) => (
                    <div
                      key={item.product.id}
                      className="border border-zinc-100 rounded-2xl p-3"
                    >
                      <div className="flex justify-between gap-3 mb-3">
                        <p className="text-sm font-black text-zinc-900">
                          {item.product.name}
                        </p>
                        <button
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              updateCartQty(item.product.id, item.quantity - 1)
                            }
                            className="p-2 bg-zinc-100 rounded-lg"
                          >
                            <Minus size={14} />
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(event) =>
                              updateCartQty(
                                item.product.id,
                                Number(event.target.value)
                              )
                            }
                            className="w-16 text-center border border-zinc-200 rounded-lg py-2 font-bold"
                          />
                          <button
                            onClick={() =>
                              updateCartQty(item.product.id, item.quantity + 1)
                            }
                            className="p-2 bg-zinc-100 rounded-lg"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <p className="text-sm font-black font-mono">
                          {formatCurrency(
                            item.quantity * item.product.sale_price
                          )}
                        </p>
                      </div>
                    </div>
                  ))}

                  <div className="border-t border-zinc-100 pt-4 flex justify-between items-center">
                    <span className="text-xs font-black text-zinc-400 uppercase">
                      Total pedido
                    </span>
                    <span className="text-xl font-black text-zinc-900 font-mono">
                      {formatCurrency(cartTotal)}
                    </span>
                  </div>

                  <button
                    disabled={submittingOrder}
                    onClick={submitOrder}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submittingOrder ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={18} />
                    )}
                    Confirmar Pedido
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}

        {activeTab === 'pedidos' && (
          <div className="space-y-4">
            {orders.map((order) => {
              const timeline = buildOrderTimeline(order);
              const pending = Number(order.sale_monto_pendiente || 0);
              const paid = Number(order.sale_monto_pagado || 0);

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                        Pedido #{order.numero_pedido}
                      </p>
                      <h3 className="font-black text-zinc-900">
                        {new Date(order.fecha).toLocaleDateString('es-AR')}
                      </h3>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase w-fit ${getStatusClass(
                        order
                      )}`}
                    >
                      {getStatusLabel(order)}
                    </span>
                  </div>

                  <div className="space-y-2 mb-4">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between gap-3 text-sm border-b border-zinc-50 pb-2"
                      >
                        <span className="font-bold text-zinc-700">
                          {item.product_name} x{item.cantidad}
                        </span>
                        <span className="font-mono font-bold">
                          {formatCurrency(item.importe)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="bg-zinc-50 rounded-2xl p-3">
                      <p className="text-[10px] font-black text-zinc-400 uppercase">
                        Subtotal
                      </p>
                      <p className="font-black font-mono">
                        {formatCurrency(order.subtotal)}
                      </p>
                    </div>
                    <div className="bg-zinc-50 rounded-2xl p-3">
                      <p className="text-[10px] font-black text-zinc-400 uppercase">
                        Descuento
                      </p>
                      <p className="font-black font-mono text-red-600">
                        -{formatCurrency(order.descuento_monto)}
                      </p>
                      {order.descuento_tipo !== 'none' &&
                        Number(order.descuento_valor || 0) > 0 && (
                          <p className="text-[10px] text-zinc-400 font-bold">
                            {order.descuento_tipo === 'percentage'
                              ? `${order.descuento_valor}%`
                              : formatCurrency(order.descuento_valor)}
                          </p>
                        )}
                    </div>
                    <div className="bg-zinc-900 text-white rounded-2xl p-3">
                      <p className="text-[10px] font-black text-zinc-400 uppercase">
                        Total
                      </p>
                      <p className="font-black font-mono">
                        {formatCurrency(order.total_final)}
                      </p>
                    </div>
                  </div>

                  {order.estado === 'entregado' && (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
                        <p className="text-[10px] uppercase font-black text-emerald-600">
                          Pagado
                        </p>
                        <p className="font-black text-emerald-700">
                          {formatCurrency(paid)}
                        </p>
                      </div>
                      <div className="bg-red-50 border border-red-100 rounded-2xl p-3">
                        <p className="text-[10px] uppercase font-black text-red-500">
                          Pendiente
                        </p>
                        <p className="font-black text-red-600">
                          {formatCurrency(pending)}
                        </p>
                      </div>
                      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-3">
                        <p className="text-[10px] uppercase font-black text-zinc-400">
                          Venta
                        </p>
                        <p className="font-black text-zinc-700">
                          #{order.numero_venta || order.sale_id || '-'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="mt-5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">
                      Seguimiento
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      {timeline.map((step, index) => (
                        <div
                          key={`${order.id}-${index}`}
                          className={`rounded-2xl border p-3 ${
                            step.danger
                              ? 'bg-red-50 border-red-100 text-red-700'
                              : step.done
                              ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                              : 'bg-zinc-50 border-zinc-100 text-zinc-400'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {step.done ? (
                              <CheckCircle2 size={15} />
                            ) : (
                              <Clock size={15} />
                            )}
                            <p className="text-[10px] font-black uppercase">
                              {step.label}
                            </p>
                          </div>
                          {step.date && (
                            <p className="text-[10px] font-bold mt-1">
                              {formatDate(step.date)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {order.admin_notes && (
                    <div className="mt-3 bg-blue-50 border border-blue-100 text-blue-700 rounded-2xl p-3 text-xs font-bold">
                      Observación: {order.admin_notes}
                    </div>
                  )}

                  {order.rejection_reason && (
                    <div className="mt-3 bg-red-50 border border-red-100 text-red-700 rounded-2xl p-3 text-xs font-bold">
                      Motivo de rechazo: {order.rejection_reason}
                    </div>
                  )}

                  {order.cancel_reason && (
                    <div className="mt-3 bg-zinc-50 border border-zinc-100 text-zinc-600 rounded-2xl p-3 text-xs font-bold">
                      Pedido cancelado: {order.cancel_reason}
                    </div>
                  )}

                  <div className="mt-4 flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => downloadOrderPdf(order)}
                      className="px-4 py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2"
                    >
                      <Download size={16} /> PDF pedido
                    </button>

                    {order.sale_id && (
                      <button
                        disabled={downloadingSaleId === order.sale_id}
                        onClick={() => downloadSalePdf(Number(order.sale_id))}
                        className="px-4 py-3 bg-emerald-50 text-emerald-700 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {downloadingSaleId === order.sale_id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <ReceiptText size={16} />
                        )}
                        PDF venta
                      </button>
                    )}

                    {order.estado === 'pendiente_aprobacion' && (
                      <button
                        disabled={actionLoading === order.id}
                        onClick={() => cancelOrder(order)}
                        className="px-4 py-3 bg-red-50 text-red-600 border border-red-100 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <XCircle size={16} /> Cancelar pedido
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {orders.length === 0 && (
              <div className="bg-white rounded-3xl border border-zinc-200 p-12 text-center text-zinc-400">
                <Clock size={44} className="mx-auto mb-3 opacity-20" />
                <p className="font-bold">Todavía no realizaste pedidos.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'cuenta' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-black flex items-center gap-2">
                    <Filter size={20} /> Filtrar cuenta corriente
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Buscá operaciones por período y por estado de pago.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetAccountFilters}
                  className="self-start sm:self-auto px-3 py-2 rounded-xl bg-zinc-100 text-zinc-600 text-xs font-black flex items-center gap-2"
                >
                  <RotateCcw size={14} /> Limpiar
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase text-zinc-400 mb-1">Desde</label>
                  <input
                    type="date"
                    value={accountFilters.dateFrom}
                    onChange={(event) => setAccountFilters({ ...accountFilters, dateFrom: event.target.value })}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-zinc-400 mb-1">Hasta</label>
                  <input
                    type="date"
                    value={accountFilters.dateTo}
                    onChange={(event) => setAccountFilters({ ...accountFilters, dateTo: event.target.value })}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-zinc-400 mb-1">Estado</label>
                  <select
                    value={accountFilters.status}
                    onChange={(event) => setAccountFilters({ ...accountFilters, status: event.target.value as 'all' | 'pending' | 'partial' | 'paid' })}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm font-black outline-none focus:ring-2 focus:ring-zinc-900"
                  >
                    <option value="all">Todos los movimientos</option>
                    <option value="pending">Pendientes de pago</option>
                    <option value="partial">Pagos parciales</option>
                    <option value="paid">Pagados</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-zinc-50 p-3">
                  <p className="text-[9px] font-black uppercase text-zinc-400">Ventas visibles</p>
                  <p className="text-lg font-black text-zinc-900">{filteredAccountSales.length}</p>
                </div>
                <div className="rounded-2xl bg-red-50 p-3">
                  <p className="text-[9px] font-black uppercase text-red-400">Pendiente visible</p>
                  <p className="text-lg font-black font-mono text-red-600">
                    {formatCurrency(filteredAccountSales.reduce((sum: number, sale: any) => sum + Number(sale.monto_pendiente || 0), 0))}
                  </p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-3">
                  <p className="text-[9px] font-black uppercase text-emerald-500">Pagado visible</p>
                  <p className="text-lg font-black font-mono text-emerald-700">
                    {formatCurrency(filteredAccountSales.reduce((sum: number, sale: any) => sum + Number(sale.monto_pagado || 0), 0))}
                  </p>
                </div>
                <div className="rounded-2xl bg-blue-50 p-3">
                  <p className="text-[9px] font-black uppercase text-blue-500">Pagos visibles</p>
                  <p className="text-lg font-black text-blue-700">{filteredAccountMovements.length}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm">
                <h2 className="text-lg font-black mb-4 flex items-center gap-2">
                  <ReceiptText size={20} /> Ventas
                </h2>

                <div className="space-y-3">
                  {filteredAccountSales.map((sale: any) => (
                    <div
                      key={sale.id}
                      className="border border-zinc-100 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-zinc-900">Venta #{sale.numero_venta}</p>
                          <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase ${getSalePaymentStatusClass(sale)}`}>
                            {getSalePaymentStatusLabel(sale)}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-1">
                          {new Date(sale.fecha).toLocaleDateString('es-AR')} · {sale.metodo_pago || sale.estado}
                          {sale.numero_pedido ? ` · Pedido #${sale.numero_pedido}` : ''}
                        </p>
                        {Number(sale.descuento_total || 0) > 0 && (
                          <p className="mt-1 text-[10px] font-bold text-amber-600">
                            Descuento aplicado: {formatCurrency(sale.descuento_total)}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <div className="text-right">
                          <p className="font-black font-mono">{formatCurrency(sale.total)}</p>
                          {getSalePaymentStatus(sale) === 'paid' ? (
                            <p className="text-xs text-emerald-600 font-bold">
                              Pagada · {formatCurrency(sale.monto_pagado)}
                            </p>
                          ) : getSalePaymentStatus(sale) === 'partial' ? (
                            <p className="text-xs text-amber-600 font-bold">
                              Cobrado {formatCurrency(sale.monto_pagado)} · Falta {formatCurrency(sale.monto_pendiente)}
                            </p>
                          ) : (
                            <p className="text-xs text-red-600 font-bold">
                              Pendiente {formatCurrency(sale.monto_pendiente)}
                            </p>
                          )}
                        </div>
                        <button
                          disabled={downloadingSaleId === sale.id}
                          onClick={() => downloadSalePdf(Number(sale.id))}
                          className="p-3 rounded-xl bg-emerald-50 text-emerald-700 disabled:opacity-50"
                          title="Descargar comprobante de venta"
                        >
                          {downloadingSaleId === sale.id ? (
                            <Loader2 size={17} className="animate-spin" />
                          ) : (
                            <Download size={17} />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}

                  {filteredAccountSales.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center">
                      <p className="text-sm text-zinc-400">No hay ventas para los filtros seleccionados.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm">
                <h2 className="text-lg font-black mb-4 flex items-center gap-2">
                  <CircleDollarSign size={20} /> Pagos y movimientos
                </h2>

                {(accountFilters.status === 'pending' || accountFilters.status === 'partial') && (
                  <div className="mb-4 rounded-2xl bg-amber-50 border border-amber-100 p-3 text-xs font-bold text-amber-700">
                    Este filtro muestra únicamente las ventas con ese estado. Los comprobantes de pago aparecen al elegir “Todos” o “Pagados”.
                  </div>
                )}

                <div className="space-y-3">
                  {filteredAccountMovements.map((movement: any) => (
                    <div
                      key={movement.id}
                      className="border border-zinc-100 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-black text-zinc-900">{movement.descripcion}</p>
                        <p className="text-xs text-zinc-400">
                          {new Date(movement.fecha).toLocaleDateString('es-AR')} · {movement.forma_pago || movement.origen}
                          {movement.numero_pago ? ` · Recibo #${movement.numero_pago}` : ''}
                          {movement.numero_venta ? ` · Venta #${movement.numero_venta}` : ''}
                          {movement.numero_pedido ? ` · Pedido #${movement.numero_pedido}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <p className={`font-black font-mono ${movement.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {formatCurrency(movement.monto)}
                        </p>

                        {movement.tipo === 'ingreso' && (
                          <button
                            onClick={() => generatePaymentReceiptPdf(movement, customer.nombre_apellido)}
                            className="p-3 rounded-xl bg-zinc-100 text-zinc-700"
                            title="Descargar comprobante de pago"
                          >
                            <Download size={17} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {filteredAccountMovements.length === 0 && accountFilters.status !== 'pending' && accountFilters.status !== 'partial' && (
                    <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center">
                      <p className="text-sm text-zinc-400">No hay movimientos para los filtros seleccionados.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
