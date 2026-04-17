import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Package, Search, X, AlertTriangle } from 'lucide-react';
import { Product, ProductFormData, ProductFamily, ProductCategory } from '../types';
import { getSocket } from '../utils/socket';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

const socket = getSocket();

export default function ProductModule() {
  const { hasPermission } = useAuth();
  console.log("ProductModule Rendering...");
  const [products, setProducts] = useState<Product[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [newFamilyCategoryId, setNewFamilyCategoryId] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [formData, setFormData] = useState<ProductFormData>({
    code: '',
    name: '',
    description: '',
    cost: 0,
    sale_price: 0,
    stock: 0,
    stock_minimo: 0,
    company: 'Edu',
    family_id: null,
    category_id: null,
    estado: 'activo'
  });

  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [stockFormData, setStockFormData] = useState({ cantidad: 0, costo_unitario: 0 });
  const [selectedProductForStock, setSelectedProductForStock] = useState<Product | null>(null);

  const [isExpireModalOpen, setIsExpireModalOpen] = useState(false);
  const [expireFormData, setExpireFormData] = useState({ cantidad: 0 });
  const [selectedProductForExpire, setSelectedProductForExpire] = useState<Product | null>(null);

  const [totalStockValue, setTotalStockValue] = useState<number>(0);

  useEffect(() => {
    fetchProducts();
    fetchFamilies();
    fetchCategories();
    fetchTotalStockValue();

    socket.on('product_updated', (updatedProduct: Product) => {
      setProducts(prev => {
        const exists = prev.find(p => p.id === updatedProduct.id);
        if (exists) {
          return prev.map(p => p.id === updatedProduct.id ? updatedProduct : p);
        } else {
          return [...prev, updatedProduct].sort((a, b) => a.name.localeCompare(b.name));
        }
      });
      fetchTotalStockValue();
    });

    socket.on('product_deleted', ({ id }) => {
      setProducts(prev => prev.filter(p => p.id !== id));
      fetchTotalStockValue();
    });

    return () => {
      socket.off('product_updated');
      socket.off('product_deleted');
    };
  }, []);

  const fetchProducts = async () => {
    const res = await apiFetch('/api/products?all=true');
    const body = await res.json();
    const data = unwrapResponse(body);
    setProducts(data);
  };

  const fetchFamilies = async () => {
    const res = await apiFetch('/api/families');
    const body = await res.json();
    const data = unwrapResponse(body);
    setFamilies(data);
  };

  const fetchCategories = async () => {
    const res = await apiFetch('/api/config/product-categories?active=true');
    const body = await res.json();
    const data = unwrapResponse(body);
    setCategories(data);
  };

  const fetchTotalStockValue = async () => {
    try {
      const res = await apiFetch('/api/inventory/total-value');
      const body = await res.json();
      const data = unwrapResponse(body);
      setTotalStockValue(data.total);
    } catch (error) {
      console.error("Error fetching total stock value:", error);
    }
  };

  const handleCreateFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFamilyName.trim()) return;

    try {
      const res = await apiFetch('/api/families', {
        method: 'POST',
        body: JSON.stringify({ 
          name: newFamilyName.trim(),
          category_id: newFamilyCategoryId
        })
      });

      const body = await res.json();
      const data = unwrapResponse(body);
      setFamilies(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setFormData(prev => ({ 
        ...prev, 
        family_id: data.id,
        category_id: data.category_id || prev.category_id 
      }));
      setIsFamilyModalOpen(false);
      setNewFamilyName('');
      setNewFamilyCategoryId(null);
    } catch (error) {
      console.error("Error creating family:", error);
      alert("Error al crear familia");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.family_id) {
      alert("La familia es obligatoria");
      return;
    }

    const url = editingProduct ? `/api/products/${editingProduct.id}` : '/api/products';
    const method = editingProduct ? 'PUT' : 'POST';

    try {
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(formData)
      });

      const body = await res.json();
      unwrapResponse(body);

      setIsModalOpen(false);
      setEditingProduct(null);
      setFormData({ code: '', name: '', description: '', cost: 0, sale_price: 0, stock: 0, stock_minimo: 0, company: 'Edu', family_id: null, category_id: null, estado: 'activo' });
      fetchProducts();
      fetchTotalStockValue();
    } catch (error: any) {
      console.error("Error saving product:", error);
      let msg = error.message || "Error al guardar el producto";
      if (error.errors && Array.isArray(error.errors)) {
        const validationMsgs = error.errors.map((e: any) => `${e.path}: ${e.message}`).join('\n');
        msg = `Error de validación:\n${validationMsgs}`;
      }
      alert(msg);
    }
  };

  const handleStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForStock) return;

    try {
      const res = await apiFetch(`/api/products/${selectedProductForStock.id}/stock`, {
        method: 'POST',
        body: JSON.stringify(stockFormData)
      });

      const body = await res.json();
      unwrapResponse(body);

      setIsStockModalOpen(false);
      setSelectedProductForStock(null);
      setStockFormData({ cantidad: 0, costo_unitario: 0 });
      fetchProducts();
      fetchTotalStockValue();
    } catch (error: any) {
      console.error("Error loading stock:", error);
      alert(error.message || "Error al cargar stock");
    }
  };

  const handleExpireSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForExpire) return;

    if (expireFormData.cantidad > selectedProductForExpire.stock) {
      alert("No se puede dar de baja más cantidad que el stock disponible");
      return;
    }

    try {
      const res = await apiFetch(`/api/products/${selectedProductForExpire.id}/expire`, {
        method: 'POST',
        body: JSON.stringify({
          cantidad: expireFormData.cantidad,
          notes: 'Baja/Merma manual'
        })
      });

      const body = await res.json();
      unwrapResponse(body);

      setIsExpireModalOpen(false);
      setExpireFormData({ cantidad: 0 });
      setSelectedProductForExpire(null);
      fetchProducts();
      fetchTotalStockValue();
    } catch (error: any) {
      console.error("Error processing expiration write-off:", error);
      alert(error.message || "Error al procesar la baja");
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      code: product.code || '',
      name: product.name,
      description: product.description,
      cost: product.cost,
      sale_price: product.sale_price,
      stock: product.stock,
      stock_minimo: product.stock_minimo || 0,
      company: product.company,
      family_id: product.family_id,
      category_id: product.category_id,
      estado: product.estado
    });
    setIsModalOpen(true);
  };

  // Helper para mostrar mensajes (Toast)
  const mostrarToast = (mensaje: string) => {
    console.log("[TOAST]:", mensaje);
    // Por ahora usamos alert para asegurar visibilidad inmediata
    alert(mensaje);
  };

  async function handleDeleteProduct(productId: number, productoObjeto: Product) {
    console.log("Iniciando eliminar producto:", productId, productoObjeto);

    try {
      // 2.a Verificar existencia del ID
      if (!productId) throw new Error("productId inválido: " + productId);

      // 2.b Intento de eliminación directa en la BD (vía API)
      console.log("Ejecutando fetch DELETE para:", productId);
      const response = await apiFetch(`/api/products/${productId}`, {
        method: 'DELETE'
      });

      const body = await response.json();
      unwrapResponse(body);

      console.log("PRODUCTO ELIMINADO:", productId);

      // 2.c Actualizar estado UI inmediatamente
      setProducts(prev => prev.filter(p => p.id !== productId));
      fetchTotalStockValue();
      return;
    } catch (err) {
      console.error("Error al eliminar directamente:", err);

      // 3) Fallback imprescindible si el delete falla: soft-delete
      try {
        console.log("Intentando fallback: marcar eliminado/inactivo para:", productId);
        
        // Preparamos los datos para el fallback (marcar como inactivo y eliminado)
        const fallbackData = {
          ...productoObjeto,
          estado: 'inactivo',
          eliminado: 1 // Usamos 1 para true en SQLite
        };

        const responseFallback = await apiFetch(`/api/products/${productId}`, {
          method: 'PUT',
          body: JSON.stringify(fallbackData)
        });

        const bodyFallback = await responseFallback.json();
        unwrapResponse(bodyFallback);

        console.log("PRODUCTO ELIMINADO (via fallback):", productId);
        setProducts(prev => prev.filter(p => p.id !== productId));
        fetchTotalStockValue();
        return;
      } catch (err2) {
        console.error("Fallback también falló:", err2);
        alert("No se pudo eliminar el producto. Ver consola para más detalles.");
        throw err2;
      }
    }
  }

  const filteredProducts = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    
    return products.filter(p => {
      const matchesSearch = !query || (
        p.name.toLowerCase().includes(query) ||
        p.code?.toLowerCase().includes(query) ||
        p.codigo_unico?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.family_name?.toLowerCase().includes(query) ||
        p.category_name?.toLowerCase().includes(query)
      );
      
      const isCritical = p.stock <= (p.stock_minimo || 0);
      const matchesCritical = !showCriticalOnly || isCritical;
      
      return matchesSearch && matchesCritical;
    });
  }, [products, searchTerm, showCriticalOnly]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">
            {showCriticalOnly ? 'Productos con Stock Crítico' : 'Módulo de Productos'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {showCriticalOnly ? 'Listado de productos bajo el stock mínimo' : 'Gestión de inventario y precios'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
          <div className="bg-white px-4 sm:px-6 py-2 rounded-xl border border-zinc-200 shadow-sm flex flex-col items-end">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Valor Total del Stock</span>
            <span className="text-lg sm:text-xl font-black text-zinc-900 font-mono">
              ${(totalStockValue ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          {hasPermission('products', 'create') && (
            <button
              onClick={() => {
                setEditingProduct(null);
                setFormData({ code: '', name: '', description: '', cost: 0, sale_price: 0, stock: 0, stock_minimo: 0, company: 'Edu', family_id: null, category_id: null, estado: 'activo' });
                setIsModalOpen(true);
              }}
              className="flex items-center justify-center gap-2 bg-zinc-900 text-white px-4 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors shadow-sm text-sm sm:text-base"
            >
              <Plus size={20} />
              <span className="whitespace-nowrap">Nuevo Producto</span>
            </button>
          )}
        </div>
      </div>

    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        <div className="p-4 border-bottom border-zinc-100 bg-zinc-50/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1 flex items-center gap-3 bg-white px-3 py-1.5 rounded-lg border border-zinc-200 focus-within:ring-2 focus-within:ring-zinc-900 transition-all">
            <Search className="text-zinc-400 shrink-0" size={20} />
            <input
              type="text"
              placeholder="Buscar productos..."
              className="bg-transparent border-none focus:ring-0 w-full text-zinc-900 placeholder-zinc-400 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              showCriticalOnly 
                ? 'bg-red-100 text-red-600 border border-red-200' 
                : 'bg-zinc-100 text-zinc-500 border border-zinc-200 hover:bg-zinc-200'
            }`}
          >
            <AlertTriangle size={14} />
            Stock Crítico
          </button>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">Producto</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">Categoría</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">Familia</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">Empresa</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Costo</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Venta</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider text-center">Stock</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider text-center">Stock Mín.</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider text-center">Estado</th>
                <th className="px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredProducts.map((product) => (
                <tr key={product.id} className={`hover:bg-zinc-50 transition-colors group ${product.estado === 'inactivo' ? 'opacity-60' : ''}`}>
                  <td className="px-4 sm:px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center ${product.estado === 'inactivo' ? 'bg-zinc-200 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>
                        <Package size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-zinc-900 text-sm sm:text-base">{product.name}</span>
                          {product.stock <= (product.stock_minimo || 0) && (
                            <AlertTriangle size={14} className="text-red-500" title="Stock Crítico" />
                          )}
                          {product.code && <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded font-mono" title="Código Manual">{product.code}</span>}
                          {product.codigo_unico && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono font-bold" title="Código Único Irreversible">{product.codigo_unico}</span>}
                        </div>
                        <div className="text-xs sm:text-sm text-zinc-500 line-clamp-1">{product.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4">
                    <span className="text-xs sm:text-sm text-zinc-600 font-medium">
                      {product.category_name || 'Sin categoría'}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4">
                    <span className="text-xs sm:text-sm text-zinc-600 font-medium">
                      {product.family_name || 'Sin familia'}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] sm:text-xs font-medium ${
                      product.company === 'Edu' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                    }`}>
                      {product.company}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-right text-zinc-600 font-mono text-xs sm:text-sm">${product.cost.toFixed(2)}</td>
                  <td className="px-4 sm:px-6 py-4 text-right text-zinc-900 font-semibold font-mono text-xs sm:text-sm">${product.sale_price.toFixed(2)}</td>
                  <td className="px-4 sm:px-6 py-4 text-center">
                    <span className={`font-medium text-xs sm:text-sm ${product.stock <= product.stock_minimo ? 'text-red-600 bg-red-50 px-2 py-1 rounded-lg' : 'text-zinc-900'}`}>
                      {product.stock}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-center">
                    <span className="text-xs sm:text-sm text-zinc-500 font-mono">
                      {product.stock_minimo || 0}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-center">
                    <span className={`px-2 py-1 rounded-full text-[9px] sm:text-[10px] uppercase font-bold tracking-wider ${
                      product.estado === 'activo' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-zinc-100 text-zinc-500 border border-zinc-200'
                    }`}>
                      {product.estado}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-right">
                    <div className="flex justify-end gap-1 sm:gap-2 transition-opacity">
                      {hasPermission('products', 'edit') && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProductForStock(product);
                              setStockFormData({ cantidad: 0, costo_unitario: product.cost });
                              setIsStockModalOpen(true);
                            }}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            title="Cargar Stock (PEPS)"
                          >
                            <Plus size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProductForExpire(product);
                              setExpireFormData({ cantidad: 0 });
                              setIsExpireModalOpen(true);
                            }}
                            className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                            title="Dar de baja por vencimiento"
                          >
                            <AlertTriangle size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEdit(product)}
                            className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer"
                            title="Editar producto"
                          >
                            <Edit2 size={18} />
                          </button>
                        </>
                      )}
                      {hasPermission('products', 'delete') && (
                        <button
                          type="button"
                          onClick={(e) => {
                            console.log("BOTON TACHO PRESIONADO - ID:", product.id);
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteProduct(product.id, product);
                          }}
                          className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-red-100 flex items-center gap-1"
                          title="Eliminar producto"
                        >
                          <Trash2 size={18} />
                          <span className="text-[10px] font-bold">ELIMINAR</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[95vh]">
            <div className="p-4 sm:p-6 border-b border-zinc-100 flex justify-between items-center shrink-0">
              <h2 className="text-lg sm:text-xl font-bold text-zinc-900">
                {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 p-1">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Código</label>
                  <input
                    required
                    autoFocus
                    type="text"
                    placeholder="Ej: C001"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all font-mono text-sm"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Nombre</label>
                  <input
                    required
                    type="text"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Descripción</label>
                <textarea
                  className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                  rows={2}
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Costo</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Precio Venta</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.sale_price}
                    onChange={(e) => setFormData({ ...formData, sale_price: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Stock Inicial</label>
                  <input
                    required
                    type="number"
                    min="0"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Stock Mínimo</label>
                  <input
                    required
                    type="number"
                    min="0"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.stock_minimo}
                    onChange={(e) => setFormData({ ...formData, stock_minimo: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Empresa</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value as 'Edu' | 'Peti' })}
                  >
                    <option value="Edu">Edu</option>
                    <option value="Peti">Peti</option>
                  </select>
                </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Categoría</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.category_id || ''}
                    onChange={(e) => setFormData({ ...formData, category_id: parseInt(e.target.value) || null })}
                  >
                    <option value="">Seleccionar categoría...</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1 uppercase tracking-wider">Familia</label>
                  <div className="flex gap-2">
                    <select
                      required
                      className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all text-sm"
                      value={formData.family_id || ''}
                      onChange={(e) => setFormData({ ...formData, family_id: parseInt(e.target.value) || null })}
                    >
                      <option value="">Seleccionar familia...</option>
                      {families.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsFamilyModalOpen(true)}
                      className="p-2 bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors"
                      title="Nueva Familia"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-2 uppercase tracking-wider">Estado del Producto</label>
                <div className="flex p-1 bg-zinc-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, estado: 'activo' })}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                      formData.estado === 'activo'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700'
                    }`}
                  >
                    Activo
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, estado: 'inactivo' })}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                      formData.estado === 'inactivo'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700'
                    }`}
                  >
                    Inactivo
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400 mt-2 px-1 italic">
                  * Los productos inactivos no aparecerán en el buscador de ventas.
                </p>
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-3 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors font-bold text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 transition-colors shadow-sm font-bold text-sm"
                >
                  {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isStockModalOpen && selectedProductForStock && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Cargar Stock</h2>
                <p className="text-xs text-zinc-500">{selectedProductForStock.name}</p>
              </div>
              <button onClick={() => setIsStockModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleStockSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Cantidad a Ingresar</label>
                <input
                  required
                  type="number"
                  className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all"
                  value={stockFormData.cantidad}
                  onChange={(e) => setStockFormData({ ...stockFormData, cantidad: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Costo Unitario (Lote)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all"
                  value={stockFormData.costo_unitario}
                  onChange={(e) => setStockFormData({ ...stockFormData, costo_unitario: parseFloat(e.target.value) })}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsStockModalOpen(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  Confirmar Ingreso
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isExpireModalOpen && selectedProductForExpire && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Baja por Vencimiento</h2>
                <p className="text-xs text-zinc-500">{selectedProductForExpire.name}</p>
              </div>
              <button onClick={() => setIsExpireModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleExpireSubmit} className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 flex gap-3">
                <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                <div className="text-xs text-amber-800">
                  <p className="font-bold">Atención</p>
                  <p>Esta operación descontará stock y registrará un gasto por merma.</p>
                  <p className="mt-1">Stock disponible: <span className="font-bold">{selectedProductForExpire.stock}</span></p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Cantidad Vencida</label>
                <input
                  required
                  type="number"
                  min="1"
                  max={selectedProductForExpire.stock}
                  className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                  value={expireFormData.cantidad}
                  onChange={(e) => setExpireFormData({ ...expireFormData, cantidad: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsExpireModalOpen(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-sm"
                >
                  Confirmar Baja
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isFamilyModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-zinc-900">Nueva Familia</h2>
              <button onClick={() => setIsFamilyModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleCreateFamily} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Nombre de la Familia</label>
                <input
                  autoFocus
                  required
                  type="text"
                  className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                  placeholder="Ej: Lácteos, Bebidas..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Categoría Asociada</label>
                <select
                  required
                  className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all"
                  value={newFamilyCategoryId || ''}
                  onChange={(e) => setNewFamilyCategoryId(parseInt(e.target.value) || null)}
                >
                  <option value="">Seleccionar categoría...</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsFamilyModalOpen(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 transition-colors shadow-sm"
                >
                  Crear Familia
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
