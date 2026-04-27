import React, { useEffect, useState } from 'react';
import { Plus, Search, X, FileText, Calendar, User, Trash2, Save, Eye } from 'lucide-react';
import { Product, PurchaseInvoice } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

type InvoiceFormItem = {
  product_id: number | string;
  cantidad: number;
  costo_unitario: number;
};

type ProviderForm = {
  nombre: string;
  cuit: string;
  telefono: string;
  email: string;
  direccion: string;
};

const emptyProviderForm: ProviderForm = {
  nombre: '',
  cuit: '',
  telefono: '',
  email: '',
  direccion: '',
};

export default function PurchaseInvoiceModule() {
  const { hasPermission } = useAuth();
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreatingNewProduct, setIsCreatingNewProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);

  const [formData, setFormData] = useState({
    numero_factura: '',
    proveedor_id: 0,
    fecha_compra: new Date().toISOString().split('T')[0],
    metodo_pago: 'efectivo',
    items: [] as InvoiceFormItem[],
  });

  const [currentItem, setCurrentItem] = useState({
    product_id: 0 as number | string,
    cantidad: 1,
    costo_unitario: 0,
  });

  useEffect(() => {
    fetchInvoices();
    fetchProducts();
    fetchProveedores();
  }, []);

  const handleApiJson = async (res: Response) => {
    const body = await res.json();
    return unwrapResponse(body);
  };

  const fetchProveedores = async () => {
    try {
      const res = await apiFetch('/api/proveedores');
      const data = await handleApiJson(res);
      setProveedores(data || []);
    } catch (error) {
      console.error('Error fetching proveedores:', error);
    }
  };

  const fetchInvoices = async () => {
    try {
      const res = await apiFetch('/api/purchase-invoices');
      const data = await handleApiJson(res);
      setInvoices(data || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await apiFetch('/api/products?all=true');
      const data = await handleApiJson(res);
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const fetchInvoiceDetails = async (id: number) => {
    try {
      const res = await apiFetch(`/api/purchase-invoices?id=${id}`);
      const data = await handleApiJson(res);
      setSelectedInvoice(data);
      setIsViewModalOpen(true);
    } catch (error) {
      console.error('Error fetching invoice details:', error);
      alert('Error al obtener el detalle de la factura');
    }
  };

  const resetCurrentItem = () => {
    setCurrentItem({ product_id: 0, cantidad: 1, costo_unitario: 0 });
    setIsCreatingNewProduct(false);
    setNewProductName('');
  };

  const resetForm = () => {
    setFormData({
      numero_factura: '',
      proveedor_id: 0,
      fecha_compra: new Date().toISOString().split('T')[0],
      metodo_pago: 'efectivo',
      items: [],
    });
    resetCurrentItem();
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!providerForm.nombre.trim()) {
      alert('Ingrese el nombre del proveedor');
      return;
    }

    try {
      const res = await apiFetch('/api/proveedores', {
        method: 'POST',
        body: JSON.stringify({
          nombre: providerForm.nombre.trim(),
          cuit: providerForm.cuit.trim(),
          telefono: providerForm.telefono.trim(),
          email: providerForm.email.trim(),
          direccion: providerForm.direccion.trim(),
          estado: 'activo',
        }),
      });

      const createdProvider = await handleApiJson(res);
      await fetchProveedores();

      if (createdProvider?.id) {
        setFormData((prev) => ({ ...prev, proveedor_id: Number(createdProvider.id) }));
      }

      setProviderForm(emptyProviderForm);
      setIsProviderModalOpen(false);
    } catch (error: any) {
      console.error('Error creating provider:', error);
      alert(error?.message || 'Error al crear proveedor');
    }
  };

  const handleAddItem = () => {
    const isNewValid = isCreatingNewProduct && newProductName.trim() !== '';
    const isExistingValid = !isCreatingNewProduct && currentItem.product_id !== 0;

    if (!(isNewValid || isExistingValid) || currentItem.cantidad <= 0) return;

    const finalProductId = isCreatingNewProduct ? `new:${newProductName.trim()}` : currentItem.product_id;

    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { ...currentItem, product_id: finalProductId }],
    }));

    resetCurrentItem();
  };

  const handleRemoveItem = (index: number) => {
    setFormData((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const getPendingItemsForSubmit = () => {
    const isNewValid = isCreatingNewProduct && newProductName.trim() !== '';
    const isExistingValid = !isCreatingNewProduct && currentItem.product_id !== 0;
    let finalItems = [...formData.items];

    if ((isNewValid || isExistingValid) && currentItem.cantidad > 0) {
      const finalProductId = isCreatingNewProduct ? `new:${newProductName.trim()}` : currentItem.product_id;
      finalItems = [...finalItems, { ...currentItem, product_id: finalProductId }];
    }

    return finalItems;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalItems = getPendingItemsForSubmit();

    if (finalItems.length === 0) {
      alert('Debe agregar al menos un producto a la lista usando el boton +');
      return;
    }

    if (formData.proveedor_id === 0) {
      alert('Seleccione un proveedor');
      return;
    }

    const total = finalItems.reduce((sum, item) => sum + item.cantidad * item.costo_unitario, 0);

    try {
      const res = await apiFetch('/api/purchase-invoices', {
        method: 'POST',
        body: JSON.stringify({
          proveedor_id: formData.proveedor_id,
          numero_factura: formData.numero_factura,
          fecha: formData.fecha_compra,
          metodo_pago: formData.metodo_pago,
          total,
          items: finalItems,
        }),
      });

      await handleApiJson(res);
      setIsModalOpen(false);
      resetForm();
      await Promise.all([fetchInvoices(), fetchProducts(), fetchProveedores()]);
    } catch (error: any) {
      console.error('Error submitting invoice:', error);
      alert(error?.message || 'Error al registrar factura');
    }
  };

  const filteredInvoices = invoices.filter((inv) => {
    const numero = String(inv.numero_factura || '').toLowerCase();
    const proveedor = String((inv as any).proveedor || '').toLowerCase();
    const term = searchTerm.toLowerCase();
    return numero.includes(term) || proveedor.includes(term);
  });

  const totalInvoice = formData.items.reduce((sum, item) => sum + item.cantidad * item.costo_unitario, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Facturas de Compra</h1>
          <p className="text-zinc-500 mt-1">Gestion de ingresos de mercaderia y costos PEPS</p>
        </div>
        {hasPermission('products', 'create') && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-xl hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 font-bold"
          >
            <FileText size={20} />
            Registrar Factura
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por numero o proveedor..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Nro. Factura</th>
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Proveedor</th>
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total</th>
                <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-zinc-50 transition-colors group">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Calendar size={14} className="text-zinc-400" />
                      <span className="text-sm">{(inv as any).fecha_compra}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-zinc-900">{inv.numero_factura}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-zinc-600">
                      <User size={14} className="text-zinc-400" />
                      <span className="text-sm">{(inv as any).proveedor}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-black text-zinc-900 font-mono">
                      ${(inv.total ?? 0).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => fetchInvoiceDetails(inv.id)}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
                    >
                      <Eye size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
              <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                <FileText className="text-zinc-400" />
                Registrar Factura de Compra
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
              <div className="p-6 grid grid-cols-3 gap-6 border-b border-zinc-100">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest">Proveedor</label>
                    {hasPermission('suppliers', 'create') && (
                      <button
                        type="button"
                        onClick={() => setIsProviderModalOpen(true)}
                        className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
                      >
                        + Crear proveedor
                      </button>
                    )}
                  </div>
                  <select
                    required
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    value={formData.proveedor_id}
                    onChange={(e) => setFormData({ ...formData, proveedor_id: parseInt(e.target.value, 10) || 0 })}
                  >
                    <option value={0}>Seleccionar proveedor</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Nro. Factura</label>
                  <input
                    required
                    type="text"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    value={formData.numero_factura}
                    onChange={(e) => setFormData({ ...formData, numero_factura: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Fecha de compra</label>
                  <input
                    required
                    type="date"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    value={formData.fecha_compra}
                    onChange={(e) => setFormData({ ...formData, fecha_compra: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Metodo de pago</label>
                  <select
                    required
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
                    value={formData.metodo_pago}
                    onChange={(e) => setFormData({ ...formData, metodo_pago: e.target.value })}
                  >
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="mercado_pago">Mercado Pago</option>
                    <option value="cheque">Cheque</option>
                    <option value="Cta Cte">Cta Cte</option>
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col p-6">
                <h3 className="text-sm font-bold text-zinc-900 mb-4">Productos en factura</h3>

                <div className="grid grid-cols-12 gap-4 mb-4 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                  <div className="col-span-6">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Producto</label>
                    {!isCreatingNewProduct ? (
                      <select
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-zinc-900"
                        value={currentItem.product_id}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'new') {
                            setIsCreatingNewProduct(true);
                            setCurrentItem({ ...currentItem, product_id: 'new' });
                            return;
                          }
                          const pid = parseInt(val, 10) || 0;
                          const product = products.find((p) => p.id === pid);
                          setCurrentItem({ ...currentItem, product_id: pid, costo_unitario: product?.cost || 0 });
                        }}
                      >
                        <option value={0}>Seleccionar producto...</option>
                        <option value="new" className="font-bold text-emerald-600">+ Crear nuevo producto...</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Nombre del nuevo producto..."
                          className="flex-1 px-3 py-2 rounded-lg border border-emerald-200 outline-none focus:ring-2 focus:ring-emerald-500"
                          value={newProductName}
                          onChange={(e) => setNewProductName(e.target.value)}
                        />
                        <button type="button" onClick={resetCurrentItem} className="p-2 text-zinc-400 hover:text-zinc-600">
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Cantidad</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full px-3 py-2 rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-zinc-900"
                      value={currentItem.cantidad}
                      onChange={(e) => setCurrentItem({ ...currentItem, cantidad: parseInt(e.target.value, 10) || 0 })}
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Costo unitario</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-zinc-900"
                      value={currentItem.costo_unitario}
                      onChange={(e) => setCurrentItem({ ...currentItem, costo_unitario: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-1 flex items-end">
                    <button
                      type="button"
                      onClick={handleAddItem}
                      title="Agregar producto a la lista"
                      className="w-full h-10 bg-emerald-600 text-white rounded-lg flex items-center justify-center hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto border border-zinc-100 rounded-xl">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white border-b border-zinc-100">
                      <tr>
                        <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase">Producto</th>
                        <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase text-center">Cantidad</th>
                        <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase text-right">Costo unit.</th>
                        <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase text-right">Subtotal</th>
                        <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {formData.items.map((item, index) => {
                        const productName =
                          typeof item.product_id === 'string' && item.product_id.startsWith('new:')
                            ? `${item.product_id.replace('new:', '')} (Nuevo)`
                            : products.find((p) => p.id === item.product_id)?.name || '';

                        return (
                          <tr key={index} className="hover:bg-zinc-50">
                            <td className="px-4 py-2 text-sm text-zinc-900">{productName}</td>
                            <td className="px-4 py-2 text-sm text-zinc-900 text-center">{item.cantidad}</td>
                            <td className="px-4 py-2 text-sm text-zinc-900 text-right font-mono">${(item.costo_unitario ?? 0).toLocaleString()}</td>
                            <td className="px-4 py-2 text-sm font-bold text-zinc-900 text-right font-mono">${((item.cantidad ?? 0) * (item.costo_unitario ?? 0)).toLocaleString()}</td>
                            <td className="px-4 py-2 text-right">
                              <button type="button" onClick={() => handleRemoveItem(index)} className="text-red-400 hover:text-red-600 p-1">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total factura</span>
                  <span className="text-2xl font-black text-zinc-900 font-mono">${(totalInvoice ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2 rounded-xl border border-zinc-200 text-zinc-600 font-bold hover:bg-white transition-all">
                    Cancelar
                  </button>
                  {hasPermission('products', 'edit') && (
                    <button type="submit" className="px-8 py-2 rounded-xl bg-zinc-900 text-white font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 flex items-center gap-2">
                      <Save size={18} />
                      Guardar factura
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isProviderModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
              <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                <User className="text-zinc-400" />
                Crear proveedor
              </h2>
              <button onClick={() => setIsProviderModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateProvider} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Nombre</label>
                <input required type="text" className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all" value={providerForm.nombre} onChange={(e) => setProviderForm({ ...providerForm, nombre: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">CUIT</label>
                  <input type="text" className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all" value={providerForm.cuit} onChange={(e) => setProviderForm({ ...providerForm, cuit: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Telefono</label>
                  <input type="text" className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all" value={providerForm.telefono} onChange={(e) => setProviderForm({ ...providerForm, telefono: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Email</label>
                <input type="email" className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all" value={providerForm.email} onChange={(e) => setProviderForm({ ...providerForm, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Direccion</label>
                <input type="text" className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none transition-all" value={providerForm.direccion} onChange={(e) => setProviderForm({ ...providerForm, direccion: e.target.value })} />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsProviderModalOpen(false)} className="px-6 py-2 rounded-xl border border-zinc-200 text-zinc-600 font-bold hover:bg-zinc-50 transition-all">Cancelar</button>
                <button type="submit" className="px-8 py-2 rounded-xl bg-zinc-900 text-white font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 flex items-center gap-2">
                  <Save size={18} />
                  Crear proveedor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isViewModalOpen && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Detalle de factura</h2>
                <p className="text-xs text-zinc-500">Factura Nro. {selectedInvoice.numero_factura}</p>
              </div>
              <button onClick={() => setIsViewModalOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase block mb-1">Proveedor</span>
                  <span className="text-sm font-bold text-zinc-900">{(selectedInvoice as any).proveedor}</span>
                </div>
                <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase block mb-1">Fecha</span>
                  <span className="text-sm font-bold text-zinc-900">{(selectedInvoice as any).fecha_compra}</span>
                </div>
              </div>
              <div className="border border-zinc-100 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-zinc-50 border-b border-zinc-100">
                    <tr>
                      <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase">Producto</th>
                      <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase text-center">Cant.</th>
                      <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase text-right">Costo</th>
                      <th className="px-4 py-2 text-[10px] font-bold text-zinc-400 uppercase text-right">Restante</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {(selectedInvoice as any).items?.map((item: any) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2 text-sm text-zinc-900">{item.product_name}</td>
                        <td className="px-4 py-2 text-sm text-zinc-900 text-center">{item.cantidad}</td>
                        <td className="px-4 py-2 text-sm text-zinc-900 text-right font-mono">${(item.costo_unitario ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-2 text-sm text-right">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.cantidad_restante > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400'}`}>
                            {item.cantidad_restante}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <div className="text-right">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase block">Total factura</span>
                  <span className="text-2xl font-black text-zinc-900 font-mono">${(selectedInvoice.total ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-end">
              <button onClick={() => setIsViewModalOpen(false)} className="px-6 py-2 rounded-xl bg-zinc-900 text-white font-bold hover:bg-zinc-800 transition-all">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
