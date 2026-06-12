import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Package, RefreshCcw, Truck, Percent, AlertCircle } from 'lucide-react';
import { unwrapResponse, apiFetch } from '../utils/api';

const formatCurrency = (value: number) => `$${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pendiente_aprobacion': return 'Pendiente de aprobación';
    case 'aprobado_pendiente_entrega': return 'Aprobado - pendiente de entrega';
    case 'entregado': return 'Entregado';
    case 'rechazado': return 'Rechazado';
    default: return status || 'Pendiente';
  }
};

const getStatusClass = (status: string) => {
  switch (status) {
    case 'pendiente_aprobacion': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'aprobado_pendiente_entrega': return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'entregado': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    case 'rechazado': return 'bg-red-50 text-red-700 border-red-100';
    default: return 'bg-zinc-50 text-zinc-600 border-zinc-100';
  }
};

export default function CustomerOrdersAdmin({ onChanged }: { onChanged?: () => void }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [discounts, setDiscounts] = useState<Record<number, { tipo: 'none' | 'percentage' | 'fixed'; valor: string }>>({});

  const pendingCount = useMemo(() => orders.filter(o => o.estado === 'pendiente_aprobacion').length, [orders]);
  const approvedCount = useMemo(() => orders.filter(o => o.estado === 'aprobado_pendiente_entrega').length, [orders]);

  const fetchOrders = async () => {
    try {
      const res = await apiFetch('/api/sales?endpoint=customer-orders');
      const body = await res.json();
      const data = unwrapResponse(body);
      setOrders(data);
    } catch (error) {
      console.error('Error fetching customer orders:', error);
      alert('No se pudieron cargar los pedidos de clientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, []);

  const approveOrder = async (order: any) => {
    const discount = discounts[order.id] || { tipo: 'none', valor: '0' };
    setActionLoading(order.id);
    try {
      const res = await apiFetch(`/api/sales?endpoint=customer-order-approve&id=${order.id}`, {
        method: 'POST',
        body: JSON.stringify({
          descuento_tipo: discount.tipo,
          descuento_valor: Number(discount.valor || 0),
        }),
      });
      const body = await res.json();
      unwrapResponse(body);
      await fetchOrders();
      onChanged?.();
    } catch (error: any) {
      alert(error?.message || 'No se pudo aprobar el pedido');
    } finally {
      setActionLoading(null);
    }
  };

  const deliverOrder = async (order: any) => {
    if (!window.confirm('¿Marcar pedido como entregado y generar saldo en cuenta corriente del cliente?')) return;
    setActionLoading(order.id);
    try {
      const res = await apiFetch(`/api/sales?endpoint=customer-order-deliver&id=${order.id}`, { method: 'POST' });
      const body = await res.json();
      unwrapResponse(body);
      await fetchOrders();
      onChanged?.();
    } catch (error: any) {
      alert(error?.message || 'No se pudo entregar el pedido');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900" /></div>;
  }

  return (
    <div className="p-4 sm:p-8 h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">Pedidos de Clientes</h1>
            <p className="text-sm text-zinc-500 mt-1">Pedidos realizados desde el portal de clientes</p>
          </div>
          <button onClick={fetchOrders} className="px-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm font-black text-zinc-700 flex items-center gap-2 shadow-sm hover:bg-zinc-50">
            <RefreshCcw size={16} /> Actualizar
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm"><p className="text-[10px] font-black text-zinc-400 uppercase">Pendientes</p><p className="text-3xl font-black text-amber-600">{pendingCount}</p></div>
          <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm"><p className="text-[10px] font-black text-zinc-400 uppercase">Aprobados por entregar</p><p className="text-3xl font-black text-blue-600">{approvedCount}</p></div>
          <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm"><p className="text-[10px] font-black text-zinc-400 uppercase">Total pedidos</p><p className="text-3xl font-black text-zinc-900">{orders.length}</p></div>
        </div>

        <div className="space-y-4">
          {orders.map((order) => {
            const discount = discounts[order.id] || { tipo: order.descuento_tipo || 'none', valor: String(order.descuento_valor || 0) };
            return (
              <div key={order.id} className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-zinc-100 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Pedido #{order.numero_pedido}</p>
                      <span className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase ${getStatusClass(order.estado)}`}>{getStatusLabel(order.estado)}</span>
                    </div>
                    <h3 className="text-xl font-black text-zinc-900">{order.cliente}</h3>
                    <p className="text-xs text-zinc-400 font-bold">{new Date(order.fecha).toLocaleString('es-AR')}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 min-w-full lg:min-w-[360px]">
                    <div className="bg-zinc-50 rounded-2xl p-3"><p className="text-[9px] font-black text-zinc-400 uppercase">Subtotal</p><p className="font-black font-mono">{formatCurrency(order.subtotal)}</p></div>
                    <div className="bg-zinc-50 rounded-2xl p-3"><p className="text-[9px] font-black text-zinc-400 uppercase">Desc.</p><p className="font-black font-mono text-red-600">-{formatCurrency(order.descuento_monto)}</p></div>
                    <div className="bg-zinc-900 text-white rounded-2xl p-3"><p className="text-[9px] font-black text-zinc-400 uppercase">Total</p><p className="font-black font-mono">{formatCurrency(order.total_final)}</p></div>
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
                  <div className="space-y-2">
                    {order.items.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 p-3 bg-zinc-50 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-white border border-zinc-100 flex items-center justify-center text-zinc-400"><Package size={16} /></div>
                          <div>
                            <p className="text-sm font-black text-zinc-900">{item.product_name}</p>
                            <p className="text-[10px] text-zinc-400 font-bold">{item.cantidad} u. x {formatCurrency(item.precio_unitario)}</p>
                          </div>
                        </div>
                        <p className="text-sm font-black font-mono">{formatCurrency(item.importe)}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {order.estado === 'pendiente_aprobacion' && (
                      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-amber-700"><Percent size={16} /><p className="text-xs font-black uppercase tracking-widest">Descuento opcional</p></div>
                        <select value={discount.tipo} onChange={(e) => setDiscounts(prev => ({ ...prev, [order.id]: { ...discount, tipo: e.target.value as any } }))} className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold">
                          <option value="none">Sin descuento</option>
                          <option value="percentage">Porcentaje %</option>
                          <option value="fixed">Monto fijo $</option>
                        </select>
                        {discount.tipo !== 'none' && (
                          <input type="number" min="0" value={discount.valor} onChange={(e) => setDiscounts(prev => ({ ...prev, [order.id]: { ...discount, valor: e.target.value } }))} className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold" placeholder="Valor descuento" />
                        )}
                        <button disabled={actionLoading === order.id} onClick={() => approveOrder(order)} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50">
                          <CheckCircle2 size={16} /> Aprobar pedido
                        </button>
                      </div>
                    )}

                    {order.estado === 'aprobado_pendiente_entrega' && (
                      <button disabled={actionLoading === order.id} onClick={() => deliverOrder(order)} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50">
                        <Truck size={18} /> Pedido entregado
                      </button>
                    )}

                    {order.estado === 'entregado' && (
                      <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-2xl p-4 flex items-center gap-2 text-sm font-bold">
                        <CheckCircle2 size={18} /> Entregado y cargado en cuenta corriente
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {orders.length === 0 && (
            <div className="bg-white rounded-3xl border border-zinc-200 p-16 text-center text-zinc-400">
              <Clock size={52} className="mx-auto mb-4 opacity-20" />
              <p className="font-bold">No hay pedidos de clientes por el momento.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
