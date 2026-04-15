import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Percent, Calculator, Eye, CheckCircle2, History, Filter, AlertCircle } from 'lucide-react';
import { Product, ProductFamily } from '../types';
import { unwrapResponse, apiFetch } from '../utils/api';

interface PriceUpdateHistory {
  id: number;
  fecha: string;
  usuario: string;
  alcance: string;
  tipo_cambio: string;
  valor: number;
  productos_afectados: number;
}

export default function BulkPriceUpdate() {
  const [products, setProducts] = useState<Product[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [previewProducts, setPreviewProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<PriceUpdateHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Filters
  const [scope, setScope] = useState<'all' | 'family' | 'company' | 'manual'>('all');
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState(true);

  // Change logic
  const [changeType, setChangeType] = useState<'increase_pct' | 'decrease_pct' | 'increase_fixed' | 'decrease_fixed' | 'replace_margin' | 'recalculate_peps'>('increase_pct');
  const [changeValue, setChangeValue] = useState<number>(0);
  const [targetField, setTargetField] = useState<'cost' | 'sale_price'>('sale_price');
  const [updateSalePrice, setUpdateSalePrice] = useState(false);
  const [newMargin, setNewMargin] = useState<number>(30);

  useEffect(() => {
    fetchFamilies();
    fetchProducts();
    fetchHistory();
  }, []);

  const fetchFamilies = async () => {
    const res = await apiFetch('/api/families');
    const body = await res.json();
    const data = unwrapResponse(body);
    setFamilies(data);
  };

  const fetchProducts = async () => {
    const res = await apiFetch('/api/products');
    const body = await res.json();
    const data = unwrapResponse(body);
    setProducts(data);
  };

  const fetchHistory = async () => {
    const res = await apiFetch('/api/bulk-price/history');
    const body = await res.json();
    const data = unwrapResponse(body);
    setHistory(data);
  };

  const fetchPreview = async () => {
    setLoading(true);
    try {
      let productIdToPreview = selectedProductId;
      if (scope === 'manual' && selectedProductId) {
        const found = products.find(p => p.id.toString() === selectedProductId || p.name === selectedProductId);
        if (found) productIdToPreview = found.id.toString();
      }

      const params = new URLSearchParams({
        scope,
        family_id: selectedFamilyId,
        company: selectedCompany,
        product_id: productIdToPreview,
        active_only: activeOnly.toString(),
        change_type: changeType,
        value: changeValue.toString()
      });
      const res = await apiFetch(`/api/bulk-price/preview?${params}`);
      const body = await res.json();
      if (!res.ok) {
        const errorData = unwrapResponse(body);
        throw new Error(errorData.message || "Error al obtener vista previa");
      }
      const data = unwrapResponse(body);
      setPreviewProducts(data);
      if (data.length === 0) {
        setNotification({ type: 'error', message: "No se encontraron productos con los filtros seleccionados" });
        setTimeout(() => setNotification(null), 3000);
      }
    } catch (error: any) {
      console.error("Error fetching preview:", error);
      setNotification({ type: 'error', message: error.message || "Error al obtener vista previa" });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  const calculateNewValues = (product: Product) => {
    let newCost = product.cost;
    let newSalePrice = product.sale_price;
    const val = changeValue;

    if (targetField === 'cost') {
      if (changeType === 'increase_pct') {
        newCost = product.cost * (1 + val / 100);
      } else if (changeType === 'decrease_pct') {
        newCost = product.cost * (1 - val / 100);
      } else if (changeType === 'increase_fixed') {
        newCost = product.cost + val;
      } else if (changeType === 'decrease_fixed') {
        newCost = product.cost - val;
      }

      if (updateSalePrice) {
        const margin = newMargin / 100;
        if (margin < 1) {
          newSalePrice = newCost / (1 - margin);
        }
      }
    } else {
      // targetField === 'sale_price'
      if (changeType === 'increase_pct') {
        newSalePrice = product.sale_price * (1 + val / 100);
      } else if (changeType === 'decrease_pct') {
        newSalePrice = product.sale_price * (1 - val / 100);
      } else if (changeType === 'increase_fixed') {
        newSalePrice = product.sale_price + val;
      } else if (changeType === 'decrease_fixed') {
        newSalePrice = product.sale_price - val;
      } else if (changeType === 'replace_margin' || changeType === 'recalculate_peps') {
        const margin = val / 100;
        if (margin < 1) {
          newSalePrice = product.cost / (1 - margin);
        }
      }
    }

    return { newCost, newSalePrice };
  };

  const handleApply = async () => {
    setShowConfirm(false);
    setApplying(true);
    try {
      // If scope is manual, ensure we have a valid ID
      let productIdToApply = selectedProductId;
      if (scope === 'manual' && selectedProductId) {
        const found = products.find(p => p.id.toString() === selectedProductId || p.name === selectedProductId);
        if (found) productIdToApply = found.id.toString();
      }

      const res = await apiFetch('/api/bulk-price/apply', {
        method: 'POST',
        body: JSON.stringify({
          scope,
          family_id: selectedFamilyId,
          company: selectedCompany,
          product_id: productIdToApply,
          active_only: activeOnly,
          target_field: targetField,
          change_type: changeType,
          value: changeValue,
          update_sale_price: updateSalePrice,
          new_margin: newMargin,
          user_email: 'grupoquatroarg@gmail.com' // From context
        })
      });
      const body = await res.json();

      if (res.ok) {
        setNotification({ type: 'success', message: "Precios actualizados correctamente" });
        setPreviewProducts([]);
        fetchHistory();
        setTimeout(() => setNotification(null), 3000);
      } else {
        const errorData = unwrapResponse(body);
        setNotification({ type: 'error', message: errorData.message || "Error al aplicar cambios" });
        setTimeout(() => setNotification(null), 5000);
      }
    } catch (error) {
      setNotification({ type: 'error', message: "Error de conexión" });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto relative">
      {/* Notifications */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-2xl border animate-in fade-in slide-in-from-right-4 duration-300 flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 text-amber-600">
              <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                <AlertCircle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900">Confirmar Actualización</h3>
                <p className="text-sm text-zinc-500">Esta acción modificará los precios de {previewProducts.length} productos.</p>
              </div>
            </div>
            
            <div className="bg-zinc-50 p-4 rounded-xl space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Tipo de cambio:</span>
                <span className="font-bold text-zinc-900 uppercase">{changeType.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Valor:</span>
                <span className="font-bold text-zinc-900">
                  {changeType.includes('pct') || changeType.includes('margin') || changeType === 'recalculate_peps' ? `${changeValue}%` : `$${changeValue}`}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl font-bold transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleApply}
                disabled={applying}
                className="flex-1 py-3 px-4 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
              >
                {applying ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-900">Actualización Masiva de Precios</h1>
        <p className="text-sm text-zinc-500 mt-1">Modifica precios en lote con filtros avanzados</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Configuration Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-6">
            <div className="flex items-center gap-2 text-zinc-900 font-bold border-b border-zinc-100 pb-4">
              <Filter size={20} />
              <span>Configuración de Alcance</span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">¿Qué desea actualizar?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setTargetField('sale_price');
                      if (changeType === 'replace_margin' || changeType === 'recalculate_peps') {
                        // Keep it
                      } else {
                        // OK
                      }
                    }}
                    className={`px-4 py-2 text-sm rounded-lg border text-center transition-all ${
                      targetField === 'sale_price'
                        ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                        : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                    }`}
                  >
                    Precios de Venta
                  </button>
                  <button
                    onClick={() => {
                      setTargetField('cost');
                      if (changeType === 'replace_margin' || changeType === 'recalculate_peps') {
                        setChangeType('increase_pct');
                      }
                    }}
                    className={`px-4 py-2 text-sm rounded-lg border text-center transition-all ${
                      targetField === 'cost'
                        ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                        : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                    }`}
                  >
                    Costos
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">Alcance de la actualización</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                  {[
                    { id: 'all', label: 'Todos los productos' },
                    { id: 'family', label: 'Por Familia' },
                    { id: 'company', label: 'Por Proveedor/Empresa' },
                    { id: 'manual', label: 'Manual (Buscador)' }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setScope(opt.id as any)}
                      className={`px-4 py-2 text-sm rounded-lg border text-left transition-all ${
                        scope === opt.id
                          ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {scope === 'manual' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Buscar Producto</label>
                  <div className="relative">
                    <input
                      list="products-list"
                      className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none"
                      placeholder="Escribe nombre del producto..."
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                    />
                    {selectedProductId && (
                      <button 
                        onClick={() => setSelectedProductId('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                      >
                        <AlertCircle size={16} />
                      </button>
                    )}
                  </div>
                  <datalist id="products-list">
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </datalist>
                  {selectedProductId && !products.find(p => p.id.toString() === selectedProductId) && (
                    <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                      <AlertCircle size={10} />
                      Selecciona un ID de la lista para mayor precisión
                    </p>
                  )}
                </div>
              )}

              {scope === 'family' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Seleccionar Familia</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={selectedFamilyId}
                    onChange={(e) => setSelectedFamilyId(e.target.value)}
                  >
                    <option value="">Seleccionar...</option>
                    {families.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {scope === 'company' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Seleccionar Empresa</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={selectedCompany}
                    onChange={(e) => setSelectedCompany(e.target.value)}
                  >
                    <option value="">Seleccionar...</option>
                    <option value="Edu">Edu</option>
                    <option value="Peti">Peti</option>
                  </select>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="activeOnly"
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                />
                <label htmlFor="activeOnly" className="text-sm text-zinc-600">Solo productos activos</label>
              </div>
            </div>

            <div className="flex items-center gap-2 text-zinc-900 font-bold border-b border-zinc-100 pb-4 pt-4">
              <TrendingUp size={20} />
              <span>Tipo de Cambio</span>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
                {[
                  { id: 'increase_pct', label: 'Aumentar %', icon: TrendingUp },
                  { id: 'decrease_pct', label: 'Disminuir %', icon: TrendingDown },
                  { id: 'increase_fixed', label: 'Aumentar $', icon: TrendingUp },
                  { id: 'decrease_fixed', label: 'Disminuir $', icon: TrendingDown },
                  ...(targetField === 'sale_price' ? [
                    { id: 'replace_margin', label: 'Nuevo Margen', icon: Percent },
                    { id: 'recalculate_peps', label: 'Desde Costo', icon: Calculator }
                  ] : [])
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setChangeType(type.id as any)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all gap-1 ${
                      changeType === type.id
                        ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                        : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <type.icon size={18} />
                    <span className="text-[10px] font-bold uppercase">{type.label}</span>
                  </button>
                ))}
              </div>

              {targetField === 'cost' && (
                <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="updateSalePrice"
                      className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                      checked={updateSalePrice}
                      onChange={(e) => setUpdateSalePrice(e.target.checked)}
                    />
                    <label htmlFor="updateSalePrice" className="text-sm font-bold text-zinc-900">Actualizar Precios de Venta</label>
                  </div>
                  {updateSalePrice && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                      <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">Margen de Ganancia Deseado (%)</label>
                      <div className="relative">
                        <input
                          type="number"
                          className="w-full pl-4 pr-10 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none font-mono"
                          value={newMargin}
                          onChange={(e) => setNewMargin(parseFloat(e.target.value) || 0)}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">%</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  {changeType.includes('pct') ? 'Porcentaje (%)' : 
                   changeType.includes('fixed') ? 'Importe Fijo ($)' : 
                   'Margen Deseado (%)'}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    className="w-full pl-4 pr-10 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none font-mono text-lg"
                    value={changeValue}
                    onChange={(e) => setChangeValue(parseFloat(e.target.value) || 0)}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">
                    {changeType.includes('pct') || changeType.includes('margin') || changeType === 'recalculate_peps' ? '%' : '$'}
                  </span>
                </div>
              </div>

              <button
                onClick={fetchPreview}
                disabled={loading}
                className="w-full py-3 bg-zinc-100 text-zinc-900 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all border border-zinc-200"
              >
                {loading ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-zinc-900"></div> : <Eye size={18} />}
                Ver Vista Previa
              </button>
            </div>
          </div>

          {/* History Summary */}
          <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
            <div className="flex items-center gap-2 text-zinc-900 font-bold mb-4">
              <History size={20} />
              <span>Últimos Cambios</span>
            </div>
            <div className="space-y-3">
              {history.slice(0, 5).map(h => (
                <div key={h.id} className="text-xs p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                  <div className="flex justify-between font-bold text-zinc-900">
                    <span>{new Date(h.fecha).toLocaleDateString()}</span>
                    <span className={h.tipo_cambio.includes('increase') ? 'text-emerald-600' : 'text-red-600'}>
                      {h.tipo_cambio.includes('fixed') ? '$' : ''}{h.valor}{h.tipo_cambio.includes('pct') ? '%' : ''}
                    </span>
                  </div>
                  <div className="text-zinc-500 mt-1">
                    {h.productos_afectados} productos • {h.alcance} • {h.tipo_cambio}
                  </div>
                </div>
              ))}
              {history.length === 0 && <p className="text-xs text-zinc-400 italic">No hay historial disponible</p>}
            </div>
          </div>
        </div>

        {/* Preview Panel */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 flex-1 flex flex-col overflow-hidden min-h-[400px] md:min-h-[500px]">
            <div className="p-4 md:p-6 border-b border-zinc-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-zinc-50/50">
              <div>
                <h2 className="text-lg md:text-xl font-bold text-zinc-900">Vista Previa de Cambios</h2>
                <p className="text-xs md:text-sm text-zinc-500">{previewProducts.length} productos seleccionados</p>
              </div>
              {previewProducts.length > 0 && (
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={applying}
                  className="w-full sm:w-auto px-6 py-2 bg-zinc-900 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
                >
                  {applying ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <CheckCircle2 size={18} />}
                  Aplicar Cambios
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              {previewProducts.length > 0 ? (
                <div className="min-w-full inline-block align-middle">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 sticky top-0 z-10">
                          <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase">Producto</th>
                          <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase text-right">Costo</th>
                          <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase text-right">P. Venta</th>
                          <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase text-center">Variación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {previewProducts.map(p => {
                          const { newCost, newSalePrice } = calculateNewValues(p);
                          const diff = targetField === 'cost' ? newCost - p.cost : newSalePrice - p.sale_price;
                          const base = targetField === 'cost' ? p.cost : p.sale_price;
                          const pct = base !== 0 ? (diff / base) * 100 : 0;
                          
                          return (
                            <tr key={p.id} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-4 md:px-6 py-4">
                                <div className="font-bold text-zinc-900 text-sm md:text-base">{p.name}</div>
                                <div className="text-[10px] text-zinc-400">{p.family_name || 'Sin familia'}</div>
                              </td>
                              <td className="px-4 md:px-6 py-4 text-right">
                                <div className="text-[10px] text-zinc-400 font-mono">${p.cost.toFixed(2)}</div>
                                <div className={`font-mono font-bold text-sm ${targetField === 'cost' ? 'text-zinc-900' : 'text-zinc-500'}`}>
                                  ${newCost.toFixed(2)}
                                </div>
                              </td>
                              <td className="px-4 md:px-6 py-4 text-right">
                                <div className="text-[10px] text-zinc-400 font-mono">${p.sale_price.toFixed(2)}</div>
                                <div className={`font-mono font-bold text-sm ${targetField === 'sale_price' || updateSalePrice ? 'text-zinc-900' : 'text-zinc-500'}`}>
                                  ${newSalePrice.toFixed(2)}
                                </div>
                              </td>
                              <td className="px-4 md:px-6 py-4 text-center">
                                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${diff >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                  {diff >= 0 ? '+' : ''}{pct.toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-400 py-10 md:py-20">
                  <AlertCircle size={48} className="mb-4 opacity-10" />
                  <p className="font-medium text-sm md:text-base px-6 text-center">Configura los filtros y haz clic en "Ver Vista Previa"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
