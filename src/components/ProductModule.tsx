import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Package, Search, X, AlertTriangle, Boxes, RefreshCw, Loader2, CircleDollarSign, SlidersHorizontal } from 'lucide-react';
import { Product, ProductFormData, ProductFamily, ProductCategory } from '../types';
import { getSocket } from '../utils/socket';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

const socket = getSocket();

export default function ProductModule() {
  const { hasPermission } = useAuth();
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

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetchProducts(true);
    fetchFamilies();
    fetchCategories();

    socket.on('product_updated', (updatedProduct: Product) => {
      setProducts(prev => {
        const exists = prev.find(p => p.id === updatedProduct.id);
        if (exists) {
          return prev.map(p => p.id === updatedProduct.id ? updatedProduct : p);
        } else {
          return [...prev, updatedProduct].sort((a, b) => a.name.localeCompare(b.name));
        }
      });
    });

    socket.on('product_deleted', ({ id }) => {
      setProducts(prev => prev.filter(p => p.id !== id));
    });

    return () => {
      socket.off('product_updated');
      socket.off('product_deleted');
    };
  }, []);

  const fetchProducts = async (showInitialLoader = false) => {
    if (showInitialLoader) setIsLoading(true);
    else setIsRefreshing(true);
    setLoadError('');

    try {
      const res = await apiFetch('/api/products?all=true');
      const body = await res.json();
      const data = unwrapResponse(body);
      setProducts(data || []);
    } catch (error: any) {
      console.error('Error fetching products:', error);
      setLoadError(error?.message || 'No se pudieron cargar los productos.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchFamilies = async () => {
    const res = await apiFetch('/api/config/product-families');
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


  const handleCreateFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFamilyName.trim()) return;

    try {
      const res = await apiFetch('/api/config/product-families', {
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
      const res = await apiFetch(`/api/products/${selectedProductForStock.id}?action=stock`, {
        method: 'POST',
        body: JSON.stringify(stockFormData)
      });

      const body = await res.json();
      unwrapResponse(body);

      setIsStockModalOpen(false);
      setSelectedProductForStock(null);
      setStockFormData({ cantidad: 0, costo_unitario: 0 });
      fetchProducts();
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
      const res = await apiFetch(`/api/products/${selectedProductForExpire.id}?action=expire`, {
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
    try {
      // 2.a Verificar existencia del ID
      if (!productId) throw new Error("productId inválido: " + productId);

      // 2.b Intento de eliminación directa en la BD (vía API)
      const response = await apiFetch(`/api/products/${productId}`, {
        method: 'DELETE'
      });

      const body = await response.json();
      unwrapResponse(body);

      // 2.c Actualizar estado UI inmediatamente
      setProducts(prev => prev.filter(p => p.id !== productId));
      return;
    } catch (err) {
      console.error("Error al eliminar directamente:", err);

      // 3) Fallback imprescindible si el delete falla: soft-delete
      try {
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

        setProducts(prev => prev.filter(p => p.id !== productId));
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

  const stockSummary = useMemo(() => {
    return products.reduce(
      (summary, product) => {
        const stock = Number(product.stock || 0);
        const minimum = Number(product.stock_minimo || 0);
        const cost = Number(product.cost || 0);

        summary.totalUnits += stock;
        summary.totalValue += stock * cost;
        if (product.estado === 'activo') summary.active += 1;
        if (stock <= minimum) summary.critical += 1;
        return summary;
      },
      { active: 0, critical: 0, totalUnits: 0, totalValue: 0 }
    );
  }, [products]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2
    }).format(Number(value || 0));

  const resetProductForm = () => {
    setEditingProduct(null);
    setFormData({
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
  };

  const openNewProductModal = () => {
    resetProductForm();
    setIsModalOpen(true);
  };

  const openStockModal = (product: Product) => {
    setSelectedProductForStock(product);
    setStockFormData({ cantidad: 0, costo_unitario: product.cost });
    setIsStockModalOpen(true);
  };

  const openExpireModal = (product: Product) => {
    setSelectedProductForExpire(product);
    setExpireFormData({ cantidad: 0 });
    setIsExpireModalOpen(true);
  };

  const renderProductActions = (product: Product) => (
    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
      {hasPermission('products', 'edit') && (
        <>
          <button
            type="button"
            onClick={() => openStockModal(product)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2.5 text-xs font-black text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 focus:outline-none focus:ring-4 focus:ring-emerald-100"
            title={`Cargar stock de ${product.name}`}
            aria-label={`Cargar stock de ${product.name}`}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Cargar stock</span>
          </button>
          <button
            type="button"
            onClick={() => openExpireModal(product)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2.5 text-xs font-black text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 focus:outline-none focus:ring-4 focus:ring-amber-100"
            title={`Dar de baja o registrar merma de ${product.name}`}
            aria-label={`Dar de baja o registrar merma de ${product.name}`}
          >
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Dar de baja</span>
          </button>
          <button
            type="button"
            onClick={() => handleEdit(product)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-xs font-black text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100"
            title={`Editar ${product.name}`}
            aria-label={`Editar producto ${product.name}`}
          >
            <Edit2 size={16} aria-hidden="true" />
            <span>Editar</span>
          </button>
        </>
      )}
      {hasPermission('products', 'delete') && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleDeleteProduct(product.id, product);
          }}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-2 py-2.5 text-xs font-black text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-100"
          title={`Eliminar ${product.name}`}
          aria-label={`Eliminar producto ${product.name}`}
        >
          <Trash2 size={16} aria-hidden="true" />
          <span>Eliminar</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-full min-w-0 bg-slate-50/70 px-2 py-3 sm:px-4 sm:py-5 lg:px-6 lg:py-6">
      <div className="mx-auto min-w-0 max-w-[1500px] space-y-4 sm:space-y-5">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-5 py-6 text-white sm:px-8 sm:py-8">
            <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100">
                  <Boxes size={14} aria-hidden="true" />
                  Inventario
                </div>
                <h1 className="text-2xl font-black tracking-tight sm:text-4xl">
                  {showCriticalOnly ? 'Productos con stock crítico' : 'Gestión de productos'}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                  {showCriticalOnly
                    ? 'Revisá rápidamente los artículos que alcanzaron o superaron su nivel mínimo.'
                    : 'Administrá productos, precios, stock y alertas desde una vista clara y centralizada.'}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <button
                  type="button"
                  onClick={() => fetchProducts(false)}
                  disabled={isRefreshing}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  title="Actualizar listado de productos"
                  aria-label="Actualizar listado de productos"
                >
                  <RefreshCw size={17} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
                  {isRefreshing ? 'Actualizando…' : 'Actualizar'}
                </button>
                {hasPermission('products', 'create') && (
                  <button
                    type="button"
                    onClick={openNewProductModal}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-white/60 sm:w-auto"
                  >
                    <Plus size={18} aria-hidden="true" />
                    Nuevo producto
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px bg-slate-200 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Productos activos</p>
                  <p className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{stockSummary.active}</p>
                  <p className="mt-1 text-xs text-slate-500">de {products.length} registrados</p>
                </div>
                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><Package size={20} aria-hidden="true" /></div>
              </div>
            </div>
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Unidades en stock</p>
                  <p className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{stockSummary.totalUnits.toLocaleString('es-AR')}</p>
                  <p className="mt-1 text-xs text-slate-500">existencia total</p>
                </div>
                <div className="rounded-xl bg-cyan-50 p-2.5 text-cyan-700"><Boxes size={20} aria-hidden="true" /></div>
              </div>
            </div>
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Stock crítico</p>
                  <p className={`mt-2 text-2xl font-black sm:text-3xl ${stockSummary.critical > 0 ? 'text-red-600' : 'text-slate-950'}`}>{stockSummary.critical}</p>
                  <p className="mt-1 text-xs text-slate-500">requieren revisión</p>
                </div>
                <div className={`rounded-xl p-2.5 ${stockSummary.critical > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}><AlertTriangle size={20} aria-hidden="true" /></div>
              </div>
            </div>
            <div className="bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Valor del inventario</p>
                  <p className="mt-2 truncate text-xl font-black text-slate-950 sm:text-2xl" title={formatCurrency(stockSummary.totalValue)}>{formatCurrency(stockSummary.totalValue)}</p>
                  <p className="mt-1 text-xs text-slate-500">stock valorizado al costo</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600"><CircleDollarSign size={20} aria-hidden="true" /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
          <div className="border-b border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-950">Listado de productos</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {filteredProducts.length} resultado{filteredProducts.length === 1 ? '' : 's'} visible{filteredProducts.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:flex-1 lg:justify-end xl:max-w-3xl">
                <label className="flex min-h-11 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 transition focus-within:border-indigo-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-100">
                  <Search className="shrink-0 text-slate-400" size={18} aria-hidden="true" />
                  <span className="sr-only">Buscar productos</span>
                  <input
                    type="search"
                    placeholder="Buscar por nombre, código, familia o categoría…"
                    className="w-full border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                      title="Limpiar búsqueda"
                      aria-label="Limpiar búsqueda"
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => setShowCriticalOnly((current) => !current)}
                  aria-pressed={showCriticalOnly}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition focus:outline-none focus:ring-4 ${
                    showCriticalOnly
                      ? 'border-red-200 bg-red-50 text-red-700 ring-red-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-100'
                  }`}
                  title={showCriticalOnly ? 'Mostrar todos los productos' : 'Mostrar solamente stock crítico'}
                >
                  <SlidersHorizontal size={17} aria-hidden="true" />
                  {showCriticalOnly ? 'Mostrando críticos' : 'Filtrar críticos'}
                </button>
              </div>
            </div>
          </div>

          {loadError && products.length > 0 && !isLoading && (
            <div className="mx-4 mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                <div><p className="font-black">No se pudo actualizar el listado</p><p className="mt-0.5 text-xs text-amber-700">Se mantienen visibles los últimos datos cargados.</p></div>
              </div>
              <button type="button" onClick={() => fetchProducts(false)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-800 transition hover:bg-amber-100">
                <RefreshCw size={14} aria-hidden="true" /> Reintentar
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3 p-5" role="status" aria-live="polite">
              <div className="flex items-center gap-3 text-sm font-bold text-slate-600">
                <Loader2 size={18} className="animate-spin text-indigo-600" aria-hidden="true" />
                Cargando productos…
              </div>
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : loadError && products.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center" role="alert">
              <div className="mb-4 rounded-2xl bg-red-50 p-4 text-red-600"><AlertTriangle size={28} aria-hidden="true" /></div>
              <h3 className="text-lg font-black text-slate-950">No pudimos cargar los productos</h3>
              <p className="mt-2 max-w-md text-sm text-slate-500">{loadError}</p>
              <button
                type="button"
                onClick={() => fetchProducts(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                <RefreshCw size={16} aria-hidden="true" />
                Reintentar
              </button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-4 rounded-2xl bg-slate-100 p-4 text-slate-500"><Package size={30} aria-hidden="true" /></div>
              <h3 className="text-lg font-black text-slate-950">
                {products.length === 0 ? 'Todavía no hay productos' : 'No encontramos resultados'}
              </h3>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                {products.length === 0
                  ? 'Creá el primer producto para comenzar a gestionar el inventario.'
                  : 'Probá modificando la búsqueda o desactivando el filtro de stock crítico.'}
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                {(searchTerm || showCriticalOnly) && (
                  <button
                    type="button"
                    onClick={() => { setSearchTerm(''); setShowCriticalOnly(false); }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    Limpiar filtros
                  </button>
                )}
                {products.length === 0 && hasPermission('products', 'create') && (
                  <button type="button" onClick={openNewProductModal} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700">
                    Crear producto
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid min-w-0 gap-4 p-3 sm:p-4 xl:grid-cols-2">
              {filteredProducts.map((product) => {
                const isCritical = Number(product.stock) <= Number(product.stock_minimo || 0);

                return (
                  <article
                    key={product.id}
                    className={`min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                      isCritical ? 'border-red-200' : 'border-slate-200'
                    } ${product.estado === 'inactivo' ? 'opacity-70' : ''}`}
                  >
                    <div className="p-4 sm:p-5">
                      <div className="flex min-w-0 flex-col gap-4 min-[460px]:flex-row min-[460px]:items-start min-[460px]:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                            isCritical
                              ? 'border-red-100 bg-red-50 text-red-600'
                              : 'border-indigo-100 bg-indigo-50 text-indigo-600'
                          }`}>
                            <Package size={20} aria-hidden="true" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="min-w-0 break-words text-base font-black leading-5 text-slate-950">
                                {product.name}
                              </h3>
                              <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                                product.estado === 'activo'
                                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                                  : 'border-slate-200 bg-slate-100 text-slate-500'
                              }`}>
                                {product.estado}
                              </span>
                              {isCritical && (
                                <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-red-600">
                                  Stock crítico
                                </span>
                              )}
                            </div>

                            <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                              {product.description || 'Sin descripción'}
                            </p>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {product.code && (
                                <span className="max-w-full break-all rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] font-bold text-slate-600">
                                  Código: {product.code}
                                </span>
                              )}
                              {product.codigo_unico && (
                                <span className="max-w-full break-all rounded-md bg-indigo-50 px-2 py-1 font-mono text-[10px] font-black text-indigo-700">
                                  ID: {product.codigo_unico}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className={`shrink-0 rounded-2xl px-4 py-3 text-left min-[460px]:text-right ${
                          isCritical ? 'bg-red-50' : 'bg-emerald-50'
                        }`}>
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Stock actual</p>
                          <p className={`mt-1 text-2xl font-black ${isCritical ? 'text-red-600' : 'text-emerald-700'}`}>
                            {Number(product.stock || 0).toLocaleString('es-AR')}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500">mínimo {product.stock_minimo || 0}</p>
                        </div>
                      </div>

                      <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Precio de venta</dt>
                          <dd className="mt-1 break-words font-mono text-sm font-black text-slate-950">{formatCurrency(product.sale_price)}</dd>
                        </div>
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Costo</dt>
                          <dd className="mt-1 break-words font-mono text-sm font-bold text-slate-700">{formatCurrency(product.cost)}</dd>
                        </div>
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Familia</dt>
                          <dd className="mt-1 break-words text-sm font-bold text-slate-700">{product.family_name || 'Sin familia'}</dd>
                        </div>
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Categoría</dt>
                          <dd className="mt-1 break-words text-sm font-bold text-slate-700">{product.category_name || 'Sin categoría'}</dd>
                        </div>
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Empresa</dt>
                          <dd className="mt-1">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                              product.company === 'Edu'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}>
                              {product.company}
                            </span>
                          </dd>
                        </div>
                        <div className="min-w-0 bg-slate-50 p-3">
                          <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Margen unitario</dt>
                          <dd className="mt-1 break-words font-mono text-sm font-black text-indigo-700">
                            {formatCurrency(Number(product.sale_price || 0) - Number(product.cost || 0))}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="border-t border-slate-100 bg-slate-50/80 p-3 sm:p-4">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Acciones</p>
                      {renderProductActions(product)}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200 sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-3xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </h2>
              <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="Cerrar formulario" aria-label="Cerrar formulario de producto">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-5 sm:p-6 sm:pb-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Código</label>
                  <input
                    required
                    autoFocus
                    type="text"
                    placeholder="Ej: C001"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-mono text-sm"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Nombre</label>
                  <input
                    required
                    type="text"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Descripción</label>
                <textarea
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                  rows={2}
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Costo</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Precio Venta</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.sale_price}
                    onChange={(e) => setFormData({ ...formData, sale_price: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Stock Inicial</label>
                  <input
                    required
                    type="number"
                    min="0"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Stock Mínimo</label>
                  <input
                    required
                    type="number"
                    min="0"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.stock_minimo}
                    onChange={(e) => setFormData({ ...formData, stock_minimo: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Empresa</label>
                  <select
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value as 'Edu' | 'Peti' })}
                  >
                    <option value="Edu">Edu</option>
                    <option value="Peti">Peti</option>
                  </select>
                </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Categoría</label>
                  <select
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">Familia</label>
                  <div className="flex flex-col gap-2 min-[420px]:flex-row">
                    <select
                      required
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
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
                      className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-black text-indigo-700 transition hover:bg-indigo-100 min-[420px]:w-auto"
                      title="Crear nueva familia"
                      aria-label="Crear nueva familia de producto"
                    >
                      <Plus size={17} aria-hidden="true" />
                      <span>Nueva familia</span>
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2 uppercase tracking-wider">Estado del Producto</label>
                <div className="flex p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, estado: 'activo' })}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                      formData.estado === 'activo'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Activo
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, estado: 'inactivo' })}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                      formData.estado === 'inactivo'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Inactivo
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 px-1 italic">
                  * Los productos inactivos no aparecerán en el buscador de ventas.
                </p>
              </div>
              <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-4 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:flex-row sm:px-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-slate-600 hover:bg-slate-50 transition-colors font-bold text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-white hover:bg-indigo-700 transition-colors shadow-sm font-bold text-sm"
                >
                  {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isStockModalOpen && selectedProductForStock && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200 sm:max-h-[92dvh] sm:max-w-sm sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Cargar Stock</h2>
                <p className="text-xs text-slate-500">{selectedProductForStock.name}</p>
              </div>
              <button type="button" onClick={() => setIsStockModalOpen(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="Cerrar" aria-label="Cerrar carga de stock">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleStockSubmit} className="space-y-4 p-4 pb-5 sm:p-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cantidad a Ingresar</label>
                <input
                  required
                  type="number"
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  value={stockFormData.cantidad}
                  onChange={(e) => setStockFormData({ ...stockFormData, cantidad: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Costo Unitario (Lote)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  value={stockFormData.costo_unitario}
                  onChange={(e) => setStockFormData({ ...stockFormData, costo_unitario: parseFloat(e.target.value) })}
                />
              </div>
              <div className="flex flex-col-reverse gap-2 min-[420px]:flex-row">
                <button
                  type="button"
                  onClick={() => setIsStockModalOpen(false)}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-11 flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
                >
                  Confirmar Ingreso
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isExpireModalOpen && selectedProductForExpire && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200 sm:max-h-[92dvh] sm:max-w-sm sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Baja por Vencimiento</h2>
                <p className="text-xs text-slate-500">{selectedProductForExpire.name}</p>
              </div>
              <button type="button" onClick={() => setIsExpireModalOpen(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="Cerrar" aria-label="Cerrar registro de baja">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleExpireSubmit} className="space-y-4 p-4 pb-5 sm:p-6">
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 flex gap-3">
                <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                <div className="text-xs text-amber-800">
                  <p className="font-bold">Atención</p>
                  <p>Esta operación descontará stock y registrará un gasto por merma.</p>
                  <p className="mt-1">Stock disponible: <span className="font-bold">{selectedProductForExpire.stock}</span></p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cantidad Vencida</label>
                <input
                  required
                  type="number"
                  min="1"
                  max={selectedProductForExpire.stock}
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                  value={expireFormData.cantidad}
                  onChange={(e) => setExpireFormData({ ...expireFormData, cantidad: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex flex-col-reverse gap-2 min-[420px]:flex-row">
                <button
                  type="button"
                  onClick={() => setIsExpireModalOpen(false)}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-11 flex-1 rounded-xl bg-amber-600 px-4 py-2.5 font-bold text-white shadow-sm transition-colors hover:bg-amber-700"
                >
                  Confirmar Baja
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isFamilyModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200 sm:max-h-[92dvh] sm:max-w-sm sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
              <h2 className="text-xl font-bold text-slate-900">Nueva Familia</h2>
              <button type="button" onClick={() => setIsFamilyModalOpen(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="Cerrar" aria-label="Cerrar nueva familia">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleCreateFamily} className="space-y-4 p-4 pb-5 sm:p-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre de la Familia</label>
                <input
                  autoFocus
                  required
                  type="text"
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                  placeholder="Ej: Lácteos, Bebidas..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Categoría Asociada</label>
                <select
                  required
                  className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  value={newFamilyCategoryId || ''}
                  onChange={(e) => setNewFamilyCategoryId(parseInt(e.target.value) || null)}
                >
                  <option value="">Seleccionar categoría...</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col-reverse gap-2 min-[420px]:flex-row">
                <button
                  type="button"
                  onClick={() => setIsFamilyModalOpen(false)}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 font-bold text-white shadow-sm transition-colors hover:bg-indigo-700"
                >
                  Crear Familia
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
