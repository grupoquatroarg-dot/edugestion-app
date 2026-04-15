import React, { useState, useEffect, useMemo } from 'react';
import { Clock, CheckCircle2, Package, AlertCircle, User, Trash2, Send, Download, Edit2, Plus, Minus, X, Search } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

interface SupplierOrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  proveedor: string;
  codigo_unico: string;
  cantidad: number;
}

interface SupplierOrder {
  id: number;
  numero_pedido: number;
  cliente: string;
  fecha: string;
  estado: 'pendiente' | 'pedido_realizado' | 'auditar_pedido' | 'entregado';
  productos: SupplierOrderItem[];
  notes?: string;
  stock_actualizado?: number;
}

export default function SupplierOrders() {
  const { hasPermission } = useAuth();
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [businessSettings, setBusinessSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  
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

  useEffect(() => {
    fetchOrders();
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

  const fetchOrders = async () => {
    try {
      const res = await apiFetch('/api/supplier-orders');
      const body = await res.json();
      const data = unwrapResponse(body);
      setOrders(data);
    } catch (error) {
      console.error("Error fetching supplier orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteSale = async (id: number) => {
    if (!window.confirm("¿Deseas completar la venta para este cliente? Esto generará un registro de venta y consumirá el stock recién ingresado.")) return;

    try {
      const res = await apiFetch(`/api/supplier-orders/${id}/complete-sale`, {
        method: 'POST'
      });
      
      await unwrapResponse(res);
      
      alert("Venta completada correctamente.");
      // Find the order to generate the remito
      const order = orders.find(o => o.id === id);
      if (order) {
        generateRemitoPDF({ ...order, estado: 'entregado' });
      }
      fetchOrders();
    } catch (error) {
      console.error("Error completing sale:", error);
      alert("Error al completar la venta");
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
      default: return estado;
    }
  };

  const generatePDF = (order: SupplierOrder) => {
    const doc = new jsPDF();
    
    // Business Logo
    if (businessSettings.business_logo) {
      try {
        doc.addImage(businessSettings.business_logo, 'PNG', 20, 10, 30, 30);
      } catch (e) {
        console.error("Error adding logo to PDF", e);
      }
    }

    // Business Header Info
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(businessSettings.business_name || 'EDUGESTIÓN', 60, 20);
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Razón Social: ${businessSettings.business_razon_social || '-'}`, 60, 25);
    doc.text(`CUIT: ${businessSettings.business_cuit || '-'}`, 60, 29);
    doc.text(`Dirección: ${businessSettings.business_address || '-'}, ${businessSettings.business_localidad || '-'}`, 60, 33);
    doc.text(`Tel: ${businessSettings.business_phone || '-'} | Email: ${businessSettings.business_email || '-'}`, 60, 37);

    doc.setTextColor(0);
    doc.setDrawColor(200);
    doc.line(20, 45, 190, 45);

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text('ORDEN DE COMPRA', 105, 55, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Pedido N°: ${(order.numero_pedido || order.id).toString().padStart(6, '0')}`, 20, 65);
    doc.text(`Fecha: ${order.fecha ? new Date(order.fecha).toLocaleString() : ''}`, 20, 70);
    
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.text('DATOS DEL PEDIDO', 20, 85);
    doc.setFont('helvetica', 'normal');
    doc.text(`Cliente/Destino: ${order.cliente}`, 20, 92);
    
    // If there's a common supplier for all items, we could show it here, 
    // but since it's per item, it's already in the table.
    // However, the user specifically asked for "Proveedor" in the list of things to include.
    // We'll add a section for it if it's consistent or just rely on the table.
    
    // Table
    const tableData = order.productos.map(p => [
      p.product_name,
      p.proveedor,
      p.cantidad.toString(),
      p.codigo_unico
    ]);

    autoTable(doc, {
      startY: 100,
      head: [['Producto', 'Proveedor', 'Cantidad', 'Código']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        2: { halign: 'center' },
        3: { halign: 'right' }
      }
    });

    // Observations
    const finalY = (doc as any).lastAutoTable.finalY || 150;
    if (order.notes) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Observaciones:', 20, finalY + 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const splitNotes = doc.splitTextToSize(order.notes, 170);
      doc.text(splitNotes, 20, finalY + 16);
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generado automáticamente por ${businessSettings.business_name || 'EDUGESTIÓN'}`, 105, 280, { align: 'center' });

    doc.save(`Pedido_${order.id}_${order.cliente.replace(/\s+/g, '_')}.pdf`);
  };

  const generateRemitoPDF = (order: SupplierOrder) => {
    const doc = new jsPDF();
    
    // Business Logo
    if (businessSettings.business_logo) {
      try {
        doc.addImage(businessSettings.business_logo, 'PNG', 20, 10, 30, 30);
      } catch (e) {
        console.error("Error adding logo to PDF", e);
      }
    }

    // Business Header Info
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(businessSettings.business_name || 'EDUGESTIÓN', 60, 20);
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Razón Social: ${businessSettings.business_razon_social || '-'}`, 60, 25);
    doc.text(`CUIT: ${businessSettings.business_cuit || '-'}`, 60, 29);
    doc.text(`Dirección: ${businessSettings.business_address || '-'}, ${businessSettings.business_localidad || '-'}`, 60, 33);
    doc.text(`Tel: ${businessSettings.business_phone || '-'} | Email: ${businessSettings.business_email || '-'}`, 60, 37);

    doc.setTextColor(0);
    doc.setDrawColor(200);
    doc.line(20, 45, 190, 45);

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text('REMITO DE ENTREGA', 105, 55, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Remito N°: ${(order.numero_pedido || order.id).toString().padStart(6, '0')}`, 20, 65);
    doc.text(`Fecha: ${new Date().toLocaleString()}`, 20, 70);
    
    doc.setFontSize(12);
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
      headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 5 },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'center' }
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 150;

    // Signature Area
    doc.setFontSize(10);
    doc.text('Firma del Cliente:', 20, finalY + 30);
    doc.line(55, finalY + 30, 120, finalY + 30);
    doc.text('Aclaración:', 20, finalY + 40);
    doc.line(45, finalY + 40, 120, finalY + 40);

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Este documento no es válido como factura.`, 105, 275, { align: 'center' });
    doc.text(`Generado por ${businessSettings.business_name || 'EDUGESTIÓN'}`, 105, 280, { align: 'center' });

    doc.save(`Remito_${order.id}_${order.cliente.replace(/\s+/g, '_')}.pdf`);
  };

  const updateStatus = async (id: number, newStatus: string) => {
    try {
      const res = await apiFetch(`/api/supplier-orders/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ estado: newStatus })
      });
      
      await unwrapResponse(res);

      setOrders(prev => prev.map(o => {
        if (o.id === id) {
          const updated = { ...o, estado: newStatus as any };
          if (newStatus === 'entregado') {
            generateRemitoPDF(updated);
          }
          return updated;
        }
        return o;
      }));
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Error al actualizar el estado");
    }
  };

  const deleteOrder = async (id: number) => {
    if (!window.confirm("¿Estás seguro de eliminar este pedido?")) return;
    try {
      const res = await apiFetch(`/api/supplier-orders/${id}`, {
        method: 'DELETE'
      });
      
      await unwrapResponse(res);
      
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (error) {
      console.error("Error deleting order:", error);
      alert("Error al eliminar el pedido");
    }
  };

  const handleStartEdit = (order: SupplierOrder) => {
    setEditingOrder(order);
    setEditingItems(order.productos.map(p => ({ ...p })));
    setEditingNotes(order.notes || '');
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
    if (!editingOrder) return;
    try {
      const res = await apiFetch(`/api/supplier-orders/${editingOrder.id}/items`, {
        method: 'PUT',
        body: JSON.stringify({ items: editingItems, notes: editingNotes })
      });
      
      await unwrapResponse(res);

      setIsEditModalOpen(false);
      fetchOrders();
    } catch (error) {
      console.error("Error saving changes:", error);
      alert("Error al guardar los cambios");
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
      const matchFecha = !filterFecha || order.fecha.startsWith(filterFecha);
      const matchProducto = !filterProducto || order.productos.some(p => 
        p.product_name.toLowerCase().includes(filterProducto.toLowerCase()) ||
        p.codigo_unico.toLowerCase().includes(filterProducto.toLowerCase())
      );
      return matchCliente && matchEstado && matchFecha && matchProducto;
    });
  }, [orders, filterCliente, filterEstado, filterFecha, filterProducto]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto custom-scrollbar">
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Pedidos a Proveedor</h1>
          <p className="text-zinc-500 mt-1">Gestión de productos sin stock agrupados por cliente</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="mb-8 p-6 bg-white rounded-2xl border border-zinc-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
            <input 
              type="text"
              placeholder="Buscar por cliente..."
              value={filterCliente}
              onChange={(e) => setFilterCliente(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Producto / Código</label>
          <div className="relative">
            <Package className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
            <input 
              type="text"
              placeholder="Buscar producto..."
              value={filterProducto}
              onChange={(e) => setFilterProducto(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Estado</label>
          <select 
            value={filterEstado}
            onChange={(e) => setFilterEstado(e.target.value)}
            className="w-full px-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all font-medium"
          >
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="pedido_realizado">Pedido Realizado</option>
            <option value="auditar_pedido">Auditar Pedido</option>
            <option value="entregado">Entregado</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</label>
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
            <input 
              type="date"
              value={filterFecha}
              onChange={(e) => setFilterFecha(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {filteredOrders.map((order) => (
          <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-zinc-900 rounded-xl flex items-center justify-center text-white">
                  <User size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-zinc-900">{order.cliente}</h3>
                    <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded">#{order.numero_pedido || order.id}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getStatusStyles(order.estado)}`}>
                      {getStatusLabel(order.estado)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5">
                    <span className="flex items-center gap-1"><Clock size={12} /> {order.fecha ? new Date(order.fecha).toLocaleString() : ''}</span>
                    <span className="flex items-center gap-1"><Package size={12} /> {order.productos.length} productos</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={order.estado}
                  onChange={(e) => updateStatus(order.id, e.target.value)}
                  disabled={order.estado === 'entregado' || !hasPermission('suppliers', 'edit')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border outline-none transition-all ${getStatusStyles(order.estado)} ${order.estado === 'entregado' || !hasPermission('suppliers', 'edit') ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <option value="pendiente">Pendiente</option>
                  <option value="pedido_realizado">Pedido Realizado</option>
                  <option value="auditar_pedido">Auditar Pedido</option>
                  {order.estado === 'entregado' && <option value="entregado">Entregado</option>}
                </select>

                {hasPermission('suppliers', 'delete') && (
                  <button
                    onClick={() => deleteOrder(order.id)}
                    className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    title="Eliminar pedido"
                  >
                    <Trash2 size={18} />
                  </button>
                )}

                {order.estado === 'auditar_pedido' && hasPermission('suppliers', 'edit') && (
                  <button
                    onClick={() => handleStartEdit(order)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 text-zinc-700 rounded-lg text-xs font-bold hover:bg-zinc-200 transition-all"
                  >
                    <Edit2 size={14} /> Editar
                  </button>
                )}
              </div>
            </div>

            {order.notes && (
              <div className="px-6 py-3 bg-zinc-50/50 border-b border-zinc-100">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Observaciones</p>
                <p className="text-xs text-zinc-600 italic">{order.notes}</p>
              </div>
            )}

            {/* Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-zinc-100">
                    <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Producto</th>
                    <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Proveedor</th>
                    <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cantidad</th>
                    <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Código</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {order.productos.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-bold text-zinc-900">{item.product_name}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          item.proveedor === 'Edu' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                        }`}>
                          {item.proveedor}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="font-mono font-black text-zinc-900">{item.cantidad}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-[10px] font-mono text-zinc-400">{item.codigo_unico}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer Actions */}
            <div className="p-4 bg-zinc-50/30 border-t border-zinc-100 flex justify-end gap-3">
               <button 
                onClick={() => generatePDF(order)}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-lg transition-all"
               >
                  <Download size={14} /> Generar PDF pedido proveedor
               </button>
               {order.estado === 'pendiente' && hasPermission('suppliers', 'edit') && (
                 <button 
                  onClick={() => updateStatus(order.id, 'pedido_realizado')}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-800 rounded-lg transition-all shadow-sm"
                 >
                    <Send size={14} /> Marcar como Pedido Realizado
                 </button>
               )}
               {order.estado === 'pedido_realizado' && hasPermission('suppliers', 'edit') && (
                 <button 
                  onClick={() => updateStatus(order.id, 'auditar_pedido')}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-800 rounded-lg transition-all shadow-sm"
                 >
                    <Send size={14} /> Pasar a Auditar Pedido
                 </button>
               )}
               {order.estado === 'auditar_pedido' && hasPermission('suppliers', 'edit') && (
                 <>
                   <button 
                    onClick={() => handleCompleteSale(order.id)}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-800 rounded-lg transition-all shadow-sm"
                   >
                      <CheckCircle2 size={14} /> Completar Entrega
                   </button>
                 </>
               )}
               {order.estado === 'entregado' && (
                 <>
                   <button 
                    onClick={() => generateRemitoPDF(order)}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                   >
                      <Download size={14} /> Descargar remito
                   </button>
                   <div className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-lg">
                      <CheckCircle2 size={14} /> Entrega Realizada
                   </div>
                 </>
               )}
            </div>
          </div>
        ))}

        {filteredOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 text-zinc-300 bg-white rounded-2xl border border-zinc-200 border-dashed">
            <AlertCircle size={64} className="mb-4 opacity-10" />
            <p className="text-lg font-medium">No se encontraron pedidos con los filtros aplicados</p>
            <p className="text-sm">Ajusta los filtros para ver más resultados</p>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {isEditModalOpen && editingOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div>
                <h2 className="text-2xl font-black text-zinc-900">Editar Pedido #{editingOrder.numero_pedido || editingOrder.id}</h2>
                <p className="text-zinc-500 text-sm">Cliente: {editingOrder.cliente}</p>
              </div>
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="p-2 hover:bg-zinc-100 rounded-full transition-all"
              >
                <X size={24} className="text-zinc-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 lg:grid-cols-2 gap-8 custom-scrollbar">
              {/* Left: Current Items */}
              <div className="space-y-6">
                <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Productos en el pedido</h3>
                <div className="space-y-3">
                  {editingItems.map((item) => (
                    <div key={item.product_id} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                      <div className="flex-1">
                        <p className="font-bold text-zinc-900 text-sm">{item.product_name}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">{item.codigo_unico}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg p-1">
                          <button 
                            onClick={() => handleUpdateQuantity(item.product_id, -1)}
                            className="w-6 h-6 flex items-center justify-center hover:bg-zinc-50 rounded text-zinc-400"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="w-8 text-center font-mono font-bold text-sm">{item.cantidad}</span>
                          <button 
                            onClick={() => handleUpdateQuantity(item.product_id, 1)}
                            className="w-6 h-6 flex items-center justify-center hover:bg-zinc-50 rounded text-zinc-400"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <button 
                          onClick={() => handleRemoveItem(item.product_id)}
                          className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {editingItems.length === 0 && (
                    <div className="text-center py-12 text-zinc-400 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                      <Package size={32} className="mx-auto mb-2 opacity-20" />
                      <p className="text-xs">No hay productos en el pedido</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Add Products */}
              <div className="space-y-6">
                <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Agregar productos</h3>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                  <input 
                    type="text"
                    placeholder="Buscar por nombre o código..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => handleAddItem(product)}
                      className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 border border-transparent hover:border-zinc-100 rounded-2xl transition-all text-left"
                    >
                      <div>
                        <p className="font-bold text-zinc-900 text-sm">{product.name}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">{product.codigo_unico} • {product.company}</p>
                      </div>
                      <Plus size={18} className="text-zinc-300" />
                    </button>
                  ))}
                  {productSearch && filteredProducts.length === 0 && (
                    <p className="text-center py-8 text-zinc-400 text-xs">No se encontraron productos</p>
                  )}
                  {!productSearch && (
                    <p className="text-center py-8 text-zinc-400 text-xs">Escribe para buscar productos</p>
                  )}
                </div>
              </div>
            </div>

            <div className="px-8 pb-4">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-2">Observaciones</label>
              <textarea
                value={editingNotes}
                onChange={(e) => setEditingNotes(e.target.value)}
                placeholder="Agregar observaciones al pedido..."
                className="w-full p-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all min-h-[100px] resize-none"
              />
            </div>

            <div className="p-8 border-t border-zinc-100 bg-zinc-50/50 flex justify-end gap-4">
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="px-6 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-100 rounded-2xl transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveChanges}
                className="px-8 py-3 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
