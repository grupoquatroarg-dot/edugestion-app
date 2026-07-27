import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Power, RotateCcw, Package, Search, X, AlertTriangle, Boxes, RefreshCw, Loader2, CircleDollarSign, SlidersHorizontal, History, Undo2 } from 'lucide-react';
import { Product, ProductFormData, ProductFamily, ProductCategory } from '../types';
import { getSocket } from '../utils/socket';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

const socket = getSocket();

type InventoryMovement = {
  id: number;
  cantidad: number;
  costo_unitario?: number;
  cantidad_restante?: number;
  descripcion?: string;
  tipo_movimiento: string;
  motivo?: string;
  usuario?: string;
  fecha_ingreso?: string;
  reversion_version?: number;
  anulada_at?: string | null;
  anulada_por?: string | null;
  anulacion_motivo?: string | null;
  reversed_movement_id?: number | null;
  can_revert?: boolean;
  protection_reason?: string;
};


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
  const [lifecycleTarget, setLifecycleTarget] = useState<{
    product: Product;
    action: 'deactivate' | 'reactivate';
  } | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [inventoryProduct, setInventoryProduct] = useState<Product | null>(null);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryReversalTarget, setInventoryReversalTarget] = useState<InventoryMovement | null>(null);
  const [inventoryReversalReason, setInventoryReversalReason] = useState('');
  const [inventoryReversing, setInventoryReversing] = useState(false);

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

  const loadInventoryHistory = async (product: Product) => {
    setInventoryLoading(true);
    setInventoryError('');
    try {
      const response = await apiFetch(`/api/products/${product.id}?action=inventory-history`);
      const body = await response.json();
      const data = unwrapResponse<any>(body);
      if (data?.product) setInventoryProduct((current) => current ? { ...current, ...data.product } : current);
      setInventoryMovements(Array.isArray(data?.movements) ? data.movements : []);
    } catch (error: any) {
      setInventoryError(error?.message || 'No se pudo cargar el historial de inventario.');
    } finally {
      setInventoryLoading(false);
    }
  };

  const openInventoryHistory = (product: Product) => {
    setInventoryProduct(product);
    setInventoryMovements([]);
    setInventoryReversalTarget(null);
    setInventoryReversalReason('');
    loadInventoryHistory(product);
  };

  const closeInventoryHistory = () => {
    if (inventoryReversing) return;
    setInventoryProduct(null);
    setInventoryMovements([]);
    setInventoryError('');
    setInventoryReversalTarget(null);
    setInventoryReversalReason('');
  };

  const submitInventoryReversal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inventoryProduct || !inventoryReversalTarget) return;

    const reason = inventoryReversalReason.trim();
    if (reason.length < 3) {
      setInventoryError('El motivo debe tener al menos 3 caracteres.');
      return;
    }

    setInventoryReversing(true);
    setInventoryError('');
    try {
      const response = await apiFetch(`/api/products/${inventoryProduct.id}?action=inventory-revert`, {
        method: 'POST',
        body: JSON.stringify({ movement_id: inventoryReversalTarget.id, motivo: reason }),
      });
      const body = await response.json();
      unwrapResponse(body);
      setInventoryReversalTarget(null);
      setInventoryReversalReason('');
      await Promise.all([loadInventoryHistory(inventoryProduct), fetchProducts(false)]);
    } catch (error: any) {
      setInventoryError(error?.message || 'No se pudo anular el movimiento.');
    } finally {
      setInventoryReversing(false);
    }
  };

  const formatMovementDate = (value?: string) => {
    if (!value) return 'Sin fecha';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('es-AR');
  };

  const openLifecycleModal = (product: Product) => {
    setLifecycleTarget({
      product,
      action: product.estado === 'activo' ? 'deactivate' : 'reactivate',
    });
    setLifecycleReason('');
  };

  const closeLifecycleModal = () => {
    if (lifecycleLoading) return;
    setLifecycleTarget(null);
    setLifecycleReason('');
  };

  const handleLifecycleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lifecycleTarget) return;

    const motivo = lifecycleReason.trim();
    if (motivo.length < 3) return;

    setLifecycleLoading(true);

    try {
      const response = await apiFetch(
        `/api/products/${lifecycleTarget.product.id}?action=${lifecycleTarget.action}`,
        {
          method: 'POST',
          body: JSON.stringify({ motivo }),
        }
      );
      const body = await response.json();
      unwrapResponse(body);

      await fetchProducts();
      setLifecycleTarget(null);
      setLifecycleReason('');
    } catch (error: any) {
      console.error('Error updating product lifecycle:', error);
      alert(error?.message || 'No se pudo actualizar el estado del producto.');
    } finally {
      setLifecycleLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    
    return products.filter(p => {
      const matchesSearch = !query || (
        p.name.toLowerCase().includes(query) ||
        p.code?.toLowerCase().includes(query) ||
        p.codigo_unico?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.family_name?.toLowerCase().includes(query) ||
        p.category_name?.toLowerCase().includes(query) ||
        p.deactivation_reason?.toLowerCase().includes(query) ||
        p.deactivated_by?.toLowerCase().includes(query)
      );
      
      const isCritical = p.estado === 'activo' && p.stock <= (p.stock_minimo || 0);
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
        if (product.estado === 'activo' && stock <= minimum) summary.critical += 1;
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

  const renderProductActions = (product: Product) => {
    const isInactive = product.estado === 'inactivo';

    return (
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        {hasPermission('products', 'edit') && (
          <>
            <button
              type="button"
              onClick={() => !isInactive && openStockModal(product)}
              disabled={isInactive}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2.5 text-xs font-black text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              title={isInactive ? 'Reactivalo antes de cargar stock' : `Cargar stock de ${product.name}`}
              aria-label={isInactive ? `Producto ${product.name} inactivo; no se puede cargar stock` : `Cargar stock de ${product.name}`}
            >
              <Plus size={16} aria-hidden="true" />
              <span>Cargar stock</span>
            </button>
            <button
              type="button"
              onClick={() => !isInactive && openExpireModal(product)}
              disabled={isInactive}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2.5 text-xs font-black text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 focus:outline-none focus:ring-4 focus:ring-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              title={isInactive ? 'Reactivalo antes de registrar una merma' : `Registrar merma de ${product.name}`}
              aria-label={isInactive ? `Producto ${product.name} inactivo; no se puede registrar merma` : `Registrar merma de ${product.name}`}
            >
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Registrar merma</span>
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
        {hasPermission('products', 'view') && (
          <button
            type="button"
            onClick={() => openInventoryHistory(product)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-2 py-2.5 text-xs font-black text-cyan-800 transition hover:bg-cyan-100 focus:outline-none focus:ring-4 focus:ring-cyan-100"
            title={`Ver historial de inventario de ${product.name}`}
            aria-label={`Ver historial de inventario de ${product.name}`}
          >
            <History size={16} aria-hidden="true" />
            <span>Historial</span>
          </button>
        )}
        {hasPermission('products', 'delete') && (
          <button
            type="button"
            onClick={() => openLifecycleModal(product)}
            className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-black transition focus:outline-none focus:ring-4 ${
              isInactive
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus:ring-emerald-100'
                : 'border-red-200 bg-white text-red-600 hover:bg-red-50 focus:ring-red-100'
            }`}
            title={isInactive ? `Reactivar ${product.name}` : `Dar de baja ${product.name}`}
            aria-label={isInactive ? `Reactivar producto ${product.name}` : `Dar de baja producto ${product.name}`}
          >
            {isInactive ? <RotateCcw size={16} aria-hidden="true" /> : <Power size={16} aria-hidden="true" />}
            <span>{isInactive ? 'Reactivar' : 'Dar de baja'}</span>
          </button>
        )}
      </div>
    );
  };

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
                            {product.estado === 'inactivo' && (
                              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                                <p className="font-black text-slate-700">Producto dado de baja</p>
                                <p className="break-words">{product.deactivation_reason || 'Baja histórica sin motivo registrado.'}</p>
                                {(product.deactivated_by || product.deactivated_at) && (
                                  <p className="mt-1 text-[11px] text-slate-400">
                                    {product.deactivated_by || 'Usuario no informado'}
                                    {product.deactivated_at ? ` · ${new Date(product.deactivated_at).toLocaleString('es-AR')}` : ''}
                                  </p>
                                )}
                              </div>
                            )}
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
      {lifecycleTarget && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form
            onSubmit={handleLifecycleSubmit}
            className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-lg sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div className="flex min-w-0 items-start gap-3">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  lifecycleTarget.action === 'deactivate'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {lifecycleTarget.action === 'deactivate'
                    ? <Power size={22} aria-hidden="true" />
                    : <RotateCcw size={22} aria-hidden="true" />}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-black text-slate-950">
                    {lifecycleTarget.action === 'deactivate' ? 'Dar de baja producto' : 'Reactivar producto'}
                  </h2>
                  <p className="mt-1 break-words text-sm text-slate-500">{lifecycleTarget.product.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeLifecycleModal}
                disabled={lifecycleLoading}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 sm:p-6">
              <div className={`rounded-2xl border p-4 text-sm leading-6 ${
                lifecycleTarget.action === 'deactivate'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}>
                {lifecycleTarget.action === 'deactivate' ? (
                  <>
                    El producto dejará de estar disponible en ventas, compras, rutas y pedidos nuevos.
                    Su stock e historial se conservarán. Si tiene pedidos activos vinculados, la operación será bloqueada.
                    {Number(lifecycleTarget.product.stock || 0) > 0 && (
                      <strong className="mt-2 block">
                        Conserva {Number(lifecycleTarget.product.stock).toLocaleString('es-AR')} unidades en inventario.
                      </strong>
                    )}
                  </>
                ) : (
                  <>El producto volverá a estar disponible para operaciones nuevas. Su stock e historial no se modificarán.</>
                )}
              </div>

              <label className="mt-5 block">
                <span className="text-xs font-black uppercase tracking-wider text-slate-600">
                  Motivo obligatorio
                </span>
                <textarea
                  value={lifecycleReason}
                  onChange={(event) => setLifecycleReason(event.target.value.slice(0, 500))}
                  rows={4}
                  autoFocus
                  className="mt-2 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  placeholder={lifecycleTarget.action === 'deactivate'
                    ? 'Ej.: Producto discontinuado por el proveedor'
                    : 'Ej.: El producto vuelve a comercializarse'}
                  disabled={lifecycleLoading}
                />
              </label>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className={lifecycleReason.trim().length > 0 && lifecycleReason.trim().length < 3 ? 'text-red-600' : 'text-slate-400'}>
                  Mínimo 3 caracteres
                </span>
                <span className="text-slate-400">{lifecycleReason.length}/500</span>
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2 sm:p-6">
              <button
                type="button"
                onClick={closeLifecycleModal}
                disabled={lifecycleLoading}
                className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={lifecycleLoading || lifecycleReason.trim().length < 3}
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  lifecycleTarget.action === 'deactivate'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {lifecycleLoading && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
                {lifecycleTarget.action === 'deactivate' ? 'Confirmar baja' : 'Confirmar reactivación'}
              </button>
            </div>
          </form>
        </div>
      )}

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
                  <label className="block text-xs font-medium text-slate-700 mb-1 uppercase tracking-wider">
                    {editingProduct ? 'Stock actual' : 'Stock inicial'}
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    disabled={Boolean(editingProduct)}
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                  />
                  {editingProduct && (
                    <p className="mt-1 text-[10px] leading-4 text-slate-400">
                      Usá Cargar stock o Registrar merma para modificar existencias con trazabilidad.
                    </p>
                  )}
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
                      {families
                        .filter((family) => family.estado !== 'inactivo' || family.id === formData.family_id)
                        .map((family) => (
                          <option key={family.id} value={family.id}>
                            {family.name}{family.estado === 'inactivo' ? ' (inactiva)' : ''}
                          </option>
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
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Estado del producto</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${
                    formData.estado === 'activo'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}>
                    {formData.estado}
                  </span>
                  <span className="text-xs leading-5 text-slate-500">
                    El estado se cambia desde las acciones Dar de baja o Reactivar para conservar motivo, usuario y fecha.
                  </span>
                </div>
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

      {inventoryProduct && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-3xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 p-4 backdrop-blur sm:p-6">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black text-slate-950">Historial de inventario</h2>
                <p className="truncate text-sm text-slate-500">{inventoryProduct.name} · Stock actual: <strong>{inventoryProduct.stock}</strong></p>
              </div>
              <button type="button" onClick={closeInventoryHistory} disabled={inventoryReversing} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Cerrar historial de inventario" title="Cerrar">
                <X size={22} />
              </button>
            </div>

            <div className="space-y-4 p-4 sm:p-6">
              {inventoryError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{inventoryError}</div>
              )}

              {inventoryLoading ? (
                <div className="flex min-h-40 items-center justify-center gap-3 text-slate-500"><Loader2 className="animate-spin" size={22} /> Cargando movimientos…</div>
              ) : inventoryMovements.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No hay movimientos registrados para este producto.</div>
              ) : (
                <div className="space-y-3">
                  {inventoryMovements.map((movement) => {
                    const isIngress = movement.tipo_movimiento === 'ingreso';
                    const isCancelled = Boolean(movement.anulada_at);
                    const quantity = Math.abs(Number(movement.cantidad || 0));
                    return (
                      <article key={movement.id} className={`rounded-2xl border p-4 ${isCancelled ? 'border-slate-200 bg-slate-50 opacity-80' : 'border-slate-200 bg-white'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${isIngress ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                {isIngress ? 'Ingreso' : 'Egreso'} {isIngress ? '+' : '-'}{quantity}
                              </span>
                              {isCancelled && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-black uppercase text-slate-700">Anulado</span>}
                              {movement.reversed_movement_id && <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-black uppercase text-indigo-700">Contramovimiento</span>}
                            </div>
                            <p className="mt-2 break-words text-sm font-black text-slate-900">{movement.descripcion || movement.motivo || 'Movimiento de inventario'}</p>
                            <p className="mt-1 text-xs text-slate-500">{formatMovementDate(movement.fecha_ingreso)} · {movement.usuario || 'Sistema'}</p>
                            {Number(movement.costo_unitario || 0) > 0 && <p className="mt-1 text-xs text-slate-500">Costo unitario: {formatCurrency(Number(movement.costo_unitario || 0))}</p>}
                            {movement.anulacion_motivo && <p className="mt-2 rounded-xl bg-white p-2 text-xs text-slate-700"><strong>Motivo de anulación:</strong> {movement.anulacion_motivo}</p>}
                            {!movement.can_revert && movement.protection_reason && !isCancelled && <p className="mt-2 text-xs font-bold text-slate-500">{movement.protection_reason}</p>}
                          </div>
                          {hasPermission('products', 'edit') && movement.can_revert && (
                            <button type="button" onClick={() => { setInventoryReversalTarget(movement); setInventoryReversalReason(''); setInventoryError(''); }} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-black text-red-700 hover:bg-red-100">
                              <Undo2 size={16} /> Anular
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {inventoryProduct && inventoryReversalTarget && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form onSubmit={submitInventoryReversal} className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6">
            <h3 className="text-xl font-black text-slate-950">Anular movimiento de inventario</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Se conservará el movimiento original y se creará un contramovimiento auditado. La operación será bloqueada si el stock actual no permite una reversión segura.</p>
            <label className="mt-5 block text-sm font-black text-slate-800" htmlFor="inventory-reversal-reason">Motivo</label>
            <textarea id="inventory-reversal-reason" autoFocus required minLength={3} maxLength={500} value={inventoryReversalReason} onChange={(event) => setInventoryReversalReason(event.target.value)} className="mt-2 min-h-28 w-full rounded-2xl border border-slate-300 p-3 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100" placeholder="Ej.: cantidad cargada por error" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => { if (!inventoryReversing) { setInventoryReversalTarget(null); setInventoryReversalReason(''); } }} disabled={inventoryReversing} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 font-black text-slate-700 disabled:opacity-50">Cancelar</button>
              <button type="submit" disabled={inventoryReversing || inventoryReversalReason.trim().length < 3} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 font-black text-white hover:bg-red-700 disabled:opacity-50">
                {inventoryReversing ? <Loader2 className="animate-spin" size={18} /> : <Undo2 size={18} />} {inventoryReversing ? 'Anulando…' : 'Confirmar anulación'}
              </button>
            </div>
          </form>
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
