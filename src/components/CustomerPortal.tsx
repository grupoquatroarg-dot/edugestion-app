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
  Search,
  RefreshCw,
  X,
  UserRound,
  Store,
  ShieldCheck,
  ShoppingBag,
  ArrowLeft,
} from 'lucide-react';
import { unwrapResponse } from '../utils/api';
import { generateCustomerOrderPdf } from '../utils/customerOrderPdf';
import { generateSaleReceipt } from '../utils/pdfGenerator';
import { generatePaymentReceiptPdf } from '../utils/paymentReceiptPdf';
import { formatBusinessDateTime } from '../utils/businessDate';

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
  cancelled_by?: string;
  cancellation_source?: string;
  cancelled_from_status?: string;
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

const getSalePaymentStatus = (sale: any): 'pending' | 'partial' | 'paid' | 'cancelled' => {
  if (String(sale?.estado || '').toLowerCase() === 'anulada') return 'cancelled';
  const paid = Number(sale?.monto_pagado || 0);
  const pending = Number(sale?.monto_pendiente || 0);
  if (pending <= 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
};

const getSalePaymentStatusLabel = (sale: any) => {
  const status = sale?.payment_status || getSalePaymentStatus(sale);
  if (status === 'cancelled') return 'Anulada';
  if (status === 'partial') return 'Pago parcial';
  if (status === 'paid') return 'Pagada';
  return 'Pendiente';
};

const getSalePaymentStatusClass = (sale: any) => {
  const status = sale?.payment_status || getSalePaymentStatus(sale);
  if (status === 'cancelled') return 'bg-red-100 text-red-700';
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
  const [accountFilters, setAccountFilters] = useState({ dateFrom: '', dateTo: '', status: 'all' as 'all' | 'pending' | 'partial' | 'paid' | 'cancelled' });
  const [portalError, setPortalError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'submit-order' | 'cancel-order';
    order?: PortalOrder;
  } | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

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

  const loadPortalData = async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setPortalError('');

    try {
      const [meRes, productsRes, ordersRes, movementsRes] = await Promise.all([
        portalFetch('/api/clientes?endpoint=portal-me'),
        portalFetch('/api/clientes?endpoint=portal-products'),
        portalFetch('/api/clientes?endpoint=portal-orders'),
        portalFetch('/api/clientes?endpoint=portal-movements'),
      ]);

      if (!meRes.ok) {
        localStorage.removeItem('customer_portal_token');
        setToken('');
        setCustomer(null);
        throw new Error('La sesión del portal venció. Ingresá nuevamente.');
      }

      const responses = [productsRes, ordersRes, movementsRes];
      if (responses.some((response) => !response.ok)) {
        throw new Error('No se pudieron cargar todos los datos del portal.');
      }

      const meBody = await meRes.json();
      const productsBody = await productsRes.json();
      const ordersBody = await ordersRes.json();
      const movementsBody = await movementsRes.json();

      setCustomer(unwrapResponse(meBody));
      setProducts(unwrapResponse(productsBody));
      setOrders(unwrapResponse(ordersBody));
      setMovements(unwrapResponse(movementsBody));
    } catch (error: any) {
      console.error('Error portal cliente:', error);
      if (localStorage.getItem('customer_portal_token')) {
        setPortalError(error?.message || 'No se pudieron cargar los datos del portal.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (token) loadPortalData('initial');
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

  const submitOrder = () => {
    if (cart.length === 0 || submittingOrder) return;
    setConfirmAction({ type: 'submit-order' });
  };

  const confirmSubmitOrder = async () => {
    if (cart.length === 0) return;

    setSubmittingOrder(true);
    setConfirmAction(null);
    setFeedback(null);

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
      setMobileCartOpen(false);
      setActiveTab('pedidos');
      await loadPortalData('refresh');
      setFeedback({
        type: 'success',
        message: 'Pedido enviado correctamente. Quedó pendiente de aprobación.',
      });
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error?.message || 'No se pudo enviar el pedido.',
      });
    } finally {
      setSubmittingOrder(false);
    }
  };

  const cancelOrder = (order: PortalOrder) => {
    if (actionLoading !== null) return;
    setCancelReason('');
    setConfirmAction({ type: 'cancel-order', order });
  };

  const confirmCancelOrder = async () => {
    const order = confirmAction?.order;
    if (!order) return;

    const reason = cancelReason.trim();
    if (reason.length < 3) {
      setFeedback({
        type: 'error',
        message: 'Ingresá un motivo de cancelación de al menos 3 caracteres.',
      });
      return;
    }

    setActionLoading(order.id);
    setConfirmAction(null);
    setFeedback(null);

    try {
      const response = await portalFetch(
        `/api/clientes?endpoint=portal-order-cancel&id=${order.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ motivo: reason }),
        }
      );
      const body = await response.json();
      unwrapResponse(body);

      await loadPortalData('refresh');
      setCancelReason('');
      setFeedback({
        type: 'success',
        message: `El pedido #${order.numero_pedido} fue cancelado correctamente.`,
      });
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error?.message || 'No se pudo cancelar el pedido.',
      });
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
    setFeedback(null);

    try {
      const response = await portalFetch(
        `/api/clientes?endpoint=portal-sale-detail&id=${saleId}`
      );
      const body = await response.json();
      const sale = unwrapResponse(body);
      generateSaleReceipt(sale);
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: error?.message || 'No se pudo descargar el comprobante de venta.',
      });
    } finally {
      setDownloadingSaleId(null);
    }
  };

  const cartUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  const cartContent = (
    <div className="space-y-4">
      {cart.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
          <ShoppingCart className="mx-auto mb-3 text-slate-300" size={36} />
          <p className="font-bold text-slate-600">Tu carrito está vacío</p>
          <p className="mt-1 text-sm text-slate-400">
            Agregá productos para preparar un pedido.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {cart.map((item) => (
              <article
                key={item.product.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-black text-slate-900">
                      {item.product.name}
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {formatCurrency(item.product.sale_price)} por unidad
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromCart(item.product.id)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 transition hover:bg-red-100"
                    aria-label={`Quitar ${item.product.name} del carrito`}
                    title="Quitar producto"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>

                <div className="mt-4 flex flex-col gap-3 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between">
                  <div className="grid grid-cols-[44px_64px_44px] items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateCartQty(item.product.id, item.quantity - 1)}
                      className="flex h-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                      aria-label={`Restar una unidad de ${item.product.name}`}
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(event) =>
                        updateCartQty(item.product.id, Number(event.target.value))
                      }
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white text-center font-black text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      aria-label={`Cantidad de ${item.product.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => updateCartQty(item.product.id, item.quantity + 1)}
                      className="flex h-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                      aria-label={`Sumar una unidad de ${item.product.name}`}
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  <p className="break-words text-left text-base font-black text-slate-900 min-[380px]:text-right">
                    {formatCurrency(item.quantity * item.product.sale_price)}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-lg shadow-slate-900/10">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  Total del pedido
                </p>
                <p className="mt-1 text-sm font-bold text-slate-300">
                  {cartUnits} {cartUnits === 1 ? 'unidad' : 'unidades'}
                </p>
              </div>
              <p className="break-words text-right text-xl font-black">
                {formatCurrency(cartTotal)}
              </p>
            </div>

            <button
              type="button"
              disabled={submittingOrder}
              onClick={submitOrder}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submittingOrder ? (
                <Loader2 size={19} className="animate-spin" />
              ) : (
                <CheckCircle2 size={19} />
              )}
              Confirmar pedido
            </button>
          </div>
        </>
      )}
    </div>
  );

  if (!token) {
    return (
      <div className="min-h-[100dvh] overflow-hidden bg-slate-950">
        <div className="mx-auto grid min-h-[100dvh] max-w-7xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.32),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.22),_transparent_40%)]" />
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                <Store size={28} />
              </div>
              <p className="mt-8 text-xs font-black uppercase tracking-[0.28em] text-indigo-200">
                Edugestión
              </p>
              <h1 className="mt-4 max-w-xl text-4xl font-black leading-tight xl:text-5xl">
                Tus pedidos y movimientos, en un solo lugar.
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
                Consultá el catálogo, armá pedidos, seguí cada estado y descargá
                comprobantes desde cualquier dispositivo.
              </p>
            </div>

            <div className="relative grid gap-3 sm:grid-cols-3">
              {[
                { icon: ShoppingBag, label: 'Catálogo actualizado' },
                { icon: Truck, label: 'Seguimiento de pedidos' },
                { icon: ShieldCheck, label: 'Acceso seguro' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
                >
                  <item.icon size={20} className="text-emerald-300" />
                  <p className="mt-3 text-sm font-bold text-slate-100">{item.label}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-8 sm:px-8">
            <div className="w-full max-w-md">
              <div className="mb-6 flex items-center gap-3 lg:hidden">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
                  <Store size={24} />
                </div>
                <div>
                  <p className="font-black text-slate-950">Edugestión</p>
                  <p className="text-xs font-bold text-slate-500">Portal de clientes</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/10 sm:p-8">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                  <UserRound size={27} />
                </div>

                <h2 className="mt-6 text-2xl font-black text-slate-950">
                  Ingresá a tu cuenta
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Usá el usuario y la contraseña proporcionados por la empresa.
                </p>

                {loginError && (
                  <div
                    className="mt-5 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"
                    role="alert"
                  >
                    <AlertCircle className="mt-0.5 shrink-0" size={18} />
                    <span className="break-words">{loginError}</span>
                  </div>
                )}

                <form onSubmit={handleLogin} className="mt-6 space-y-5">
                  <div>
                    <label
                      htmlFor="portal-username"
                      className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500"
                    >
                      Usuario
                    </label>
                    <input
                      id="portal-username"
                      required
                      autoComplete="username"
                      value={loginForm.username}
                      onChange={(event) =>
                        setLoginForm({ ...loginForm, username: event.target.value })
                      }
                      className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      placeholder="Ingresá tu usuario"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="portal-password"
                      className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500"
                    >
                      Contraseña
                    </label>
                    <input
                      id="portal-password"
                      required
                      type="password"
                      autoComplete="current-password"
                      value={loginForm.password}
                      onChange={(event) =>
                        setLoginForm({ ...loginForm, password: event.target.value })
                      }
                      className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      placeholder="Ingresá tu contraseña"
                    />
                  </div>

                  <button
                    disabled={loginLoading}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loginLoading ? (
                      <Loader2 size={19} className="animate-spin" />
                    ) : (
                      <LogIn size={19} />
                    )}
                    {loginLoading ? 'Ingresando…' : 'Entrar al portal'}
                  </button>
                </form>

                {onBackToAdmin && (
                  <button
                    type="button"
                    onClick={onBackToAdmin}
                    className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    <ArrowLeft size={17} />
                    Volver al acceso administrativo
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (loading || !customer) {
    return (
      <div className="min-h-[100dvh] bg-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-5">
            <div className="h-24 rounded-3xl bg-white" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="h-24 rounded-2xl bg-white" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div key={item} className="h-48 rounded-3xl bg-white" />
              ))}
            </div>
          </div>
          <div className="fixed inset-x-0 bottom-8 flex justify-center px-4">
            <div className="flex items-center gap-3 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-xl">
              <Loader2 size={18} className="animate-spin" />
              Cargando portal…
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'catalogo' as const, label: 'Productos', icon: Package },
    { id: 'pedidos' as const, label: 'Pedidos', icon: History },
    { id: 'cuenta' as const, label: 'Cuenta', icon: Wallet },
  ];

  return (
    <div className="custom-scrollbar h-[100dvh] overflow-y-auto overscroll-y-contain bg-slate-100 text-slate-900 [scrollbar-gutter:stable] [webkit-overflow-scrolling:touch]">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
                <Store size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">
                  Portal de clientes
                </p>
                <h1 className="truncate text-base font-black text-slate-950 sm:text-lg">
                  {customer.razon_social || customer.nombre_apellido}
                </h1>
                {customer.razon_social && (
                  <p className="truncate text-xs font-bold text-slate-500">
                    {customer.nombre_apellido}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => loadPortalData('refresh')}
                disabled={refreshing}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 sm:w-auto sm:px-3"
                title="Actualizar datos"
                aria-label="Actualizar datos del portal"
              >
                <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
                <span className="ml-2 hidden text-xs font-black sm:inline">Actualizar</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600 transition hover:bg-red-100 sm:w-auto sm:px-3"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                <LogOut size={17} />
                <span className="ml-2 hidden text-xs font-black sm:inline">Salir</span>
              </button>
            </div>
          </div>

          <nav className="mt-3 grid grid-cols-3 gap-2" aria-label="Secciones del portal">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-2xl px-2 text-xs font-black transition sm:text-sm ${
                  activeTab === tab.id
                    ? 'bg-slate-950 text-white shadow-lg shadow-slate-900/10'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
                }`}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <tab.icon size={17} className="shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className={`mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 ${
        activeTab === 'catalogo' && cart.length > 0 ? 'pb-28 xl:pb-8' : 'pb-8'
      }`}>
        {portalError && (
          <div
            className="mb-5 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <div className="flex min-w-0 gap-3">
              <AlertCircle size={19} className="mt-0.5 shrink-0" />
              <p className="break-words text-sm font-bold">{portalError}</p>
            </div>
            <button
              type="button"
              onClick={() => loadPortalData('refresh')}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-black text-white"
            >
              <RotateCcw size={17} />
              Reintentar
            </button>
          </div>
        )}

        {feedback && (
          <div
            className={`mb-5 flex min-w-0 items-start justify-between gap-3 rounded-2xl border p-4 ${
              feedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
            role="status"
          >
            <div className="flex min-w-0 gap-3">
              {feedback.type === 'success' ? (
                <CheckCircle2 size={19} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={19} className="mt-0.5 shrink-0" />
              )}
              <p className="break-words text-sm font-bold">{feedback.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70"
              aria-label="Cerrar mensaje"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {[
            {
              label: 'Por aprobar',
              value: portalSummary.pendingApproval,
              className: 'border-amber-200 bg-amber-50 text-amber-700',
            },
            {
              label: 'Esperando stock',
              value: portalSummary.waitingStock,
              className: 'border-orange-200 bg-orange-50 text-orange-700',
            },
            {
              label: 'Listos',
              value: portalSummary.approved,
              className: 'border-blue-200 bg-blue-50 text-blue-700',
            },
            {
              label: 'Entregados',
              value: portalSummary.delivered,
              className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
            },
          ].map((item) => (
            <article
              key={item.label}
              className={`min-w-0 rounded-2xl border p-4 ${item.className}`}
            >
              <p className="break-words text-[10px] font-black uppercase tracking-[0.12em] opacity-75">
                {item.label}
              </p>
              <p className="mt-2 text-2xl font-black">{item.value}</p>
            </article>
          ))}
          <article className="col-span-2 min-w-0 rounded-2xl bg-slate-950 p-4 text-white sm:col-span-1">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
              Saldo pendiente
            </p>
            <p className="mt-2 break-words text-xl font-black">
              {formatCurrency(customer.saldo_cta_cte || 0)}
            </p>
          </article>
        </section>

        {activeTab === 'catalogo' && (
          <section className="mt-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
                  Catálogo
                </p>
                <h2 className="mt-1 text-2xl font-black text-slate-950">
                  Elegí tus productos
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {filteredProducts.length} {filteredProducts.length === 1 ? 'producto visible' : 'productos visibles'}
                </p>
              </div>
              <div className="relative w-full sm:max-w-md">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por nombre, código o familia"
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
              </div>
            </div>

            <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_390px] xl:items-start xl:gap-6">
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {filteredProducts.map((product) => {
                  const cartItem = cart.find((item) => item.product.id === product.id);

                  return (
                    <article
                      key={product.id}
                      className="flex min-w-0 flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-all text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                            {product.code || 'Sin código'}
                          </p>
                          <h3 className="mt-2 break-words text-base font-black leading-snug text-slate-950">
                            {product.name}
                          </h3>
                        </div>
                        {cartItem && (
                          <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-black text-indigo-700">
                            {cartItem.quantity} en carrito
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {product.family_name && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">
                            {product.family_name}
                          </span>
                        )}
                        {product.category_name && (
                          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black text-indigo-600">
                            {product.category_name}
                          </span>
                        )}
                      </div>

                      {product.description && (
                        <p className="mt-3 line-clamp-3 break-words text-sm leading-6 text-slate-500">
                          {product.description}
                        </p>
                      )}

                      <div className="mt-auto pt-5">
                        <p className="break-words text-xl font-black text-emerald-700">
                          {formatCurrency(product.sale_price)}
                        </p>
                        <button
                          type="button"
                          onClick={() => addToCart(product)}
                          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-indigo-700"
                        >
                          <Plus size={18} />
                          Agregar al carrito
                        </button>
                      </div>
                    </article>
                  );
                })}

                {filteredProducts.length === 0 && (
                  <div className="sm:col-span-2 2xl:col-span-3 rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
                    <Package className="mx-auto text-slate-300" size={42} />
                    <p className="mt-4 font-black text-slate-700">No encontramos productos</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Probá con otro nombre, código, familia o categoría.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="mt-5 min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700"
                    >
                      Limpiar búsqueda
                    </button>
                  </div>
                )}
              </div>

              <aside className="sticky top-40 hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 xl:block">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <ShoppingCart size={20} />
                      Carrito
                    </h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {cartUnits} {cartUnits === 1 ? 'unidad' : 'unidades'}
                    </p>
                  </div>
                </div>
                {cartContent}
              </aside>
            </div>
          </section>
        )}

        {activeTab === 'pedidos' && (
          <section className="mt-6">
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
                Seguimiento
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-950">Mis pedidos</h2>
              <p className="mt-1 text-sm text-slate-500">
                Revisá productos, estados, descuentos y comprobantes.
              </p>
            </div>

            <div className="space-y-4">
              {orders.map((order) => {
                const timeline = buildOrderTimeline(order);
                const pending = Number(order.sale_monto_pendiente || 0);
                const paid = Number(order.sale_monto_pagado || 0);

                return (
                  <article
                    key={order.id}
                    className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
                  >
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                          Pedido #{order.numero_pedido}
                        </p>
                        <h3 className="mt-1 text-lg font-black text-slate-950">
                          {formatDate(order.fecha)}
                        </h3>
                      </div>
                      <span
                        className={`w-fit max-w-full rounded-full border px-3 py-1.5 text-[10px] font-black uppercase ${getStatusClass(
                          order
                        )}`}
                      >
                        {getStatusLabel(order)}
                      </span>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {(order.items || []).map((item: any, index: number) => (
                        <div
                          key={`${order.id}-${item.id || item.product_id || index}`}
                          className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <p className="break-words text-sm font-black text-slate-900">
                            {item.product_name || item.nombre_producto || item.name || 'Producto'}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
                            <span>{Number(item.cantidad || item.quantity || 0)} unidades</span>
                            <span className="break-words text-right text-slate-900">
                              {formatCurrency(item.importe || item.subtotal || 0)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black uppercase text-slate-400">Subtotal</p>
                        <p className="mt-1 break-words font-black text-slate-900">
                          {formatCurrency(order.subtotal)}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-amber-50 p-3">
                        <p className="text-[10px] font-black uppercase text-amber-600">Descuento</p>
                        <p className="mt-1 break-words font-black text-amber-700">
                          -{formatCurrency(order.descuento_monto)}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-950 p-3 text-white">
                        <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
                        <p className="mt-1 break-words font-black">{formatCurrency(order.total_final)}</p>
                      </div>
                      {order.estado === 'entregado' ? (
                        <div className={`rounded-2xl p-3 ${pending > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                          <p className={`text-[10px] font-black uppercase ${pending > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                            {pending > 0 ? 'Saldo pendiente' : 'Estado de pago'}
                          </p>
                          <p className={`mt-1 break-words font-black ${pending > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                            {pending > 0 ? formatCurrency(pending) : 'Pagado'}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-indigo-50 p-3">
                          <p className="text-[10px] font-black uppercase text-indigo-500">Productos</p>
                          <p className="mt-1 font-black text-indigo-700">{order.items?.length || 0}</p>
                        </div>
                      )}
                    </div>

                    {order.estado === 'entregado' && paid > 0 && (
                      <p className="mt-3 text-xs font-bold text-emerald-700">
                        Total cobrado: {formatCurrency(paid)}
                      </p>
                    )}

                    <div className="mt-5">
                      <p className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                        Seguimiento
                      </p>
                      <div className="grid gap-2 min-[420px]:grid-cols-2 lg:grid-cols-4">
                        {timeline.map((step, index) => (
                          <div
                            key={`${order.id}-${index}`}
                            className={`rounded-2xl border p-3 ${
                              step.danger
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : step.done
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-50 text-slate-400'
                            }`}
                          >
                            <div className="flex min-w-0 items-start gap-2">
                              {step.done ? (
                                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                              ) : (
                                <Clock size={16} className="mt-0.5 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="break-words text-[10px] font-black uppercase">
                                  {step.label}
                                </p>
                                {step.date && (
                                  <p className="mt-1 text-[10px] font-bold">
                                    {formatDate(step.date)}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {order.admin_notes && (
                      <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-700">
                        Observación: {order.admin_notes}
                      </div>
                    )}
                    {order.rejection_reason && (
                      <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                        Motivo de rechazo: {order.rejection_reason}
                      </div>
                    )}
                    {order.cancel_reason && (
                      <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                        <p>Pedido cancelado: {order.cancel_reason}</p>
                        {order.cancelled_at && (
                          <p className="mt-1 text-xs text-red-500">
                            {formatBusinessDateTime(order.cancelled_at)}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
                      <button
                        type="button"
                        onClick={() => downloadOrderPdf(order)}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-200"
                      >
                        <Download size={17} />
                        PDF del pedido
                      </button>

                      {order.sale_id && (
                        <button
                          type="button"
                          disabled={downloadingSaleId === order.sale_id}
                          onClick={() => downloadSalePdf(Number(order.sale_id))}
                          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-black text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {downloadingSaleId === order.sale_id ? (
                            <Loader2 size={17} className="animate-spin" />
                          ) : (
                            <ReceiptText size={17} />
                          )}
                          PDF de la venta
                        </button>
                      )}

                      {order.estado === 'pendiente_aprobacion' && (
                        <button
                          type="button"
                          disabled={actionLoading === order.id}
                          onClick={() => cancelOrder(order)}
                          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          {actionLoading === order.id ? (
                            <Loader2 size={17} className="animate-spin" />
                          ) : (
                            <XCircle size={17} />
                          )}
                          Cancelar pedido
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}

              {orders.length === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
                  <History className="mx-auto text-slate-300" size={44} />
                  <p className="mt-4 font-black text-slate-700">Todavía no realizaste pedidos</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Elegí productos del catálogo y armá tu primer pedido.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('catalogo')}
                    className="mt-5 min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-black text-white"
                  >
                    Ir al catálogo
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'cuenta' && (
          <section className="mt-6 space-y-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
                Cuenta corriente
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-950">
                Ventas y pagos
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Filtrá operaciones y descargá tus comprobantes.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <Filter size={20} />
                    Filtros
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Seleccioná período y estado de pago.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetAccountFilters}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700"
                >
                  <RotateCcw size={17} />
                  Limpiar filtros
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                    Desde
                  </label>
                  <input
                    type="date"
                    value={accountFilters.dateFrom}
                    onChange={(event) =>
                      setAccountFilters({ ...accountFilters, dateFrom: event.target.value })
                    }
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                    Hasta
                  </label>
                  <input
                    type="date"
                    value={accountFilters.dateTo}
                    onChange={(event) =>
                      setAccountFilters({ ...accountFilters, dateTo: event.target.value })
                    }
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                    Estado
                  </label>
                  <select
                    value={accountFilters.status}
                    onChange={(event) =>
                      setAccountFilters({
                        ...accountFilters,
                        status: event.target.value as 'all' | 'pending' | 'partial' | 'paid' | 'cancelled',
                      })
                    }
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  >
                    <option value="all">Todos los movimientos</option>
                    <option value="pending">Pendientes de pago</option>
                    <option value="partial">Pagos parciales</option>
                    <option value="paid">Pagados</option>
                    <option value="cancelled">Anuladas</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                {
                  label: 'Ventas visibles',
                  value: String(filteredAccountSales.length),
                  className: 'bg-white text-slate-900',
                },
                {
                  label: 'Pendiente visible',
                  value: formatCurrency(
                    filteredAccountSales.reduce(
                      (sum: number, sale: any) =>
                        sum + Number(sale.monto_pendiente || 0),
                      0
                    )
                  ),
                  className: 'bg-red-50 text-red-700',
                },
                {
                  label: 'Pagado visible',
                  value: formatCurrency(
                    filteredAccountSales.reduce(
                      (sum: number, sale: any) =>
                        sum + Number(sale.monto_pagado || 0),
                      0
                    )
                  ),
                  className: 'bg-emerald-50 text-emerald-700',
                },
                {
                  label: 'Pagos visibles',
                  value: String(filteredAccountMovements.length),
                  className: 'bg-indigo-50 text-indigo-700',
                },
              ].map((item) => (
                <article
                  key={item.label}
                  className={`min-w-0 rounded-2xl border border-slate-200 p-4 ${item.className}`}
                >
                  <p className="break-words text-[10px] font-black uppercase tracking-[0.12em] opacity-70">
                    {item.label}
                  </p>
                  <p className="mt-2 break-words text-lg font-black">{item.value}</p>
                </article>
              ))}
            </div>

            <div className="grid gap-5 2xl:grid-cols-2">
              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                  <ReceiptText size={20} />
                  Ventas
                </h3>

                <div className="mt-4 space-y-3">
                  {filteredAccountSales.map((sale: any) => (
                    <article
                      key={sale.id}
                      className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex min-w-0 flex-col gap-3 min-[460px]:flex-row min-[460px]:items-start min-[460px]:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="break-words font-black text-slate-950">
                              Venta #{sale.numero_venta}
                            </p>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${getSalePaymentStatusClass(
                                sale
                              )}`}
                            >
                              {getSalePaymentStatusLabel(sale)}
                            </span>
                          </div>
                          <p className="mt-2 break-words text-xs font-bold text-slate-500">
                            {formatDate(sale.fecha)} · {sale.metodo_pago || sale.estado}
                            {sale.numero_pedido ? ` · Pedido #${sale.numero_pedido}` : ''}
                          </p>
                          {Number(sale.descuento_total || 0) > 0 && (
                            <p className="mt-2 text-xs font-bold text-amber-700">
                              Descuento: {formatCurrency(sale.descuento_total)}
                            </p>
                          )}
                          {String(sale.estado || '').toLowerCase() === 'anulada' && (
                            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
                              <p>Venta anulada{sale.anulada_at ? ` el ${formatDate(sale.anulada_at)}` : ''}.</p>
                              {sale.anulacion_motivo && <p className="mt-1">Motivo: {sale.anulacion_motivo}</p>}
                            </div>
                          )}
                        </div>

                        <div className="flex min-w-0 items-center justify-between gap-3 min-[460px]:justify-end">
                          <div className="min-w-0 min-[460px]:text-right">
                            <p className="break-words font-black text-slate-950">
                              {formatCurrency(sale.total)}
                            </p>
                            {getSalePaymentStatus(sale) === 'cancelled' ? (
                              <p className="mt-1 text-xs font-bold text-red-700">Anulada</p>
                            ) : getSalePaymentStatus(sale) === 'paid' ? (
                              <p className="mt-1 text-xs font-bold text-emerald-700">
                                Pagada · {formatCurrency(sale.monto_pagado)}
                              </p>
                            ) : getSalePaymentStatus(sale) === 'partial' ? (
                              <p className="mt-1 text-xs font-bold text-amber-700">
                                Falta {formatCurrency(sale.monto_pendiente)}
                              </p>
                            ) : (
                              <p className="mt-1 text-xs font-bold text-red-700">
                                Pendiente {formatCurrency(sale.monto_pendiente)}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={downloadingSaleId === sale.id}
                            onClick={() => downloadSalePdf(Number(sale.id))}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 disabled:opacity-50"
                            title="Descargar comprobante de venta"
                            aria-label={`Descargar comprobante de venta ${sale.numero_venta}`}
                          >
                            {downloadingSaleId === sale.id ? (
                              <Loader2 size={17} className="animate-spin" />
                            ) : (
                              <Download size={17} />
                            )}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}

                  {filteredAccountSales.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center">
                      <ReceiptText className="mx-auto text-slate-300" size={34} />
                      <p className="mt-3 text-sm font-bold text-slate-500">
                        No hay ventas para los filtros seleccionados.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                  <CircleDollarSign size={20} />
                  Pagos y movimientos
                </h3>

                {(accountFilters.status === 'pending' ||
                  accountFilters.status === 'partial') && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
                    Este filtro muestra ventas con ese estado. Los comprobantes de pago
                    aparecen al elegir “Todos” o “Pagados”.
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  {filteredAccountMovements.map((movement: any) => (
                    <article
                      key={movement.id}
                      className={`min-w-0 rounded-2xl border p-4 ${String(movement.estado || 'Activo').toLowerCase() === 'anulado' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}
                    >
                      <div className="flex min-w-0 flex-col gap-3 min-[460px]:flex-row min-[460px]:items-start min-[460px]:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`break-words font-black ${String(movement.estado || 'Activo').toLowerCase() === 'anulado' ? 'text-red-900 line-through' : 'text-slate-950'}`}>
                              {movement.descripcion}
                            </p>
                            {String(movement.estado || 'Activo').toLowerCase() === 'anulado' && (
                              <span className="rounded-full border border-red-200 bg-red-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-red-700">Anulado</span>
                            )}
                          </div>
                          <p className="mt-2 break-words text-xs font-bold leading-5 text-slate-500">
                            {formatDate(movement.fecha)} ·{' '}
                            {movement.forma_pago || movement.origen}
                            {movement.numero_pago
                              ? ` · Recibo #${movement.numero_pago}`
                              : ''}
                            {movement.numero_venta
                              ? ` · Venta #${movement.numero_venta}`
                              : ''}
                            {movement.numero_pedido
                              ? ` · Pedido #${movement.numero_pedido}`
                              : ''}
                          </p>
                          {String(movement.estado || 'Activo').toLowerCase() === 'anulado' && movement.anulacion_motivo && (
                            <p className="mt-2 break-words text-xs font-bold text-red-700">Motivo: {movement.anulacion_motivo}</p>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 min-[460px]:justify-end">
                          <p
                            className={`break-words font-black ${
                              String(movement.estado || 'Activo').toLowerCase() === 'anulado'
                                ? 'text-red-500 line-through'
                                : movement.tipo === 'ingreso'
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                            }`}
                          >
                            {movement.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(movement.monto)}
                          </p>
                          {movement.tipo === 'ingreso' && String(movement.estado || 'Activo').toLowerCase() !== 'anulado' && (
                            <button
                              type="button"
                              onClick={() =>
                                generatePaymentReceiptPdf(
                                  movement,
                                  customer.nombre_apellido
                                )
                              }
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700"
                              title="Descargar comprobante de pago"
                              aria-label="Descargar comprobante de pago"
                            >
                              <Download size={17} />
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}

                  {filteredAccountMovements.length === 0 &&
                    accountFilters.status !== 'pending' &&
                    accountFilters.status !== 'partial' && (
                      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center">
                        <CircleDollarSign className="mx-auto text-slate-300" size={34} />
                        <p className="mt-3 text-sm font-bold text-slate-500">
                          No hay movimientos para los filtros seleccionados.
                        </p>
                      </div>
                    )}
                </div>
              </section>
            </div>
          </section>
        )}
      </main>

      {activeTab === 'catalogo' && cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur xl:hidden">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileCartOpen(true)}
              className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl bg-slate-950 px-4 text-white"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ShoppingCart size={19} className="shrink-0" />
                <span className="truncate text-sm font-black">
                  Ver carrito · {cartUnits} {cartUnits === 1 ? 'unidad' : 'unidades'}
                </span>
              </span>
              <span className="shrink-0 text-sm font-black">{formatCurrency(cartTotal)}</span>
            </button>
          </div>
        </div>
      )}

      {mobileCartOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/55 backdrop-blur-sm xl:hidden">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setMobileCartOpen(false)}
            aria-label="Cerrar carrito"
          />
          <section className="relative max-h-[92dvh] w-full overflow-hidden rounded-t-[30px] bg-slate-50 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">Tu carrito</h2>
                <p className="text-xs font-bold text-slate-500">
                  {cartUnits} {cartUnits === 1 ? 'unidad' : 'unidades'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileCartOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Cerrar carrito"
              >
                <X size={19} />
              </button>
            </div>
            <div className="max-h-[calc(92dvh-77px)] overflow-y-auto p-4">
              {cartContent}
            </div>
          </section>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => {
              if (!submittingOrder && actionLoading === null) {
                setConfirmAction(null);
                setCancelReason('');
              }
            }}
            aria-label="Cerrar confirmación"
          />
          <section className="relative w-full rounded-t-[30px] bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                confirmAction.type === 'submit-order'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {confirmAction.type === 'submit-order' ? (
                <ShoppingBag size={23} />
              ) : (
                <XCircle size={23} />
              )}
            </div>

            <h2 className="mt-5 text-xl font-black text-slate-950">
              {confirmAction.type === 'submit-order'
                ? '¿Confirmar este pedido?'
                : `¿Cancelar el pedido #${confirmAction.order?.numero_pedido}?`}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {confirmAction.type === 'submit-order'
                ? `Se enviarán ${cartUnits} ${
                    cartUnits === 1 ? 'unidad' : 'unidades'
                  } por un total de ${formatCurrency(cartTotal)} para aprobación.`
                : 'Solo podés cancelar el pedido mientras está pendiente de aprobación.'}
            </p>

            {confirmAction.type === 'cancel-order' && (
              <div className="mt-5">
                <label htmlFor="portal-order-cancel-reason" className="text-xs font-black uppercase tracking-widest text-slate-500">
                  Motivo obligatorio
                </label>
                <textarea
                  id="portal-order-cancel-reason"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  maxLength={500}
                  className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-900 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
                  placeholder="Ej.: Ya no necesito estos productos"
                  autoFocus
                />
                <p className="mt-1 text-right text-[11px] font-bold text-slate-400">
                  {cancelReason.trim().length}/500
                </p>
              </div>
            )}

            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={submittingOrder || actionLoading !== null}
                onClick={() => {
                  setConfirmAction(null);
                  setCancelReason('');
                }}
                className="min-h-12 rounded-2xl bg-slate-100 px-4 text-sm font-black text-slate-700 disabled:opacity-50"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={
                  submittingOrder ||
                  actionLoading !== null ||
                  (confirmAction.type === 'cancel-order' && cancelReason.trim().length < 3)
                }
                onClick={
                  confirmAction.type === 'submit-order'
                    ? confirmSubmitOrder
                    : confirmCancelOrder
                }
                className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black text-white disabled:opacity-50 ${
                  confirmAction.type === 'submit-order'
                    ? 'bg-emerald-600'
                    : 'bg-red-600'
                }`}
              >
                {(submittingOrder || actionLoading !== null) && (
                  <Loader2 size={17} className="animate-spin" />
                )}
                {confirmAction.type === 'submit-order'
                  ? 'Enviar pedido'
                  : 'Cancelar pedido'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
