import React, { useEffect, useMemo, useState } from 'react';
import { LogIn, Package, ShoppingCart, Plus, Minus, Trash2, CheckCircle2, Clock, XCircle, History, Wallet, LogOut, AlertCircle, Loader2 } from 'lucide-react';
import { unwrapResponse } from '../utils/api';

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
  subtotal: number;
  descuento_tipo: string;
  descuento_valor: number;
  descuento_monto: number;
  total_final: number;
  sale_id?: number | null;
  admin_notes?: string;
  rejection_reason?: string;
  cancel_reason?: string;
  items: any[];
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
  `$${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pendiente_aprobacion': return 'Pendiente de aprobación';
    case 'aprobado_pendiente_entrega': return 'Aprobado - pendiente de entrega';
    case 'entregado': return 'Entregado';
    case 'rechazado': return 'Rechazado';
    case 'cancelado': return 'Cancelado';
    default: return status || 'Pendiente';
  }
};

const getStatusClass = (status: string) => {
  switch (status) {
    case 'pendiente_aprobacion': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'aprobado_pendiente_entrega': return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'entregado': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    case 'rechazado': return 'bg-red-50 text-red-700 border-red-100';
    case 'cancelado': return 'bg-zinc-100 text-zinc-600 border-zinc-200';
    default: return 'bg-zinc-50 text-zinc-600 border-zinc-100';
  }
};

export default function CustomerPortal({ onBackToAdmin }: { onBackToAdmin?: () => void }) {
  const [token, setToken] = useState(() => localStorage.getItem('customer_portal_token') || '');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [products, setProducts] = useState<PortalProduct[]>([]);
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'catalogo' | 'pedidos' | 'cuenta'>('catalogo');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<{ product: PortalProduct; quantity: number }[]>([]);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return products;
    return products.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      (p.family_name || '').toLowerCase().includes(q) ||
      (p.category_name || '').toLowerCase().includes(q)
    );
  }, [products, searchTerm]);

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.quantity * Number(item.product.sale_price || 0), 0), [cart]);

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch('/api/clientes?endpoint=portal-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const body = await res.json();
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
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateCartQty = (productId: number, quantity: number) => {
    const safeQty = Math.max(1, Number(quantity || 1));
    setCart((prev) => prev.map((item) => item.product.id === productId ? { ...item, quantity: safeQty } : item));
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const submitOrder = async () => {
    if (cart.length === 0) return;
    if (!window.confirm('¿Confirmar pedido para aprobación del administrador?')) return;

    setSubmittingOrder(true);
    try {
      const res = await portalFetch('/api/clientes?endpoint=portal-orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((item) => ({ product_id: item.product.id, cantidad: item.quantity })),
        }),
      });
      const body = await res.json();
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
    if (!window.confirm('¿Cancelar este pedido? Solo se puede cancelar mientras está pendiente de aprobación.')) return;

    setActionLoading(order.id);
    try {
      const res = await portalFetch(`/api/clientes?endpoint=portal-order-cancel&id=${order.id}`, {
        method: 'POST',
        body: JSON.stringify({ motivo: 'Cancelado por el cliente' }),
      });
      const body = await res.json();
      unwrapResponse(body);
      await loadPortalData();
      alert('Pedido cancelado correctamente');
    } catch (error: any) {
      alert(error?.message || 'No se pudo cancelar el pedido');
    } finally {
      setActionLoading(null);
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
            <h1 className="text-2xl font-black text-zinc-900 text-center mb-2">Portal de Clientes</h1>
            <p className="text-sm text-zinc-500 text-center mb-8">Ingresá para ver productos, pedidos y cuenta corriente</p>

            {loginError && (
              <div className="mb-5 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex gap-2">
                <AlertCircle size={18} />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Usuario</label>
                <input
                  required
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 text-sm"
                  placeholder="cliente123"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Contraseña</label>
                <input
                  required
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 text-sm"
                  placeholder="••••••••"
                />
              </div>
              <button disabled={loginLoading} className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50">
                {loginLoading ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
                Entrar al Portal
              </button>
            </form>

            {onBackToAdmin && (
              <button onClick={onBackToAdmin} className="w-full mt-4 py-3 text-zinc-500 hover:text-zinc-900 text-xs font-bold uppercase tracking-widest">
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
            <h1 className="text-xl sm:text-2xl font-black text-zinc-900">Portal de Clientes</h1>
            <p className="text-xs sm:text-sm text-zinc-500 font-bold">{customer.nombre_apellido}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-3 py-2 rounded-xl bg-zinc-50 border border-zinc-100 text-xs font-black text-zinc-700">
              Saldo: {formatCurrency(customer.saldo_cta_cte || 0)}
            </div>
            <button onClick={logout} className="p-3 text-red-500 hover:bg-red-50 rounded-xl">
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
              className={`px-4 py-4 text-sm font-black border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === tab.id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-zinc-400'}`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl w-full mx-auto p-4 sm:p-6 flex-1">
        {activeTab === 'catalogo' && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
            <div className="space-y-4">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar producto..."
                className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-600/20"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProducts.map((product) => (
                  <div key={product.id} className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm flex flex-col gap-4">
                    <div className="flex-1">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{product.code || 'Producto'}</p>
                      <h3 className="font-black text-zinc-900 leading-tight mt-1">{product.name}</h3>
                      {product.description && <p className="text-xs text-zinc-500 mt-2 line-clamp-2">{product.description}</p>}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-lg font-black text-emerald-700 font-mono">{formatCurrency(product.sale_price)}</p>
                      <button onClick={() => addToCart(product)} className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase flex items-center gap-2">
                        <Plus size={16} /> Agregar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="bg-white rounded-3xl border border-zinc-200 shadow-xl p-5 h-fit sticky top-32">
              <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-4"><ShoppingCart size={20} /> Carrito</h2>
              {cart.length === 0 ? (
                <p className="text-sm text-zinc-400 py-8 text-center">Agregá productos para armar tu pedido.</p>
              ) : (
                <div className="space-y-4">
                  {cart.map((item) => (
                    <div key={item.product.id} className="border border-zinc-100 rounded-2xl p-3">
                      <div className="flex justify-between gap-3 mb-3">
                        <p className="text-sm font-black text-zinc-900">{item.product.name}</p>
                        <button onClick={() => removeFromCart(item.product.id)} className="text-red-500"><Trash2 size={16} /></button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button onClick={() => updateCartQty(item.product.id, item.quantity - 1)} className="p-2 bg-zinc-100 rounded-lg"><Minus size={14} /></button>
                          <input type="number" min="1" value={item.quantity} onChange={(e) => updateCartQty(item.product.id, Number(e.target.value))} className="w-16 text-center border border-zinc-200 rounded-lg py-2 font-bold" />
                          <button onClick={() => updateCartQty(item.product.id, item.quantity + 1)} className="p-2 bg-zinc-100 rounded-lg"><Plus size={14} /></button>
                        </div>
                        <p className="text-sm font-black font-mono">{formatCurrency(item.quantity * item.product.sale_price)}</p>
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-zinc-100 pt-4 flex justify-between items-center">
                    <span className="text-xs font-black text-zinc-400 uppercase">Total pedido</span>
                    <span className="text-xl font-black text-zinc-900 font-mono">{formatCurrency(cartTotal)}</span>
                  </div>
                  <button disabled={submittingOrder} onClick={submitOrder} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50">
                    {submittingOrder ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    Confirmar Pedido
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}

        {activeTab === 'pedidos' && (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.id} className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Pedido #{order.numero_pedido}</p>
                    <h3 className="font-black text-zinc-900">{new Date(order.fecha).toLocaleDateString('es-AR')}</h3>
                  </div>
                  <span className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase w-fit ${getStatusClass(order.estado)}`}>{getStatusLabel(order.estado)}</span>
                </div>
                <div className="space-y-2 mb-4">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3 text-sm border-b border-zinc-50 pb-2">
                      <span className="font-bold text-zinc-700">{item.product_name} x{item.cantidad}</span>
                      <span className="font-mono font-bold">{formatCurrency(item.importe)}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="bg-zinc-50 rounded-2xl p-3"><p className="text-[10px] font-black text-zinc-400 uppercase">Subtotal</p><p className="font-black font-mono">{formatCurrency(order.subtotal)}</p></div>
                  <div className="bg-zinc-50 rounded-2xl p-3"><p className="text-[10px] font-black text-zinc-400 uppercase">Descuento</p><p className="font-black font-mono text-red-600">-{formatCurrency(order.descuento_monto)}</p></div>
                  <div className="bg-zinc-900 text-white rounded-2xl p-3"><p className="text-[10px] font-black text-zinc-400 uppercase">Total final</p><p className="font-black font-mono">{formatCurrency(order.total_final)}</p></div>
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
                {order.estado === 'pendiente_aprobacion' && (
                  <button
                    disabled={actionLoading === order.id}
                    onClick={() => cancelOrder(order)}
                    className="mt-4 w-full sm:w-auto px-4 py-3 bg-red-50 text-red-600 border border-red-100 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <XCircle size={16} /> Cancelar pedido
                  </button>
                )}
              </div>
            ))}
            {orders.length === 0 && (
              <div className="bg-white rounded-3xl border border-zinc-200 p-12 text-center text-zinc-400">
                <Clock size={44} className="mx-auto mb-3 opacity-20" />
                <p className="font-bold">Todavía no realizaste pedidos.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'cuenta' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm">
              <h2 className="text-lg font-black mb-4">Ventas</h2>
              <div className="space-y-3">
                {(movements.sales || []).map((sale: any) => (
                  <div key={sale.id} className="border border-zinc-100 rounded-2xl p-3 flex justify-between gap-3">
                    <div>
                      <p className="font-black text-zinc-900">Venta #{sale.numero_venta}</p>
                      <p className="text-xs text-zinc-400">{new Date(sale.fecha).toLocaleDateString('es-AR')} · {sale.estado}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black font-mono">{formatCurrency(sale.total)}</p>
                      {sale.monto_pendiente > 0 && <p className="text-xs text-red-600 font-bold">Pendiente {formatCurrency(sale.monto_pendiente)}</p>}
                    </div>
                  </div>
                ))}
                {(movements.sales || []).length === 0 && <p className="text-sm text-zinc-400">Sin ventas registradas.</p>}
              </div>
            </div>
            <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm">
              <h2 className="text-lg font-black mb-4">Movimientos</h2>
              <div className="space-y-3">
                {(movements.movements || []).map((movement: any) => (
                  <div key={movement.id} className="border border-zinc-100 rounded-2xl p-3 flex justify-between gap-3">
                    <div>
                      <p className="font-black text-zinc-900">{movement.descripcion}</p>
                      <p className="text-xs text-zinc-400">{new Date(movement.fecha).toLocaleDateString('es-AR')} · {movement.forma_pago || movement.origen}</p>
                    </div>
                    <p className={`font-black font-mono ${movement.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(movement.monto)}</p>
                  </div>
                ))}
                {(movements.movements || []).length === 0 && <p className="text-sm text-zinc-400">Sin movimientos registrados.</p>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
