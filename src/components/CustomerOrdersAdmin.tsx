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
  Search,
  Plus,
  CreditCard,
  Wallet,
  Loader2,
  Filter,
} from 'lucide-react';
import { unwrapResponse, apiFetch } from '../utils/api';
import { generateCustomerOrderPdf } from '../utils/customerOrderPdf';
import { formatBusinessDateTime, getBusinessDateInputValue, getBusinessDateKey } from '../utils/businessDate';

const formatCurrency = (value: number) =>
  `$${Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const getStatusLabel = (order: any) => {
  if (
    order.estado === 'aprobado_pendiente_entrega' &&
    order.stock_status === 'esperando_stock'
  ) {
    return 'Esperando reposición';
  }

  if (
    order.estado === 'aprobado_pendiente_entrega' &&
    order.stock_status === 'listo_entrega'
  ) {
    return 'Listo para entregar';
  }

  if (order.estado === 'entregado' && order.sale_estado === 'Pagada') {
    return 'Entregado y pagado';
  }

  switch (order.estado) {
    case 'pendiente_aprobacion':
      return 'Pendiente de aprobación';
    case 'aprobado_pendiente_entrega':
      return 'Aprobado - pendiente de entrega';
    case 'entregado':
      return 'Entregado - pago pendiente';
    case 'rechazado':
      return 'Rechazado';
    case 'cancelado':
      return 'Cancelado';
    default:
      return order.estado || 'Pendiente';
  }
};

const getStatusClass = (order: any) => {
  if (
    order.estado === 'aprobado_pendiente_entrega' &&
    order.stock_status === 'esperando_stock'
  ) {
    return 'bg-orange-50 text-orange-700 border-orange-100';
  }

  if (
    order.estado === 'aprobado_pendiente_entrega' &&
    order.stock_status === 'listo_entrega'
  ) {
    return 'bg-blue-50 text-blue-700 border-blue-100';
  }

  if (order.estado === 'entregado' && order.sale_estado === 'Pagada') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  }

  switch (order.estado) {
    case 'pendiente_aprobacion':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'entregado':
      return 'bg-violet-50 text-violet-700 border-violet-100';
    case 'rechazado':
      return 'bg-red-50 text-red-700 border-red-100';
    case 'cancelado':
      return 'bg-zinc-100 text-zinc-600 border-zinc-200';
    default:
      return 'bg-zinc-50 text-zinc-600 border-zinc-100';
  }
};

const normalizeWhatsAppPhone = (rawPhone: any) => {
  let digits = String(rawPhone || '').replace(/\D/g, '');

  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith('549')) return digits;

  if (digits.startsWith('54')) {
    let localNumber = digits.slice(2);
    while (localNumber.startsWith('0')) localNumber = localNumber.slice(1);
    if (localNumber.startsWith('9')) return `54${localNumber}`;
    return localNumber ? `549${localNumber}` : '';
  }

  while (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('9') && digits.length === 11) return `54${digits}`;

  return digits.length >= 10 ? `549${digits}` : '';
};

const openWhatsAppPlaceholder = () => {
  const popup = window.open('', '_blank');

  if (!popup) return null;

  try {
    popup.opener = null;
    popup.document.title = 'Abriendo WhatsApp...';
    popup.document.body.innerHTML = `
      <main style="font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;margin:0;padding:24px;text-align:center">
        <div>
          <div style="width:44px;height:44px;border:4px solid #dcfce7;border-top-color:#16a34a;border-radius:9999px;margin:0 auto 16px;animation:spin 0.8s linear infinite"></div>
          <strong>Abriendo WhatsApp...</strong>
          <p style="color:#64748b;margin:8px 0 0">Estamos preparando el chat del cliente.</p>
        </div>
      </main>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
  } catch {}

  return popup;
};

type PaymentLine = {
  metodo_pago: string;
  monto: string;
};

type StatusFilter =
  | 'all'
  | 'pendiente_aprobacion'
  | 'esperando_stock'
  | 'listo_entrega'
  | 'entregado_pendiente_pago'
  | 'pagado'
  | 'cerrados';

export default function CustomerOrdersAdmin({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [discounts, setDiscounts] = useState<
    Record<number, { tipo: 'none' | 'percentage' | 'fixed'; valor: string }>
  >({});
  const [rejectReasons, setRejectReasons] = useState<Record<number, string>>({});
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [draftItems, setDraftItems] = useState<Record<number, any[]>>({});

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [paymentOrderId, setPaymentOrderId] = useState<number | null>(null);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [paymentDate, setPaymentDate] = useState(
    getBusinessDateInputValue()
  );
  const [paymentNotes, setPaymentNotes] = useState('');

  const availablePaymentMethods = useMemo(() => {
    const activeMethods = paymentMethods.filter(
      (method) => method.tipo !== 'Crédito'
    );

    if (activeMethods.length > 0) return activeMethods;

    return [
      { id: 'efectivo', name: 'Efectivo' },
      { id: 'transferencia', name: 'Transferencia' },
      { id: 'mercado-pago', name: 'Mercado Pago' },
      { id: 'cheque', name: 'Cheque' },
      { id: 'otro', name: 'Otro' },
    ];
  }, [paymentMethods]);

  const counters = useMemo(
    () => ({
      pending: orders.filter(
        (order) => order.estado === 'pendiente_aprobacion'
      ).length,
      waitingStock: orders.filter(
        (order) =>
          order.estado === 'aprobado_pendiente_entrega' &&
          order.stock_status === 'esperando_stock'
      ).length,
      ready: orders.filter(
        (order) =>
          order.estado === 'aprobado_pendiente_entrega' &&
          order.stock_status !== 'esperando_stock'
      ).length,
      deliveredDebt: orders.filter(
        (order) =>
          order.estado === 'entregado' &&
          Number(order.sale_monto_pendiente || 0) > 0
      ).length,
    }),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return orders.filter((order) => {
      const orderDate = getBusinessDateKey(order.fecha);
      const matchesSearch =
        !query ||
        String(order.cliente || '').toLowerCase().includes(query) ||
        String(order.numero_pedido || '').includes(query) ||
        String(order.numero_venta || '').includes(query);

      const matchesDate =
        (!dateFrom || orderDate >= dateFrom) &&
        (!dateTo || orderDate <= dateTo);

      let matchesStatus = true;

      if (statusFilter === 'pendiente_aprobacion') {
        matchesStatus = order.estado === 'pendiente_aprobacion';
      }

      if (statusFilter === 'esperando_stock') {
        matchesStatus =
          order.estado === 'aprobado_pendiente_entrega' &&
          order.stock_status === 'esperando_stock';
      }

      if (statusFilter === 'listo_entrega') {
        matchesStatus =
          order.estado === 'aprobado_pendiente_entrega' &&
          order.stock_status !== 'esperando_stock';
      }

      if (statusFilter === 'entregado_pendiente_pago') {
        matchesStatus =
          order.estado === 'entregado' &&
          Number(order.sale_monto_pendiente || 0) > 0;
      }

      if (statusFilter === 'pagado') {
        matchesStatus =
          order.estado === 'entregado' &&
          Number(order.sale_monto_pendiente || 0) <= 0;
      }

      if (statusFilter === 'cerrados') {
        matchesStatus =
          order.estado === 'rechazado' || order.estado === 'cancelado';
      }

      return matchesSearch && matchesDate && matchesStatus;
    });
  }, [orders, searchTerm, dateFrom, dateTo, statusFilter]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await apiFetch('/api/sales?endpoint=customer-orders');
      const body = await response.json();
      setOrders(unwrapResponse(body));
    } catch (error) {
      console.error('Error fetching customer orders:', error);
      alert('No se pudieron cargar los pedidos de clientes');
    } finally {
      setLoading(false);
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const response = await apiFetch('/api/config/payment-methods?active=true');
      const body = await response.json();
      const data = unwrapResponse(body);
      setPaymentMethods(data || []);
    } catch (error) {
      console.error('Error fetching payment methods:', error);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchPaymentMethods();
  }, []);

  const getDiscount = (order: any) =>
    discounts[order.id] || {
      tipo: order.descuento_tipo || 'none',
      valor: String(order.descuento_valor || 0),
    };

  const getDraft = (order: any) => draftItems[order.id] || order.items || [];

  const startEdit = (order: any) => {
    setEditingOrderId(order.id);
    setDraftItems((current) => ({
      ...current,
      [order.id]: order.items.map((item: any) => ({ ...item })),
    }));
    setDiscounts((current) => ({
      ...current,
      [order.id]: getDiscount(order),
    }));
    setAdminNotes((current) => ({
      ...current,
      [order.id]: order.admin_notes || '',
    }));
  };

  const updateDraftQty = (
    orderId: number,
    itemId: number,
    quantity: number
  ) => {
    setDraftItems((current) => ({
      ...current,
      [orderId]: (current[orderId] || []).map((item: any) =>
        item.id === itemId
          ? { ...item, cantidad: Math.max(1, Number(quantity || 1)) }
          : item
      ),
    }));
  };

  const removeDraftItem = (orderId: number, itemId: number) => {
    setDraftItems((current) => ({
      ...current,
      [orderId]: (current[orderId] || []).filter(
        (item: any) => item.id !== itemId
      ),
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
      const response = await apiFetch(
        `/api/sales?endpoint=customer-order-update&id=${order.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            items: items.map((item: any) => ({
              product_id: Number(item.product_id),
              cantidad: Number(item.cantidad),
            })),
            descuento_tipo: discount.tipo,
            descuento_valor: Number(discount.valor || 0),
            admin_notes: adminNotes[order.id] || '',
          }),
        }
      );
      const body = await response.json();
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
      const response = await apiFetch(
        `/api/sales?endpoint=customer-order-approve&id=${order.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            descuento_tipo: discount.tipo,
            descuento_valor: Number(discount.valor || 0),
            admin_notes:
              adminNotes[order.id] || order.admin_notes || '',
          }),
        }
      );
      const body = await response.json();
      const data = unwrapResponse(body);

      if (data?.shortageItems?.length) {
        const detail = data.shortageItems
          .map(
            (item: any) =>
              `- ${item.product_name}: faltan ${item.cantidad} u. (stock actual: ${item.stock_actual})`
          )
          .join('\n');

        alert(
          `Pedido aprobado. Hay productos sin stock y se generó/actualizó el Pedido a Proveedor #${
            data.supplierOrderNumber || ''
          }.\n\n${detail}`
        );
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

    if (!window.confirm('¿Rechazar este pedido? El cliente verá el motivo.')) {
      return;
    }

    setActionLoading(order.id);

    try {
      const response = await apiFetch(
        `/api/sales?endpoint=customer-order-reject&id=${order.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            motivo: reason,
            admin_notes: adminNotes[order.id] || reason,
          }),
        }
      );
      const body = await response.json();
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
    if (
      !window.confirm(
        '¿Marcar pedido como entregado y generar saldo en cuenta corriente del cliente?'
      )
    ) {
      return;
    }

    setActionLoading(order.id);

    try {
      const response = await apiFetch(
        `/api/sales?endpoint=customer-order-deliver&id=${order.id}`,
        { method: 'POST' }
      );
      const body = await response.json();
      unwrapResponse(body);

      await fetchOrders();
      onChanged?.();
    } catch (error: any) {
      const details = error?.errors?.length
        ? `\n\n${error.errors
            .map(
              (item: any) =>
                `- ${item.product_name}: faltan ${item.cantidad} u. (stock actual: ${item.stock_actual})`
            )
            .join('\n')}`
        : '';

      alert((error?.message || 'No se pudo entregar el pedido') + details);
    } finally {
      setActionLoading(null);
    }
  };

  const openPayment = (order: any) => {
    const defaultMethod =
      availablePaymentMethods[0]?.name || 'Efectivo';

    setPaymentOrderId(order.id);
    setPaymentLines([
      {
        metodo_pago: defaultMethod,
        monto: String(Number(order.sale_monto_pendiente || 0)),
      },
    ]);
    setPaymentDate(getBusinessDateInputValue());
    setPaymentNotes('');
  };

  const updatePaymentLine = (
    index: number,
    field: keyof PaymentLine,
    value: string
  ) => {
    setPaymentLines((current) =>
      current.map((line, currentIndex) =>
        currentIndex === index ? { ...line, [field]: value } : line
      )
    );
  };

  const addPaymentLine = () => {
    const defaultMethod =
      availablePaymentMethods[0]?.name || 'Efectivo';

    setPaymentLines((current) => [
      ...current,
      { metodo_pago: defaultMethod, monto: '' },
    ]);
  };

  const removePaymentLine = (index: number) => {
    setPaymentLines((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  };

  const paymentTotal = useMemo(
    () =>
      paymentLines.reduce(
        (sum, line) => sum + Number(line.monto || 0),
        0
      ),
    [paymentLines]
  );

  const registerPayment = async (order: any) => {
    const pending = Number(order.sale_monto_pendiente || 0);
    const validPayments = paymentLines
      .map((line) => ({
        metodo_pago: line.metodo_pago,
        monto: Number(line.monto || 0),
      }))
      .filter((line) => line.metodo_pago && line.monto > 0);

    if (!validPayments.length) {
      alert('Ingresá al menos un medio de pago con importe');
      return;
    }

    if (paymentTotal > pending + 0.001) {
      alert('El total del cobro supera el saldo pendiente del pedido');
      return;
    }

    setActionLoading(order.id);

    try {
      const response = await apiFetch(
        `/api/sales?endpoint=customer-order-payment&id=${order.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            payments: validPayments,
            fecha: paymentDate,
            observaciones: paymentNotes,
          }),
        }
      );
      const body = await response.json();
      const data = unwrapResponse(body);

      setPaymentOrderId(null);
      setPaymentLines([]);
      await fetchOrders();
      onChanged?.();

      alert(
        data.monto_pendiente > 0
          ? `Pago parcial registrado. Saldo restante: ${formatCurrency(
              data.monto_pendiente
            )}`
          : 'Pedido cobrado completamente'
      );
    } catch (error: any) {
      alert(error?.message || 'No se pudo registrar el cobro');
    } finally {
      setActionLoading(null);
    }
  };

  const downloadOrderPdf = (order: any) => {
    generateCustomerOrderPdf(order);
  };

  const notifyOrderWhatsApp = async (order: any) => {
    const whatsappWindow = openWhatsAppPlaceholder();

    if (!whatsappWindow) {
      alert('El navegador bloqueó la nueva pestaña. Habilitá las ventanas emergentes para abrir WhatsApp.');
      return;
    }

    try {
      const phone = normalizeWhatsAppPhone(order.cliente_telefono);

      if (!phone) {
        whatsappWindow.close();
        alert('El cliente no tiene teléfono válido cargado para WhatsApp.');
        return;
      }

      generateCustomerOrderPdf(order);

      const message = `Hola ${order.cliente || ''}, te avisamos que tu pedido #${
        order.numero_pedido
      } está en estado: ${getStatusLabel(order)}. Total: ${formatCurrency(
        order.total_final
      )}.`;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(message);
        }
      } catch {}

      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      whatsappWindow.location.replace(url);
    } catch (error) {
      whatsappWindow.close();
      console.error('Error opening WhatsApp for customer order:', error);
      alert('No se pudo preparar el envío por WhatsApp.');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-3 sm:p-5 lg:p-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">
              Pedidos de Clientes
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Aprobá, editá, entregá y registrá cobros desde un mismo lugar
            </p>
          </div>

          <button
            onClick={fetchOrders}
            className="px-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm font-black text-zinc-700 flex items-center justify-center gap-2 shadow-sm hover:bg-zinc-50"
          >
            <RefreshCcw size={16} /> Actualizar
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4 sm:gap-4">
          <button
            onClick={() => setStatusFilter('pendiente_aprobacion')}
            className="text-left bg-white rounded-3xl border border-zinc-200 p-4 sm:p-5 shadow-sm"
          >
            <p className="text-[10px] font-black text-zinc-400 uppercase">
              Pendientes
            </p>
            <p className="text-3xl font-black text-amber-600">
              {counters.pending}
            </p>
          </button>

          <button
            onClick={() => setStatusFilter('esperando_stock')}
            className="text-left bg-white rounded-3xl border border-zinc-200 p-4 sm:p-5 shadow-sm"
          >
            <p className="text-[10px] font-black text-zinc-400 uppercase">
              Esperando stock
            </p>
            <p className="text-3xl font-black text-orange-600">
              {counters.waitingStock}
            </p>
          </button>

          <button
            onClick={() => setStatusFilter('listo_entrega')}
            className="text-left bg-white rounded-3xl border border-zinc-200 p-4 sm:p-5 shadow-sm"
          >
            <p className="text-[10px] font-black text-zinc-400 uppercase">
              Para entregar
            </p>
            <p className="text-3xl font-black text-blue-600">
              {counters.ready}
            </p>
          </button>

          <button
            onClick={() => setStatusFilter('entregado_pendiente_pago')}
            className="text-left bg-white rounded-3xl border border-zinc-200 p-4 sm:p-5 shadow-sm"
          >
            <p className="text-[10px] font-black text-zinc-400 uppercase">
              Entregados por cobrar
            </p>
            <p className="text-3xl font-black text-violet-600">
              {counters.deliveredDebt}
            </p>
          </button>
        </div>

        <div className="bg-white rounded-3xl border border-zinc-200 p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-zinc-500">
            <Filter size={16} />
            <p className="text-xs font-black uppercase tracking-widest">
              Filtros
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Cliente o número..."
                className="w-full pl-10 pr-3 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              className="w-full px-3 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-bold"
            >
              <option value="all">Todos los estados</option>
              <option value="pendiente_aprobacion">Pendientes de aprobación</option>
              <option value="esperando_stock">Esperando stock</option>
              <option value="listo_entrega">Listos para entregar</option>
              <option value="entregado_pendiente_pago">Entregados por cobrar</option>
              <option value="pagado">Pagados</option>
              <option value="cerrados">Rechazados / cancelados</option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full px-3 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm"
            />

            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full px-3 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs font-bold text-zinc-400">
              Mostrando {filteredOrders.length} de {orders.length} pedidos
            </p>
            <button
              onClick={() => {
                setStatusFilter('all');
                setSearchTerm('');
                setDateFrom('');
                setDateTo('');
              }}
              className="text-xs font-black text-zinc-500 hover:text-zinc-900"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const discount = getDiscount(order);
            const editing = editingOrderId === order.id;
            const items = editing ? getDraft(order) : order.items;
            const orderPending = Number(order.sale_monto_pendiente || 0);
            const orderPaid = Number(order.sale_monto_pagado || 0);
            const paymentOpen = paymentOrderId === order.id;

            return (
              <div
                key={order.id}
                className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden"
              >
                <div className="p-5 border-b border-zinc-100 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                        Pedido #{order.numero_pedido}
                      </p>
                      <span
                        className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase ${getStatusClass(
                          order
                        )}`}
                      >
                        {getStatusLabel(order)}
                      </span>
                    </div>

                    <h3 className="text-xl font-black text-zinc-900">
                      {order.cliente}
                    </h3>
                    <p className="text-xs text-zinc-400 font-bold">
                      {formatBusinessDateTime(order.fecha)}
                    </p>

                    {order.numero_venta && (
                      <p className="text-xs text-emerald-600 font-bold mt-1">
                        Venta #{order.numero_venta}
                      </p>
                    )}

                    {order.admin_notes && (
                      <p className="text-xs text-blue-600 font-bold mt-2">
                        Obs.: {order.admin_notes}
                      </p>
                    )}

                    {order.rejection_reason && (
                      <p className="text-xs text-red-600 font-bold mt-2">
                        Motivo rechazo: {order.rejection_reason}
                      </p>
                    )}

                    {order.cancel_reason && (
                      <p className="text-xs text-zinc-500 font-bold mt-2">
                        Cancelado: {order.cancel_reason}
                      </p>
                    )}
                  </div>

                  <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-3 lg:w-auto lg:min-w-[360px]">
                    <div className="bg-zinc-50 rounded-2xl p-3">
                      <p className="text-[9px] font-black text-zinc-400 uppercase">
                        Subtotal
                      </p>
                      <p className="font-black font-mono">
                        {formatCurrency(order.subtotal)}
                      </p>
                    </div>
                    <div className="bg-zinc-50 rounded-2xl p-3">
                      <p className="text-[9px] font-black text-zinc-400 uppercase">
                        Desc.
                      </p>
                      <p className="font-black font-mono text-red-600">
                        -{formatCurrency(order.descuento_monto)}
                      </p>
                    </div>
                    <div className="bg-zinc-900 text-white rounded-2xl p-3">
                      <p className="text-[9px] font-black text-zinc-400 uppercase">
                        Total
                      </p>
                      <p className="font-black font-mono">
                        {formatCurrency(order.total_final)}
                      </p>
                    </div>
                  </div>
                </div>

                {order.items.some(
                  (item: any) => Number(item.faltante || 0) > 0
                ) &&
                  !['entregado', 'rechazado', 'cancelado'].includes(
                    order.estado
                  ) && (
                    <div className="mx-5 mt-5 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-amber-800">
                      <AlertTriangle
                        size={18}
                        className="shrink-0 mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest">
                          Hay productos sin stock
                        </p>
                        <p className="text-xs font-bold mt-1">
                          El pedido está esperando reposición. No se podrá
                          entregar hasta completar el stock.
                        </p>
                      </div>
                    </div>
                  )}

                {order.estado === 'entregado' && (
                  <div className="mx-5 mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
                      <p className="text-[10px] font-black uppercase text-emerald-600">
                        Pagado
                      </p>
                      <p className="font-black text-emerald-700">
                        {formatCurrency(orderPaid)}
                      </p>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-3">
                      <p className="text-[10px] font-black uppercase text-red-500">
                        Saldo pendiente
                      </p>
                      <p className="font-black text-red-600">
                        {formatCurrency(orderPending)}
                      </p>
                    </div>
                    <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-3">
                      <p className="text-[10px] font-black uppercase text-zinc-400">
                        Estado de venta
                      </p>
                      <p className="font-black text-zinc-700">
                        {order.sale_estado || '-'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="space-y-2">
                    {items.map((item: any) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-3 rounded-2xl bg-zinc-50 p-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-white border border-zinc-100 flex items-center justify-center text-zinc-400 shrink-0">
                            <Package size={16} />
                          </div>

                          <div className="min-w-0">
                            <p className="break-words text-sm font-black text-zinc-900">
                              {item.product_name}
                            </p>
                            <p className="text-[10px] text-zinc-400 font-bold">
                              {formatCurrency(item.precio_unitario)}
                            </p>
                            <p
                              className={`text-[10px] font-black ${
                                Number(item.faltante || 0) > 0
                                  ? 'text-amber-600'
                                  : 'text-emerald-600'
                              }`}
                            >
                              Stock actual: {Number(item.stock_actual || 0)} u.{' '}
                              {Number(item.faltante || 0) > 0
                                ? `| Faltan: ${Number(item.faltante || 0)} u.`
                                : '| Disponible'}
                            </p>
                          </div>
                        </div>

                        {editing ? (
                          <div className="flex w-full items-center gap-2 min-[520px]:w-auto">
                            <input
                              type="number"
                              min="1"
                              value={item.cantidad}
                              onChange={(event) =>
                                updateDraftQty(
                                  order.id,
                                  item.id,
                                  Number(event.target.value)
                                )
                              }
                              className="min-h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-2 py-2 text-center font-black min-[520px]:w-20 min-[520px]:flex-none"
                            />
                            <button
                              onClick={() =>
                                removeDraftItem(order.id, item.id)
                              }
                              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-red-50 p-2 text-red-500"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-zinc-400 font-bold">
                              {item.cantidad} u.
                            </p>
                            <p className="text-sm font-black font-mono">
                              {formatCurrency(item.importe)}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                      <button
                        onClick={() => downloadOrderPdf(order)}
                        className="py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black uppercase text-[10px] flex items-center justify-center gap-2"
                      >
                        <Download size={15} /> PDF
                      </button>
                      <button
                        onClick={() => notifyOrderWhatsApp(order)}
                        className="py-3 bg-green-50 text-green-700 rounded-xl font-black uppercase text-[10px] flex items-center justify-center gap-2"
                      >
                        <MessageCircle size={15} /> WhatsApp
                      </button>
                    </div>

                    {order.estado === 'pendiente_aprobacion' && (
                      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-amber-700">
                          <Percent size={16} />
                          <p className="text-xs font-black uppercase tracking-widest">
                            Gestión del pedido
                          </p>
                        </div>

                        <select
                          value={discount.tipo}
                          onChange={(event) =>
                            setDiscounts((current) => ({
                              ...current,
                              [order.id]: {
                                ...discount,
                                tipo: event.target.value as any,
                              },
                            }))
                          }
                          className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold"
                        >
                          <option value="none">Sin descuento</option>
                          <option value="percentage">Porcentaje %</option>
                          <option value="fixed">Monto fijo $</option>
                        </select>

                        {discount.tipo !== 'none' && (
                          <input
                            type="number"
                            min="0"
                            value={discount.valor}
                            onChange={(event) =>
                              setDiscounts((current) => ({
                                ...current,
                                [order.id]: {
                                  ...discount,
                                  valor: event.target.value,
                                },
                              }))
                            }
                            className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold"
                            placeholder="Valor descuento"
                          />
                        )}

                        <textarea
                          value={
                            adminNotes[order.id] ??
                            order.admin_notes ??
                            ''
                          }
                          onChange={(event) =>
                            setAdminNotes((current) => ({
                              ...current,
                              [order.id]: event.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 bg-white border border-amber-100 rounded-xl text-sm font-bold min-h-[72px]"
                          placeholder="Observación para el cliente"
                        />

                        {editing ? (
                          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                            <button
                              disabled={actionLoading === order.id}
                              onClick={() => saveOrderChanges(order)}
                              className="py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              <Save size={16} /> Guardar
                            </button>
                            <button
                              onClick={() => setEditingOrderId(null)}
                              className="py-3 bg-white border border-zinc-200 text-zinc-700 rounded-xl font-black uppercase text-xs"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(order)}
                            className="w-full py-3 bg-white border border-amber-200 text-amber-700 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2"
                          >
                            <Edit3 size={16} /> Editar cantidades
                          </button>
                        )}

                        <button
                          disabled={actionLoading === order.id}
                          onClick={() => approveOrder(order)}
                          className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          <CheckCircle2 size={16} /> Aprobar pedido
                        </button>

                        <div className="border-t border-amber-100 pt-3 space-y-2">
                          <input
                            value={rejectReasons[order.id] || ''}
                            onChange={(event) =>
                              setRejectReasons((current) => ({
                                ...current,
                                [order.id]: event.target.value,
                              }))
                            }
                            className="w-full px-3 py-2 bg-white border border-red-100 rounded-xl text-sm font-bold"
                            placeholder="Motivo obligatorio para rechazar"
                          />
                          <button
                            disabled={actionLoading === order.id}
                            onClick={() => rejectOrder(order)}
                            className="w-full py-3 bg-red-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <XCircle size={16} /> Rechazar pedido
                          </button>
                        </div>
                      </div>
                    )}

                    {order.estado === 'aprobado_pendiente_entrega' &&
                      order.stock_status === 'esperando_stock' && (
                        <div className="bg-orange-50 border border-orange-100 text-orange-700 rounded-2xl p-4 text-sm font-bold">
                          <AlertTriangle size={18} className="mb-2" />
                          Esperando ingreso de stock para habilitar la entrega.
                        </div>
                      )}

                    {order.estado === 'aprobado_pendiente_entrega' &&
                      order.stock_status !== 'esperando_stock' && (
                        <button
                          disabled={actionLoading === order.id}
                          onClick={() => deliverOrder(order)}
                          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          <Truck size={18} /> Pedido entregado
                        </button>
                      )}

                    {order.estado === 'entregado' && orderPending > 0 && (
                      <>
                        <button
                          onClick={() =>
                            paymentOpen
                              ? setPaymentOrderId(null)
                              : openPayment(order)
                          }
                          className="w-full py-4 bg-violet-600 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2"
                        >
                          <CreditCard size={18} />
                          {paymentOpen ? 'Cerrar cobro' : 'Registrar cobro'}
                        </button>

                        {paymentOpen && (
                          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-black uppercase tracking-widest text-violet-700">
                                Cobro del pedido
                              </p>
                              <span className="text-xs font-black text-red-600">
                                Saldo {formatCurrency(orderPending)}
                              </span>
                            </div>

                            {paymentLines.map((line, index) => (
                              <div
                                key={`${order.id}-payment-${index}`}
                                className="grid grid-cols-1 gap-2 min-[520px]:grid-cols-[minmax(0,1fr)_110px_44px]"
                              >
                                <select
                                  value={line.metodo_pago}
                                  onChange={(event) =>
                                    updatePaymentLine(
                                      index,
                                      'metodo_pago',
                                      event.target.value
                                    )
                                  }
                                  className="px-3 py-2 bg-white border border-violet-100 rounded-xl text-sm font-bold min-w-0"
                                >
                                  {availablePaymentMethods.map((method) => (
                                      <option
                                        key={method.id || method.name}
                                        value={method.name}
                                      >
                                        {method.name}
                                      </option>
                                    ))}
                                </select>

                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={line.monto}
                                  onChange={(event) =>
                                    updatePaymentLine(
                                      index,
                                      'monto',
                                      event.target.value
                                    )
                                  }
                                  className="px-3 py-2 bg-white border border-violet-100 rounded-xl text-sm font-bold text-right"
                                  placeholder="Monto"
                                />

                                <button
                                  disabled={paymentLines.length === 1}
                                  onClick={() => removePaymentLine(index)}
                                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-50 p-2 text-red-500 disabled:opacity-30"
                                  title="Quitar medio de pago"
                                  aria-label="Quitar medio de pago"
                                >
                                  <Trash2 size={16} />
                                  <span className="text-xs font-black min-[520px]:hidden">Quitar medio</span>
                                </button>
                              </div>
                            ))}

                            <button
                              onClick={addPaymentLine}
                              className="w-full py-2 bg-white border border-violet-200 text-violet-700 rounded-xl text-xs font-black uppercase flex items-center justify-center gap-2"
                            >
                              <Plus size={15} /> Agregar medio de pago
                            </button>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input
                                type="date"
                                value={paymentDate}
                                onChange={(event) =>
                                  setPaymentDate(event.target.value)
                                }
                                className="px-3 py-2 bg-white border border-violet-100 rounded-xl text-sm"
                              />
                              <input
                                value={paymentNotes}
                                onChange={(event) =>
                                  setPaymentNotes(event.target.value)
                                }
                                placeholder="Observación"
                                className="px-3 py-2 bg-white border border-violet-100 rounded-xl text-sm"
                              />
                            </div>

                            <div className="flex items-center justify-between bg-white rounded-xl p-3">
                              <span className="text-xs font-black uppercase text-zinc-400">
                                Total cobro
                              </span>
                              <span
                                className={`font-black font-mono ${
                                  paymentTotal > orderPending
                                    ? 'text-red-600'
                                    : 'text-violet-700'
                                }`}
                              >
                                {formatCurrency(paymentTotal)}
                              </span>
                            </div>

                            <button
                              disabled={
                                actionLoading === order.id ||
                                paymentTotal <= 0 ||
                                paymentTotal > orderPending + 0.001
                              }
                              onClick={() => registerPayment(order)}
                              className="w-full py-3 bg-violet-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {actionLoading === order.id ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Wallet size={16} />
                              )}
                              Confirmar cobro
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {order.estado === 'entregado' && orderPending <= 0 && (
                      <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-2xl p-4 flex items-center gap-2 text-sm font-bold">
                        <CheckCircle2 size={18} /> Pedido entregado y pagado
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredOrders.length === 0 && (
            <div className="bg-white rounded-3xl border border-zinc-200 p-16 text-center text-zinc-400">
              <Clock size={52} className="mx-auto mb-4 opacity-20" />
              <p className="font-bold">
                No hay pedidos que coincidan con los filtros.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
