import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Package,
  RefreshCcw,
  Truck,
  Percent,
  AlertTriangle,
  XCircle,
  Edit3,
  Save,
  Trash2,
  Download,
  MessageCircle,
} from 'lucide-react';
import { unwrapResponse, apiFetch } from '../utils/api';
import { generateCustomerOrderPdf } from '../utils/customerOrderPdf';

const formatCurrency = (value: number) => `$${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

const normalizeWhatsAppPhone = (rawPhone: any) => {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('54')) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `549${digits}`;
  return digits;
};

export default function CustomerOrdersAdmin({ onChanged }: { onChanged?: () => void }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [discounts, setDiscounts] = useState<Record<number, { tipo: 'none' | 'percentage' | 'fixed'; valor: string }>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<number, string>>({});
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [draftItems, setDraftItems] = useState<Record<number, any[]>>({});

  const pendingCount = useMemo(() => orders.filter(o => o.estado === 'pendiente_aprobacion').length, [orders]);
  const approvedCount = useMemo(() => orders.filter(o => o.estado === 'aprobado_pendiente_entrega').length, [orders]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
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

  const getDiscount = (order: any) => discounts[order.id] || { tipo: order.descuento_tipo || 'none', valor: String(order.descuento_valor || 0) };
  const getDraft = (order: any) => draftItems[order.id] || order.items || [];

  const startEdit = (order: any) => {
    setEditingOrderId(order.id);
    setDraftItems(prev => ({ ...prev, [order.id]: order.items.map((item: any) => ({ ...item })) }));
    setDiscounts(prev => ({ ...prev, [order.id]: getDiscount(order) }));
    setAdminNotes(prev => ({ ...prev, [order.id]: order.admin_notes || '' }));
  };

  const updateDraftQty = (orderId: number, itemId: number, quantity: number) => {
    setDraftItems(prev => ({
      ...prev,
      [orderId]: (prev[orderId] || []).map((item: any) => item.id === itemId ? { ...item, cantidad: Math.max(1, Number(quantity || 1)) } : item),
    }));
  };

  const removeDraftItem = (orderId: number, itemId: number) => {
    setDraftItems(prev => ({
      ...prev,
      [orderId]: (prev[orderId] || []).filter((item: any) => item.id !== itemId),
    }));
  };

  const saveOrderChanges = async (order: any) => {
    const items = getDraft(order);
    if (!items.length) {
      alert('El pedido debe tener al menos un producto');
      return;
    }

    const discount = getDiscount(order);
    setActionLoading(order.id);
    try {
      const res = await apiFetch(`/api/sales?endpoint=customer-order-update&id=${order.id}`, {
        method: 'POST',
        body: JSON.stringify({
          items: items.map((item: any) => ({ product_id: Number(item.product_id), cantidad: Number(item.cantidad) })),
          descuento_tipo: discount.tipo,
          descuento_valor: Number(discount.valor || 0),
          admin_notes: adminNotes[order.id] || '',
        }),
      });
      const body = await res.json();
      unwrapResponse(body);
      setEditingOrderId(null);
      await fetchOrders();
      onChanged?.();
      alert('Pedido actualizado correctamente');
    } catch (error: any) {
      alert(error?.message || 'No se pudo editar el pedido');
    } finally {
      setActionLoading(null);
    }
  };

  const approveOrder = async (order: any) => {
    const discount = getDiscount(order);
    setActionLoading(order.id);
    try {
      const res = await apiFetch(`/api/sales?endpoint=customer-order-approve&id=${order.id}`, {
        method: 'POST',
        body: JSON.stringify({
          descuento_tipo: discount.tipo,
          descuento_valor: Number(discount.valor || 0),
          admin_notes: adminNotes[order.id] || order.admin_notes || '',
        }),
      });
      const body = await res.json();
      const data = unwrapResponse(body);

      if (data?.shortageItems?.length) {
        const detalle = data.shortageItems
          .map((item: any) => `- ${item.product_name}: faltan ${item.cantidad} u. (stock actual: ${item.stock_actual})`)
          .join('\n');
        alert(`Pedido aprobado. Hay productos sin stock y se generó/actualizó el Pedido a Proveedor #${data.supplierOrderNumber || ''}.\n\n${detalle}`);
      } else {
        alert('Pedido aprobado correctamente. Hay stock disponible para entregar.');
      }

      await fetchOrders();
      onChanged?.();
    } catch (error: any) {
      alert(error?.message || 'No se pudo aprobar el pedido');
    } finally {
      setActionLoading(null);
    }
  };

  const rejectOrder = async (order: any) => {
    const reason = (rejectReasons[order.id] || '').trim();
    if (reason.length < 3) {
      alert('Ingresá un motivo de rechazo');
      return;
    }
    if (!window.confirm('¿Rechazar este pedido? El cliente verá el motivo.')) return;

    setActionLoading(order.id);
    try {
      const res = await apiFetch(`/api/sales?endpoint=customer-order-reject&id=${order.id}`, {
        method: 'POST',
        body: JSON.stringify({ motivo: reason, admin_notes: adminNotes[order.id] || reason }),
      });
      const body = await res.json();
      unwrapResponse(body);
      await fetchOrders();
      onChanged?.();
    } catch (error: any) {
      alert(error?.message || 'No se pudo rechazar el pedido');
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
      const detalles = error?.errors?.length
        ? '\n\n' + error.errors.map((item: any) => `- ${item.product_name}: faltan ${item.cantidad} u. (stock actual: ${item.stock_actual})`).join('\n')
        : '';
      alert((error?.message || 'No se pudo entregar el pedido') + detalles);
    } finally {
      setActionLoading(null);
    }
  };

  const downloadOrderPdf = (order: any) => {
    generateCustomerOrderPdf(order);
  };

  const notifyOrderWhatsApp = async (order: any) => {
    const phone = normalizeWhatsAppPhone(order.cliente_telefono);
    if (!phone || phone.length < 10) {
      alert('El cliente no tiene teléfono válido cargado para WhatsApp.');
      return;
    }

    generateCustomerOrderPdf(order);
    const message = `Hola ${order.cliente || ''}, te avisamos que tu pedido #${order.numero_pedido} está en estado: ${getStatusLabel(order.estado)}. Total: ${formatCurrency(order.total_final)}.`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message);
    } catch {}
    const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
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
            <p className="text-sm text-zinc-500 mt-1">Aprobá, editá, rechazá o entregá pedidos realizados desde el portal</p>
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
            const discount = getDiscount(order);
            const editing = editingOrderId === order.id;
            const items = editing ? getDraft(order) : order.items;
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
                    {order.admin_notes && <p className="text-xs text-blue-600 font-bold mt-2">Obs.: {order.admin_notes}</p>}
                    {order.rejection_reason && <p className="text-xs text-red-600 font-bold mt-2">Motivo rechazo: {order.rejection_reason}</p>}
                    {order.cancel_reason && <p className="text-xs text-zinc-500 font-bold mt-2">Cancelado: {order.cancel_reason}</p>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 min-w-full lg:min-w-[360px]">
                    <div className="bg-zinc-50 rounded-2xl p-3"><p className="text-[9px] font-black text-zinc-400 uppercase">Subtotal</p><p className="font-black font-mono">{formatCurrency(order.subtotal)}</p></div>
                    <div className="bg-zinc-50 rounded-2xl p-3"><p className="text-[9px] font-black text-zinc-400 uppercase">Desc.</p><p className="font-black font-mono text-red-600">-{formatCurrency(order.descuento_monto)}</p></div>
                    <div className="bg-zinc-900 text-white rounded-2xl p-3"><p className="text-[9px] font-black text-zinc-400 uppercase">Total</p><p className="font-black font-mono">{formatCurrency(order.total_final)}</p></div>
                  </div>
                </div>

                {order.items.some((item: any) => Number(item.faltante || 0) > 0) && order.estado !== 'entregado' && order.estado !== 'rechazado' && order.estado !== 'cancelado' && (
                  <div className="mx-5 mt-5 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-amber-800">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest">Hay productos sin stock</p>
                      <p className="text-xs font-bold mt-1">Al aprobar se generará automáticamente un pedido a proveedor. Para entregar, primero debe haber stock suficiente.</p>
                    </div>
                  </div>
                )}

                <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
                  <div className="space-y-2">
                    {items.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 p-3 bg-zinc-50 rounded-2xl">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-white border border-zinc-100 flex items-center justify-center text-zinc-400 shrink-0"><Package size={16} /></div>
                          <div className="min-w-0">
                            <p className="text-sm font-black text-zinc-900 truncate">{item.product_name}</p>
                            <p className="text-[10px] text-zinc-400 font-bold">{formatCurrency(item.precio_unitario)}</p>
                            <p className={`text-[10px] font-black ${Number(item.faltante || 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                              Stock actual: {Number(item.stock_actual || 0)} u. {Number(item.faltante || 0) > 0 ? `| Faltan: ${Number(item.faltante || 0)} u.` : '| Disponible'}
                            </p>
                          </div>
                        </div>

                        {editing ? (
                          <div className="flex items-center gap-2">
                            <input type="number" min="1" value={item.cantidad} onChange={(e) => updateDraftQty(order.id, item.id, Number(e.target.value))} className="w-20 px-2 py-2 bg-white border border-zinc-200 rounded-xl text-center font-black" />
                            <button onClick={() => removeDraftItem(order.id, item.id)} className="p-2 text-red-500 bg-red-50 rounded-xl"><Trash2 size={16} /></button>
                          </div>
                        ) : (
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-zinc-400 font-bold">{item.cantidad} u.</p>
                            <p className="text-sm font-black font-mono">{formatCurrency(item.importe)}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => downloadOrderPdf(order)} className="py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black uppercase text-[10px] flex items-center justify-center gap-2"><Download size={15} /> PDF</button>
                      <button onClick={() => notifyOrderWhatsApp(order)} className="py-3 bg-green-50 text-green-700 rounded-xl font-black uppercase text-[10px] flex items-center justify-center gap-2"><MessageCircle size={15} /> WhatsApp</button>
                    </div>

                    {order.estado === 'pendiente_aprobacion' && (
                      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-amber-700"><Percent size={16} /><p className="text-xs font-black uppercase tracking-widest">Gestión del pedido</p></div>
                        <select value={discount.tipo} onChange={(e) => setDiscounts(prev => ({ ...prev, [order.id]: { ...discount, tipo: e.target.value as any } }))} className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold">
                          <option value="none">Sin descuento</option>
                          <option value="percentage">Porcentaje %</option>
                          <option value="fixed">Monto fijo $</option>
                        </select>
                        {discount.tipo !== 'none' && (
                          <input type="number" min="0" value={discount.valor} onChange={(e) => setDiscounts(prev => ({ ...prev, [order.id]: { ...discount, valor: e.target.value } }))} className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold" placeholder="Valor descuento" />
                        )}
                        <textarea value={adminNotes[order.id] ?? order.admin_notes ?? ''} onChange={(e) => setAdminNotes(prev => ({ ...prev, [order.id]: e.target.value }))} className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold min-h-[72px]" placeholder="Observación para el cliente" />

                        {editing ? (
                          <div className="grid grid-cols-2 gap-2">
                            <button disabled={actionLoading === order.id} onClick={() => saveOrderChanges(order)} className="py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"><Save size={16} /> Guardar</button>
                            <button onClick={() => setEditingOrderId(null)} className="py-3 bg-white border border-zinc-200 text-zinc-700 rounded-xl font-black uppercase text-xs">Cancelar</button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(order)} className="w-full py-3 bg-white border border-amber-200 text-amber-700 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2"><Edit3 size={16} /> Editar cantidades</button>
                        )}

                        <button disabled={actionLoading === order.id} onClick={() => approveOrder(order)} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50">
                          <CheckCircle2 size={16} /> Aprobar pedido
                        </button>

                        <div className="border-t border-amber-100 pt-3 space-y-2">
                          <input value={rejectReasons[order.id] || ''} onChange={(e) => setRejectReasons(prev => ({ ...prev, [order.id]: e.target.value }))} className="w-full px-3 py-2 bg-white border border-red-100 rounded-xl text-sm font-bold" placeholder="Motivo obligatorio para rechazar" />
                          <button disabled={actionLoading === order.id} onClick={() => rejectOrder(order)} className="w-full py-3 bg-red-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"><XCircle size={16} /> Rechazar pedido</button>
                        </div>
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
