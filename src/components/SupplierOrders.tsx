import React, { useState, useEffect, useMemo } from 'react';
import { Clock, CheckCircle2, Package, AlertCircle, User, Ban, Trash2, Send, Download, Edit2, Plus, Minus, X, Search, Calendar, BarChart3, RefreshCw, FileText, Truck, FilterX, Loader2, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';
import { formatBusinessDateTime, getBusinessDateKey } from '../utils/businessDate';
import { outputPdfDocument, type PdfOutputMode } from '../utils/pdfOutput';

interface SupplierOrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  proveedor: string;
  codigo_unico: string;
  cantidad: number;
  precio_venta?: number;
  importe?: number;
}

interface SupplierOrder {
  id: number;
  numero_pedido: number;
  cliente: string;
  fecha: string;
  estado: 'pendiente' | 'pedido_realizado' | 'auditar_pedido' | 'entregado' | 'cancelado';
  productos: SupplierOrderItem[];
  notes?: string;
  stock_actualizado?: number;
  sale_id?: number | null;
  customer_order_id?: number | null;
  total_pedido?: number;
  cobrado_pedido?: number;
  cta_cte_pedido?: number;
  sale_total?: number;
  sale_monto_pagado?: number;
  sale_monto_pendiente?: number;
  sale_metodo_pago?: string;
  sale_estado?: string | null;
  customer_order_estado?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  cancellation_source?: string | null;
  cancelled_from_status?: string | null;
}

export default function SupplierOrders() {
  const { hasPermission } = useAuth();
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [businessSettings, setBusinessSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [savingChanges, setSavingChanges] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ type: 'cancel' | 'complete'; order: SupplierOrder } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [editError, setEditError] = useState('');
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SupplierOrder | null>(null);
  const [editingItems, setEditingItems] = useState<any[]>([]);
  const [editingNotes, setEditingNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  
  // Filters
  const [filterCliente, setFilterCliente] = useState('');
  const [filterProducto, setFilterProducto] = useState('');
  const [filterEstado, setFilterEstado] = useState('todos');
  const [filterFecha, setFilterFecha] = useState('');
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');

  useEffect(() => {
    fetchOrders(true);
    fetchBusinessSettings();
    fetchAllProducts();
  }, []);

  const fetchAllProducts = async () => {
    try {
      const res = await apiFetch('/api/products?all=true');
      const body = await res.json();
      const data = unwrapResponse(body);
      setAllProducts(data);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  const fetchBusinessSettings = async () => {
    try {
      const res = await apiFetch('/api/config/settings');
      const body = await res.json();
      const data = unwrapResponse(body);
      setBusinessSettings(data);
    } catch (error) {
      console.error("Error fetching business settings:", error);
    }
  };

  const fetchOrders = async (initialLoad = false) => {
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    setLoadError('');

    try {
      const res = await apiFetch('/api/sales?endpoint=supplier-orders');
      const body = await res.json();
      const data = unwrapResponse<SupplierOrder[]>(body);

      if (!Array.isArray(data)) {
        throw new Error('La respuesta de pedidos no tiene el formato esperado.');
      }

      setOrders(data);
    } catch (error) {
      console.error("Error fetching supplier orders:", error);
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los pedidos a proveedor.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleCompleteSale = async (id: number) => {
    setUpdatingOrderId(id);
    setFeedback(null);

    try {
      const res = await apiFetch(`/api/sales?endpoint=supplier-order-complete&id=${id}`, {
        method: 'POST'
      });

      await unwrapResponse(res);

      const order = orders.find(o => o.id === id);
      if (order) {
        generateRemitoPDF({ ...order, estado: 'entregado' });
      }

      setFeedback({
        type: 'success',
        message: 'Pedido completado correctamente. El stock y el estado relacionado fueron actualizados.'
      });
      setConfirmation(null);
      fetchOrders();
    } catch (error) {
      console.error("Error completing sale:", error);
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'No se pudo completar la entrega del pedido.'
      });
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const getStatusStyles = (estado: string) => {
    switch (estado) {
      case 'pendiente':
        return 'bg-zinc-100 text-zinc-600 border-zinc-200';
      case 'pedido_realizado':
        return 'bg-blue-50 text-blue-600 border-blue-200';
      case 'auditar_pedido':
        return 'bg-orange-50 text-orange-600 border-orange-200';
      case 'entregado':
        return 'bg-emerald-50 text-emerald-600 border-emerald-200';
      case 'cancelado':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-zinc-100 text-zinc-500 border-zinc-200';
    }
  };

  const getStatusLabel = (estado: string) => {
    switch (estado) {
      case 'pendiente': return 'Pendiente';
      case 'pedido_realizado': return 'Pedido realizado';
      case 'auditar_pedido': return 'Auditar pedido';
      case 'entregado': return 'Entregado';
      case 'cancelado': return 'Cancelado';
      default: return estado;
    }
  };

  const generatePDF = (order: SupplierOrder, mode: PdfOutputMode = 'download') => {
    const isPrint = mode === 'print';
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const headerX = isPrint ? 20 : 60;
    
    // Business Logo
    if (!isPrint && businessSettings.business_logo) {
      try {
        doc.addImage(businessSettings.business_logo, 'PNG', 20, 10, 30, 30);
      } catch (e) {
        console.error("Error adding logo to PDF", e);
      }
    }

    // Business Header Info
    doc.setFontSize(isPrint ? 18 : 14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(businessSettings.business_name || 'EDUGESTIÓN', headerX, 20);
    
    doc.setFontSize(isPrint ? 10 : 8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(isPrint ? 0 : 100, isPrint ? 0 : 100, isPrint ? 0 : 100);
    doc.text(`Razón Social: ${businessSettings.business_razon_social || '-'}`, headerX, 25);
    doc.text(`CUIT: ${businessSettings.business_cuit || '-'}`, headerX, 29);
    doc.text(`Dirección: ${businessSettings.business_address || '-'}, ${businessSettings.business_localidad || '-'}`, headerX, 33);
    doc.text(`Tel: ${businessSettings.business_phone || '-'} | Email: ${businessSettings.business_email || '-'}`, headerX, 37);

    doc.setTextColor(0);
    doc.setDrawColor(200);
    doc.line(20, 45, 190, 45);

    // Title
    doc.setFontSize(isPrint ? 20 : 16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(order.estado === 'cancelado' ? 'ORDEN DE COMPRA - ANULADA' : 'ORDEN DE COMPRA', 105, 55, { align: 'center' });
    
    doc.setFontSize(isPrint ? 11 : 10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(isPrint ? 0 : 100, isPrint ? 0 : 100, isPrint ? 0 : 100);
    doc.text(`Pedido N°: ${(order.numero_pedido || order.id).toString().padStart(6, '0')}`, 20, 65);
    doc.text(`Fecha: ${order.fecha ? formatBusinessDateTime(order.fecha) : ''}`, 20, 70);

    if (order.estado === 'cancelado') {
      doc.setTextColor(180, 30, 30);
      doc.setFont('helvetica', 'bold');
      doc.text(`Motivo: ${order.cancel_reason || 'Pedido anulado'}`, 20, 76);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Anulado por: ${order.cancelled_by || 'Sistema'}${order.cancelled_at ? ` - ${formatBusinessDateTime(order.cancelled_at)}` : ''}`,
        20,
        81
      );
      doc.setTextColor(20, 20, 20);
    }

    doc.setFontSize(isPrint ? 13 : 12);
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.text('DATOS DEL PEDIDO', 20, order.estado === 'cancelado' ? 92 : 85);
    doc.setFont('helvetica', 'normal');
    doc.text(`Cliente/Destino: ${order.cliente}`, 20, order.estado === 'cancelado' ? 99 : 92);

    // If there's a common supplier for all items, we could show it here, 
    // but since it's per item, it's already in the table.
    // However, the user specifically asked for "Proveedor" in the list of things to include.
    // We'll add a section for it if it's consistent or just rely on the table.
    
    // Table
    const tableData = order.productos.map(p => [
      p.product_name,
      p.proveedor,
      p.cantidad.toString(),
      p.codigo_unico,
      `$${Number(p.importe || 0).toFixed(2)}`
    ]);

    autoTable(doc, {
      startY: order.estado === 'cancelado' ? 107 : 100,
      head: [['Producto', 'Proveedor', 'Cantidad', 'Código', 'Importe']],
      body: tableData,
      theme: 'grid',
      headStyles: isPrint
        ? { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [70, 70, 70], lineWidth: 0.35 }
        : { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: {
        fontSize: isPrint ? 11 : 9,
        cellPadding: isPrint ? 4.5 : 4,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineColor: isPrint ? [110, 110, 110] : [200, 200, 200],
        lineWidth: isPrint ? 0.25 : 0.1,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles: {
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' }
      }
    });

    const totalPedido = order.productos.reduce((sum, item) => sum + Number(item.importe || 0), 0);
    const finalTableY = (doc as any).lastAutoTable.finalY || 150;
    doc.setFontSize(isPrint ? 14 : 11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total pedido proveedor: $${totalPedido.toFixed(2)}`, 190, finalTableY + 8, { align: 'right' });

    // Observations
    const finalY = (doc as any).lastAutoTable.finalY || 150;
    if (order.notes) {
      doc.setFontSize(isPrint ? 12 : 10);
      doc.setFont('helvetica', 'bold');
      doc.text('Observaciones:', 20, finalY + 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(isPrint ? 11 : 9);
      const splitNotes = doc.splitTextToSize(order.notes, 170);
      doc.text(splitNotes, 20, finalY + 16);
    }

    // Footer
    doc.setFontSize(isPrint ? 9 : 8);
    doc.setTextColor(isPrint ? 0 : 150, isPrint ? 0 : 150, isPrint ? 0 : 150);
    doc.text(`Generado automáticamente por ${businessSettings.business_name || 'EDUGESTIÓN'}`, 105, 280, { align: 'center' });

    outputPdfDocument(
      doc,
      `Pedido_${order.id}_${order.cliente.replace(/\s+/g, '_')}${order.estado === 'cancelado' ? '_ANULADO' : ''}.pdf`,
      mode
    );
  };

  const generateRemitoPDF = (order: SupplierOrder, mode: PdfOutputMode = 'download') => {
    const isPrint = mode === 'print';
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const headerX = isPrint ? 20 : 60;
    
    // Business Logo
    if (!isPrint && businessSettings.business_logo) {
      try {
        doc.addImage(businessSettings.business_logo, 'PNG', 20, 10, 30, 30);
      } catch (e) {
        console.error("Error adding logo to PDF", e);
      }
    }

    // Business Header Info
    doc.setFontSize(isPrint ? 18 : 14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(businessSettings.business_name || 'EDUGESTIÓN', headerX, 20);
    
    doc.setFontSize(isPrint ? 10 : 8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(isPrint ? 0 : 100, isPrint ? 0 : 100, isPrint ? 0 : 100);
    doc.text(`Razón Social: ${businessSettings.business_razon_social || '-'}`, headerX, 25);
    doc.text(`CUIT: ${businessSettings.business_cuit || '-'}`, headerX, 29);
    doc.text(`Dirección: ${businessSettings.business_address || '-'}, ${businessSettings.business_localidad || '-'}`, headerX, 33);
    doc.text(`Tel: ${businessSettings.business_phone || '-'} | Email: ${businessSettings.business_email || '-'}`, headerX, 37);

    doc.setTextColor(0);
    doc.setDrawColor(200);
    doc.line(20, 45, 190, 45);

    // Title
    doc.setFontSize(isPrint ? 20 : 16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text('REMITO DE ENTREGA', 105, 55, { align: 'center' });
    
    doc.setFontSize(isPrint ? 11 : 10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(isPrint ? 0 : 100, isPrint ? 0 : 100, isPrint ? 0 : 100);
    doc.text(`Remito N°: ${(order.numero_pedido || order.id).toString().padStart(6, '0')}`, 20, 65);
    doc.text(`Fecha: ${formatBusinessDateTime(new Date())}`, 20, 70);
    
    doc.setFontSize(isPrint ? 13 : 12);
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.text('DATOS DEL CLIENTE', 20, 85);
    doc.setFont('helvetica', 'normal');
    doc.text(`Cliente: ${order.cliente}`, 20, 92);
    
    // Table
    const tableData = order.productos.map(p => [
      p.product_name,
      p.cantidad.toString(),
      '________________' // Signature space or check space
    ]);

    autoTable(doc, {
      startY: 105,
      head: [['Producto', 'Cantidad', 'Firma/Recibido']],
      body: tableData,
      theme: 'grid',
      headStyles: isPrint
        ? { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [70, 70, 70], lineWidth: 0.35 }
        : { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: {
        fontSize: isPrint ? 12 : 10,
        cellPadding: isPrint ? 6 : 5,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineColor: isPrint ? [110, 110, 110] : [200, 200, 200],
        lineWidth: isPrint ? 0.25 : 0.1,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'center' }
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 150;

    // Signature Area
    doc.setFontSize(isPrint ? 12 : 10);
    doc.text('Firma del Cliente:', 20, finalY + 30);
    doc.line(55, finalY + 30, 120, finalY + 30);
    doc.text('Aclaración:', 20, finalY + 40);
    doc.line(45, finalY + 40, 120, finalY + 40);

    // Footer
    doc.setFontSize(isPrint ? 9 : 8);
    doc.setTextColor(isPrint ? 0 : 150, isPrint ? 0 : 150, isPrint ? 0 : 150);
    doc.text(`Este documento no es válido como factura.`, 105, 275, { align: 'center' });
    doc.text(`Generado por ${businessSettings.business_name || 'EDUGESTIÓN'}`, 105, 280, { align: 'center' });

    outputPdfDocument(doc, `Remito_${order.id}_${order.cliente.replace(/\s+/g, '_')}.pdf`, mode);
  };

  const updateStatus = async (id: number, newStatus: string) => {
    setUpdatingOrderId(id);
    setFeedback(null);

    try {
      const res = await apiFetch(`/api/sales?endpoint=supplier-order-status&id=${id}`, {
        method: 'POST',
        body: JSON.stringify({ estado: newStatus })
      });

      await unwrapResponse(res);

      setOrders(prev => prev.map(o => {
        if (o.id === id) {
          const updated = { ...o, estado: newStatus as SupplierOrder['estado'] };
          if (newStatus === 'entregado') {
            generateRemitoPDF(updated);
          }
          return updated;
        }
        return o;
      }));

      setFeedback({
        type: 'success',
        message: `El pedido quedó en estado “${getStatusLabel(newStatus)}”.`
      });
    } catch (error) {
      console.error("Error updating status:", error);
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'No se pudo actualizar el estado del pedido.'
      });
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const getCancelProtectionReason = (order: SupplierOrder) => {
    if (order.estado === 'cancelado') {
      return 'El pedido ya fue anulado y debe conservarse como historial.';
    }

    if (order.estado === 'entregado' || Number(order.stock_actualizado || 0) === 1) {
      return 'No se puede anular: el pedido ya fue entregado o actualizó stock.';
    }

    if (order.sale_id && String(order.sale_estado || '').toLowerCase() !== 'anulada') {
      return 'No se puede anular: está vinculado a una venta activa. Primero debe anularse la venta.';
    }

    if (
      order.customer_order_id &&
      !['cancelado', 'rechazado'].includes(String(order.customer_order_estado || '').toLowerCase())
    ) {
      return 'No se puede anular: está vinculado a un pedido de cliente activo.';
    }

    return '';
  };

  const cancelOrder = async (order: SupplierOrder) => {
    const normalizedReason = cancelReason.trim();

    if (normalizedReason.length < 3) {
      setFeedback({ type: 'error', message: 'El motivo de anulación es obligatorio.' });
      return;
    }

    setCancellingOrderId(order.id);
    setFeedback(null);

    try {
      const res = await apiFetch(`/api/sales?endpoint=supplier-order-cancel&id=${order.id}`, {
        method: 'POST',
        body: JSON.stringify({ motivo: normalizedReason })
      });

      await unwrapResponse(res);

      setFeedback({ type: 'success', message: 'Pedido anulado correctamente.' });
      setConfirmation(null);
      setCancelReason('');
      await fetchOrders();
    } catch (error) {
      console.error("Error cancelling order:", error);
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'No se pudo anular el pedido.'
      });
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleStartEdit = (order: SupplierOrder) => {
    setEditingOrder(order);
    setEditingItems(order.productos.map(p => ({ ...p })));
    setEditingNotes(order.notes || '');
    setProductSearch('');
    setEditError('');
    setIsEditModalOpen(true);
  };

  const handleAddItem = (product: any) => {
    const existing = editingItems.find(i => i.product_id === product.id);
    if (existing) {
      setEditingItems(prev => prev.map(i => i.product_id === product.id ? { ...i, cantidad: i.cantidad + 1 } : i));
    } else {
      setEditingItems(prev => [...prev, {
        id: Date.now(), // Temporary ID
        order_id: editingOrder!.id,
        product_id: product.id,
        product_name: product.name,
        proveedor: product.company,
        codigo_unico: product.codigo_unico,
        cantidad: 1
      }]);
    }
  };

  const handleRemoveItem = (productId: number) => {
    setEditingItems(prev => prev.filter(i => i.product_id !== productId));
  };

  const handleUpdateQuantity = (productId: number, delta: number) => {
    setEditingItems(prev => prev.map(i => {
      if (i.product_id === productId) {
        const newQty = Math.max(1, i.cantidad + delta);
        return { ...i, cantidad: newQty };
      }
      return i;
    }));
  };

  const handleSaveChanges = async () => {
    if (!editingOrder || savingChanges) return;

    if (editingItems.length === 0) {
      setEditError('El pedido debe conservar al menos un producto.');
      return;
    }

    setSavingChanges(true);
    setEditError('');
    setFeedback(null);

    try {
      const res = await apiFetch(`/api/sales?endpoint=supplier-order-items&id=${editingOrder.id}`, {
        method: 'PUT',
        body: JSON.stringify({ items: editingItems, notes: editingNotes })
      });

      await unwrapResponse(res);

      setIsEditModalOpen(false);
      setFeedback({ type: 'success', message: 'Los productos y observaciones del pedido fueron actualizados.' });
      fetchOrders();
    } catch (error) {
      console.error("Error saving changes:", error);
      setEditError(error instanceof Error ? error.message : 'No se pudieron guardar los cambios.');
    } finally {
      setSavingChanges(false);
    }
  };

  const filteredProducts = useMemo(() => {
    if (!productSearch) return [];
    return allProducts.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.codigo_unico.toLowerCase().includes(productSearch.toLowerCase())
    ).slice(0, 5);
  }, [allProducts, productSearch]);

  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      const matchCliente = order.cliente.toLowerCase().includes(filterCliente.toLowerCase());
      const matchEstado = filterEstado === 'todos' || order.estado === filterEstado;
      const matchFecha = !filterFecha || getBusinessDateKey(order.fecha) === filterFecha;
      const matchProducto = !filterProducto || order.productos.some(p => 
        p.product_name.toLowerCase().includes(filterProducto.toLowerCase()) ||
        p.codigo_unico.toLowerCase().includes(filterProducto.toLowerCase())
      );
      return matchCliente && matchEstado && matchFecha && matchProducto;
    });
  }, [orders, filterCliente, filterEstado, filterFecha, filterProducto]);

  const hasActiveFilters = Boolean(
    filterCliente || filterProducto || filterEstado !== 'todos' || filterFecha
  );

  const clearFilters = () => {
    setFilterCliente('');
    setFilterProducto('');
    setFilterEstado('todos');
    setFilterFecha('');
  };

  const orderStats = useMemo(() => ({
    total: orders.length,
    pendientes: orders.filter(order => order.estado === 'pendiente').length,
    enProceso: orders.filter(order => order.estado === 'pedido_realizado' || order.estado === 'auditar_pedido').length,
    entregados: orders.filter(order => order.estado === 'entregado').length,
  }), [orders]);

  const formatCurrency = (value: number | string | null | undefined) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(Number(value || 0));

  const formatDateTime = (value: string) => formatBusinessDateTime(value);

  const normalizePaymentMethod = (value: string) => {
    const raw = (value || '').trim();
    const normalized = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/_/g, ' ')
      .trim();

    if (!normalized) return 'Sin método';
    if (normalized.includes('cta') || normalized.includes('cuenta corriente') || normalized.includes('credito')) return 'Cuenta Corriente';
    if (normalized.includes('efectivo')) return 'Efectivo';
    if (normalized.includes('transfer')) return 'Transferencia';
    if (normalized.includes('mercado') || normalized === 'mp') return 'Mercado Pago';
    if (normalized.includes('cheque')) return 'Cheque';
    if (normalized.includes('tarjeta') || normalized.includes('debito') || normalized.includes('credito tarjeta')) return 'Tarjeta';

    return raw
      .split(' ')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  };

  const getPaymentBreakdown = (method: string | undefined, total: number, cobrado: number, ctaCte: number) => {
    const breakdown: Record<string, number> = {};
    const rawMethod = method || '';
    const methodLower = rawMethod.toLowerCase();

    if (methodLower.includes('mixto')) {
      const partialMethodRaw = rawMethod.match(/\((.*?)\)/)?.[1]?.split('+')?.[0]?.trim() || 'Pago parcial';
      const partialMethod = normalizePaymentMethod(partialMethodRaw);

      if (partialMethod === 'Cuenta Corriente') {
        return { breakdown, ctaCte: total };
      }

      if (cobrado > 0) {
        breakdown[partialMethod] = (breakdown[partialMethod] || 0) + cobrado;
      }

      return { breakdown, ctaCte };
    }

    const methodName = normalizePaymentMethod(rawMethod);

    if (methodName === 'Cuenta Corriente') {
      return { breakdown, ctaCte: total };
    }

    const amount = cobrado > 0 ? cobrado : Math.max(0, total - ctaCte);
    if (amount > 0) {
      breakdown[methodName] = (breakdown[methodName] || 0) + amount;
    }

    return { breakdown, ctaCte };
  };

  const supplierReport = useMemo(() => {
    const filtered = orders.filter(order => {
      const orderDate = order.fecha ? order.fecha.slice(0, 10) : '';
      const fromOk = !reportDateFrom || orderDate >= reportDateFrom;
      const toOk = !reportDateTo || orderDate <= reportDateTo;
      return fromOk && toOk;
    });

    const map = new Map<string, {
      cliente: string;
      total: number;
      cobrado: number;
      ctaCte: number;
      cantidadPedidos: number;
      productos: number;
      metodos: Record<string, number>;
    }>();

    const methodSet = new Set<string>();

    filtered.forEach(order => {
      const key = order.cliente || 'Sin cliente';
      const total = Number(order.total_pedido || order.productos.reduce((sum, item) => sum + Number(item.importe || 0), 0));
      const baseCobrado = Number(order.cobrado_pedido || 0);
      const baseCtaCte = Number(order.cta_cte_pedido ?? Math.max(0, total - baseCobrado));
      const paymentData = getPaymentBreakdown(order.sale_metodo_pago, total, baseCobrado, baseCtaCte);
      const cobrado = Object.values(paymentData.breakdown).reduce((sum, amount) => sum + Number(amount || 0), 0);
      const ctaCte = Number(paymentData.ctaCte || 0);

      if (!map.has(key)) {
        map.set(key, {
          cliente: key,
          total: 0,
          cobrado: 0,
          ctaCte: 0,
          cantidadPedidos: 0,
          productos: 0,
          metodos: {},
        });
      }

      const entry = map.get(key)!;
      entry.total += total;
      entry.cobrado += cobrado;
      entry.ctaCte += ctaCte;
      entry.cantidadPedidos += 1;
      entry.productos += order.productos.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);

      Object.entries(paymentData.breakdown).forEach(([methodName, amount]) => {
        entry.metodos[methodName] = (entry.metodos[methodName] || 0) + Number(amount || 0);
        methodSet.add(methodName);
      });
    });

    const clientes = Array.from(map.values()).sort((a, b) => b.total - a.total);
    const preferredOrder = ['Efectivo', 'Transferencia', 'Mercado Pago', 'Cheque', 'Tarjeta'];
    const paymentMethods = Array.from(methodSet).sort((a, b) => {
      const ia = preferredOrder.indexOf(a);
      const ib = preferredOrder.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b);
    });
    const totalsByMethod = paymentMethods.reduce((acc, methodName) => {
      acc[methodName] = clientes.reduce((sum, row) => sum + Number(row.metodos[methodName] || 0), 0);
      return acc;
    }, {} as Record<string, number>);

    return {
      clientes,
      paymentMethods,
      totalsByMethod,
      total: clientes.reduce((sum, row) => sum + row.total, 0),
      cobrado: clientes.reduce((sum, row) => sum + row.cobrado, 0),
      ctaCte: clientes.reduce((sum, row) => sum + row.ctaCte, 0),
      pedidos: filtered.length,
    };
  }, [orders, reportDateFrom, reportDateTo]);

  const generateSupplierReportPDF = (mode: PdfOutputMode = 'download') => {
    const isPrint = mode === 'print';
    const doc = new jsPDF({ orientation: isPrint ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(isPrint ? 20 : 16);
    doc.setFont('helvetica', 'bold');
    doc.text('REPORTE PEDIDOS A PROVEEDOR', pageWidth / 2, 18, { align: 'center' });

    doc.setFontSize(isPrint ? 11 : 9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Desde: ${reportDateFrom || 'Inicio'}  Hasta: ${reportDateTo || 'Hoy'}`, 14, 30);
    doc.text(`Pedidos incluidos: ${supplierReport.pedidos}`, 14, 36);

    autoTable(doc, {
      startY: 45,
      head: [[
        'Cliente',
        'Pedidos',
        'Unidades',
        'Total',
        ...supplierReport.paymentMethods,
        'Cobrado',
        'Cuenta Corriente'
      ]],
      body: supplierReport.clientes.map(row => [
        row.cliente,
        row.cantidadPedidos.toString(),
        row.productos.toString(),
        `$${row.total.toFixed(2)}`,
        ...supplierReport.paymentMethods.map(methodName => `$${Number(row.metodos[methodName] || 0).toFixed(2)}`),
        `$${row.cobrado.toFixed(2)}`,
        `$${row.ctaCte.toFixed(2)}`,
      ]),
      theme: 'grid',
      headStyles: isPrint
        ? { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [70, 70, 70], lineWidth: 0.35 }
        : { fillColor: [20, 20, 20], textColor: [255, 255, 255] },
      styles: {
        fontSize: isPrint ? (supplierReport.paymentMethods.length > 3 ? 8 : 10) : (supplierReport.paymentMethods.length > 3 ? 6 : 8),
        cellPadding: isPrint ? 3 : 2,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineColor: isPrint ? [110, 110, 110] : [200, 200, 200],
        lineWidth: isPrint ? 0.25 : 0.1,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
    });

    const finalY = (doc as any).lastAutoTable?.finalY || 80;
    doc.setFontSize(isPrint ? 13 : 11);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL GENERAL: $${supplierReport.total.toFixed(2)}`, 14, finalY + 12);
    doc.text(`COBRADO: $${supplierReport.cobrado.toFixed(2)}`, 14, finalY + 19);
    doc.text(`CTA CTE: $${supplierReport.ctaCte.toFixed(2)}`, 14, finalY + 26);

    outputPdfDocument(doc, 'Reporte_Pedidos_Proveedor.pdf', mode);
  };

  if (loading) {
    return (
      <div className="min-h-full overflow-y-auto bg-slate-50 px-3 py-4 sm:px-5 sm:py-6 lg:px-8" aria-live="polite" aria-busy="true">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <div className="rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-5 text-white shadow-xl sm:p-7">
            <div className="h-4 w-32 animate-pulse rounded bg-white/15" />
            <div className="mt-4 h-9 w-72 max-w-full animate-pulse rounded-xl bg-white/20" />
            <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-white/10" />
          </div>

          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                <div className="mt-3 h-8 w-20 animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="animate-spin text-indigo-600" size={22} />
              <div>
                <p className="font-black text-slate-900">Cargando pedidos a proveedor…</p>
                <p className="text-sm text-slate-500">Consultando pedidos, productos, estados y reportes.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-slate-200" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="h-5 w-56 max-w-full animate-pulse rounded bg-slate-200" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError && orders.length === 0) {
    return (
      <div className="min-h-full overflow-y-auto bg-slate-50 px-3 py-6 sm:px-6">
        <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center">
          <div className="w-full rounded-[28px] border border-red-200 bg-white p-6 text-center shadow-lg sm:p-9">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertCircle size={28} />
            </div>
            <h1 className="text-xl font-black text-slate-950">No pudimos cargar los pedidos</h1>
            <p className="mt-2 break-words text-sm text-slate-500">{loadError}</p>
            <button
              type="button"
              onClick={() => fetchOrders(true)}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 sm:w-auto"
            >
              <RefreshCw size={17} />
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const confirmationBusy = Boolean(
    confirmation && (
      updatingOrderId === confirmation.order.id ||
      cancellingOrderId === confirmation.order.id
    )
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 custom-scrollbar">
      <div className="mx-auto w-full max-w-[1600px] space-y-5 px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-xl">
          <div className="relative p-5 sm:p-7 lg:p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl" />

            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-100">
                  <Truck size={14} />
                  Abastecimiento y recepción
                </div>
                <h1 className="break-words text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">
                  Pedidos a Proveedor
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  Seguimiento de faltantes, compras, auditoría, recepción de mercadería y documentos relacionados.
                </p>
              </div>

              <button
                type="button"
                onClick={() => fetchOrders()}
                disabled={refreshing}
                aria-label="Actualizar pedidos a proveedor"
                title="Actualizar pedidos a proveedor"
                className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-black text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Actualizando…' : 'Actualizar pedidos'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Pedidos totales', value: orderStats.total, icon: Package, tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
            { label: 'Pendientes', value: orderStats.pendientes, icon: Clock, tone: 'bg-amber-50 text-amber-700 border-amber-100' },
            { label: 'En proceso', value: orderStats.enProceso, icon: Search, tone: 'bg-blue-50 text-blue-700 border-blue-100' },
            { label: 'Entregados', value: orderStats.entregados, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
          ].map(({ label, value, icon: Icon, tone }) => (
            <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
                  <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
                </div>
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${tone}`}>
                  <Icon size={21} />
                </div>
              </div>
            </article>
          ))}
        </section>

        {feedback && (
          <div
            role="status"
            className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
              feedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            <div className="flex min-w-0 items-start gap-3">
              {feedback.type === 'success'
                ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
                : <AlertCircle size={20} className="mt-0.5 shrink-0" />}
              <p className="break-words text-sm font-bold">{feedback.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-black hover:bg-black/5"
            >
              Cerrar
            </button>
          </div>
        )}

        {loadError && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <div className="flex min-w-0 items-start gap-3">
              <AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-black text-amber-950">No se pudo actualizar la información</p>
                <p className="break-words text-sm text-amber-700">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchOrders()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-black text-amber-900 transition hover:bg-amber-100"
            >
              <RefreshCw size={16} />
              Reintentar
            </button>
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">Buscar y filtrar pedidos</h2>
              <p className="text-sm text-slate-500">Encontrá rápidamente un cliente, producto, estado o fecha.</p>
            </div>
            <p className="text-sm text-slate-500" aria-live="polite">
              <span className="font-black text-slate-950">{filteredOrders.length}</span> de{' '}
              <span className="font-black text-slate-950">{orders.length}</span> pedidos
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <label className="min-w-0 space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Cliente</span>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Nombre del cliente"
                  value={filterCliente}
                  onChange={event => setFilterCliente(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </div>
            </label>

            <label className="min-w-0 space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Producto o código</span>
              <div className="relative">
                <Package className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Producto o código"
                  value={filterProducto}
                  onChange={event => setFilterProducto(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </div>
            </label>

            <label className="min-w-0 space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Estado</span>
              <select
                value={filterEstado}
                onChange={event => setFilterEstado(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              >
                <option value="todos">Todos los estados</option>
                <option value="pendiente">Pendiente</option>
                <option value="pedido_realizado">Pedido realizado</option>
                <option value="auditar_pedido">Auditar pedido</option>
                <option value="entregado">Entregado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </label>

            <label className="min-w-0 space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Fecha</span>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="date"
                  value={filterFecha}
                  onChange={event => setFilterFecha(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </div>
            </label>
          </div>

          <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              <FilterX size={17} />
              Limpiar filtros
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BarChart3 size={20} className="text-indigo-600" />
                <h2 className="text-lg font-black text-slate-950">Reporte por cliente</h2>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Totaliza pedidos, unidades, cobros, cuenta corriente y medios de pago para el período seleccionado.
              </p>
            </div>

            <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:w-auto">
              <button
                type="button"
                onClick={() => generateSupplierReportPDF('download')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-slate-800"
              >
                <Download size={16} />
                Descargar PDF
              </button>
              <button
                type="button"
                onClick={() => generateSupplierReportPDF('print')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-800 transition hover:bg-slate-100"
              >
                <Printer size={16} />
                Imprimir económico
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Desde</span>
              <input
                type="date"
                value={reportDateFrom}
                onChange={event => setReportDateFrom(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>

            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Hasta</span>
              <input
                type="date"
                value={reportDateTo}
                onChange={event => setReportDateTo(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>

            {[
              { label: 'Total', value: supplierReport.total, tone: 'text-slate-950' },
              { label: 'Cobrado', value: supplierReport.cobrado, tone: 'text-emerald-700' },
              { label: 'Cuenta corriente', value: supplierReport.ctaCte, tone: 'text-red-700' },
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                <p className={`mt-1 break-words text-lg font-black ${item.tone}`}>{formatCurrency(item.value)}</p>
              </div>
            ))}
          </div>

          {supplierReport.paymentMethods.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {supplierReport.paymentMethods.map(methodName => (
                <div key={methodName} className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                  <p className="break-words text-[10px] font-black uppercase tracking-[0.16em] text-indigo-500">{methodName}</p>
                  <p className="mt-1 break-words text-lg font-black text-indigo-950">
                    {formatCurrency(supplierReport.totalsByMethod[methodName] || 0)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {supplierReport.clientes.map(row => (
              <article key={row.cliente} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-black text-slate-950">{row.cliente}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.cantidadPedidos} pedidos · {row.productos} unidades
                    </p>
                  </div>
                  <div className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-right">
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total</p>
                    <p className="text-sm font-black text-slate-950">{formatCurrency(row.total)}</p>
                  </div>
                </div>

                {supplierReport.paymentMethods.length > 0 && (
                  <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                    {supplierReport.paymentMethods.map(methodName => (
                      <div key={methodName} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
                        <p className="break-words text-[9px] font-black uppercase tracking-wider text-slate-400">{methodName}</p>
                        <p className="break-words text-sm font-black text-slate-700">
                          {formatCurrency(row.metodos[methodName] || 0)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600">Cobrado</p>
                    <p className="break-words text-sm font-black text-emerald-800">{formatCurrency(row.cobrado)}</p>
                  </div>
                  <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-wider text-red-600">Cuenta corriente</p>
                    <p className="break-words text-sm font-black text-red-800">{formatCurrency(row.ctaCte)}</p>
                  </div>
                </div>
              </article>
            ))}

            {supplierReport.clientes.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center lg:col-span-2 2xl:col-span-3">
                <BarChart3 size={30} className="mx-auto text-slate-300" />
                <p className="mt-3 font-black text-slate-700">No hay datos para este período</p>
                <p className="mt-1 text-sm text-slate-500">Modificá las fechas para incluir otros pedidos.</p>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Seguimiento de pedidos</h2>
              <p className="text-sm text-slate-500">Documentos, productos, auditoría y recepción en un solo lugar.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            {filteredOrders.map(order => {
              const totalOrder = Number(
                order.total_pedido ||
                order.productos.reduce((sum, item) => sum + Number(item.importe || 0), 0)
              );

              return (
                <article key={order.id} className="min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50/70 p-4 sm:p-5">
                    <div className="flex min-w-0 flex-col gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                          <User size={21} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h3 className="min-w-0 break-words text-lg font-black text-slate-950">{order.cliente}</h3>
                            <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-slate-500 ring-1 ring-slate-200">
                              #{order.numero_pedido || order.id}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${getStatusStyles(order.estado)}`}>
                              {getStatusLabel(order.estado)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-col gap-1 text-xs text-slate-500 min-[420px]:flex-row min-[420px]:flex-wrap min-[420px]:gap-x-4">
                            <span className="flex items-center gap-1.5"><Clock size={13} /> {formatDateTime(order.fecha)}</span>
                            <span className="flex items-center gap-1.5"><Package size={13} /> {order.productos.length} productos</span>
                            <span className="font-black text-slate-800">Total {formatCurrency(totalOrder)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <label className="min-w-0 space-y-1.5">
                          <span className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Estado manual</span>
                          <select
                            value={order.estado}
                            onChange={event => updateStatus(order.id, event.target.value)}
                            disabled={['entregado', 'cancelado'].includes(order.estado) || !hasPermission('suppliers', 'edit') || updatingOrderId === order.id}
                            aria-label={`Cambiar estado del pedido ${order.numero_pedido || order.id}`}
                            className={`min-h-11 w-full rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wider outline-none transition ${getStatusStyles(order.estado)} disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            <option value="pendiente">Pendiente</option>
                            <option value="pedido_realizado">Pedido realizado</option>
                            <option value="auditar_pedido">Auditar pedido</option>
                            {order.estado === 'entregado' && <option value="entregado">Entregado</option>}
                            {order.estado === 'cancelado' && <option value="cancelado">Cancelado</option>}
                          </select>
                        </label>

                        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:items-end">
                          {order.estado === 'auditar_pedido' && hasPermission('suppliers', 'edit') && (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(order)}
                              disabled={updatingOrderId === order.id}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50"
                            >
                              <Edit2 size={15} />
                              Editar
                            </button>
                          )}

                          {hasPermission('suppliers', 'delete') && (() => {
                            const cancelProtectionReason = getCancelProtectionReason(order);
                            const cancelDisabled = Boolean(cancelProtectionReason)
                              || cancellingOrderId === order.id
                              || updatingOrderId === order.id;

                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setCancelReason('');
                                  setConfirmation({ type: 'cancel', order });
                                }}
                                disabled={cancelDisabled}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-xs font-black text-red-700 ring-1 ring-red-100 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:ring-slate-200"
                                title={cancelProtectionReason || 'Anular pedido'}
                                aria-label={cancelProtectionReason || `Anular pedido ${order.numero_pedido || order.id}`}
                              >
                                {cancellingOrderId === order.id
                                  ? <Loader2 size={15} className="animate-spin" />
                                  : <Ban size={15} />}
                                {cancelProtectionReason ? 'Protegido' : 'Anular'}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {order.notes && (
                    <div className="border-b border-slate-100 bg-amber-50/60 px-4 py-3 sm:px-5">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-amber-600">Observaciones</p>
                      <p className="mt-1 break-words text-sm text-amber-900">{order.notes}</p>
                    </div>
                  )}

                  {order.estado === 'cancelado' && (
                    <div className="border-b border-red-100 bg-red-50 px-4 py-4 sm:px-5">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-red-600">Pedido anulado</p>
                      <p className="mt-1 break-words text-sm font-bold text-red-900">
                        {order.cancel_reason || 'Pedido cancelado por una operación relacionada.'}
                      </p>
                      <p className="mt-2 text-xs text-red-700">
                        {order.cancelled_by ? `Por ${order.cancelled_by}` : 'Por el sistema'}
                        {order.cancelled_at ? ` · ${formatBusinessDateTime(order.cancelled_at)}` : ''}
                      </p>
                    </div>
                  )}

                  <div className="p-4 sm:p-5">
                    <p className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Productos solicitados</p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {order.productos.map(item => (
                        <div key={item.id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-black text-slate-950">{item.product_name}</p>
                              <p className="mt-1 break-all text-[10px] font-bold text-slate-400">{item.codigo_unico || 'Sin código'}</p>
                            </div>
                            <div className="shrink-0 rounded-xl bg-white px-3 py-2 text-center ring-1 ring-slate-200">
                              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Cantidad</p>
                              <p className="text-base font-black text-slate-950">{item.cantidad}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                              item.proveedor === 'Edu'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-orange-50 text-orange-700'
                            }`}>
                              {item.proveedor || 'Sin proveedor'}
                            </span>
                            {Number(item.importe || 0) > 0 && (
                              <span className="text-xs font-black text-slate-700">{formatCurrency(item.importe)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5">
                    <div>
                      <p className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Documentos</p>
                      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:grid-cols-4">
                        <button
                          type="button"
                          onClick={() => generatePDF(order)}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                        >
                          <FileText size={15} />
                          PDF del pedido
                        </button>
                        <button
                          type="button"
                          onClick={() => generatePDF(order, 'print')}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-100"
                        >
                          <Printer size={15} />
                          Imprimir pedido
                        </button>
                        {order.estado === 'entregado' && (
                          <>
                            <button
                              type="button"
                              onClick={() => generateRemitoPDF(order)}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                            >
                              <Truck size={15} />
                              Remito de entrega
                            </button>
                            <button
                              type="button"
                              onClick={() => generateRemitoPDF(order, 'print')}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-100"
                            >
                              <Printer size={15} />
                              Imprimir remito
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Siguiente acción</p>
                      {order.estado === 'pendiente' && hasPermission('suppliers', 'edit') && (
                        <button
                          type="button"
                          onClick={() => updateStatus(order.id, 'pedido_realizado')}
                          disabled={updatingOrderId === order.id}
                          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-60"
                        >
                          {updatingOrderId === order.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                          {updatingOrderId === order.id ? 'Actualizando…' : 'Confirmar pedido realizado'}
                        </button>
                      )}

                      {order.estado === 'pedido_realizado' && hasPermission('suppliers', 'edit') && (
                        <button
                          type="button"
                          onClick={() => updateStatus(order.id, 'auditar_pedido')}
                          disabled={updatingOrderId === order.id}
                          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-xs font-black text-white transition hover:bg-orange-700 disabled:opacity-60"
                        >
                          {updatingOrderId === order.id ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                          {updatingOrderId === order.id ? 'Actualizando…' : 'Enviar a auditoría'}
                        </button>
                      )}

                      {order.estado === 'auditar_pedido' && hasPermission('suppliers', 'edit') && (
                        <button
                          type="button"
                          onClick={() => setConfirmation({ type: 'complete', order })}
                          disabled={updatingOrderId === order.id}
                          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {updatingOrderId === order.id ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                          {updatingOrderId === order.id ? 'Completando…' : 'Completar entrega y actualizar stock'}
                        </button>
                      )}

                      {order.estado === 'entregado' && (
                        <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-black text-emerald-700">
                          <CheckCircle2 size={15} />
                          Entrega realizada
                        </div>
                      )}
                      {order.estado === 'cancelado' && (
                        <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-black text-red-700">
                          <AlertCircle size={15} />
                          Pedido anulado
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {filteredOrders.length === 0 && (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                {orders.length === 0 ? <Package size={30} /> : <Search size={30} />}
              </div>
              <p className="mt-4 text-lg font-black text-slate-800">
                {orders.length === 0 ? 'No hay pedidos a proveedor' : 'No hay resultados para estos filtros'}
              </p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
                {orders.length === 0
                  ? 'Los pedidos aparecerán cuando una venta o un pedido de cliente necesite productos sin stock.'
                  : 'Modificá los criterios de búsqueda o limpiá los filtros para volver a ver todos los pedidos.'}
              </p>
              {orders.length > 0 && hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800"
                >
                  <FilterX size={16} />
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {isEditModalOpen && editingOrder && (
        <div className="fixed inset-0 z-[110] flex items-end bg-slate-950/65 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="edit-supplier-order-title">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-5xl sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/80 p-4 sm:p-6">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-500">Edición de pedido</p>
                <h2 id="edit-supplier-order-title" className="mt-1 break-words text-xl font-black text-slate-950 sm:text-2xl">
                  Pedido #{editingOrder.numero_pedido || editingOrder.id}
                </h2>
                <p className="mt-1 break-words text-sm text-slate-500">{editingOrder.cliente}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                disabled={savingChanges}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-200 disabled:opacity-50"
                aria-label="Cerrar edición del pedido"
              >
                <X size={22} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar sm:p-6">
              {editError && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900" role="alert">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" />
                  <p className="break-words text-sm font-bold">{editError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <section className="min-w-0">
                  <h3 className="text-sm font-black text-slate-950">Productos en el pedido</h3>
                  <p className="mt-1 text-xs text-slate-500">Modificá cantidades o quitá productos antes de guardar.</p>

                  <div className="mt-4 space-y-3">
                    {editingItems.map(item => (
                      <div key={item.product_id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-black text-slate-950">{item.product_name}</p>
                          <p className="mt-1 break-all text-[10px] font-bold text-slate-400">{item.codigo_unico}</p>
                        </div>

                        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                          <div className="flex min-h-11 items-center justify-between rounded-xl border border-slate-200 bg-white p-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(item.product_id, -1)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100"
                              aria-label={`Reducir cantidad de ${item.product_name}`}
                            >
                              <Minus size={15} />
                            </button>
                            <span className="px-3 text-center text-sm font-black text-slate-950">{item.cantidad}</span>
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(item.product_id, 1)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100"
                              aria-label={`Aumentar cantidad de ${item.product_name}`}
                            >
                              <Plus size={15} />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.product_id)}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-50 px-3 text-xs font-black text-red-700 transition hover:bg-red-100"
                            aria-label={`Quitar ${item.product_name} del pedido`}
                          >
                            <Trash2 size={15} />
                            <span className="hidden min-[420px]:inline">Quitar</span>
                          </button>
                        </div>
                      </div>
                    ))}

                    {editingItems.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
                        <Package size={30} className="mx-auto text-slate-300" />
                        <p className="mt-2 text-sm font-bold text-slate-500">No hay productos en el pedido</p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="min-w-0">
                  <h3 className="text-sm font-black text-slate-950">Agregar productos</h3>
                  <p className="mt-1 text-xs text-slate-500">Buscá por nombre o código y agregá el producto.</p>

                  <div className="relative mt-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="text"
                      placeholder="Buscar producto o código"
                      value={productSearch}
                      onChange={event => setProductSearch(event.target.value)}
                      className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-11 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                    />
                  </div>

                  <div className="mt-3 space-y-2">
                    {filteredProducts.map(product => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleAddItem(product)}
                        className="flex min-h-14 w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        <div className="min-w-0">
                          <p className="break-words text-sm font-black text-slate-950">{product.name}</p>
                          <p className="mt-1 break-all text-[10px] font-bold text-slate-400">
                            {product.codigo_unico} · {product.company || 'Sin proveedor'}
                          </p>
                        </div>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
                          <Plus size={17} />
                        </div>
                      </button>
                    ))}

                    {productSearch && filteredProducts.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm font-bold text-slate-500">
                        No se encontraron productos
                      </div>
                    )}

                    {!productSearch && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-500">
                        Escribí para buscar productos
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <label className="mt-6 block space-y-2">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Observaciones</span>
                <textarea
                  value={editingNotes}
                  onChange={event => setEditingNotes(event.target.value)}
                  placeholder="Agregar observaciones al pedido"
                  className="min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-slate-100 bg-white p-4 sm:grid-cols-2 sm:p-6">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                disabled={savingChanges}
                className="min-h-11 rounded-xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveChanges}
                disabled={savingChanges || editingItems.length === 0}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingChanges && <Loader2 size={17} className="animate-spin" />}
                {savingChanges ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmation && (
        <div className="fixed inset-0 z-[120] flex items-end bg-slate-950/65 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full rounded-t-[28px] bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-[28px] sm:p-7">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
              confirmation.type === 'cancel'
                ? 'bg-red-50 text-red-600'
                : 'bg-emerald-50 text-emerald-600'
            }`}>
              {confirmation.type === 'cancel' ? <Ban size={26} /> : <CheckCircle2 size={26} />}
            </div>

            <h2 className="mt-5 text-xl font-black text-slate-950">
              {confirmation.type === 'cancel' ? 'Anular pedido' : 'Completar entrega'}
            </h2>
            <p className="mt-2 break-words text-sm leading-6 text-slate-500">
              {confirmation.type === 'cancel'
                ? `El pedido #${confirmation.order.numero_pedido || confirmation.order.id} quedará anulado y se conservará como historial.`
                : 'Se completará la entrega. Si el pedido proviene de una venta registrada, no se duplicará; si proviene del portal, se cargará el stock necesario para poder entregarlo.'}
            </p>

            {confirmation.type === 'cancel' && (
              <label className="mt-5 block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  Motivo obligatorio
                </span>
                <textarea
                  value={cancelReason}
                  onChange={event => setCancelReason(event.target.value)}
                  maxLength={500}
                  rows={4}
                  autoFocus
                  placeholder="Ejemplo: pedido duplicado o proveedor sin disponibilidad"
                  className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-red-400 focus:bg-white focus:ring-4 focus:ring-red-100"
                />
                <p className="text-right text-[11px] font-bold text-slate-400">
                  {cancelReason.length}/500
                </p>
              </label>
            )}

            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setConfirmation(null)}
                disabled={confirmationBusy}
                className="min-h-11 rounded-xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmation.type === 'cancel') {
                    cancelOrder(confirmation.order);
                  } else {
                    handleCompleteSale(confirmation.order.id);
                  }
                }}
                disabled={confirmationBusy || (confirmation.type === 'cancel' && cancelReason.trim().length < 3)}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  confirmation.type === 'cancel'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {confirmationBusy && <Loader2 size={17} className="animate-spin" />}
                {confirmationBusy
                  ? 'Procesando…'
                  : confirmation.type === 'cancel'
                    ? 'Confirmar anulación'
                    : 'Completar y actualizar stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
