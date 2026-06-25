import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Percent,
  Calculator,
  Eye,
  CheckCircle2,
  History,
  Filter,
  AlertCircle,
  RefreshCw,
  PackageSearch,
  Layers3,
  Building2,
  ShieldCheck,
  Search,
  X,
  Boxes,
  ArrowRight,
} from 'lucide-react';
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

type PriceScope = 'all' | 'family' | 'company' | 'manual';
type PriceChangeType = 'increase_pct' | 'decrease_pct' | 'increase_fixed' | 'decrease_fixed' | 'replace_margin' | 'recalculate_peps';
type PriceTargetField = 'cost' | 'sale_price';

interface PreviewConfiguration {
  scope: PriceScope;
  familyId: string;
  company: string;
  productId: string;
  activeOnly: boolean;
  changeType: PriceChangeType;
  changeValue: number;
  targetField: PriceTargetField;
  updateSalePrice: boolean;
  newMargin: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const scopeLabels: Record<PriceScope, string> = {
  all: 'Todos los productos',
  family: 'Familia',
  company: 'Proveedor/Empresa',
  manual: 'Producto individual',
};

const changeTypeLabels: Record<PriceChangeType, string> = {
  increase_pct: 'Aumentar porcentaje',
  decrease_pct: 'Disminuir porcentaje',
  increase_fixed: 'Aumentar importe fijo',
  decrease_fixed: 'Disminuir importe fijo',
  replace_margin: 'Aplicar nuevo margen',
  recalculate_peps: 'Recalcular desde costo',
};

const targetFieldLabels: Record<PriceTargetField, string> = {
  cost: 'Costo',
  sale_price: 'Precio de venta',
};

export default function BulkPriceUpdate() {
  const [products, setProducts] = useState<Product[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [previewProducts, setPreviewProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<PriceUpdateHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [previewConfig, setPreviewConfig] = useState<PreviewConfiguration | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  // Filters
  const [scope, setScope] = useState<PriceScope>('manual');
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState(true);

  // Change logic
  const [changeType, setChangeType] = useState<PriceChangeType>('increase_pct');
  const [changeValue, setChangeValue] = useState<number>(0);
  const [targetField, setTargetField] = useState<PriceTargetField>('sale_price');
  const [updateSalePrice, setUpdateSalePrice] = useState(false);
  const [newMargin, setNewMargin] = useState<number>(30);

  useEffect(() => {
    void loadData(true);
  }, []);

  useEffect(() => {
    setPreviewProducts([]);
    setPreviewConfig(null);
    setShowConfirm(false);
    setConfirmationText('');
  }, [
    scope,
    selectedFamilyId,
    selectedCompany,
    selectedProductId,
    activeOnly,
    changeType,
    changeValue,
    targetField,
    updateSalePrice,
    newMargin,
  ]);

  const fetchFamilies = async () => {
    const res = await apiFetch('/api/config/product-families');
    const body = await res.json();

    if (!res.ok) {
      const errorData = unwrapResponse(body);
      throw new Error((errorData as any)?.message || 'No se pudieron cargar las familias.');
    }

    const data = unwrapResponse<ProductFamily[]>(body);
    setFamilies(Array.isArray(data) ? data : []);
  };

  const fetchProducts = async () => {
    const res = await apiFetch('/api/products');
    const body = await res.json();

    if (!res.ok) {
      const errorData = unwrapResponse(body);
      throw new Error((errorData as any)?.message || 'No se pudieron cargar los productos.');
    }

    const data = unwrapResponse<Product[]>(body);
    setProducts(Array.isArray(data) ? data : []);
  };

  const fetchHistory = async () => {
    const res = await apiFetch('/api/products?endpoint=bulk-price-history');
    const body = await res.json();

    if (!res.ok) {
      const errorData = unwrapResponse(body);
      throw new Error((errorData as any)?.message || 'No se pudo cargar el historial.');
    }

    const data = unwrapResponse<PriceUpdateHistory[]>(body);
    setHistory(Array.isArray(data) ? data : []);
  };

  const loadData = async (initial = false) => {
    if (initial) setInitialLoading(true);
    else setRefreshing(true);

    setDataError(null);

    try {
      await Promise.all([fetchFamilies(), fetchProducts(), fetchHistory()]);
    } catch (error: any) {
      console.error('Error loading bulk price data:', error);
      setDataError(error.message || 'No se pudieron cargar los datos de Cambio de Precios.');
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  const resolveProductId = (value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) return '';

    const found = products.find(
      (product) =>
        product.id.toString() === normalizedValue ||
        product.name.toLocaleLowerCase('es-AR') === normalizedValue.toLocaleLowerCase('es-AR')
    );

    return found?.id.toString() || '';
  };

  const productMatches = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase('es-AR');
    if (!query) return products.slice(0, 8);

    return products
      .filter((product) =>
        [product.name, product.code, product.codigo_unico, product.family_name, product.company]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('es-AR').includes(query))
      )
      .slice(0, 8);
  }, [productSearch, products]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id.toString() === selectedProductId),
    [products, selectedProductId]
  );

  const selectProduct = (product: Product) => {
    setSelectedProductId(product.id.toString());
    setProductSearch(product.name);
    setProductPickerOpen(false);
  };

  const buildCurrentConfiguration = (): PreviewConfiguration => ({
    scope,
    familyId: selectedFamilyId,
    company: selectedCompany,
    productId: scope === 'manual' ? resolveProductId(selectedProductId) : '',
    activeOnly,
    changeType,
    changeValue,
    targetField,
    updateSalePrice: targetField === 'cost' ? updateSalePrice : false,
    newMargin,
  });

  const validateConfiguration = (config: PreviewConfiguration) => {
    if (config.scope === 'family' && !config.familyId) {
      return 'Seleccioná una familia antes de generar la vista previa.';
    }

    if (config.scope === 'company' && !config.company) {
      return 'Seleccioná una empresa antes de generar la vista previa.';
    }

    if (config.scope === 'manual' && !config.productId) {
      return 'Seleccioná un producto válido de la lista antes de continuar.';
    }

    if (!Number.isFinite(config.changeValue) || config.changeValue <= 0) {
      return 'Ingresá un valor de cambio mayor a cero.';
    }

    if (config.changeType === 'decrease_pct' && config.changeValue >= 100) {
      return 'La disminución porcentual debe ser menor al 100%.';
    }

    if (
      (config.changeType === 'replace_margin' || config.changeType === 'recalculate_peps') &&
      config.changeValue >= 100
    ) {
      return 'El margen debe ser menor al 100%.';
    }

    if (
      config.targetField === 'cost' &&
      config.updateSalePrice &&
      (!Number.isFinite(config.newMargin) || config.newMargin < 0 || config.newMargin >= 100)
    ) {
      return 'El margen para recalcular el precio de venta debe estar entre 0% y 99,99%.';
    }

    return null;
  };

  const calculateNewValues = (product: Product, config: PreviewConfiguration) => {
    let newCost = product.cost;
    let newSalePrice = product.sale_price;
    const val = config.changeValue;

    if (config.targetField === 'cost') {
      if (config.changeType === 'increase_pct') {
        newCost = product.cost * (1 + val / 100);
      } else if (config.changeType === 'decrease_pct') {
        newCost = product.cost * (1 - val / 100);
      } else if (config.changeType === 'increase_fixed') {
        newCost = product.cost + val;
      } else if (config.changeType === 'decrease_fixed') {
        newCost = product.cost - val;
      }

      if (config.updateSalePrice) {
        const margin = config.newMargin / 100;
        if (margin < 1) {
          newSalePrice = newCost / (1 - margin);
        }
      }
    } else {
      if (config.changeType === 'increase_pct') {
        newSalePrice = product.sale_price * (1 + val / 100);
      } else if (config.changeType === 'decrease_pct') {
        newSalePrice = product.sale_price * (1 - val / 100);
      } else if (config.changeType === 'increase_fixed') {
        newSalePrice = product.sale_price + val;
      } else if (config.changeType === 'decrease_fixed') {
        newSalePrice = product.sale_price - val;
      } else if (config.changeType === 'replace_margin' || config.changeType === 'recalculate_peps') {
        const margin = val / 100;
        if (margin < 1) {
          newSalePrice = product.cost / (1 - margin);
        }
      }
    }

    return {
      newCost: Math.max(0, Number(newCost.toFixed(2))),
      newSalePrice: Math.max(0, Number(newSalePrice.toFixed(2))),
    };
  };

  const getScopeDescription = (config: PreviewConfiguration) => {
    if (config.scope === 'family') {
      return families.find((family) => family.id.toString() === config.familyId)?.name || 'Familia seleccionada';
    }

    if (config.scope === 'company') {
      return config.company;
    }

    if (config.scope === 'manual') {
      return products.find((product) => product.id.toString() === config.productId)?.name || 'Producto seleccionado';
    }

    return config.activeOnly ? 'Todos los productos activos' : 'Todos los productos';
  };

  const fetchPreview = async () => {
    const configuration = buildCurrentConfiguration();
    const validationError = validateConfiguration(configuration);

    if (validationError) {
      setNotification({ type: 'error', message: validationError });
      setTimeout(() => setNotification(null), 5000);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        scope: configuration.scope,
        family_id: configuration.familyId,
        company: configuration.company,
        product_id: configuration.productId,
        active_only: configuration.activeOnly.toString(),
        change_type: configuration.changeType,
        value: configuration.changeValue.toString(),
      });

      const res = await apiFetch(`/api/products?endpoint=bulk-price-preview&${params}`);
      const body = await res.json();

      if (!res.ok) {
        const errorData = unwrapResponse(body);
        throw new Error((errorData as any)?.message || 'Error al obtener vista previa');
      }

      const data = unwrapResponse<Product[]>(body);

      if (data.length === 0) {
        setPreviewProducts([]);
        setPreviewConfig(null);
        setNotification({ type: 'error', message: 'No se encontraron productos con los filtros seleccionados.' });
        setTimeout(() => setNotification(null), 5000);
        return;
      }

      const invalidProducts = data.filter((product) => {
        const { newCost, newSalePrice } = calculateNewValues(product, configuration);
        return (
          (configuration.targetField === 'cost' && newCost <= 0) ||
          (configuration.targetField === 'sale_price' && newSalePrice <= 0) ||
          (configuration.targetField === 'cost' && configuration.updateSalePrice && newSalePrice <= 0)
        );
      });

      if (invalidProducts.length > 0) {
        setPreviewProducts([]);
        setPreviewConfig(null);
        setNotification({
          type: 'error',
          message: `El cambio dejaría ${invalidProducts.length} producto(s) con costo o precio igual a cero. Ajustá el valor antes de continuar.`,
        });
        setTimeout(() => setNotification(null), 6000);
        return;
      }

      setPreviewProducts(data);
      setPreviewConfig(configuration);
      setConfirmationText('');
    } catch (error: any) {
      console.error('Error fetching preview:', error);
      setPreviewProducts([]);
      setPreviewConfig(null);
      setNotification({ type: 'error', message: error.message || 'Error al obtener vista previa.' });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setLoading(false);
    }
  };

  const previewSummary = useMemo(() => {
    if (!previewConfig || previewProducts.length === 0) return null;

    const rows = previewProducts.map((product) => {
      const { newCost, newSalePrice } = calculateNewValues(product, previewConfig);
      return {
        current: previewConfig.targetField === 'cost' ? product.cost : product.sale_price,
        next: previewConfig.targetField === 'cost' ? newCost : newSalePrice,
      };
    });

    const currentValues = rows.map((row) => row.current);
    const nextValues = rows.map((row) => row.next);
    const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

    return {
      currentAverage: average(currentValues),
      nextAverage: average(nextValues),
      currentMin: Math.min(...currentValues),
      nextMin: Math.min(...nextValues),
      currentMax: Math.max(...currentValues),
      nextMax: Math.max(...nextValues),
    };
  }, [previewConfig, previewProducts]);

  const confirmationPhrase = previewProducts.length > 0 ? `ACTUALIZAR ${previewProducts.length}` : '';
  const confirmationIsValid =
    confirmationText.trim().toLocaleUpperCase('es-AR') === confirmationPhrase.toLocaleUpperCase('es-AR');

  const openConfirmation = () => {
    if (!previewConfig || previewProducts.length === 0) {
      setNotification({ type: 'error', message: 'Generá una vista previa válida antes de aplicar cambios.' });
      setTimeout(() => setNotification(null), 5000);
      return;
    }

    setConfirmationText('');
    setShowConfirm(true);
  };

  const handleApply = async () => {
    if (!previewConfig || previewProducts.length === 0 || !confirmationIsValid || applying) {
      return;
    }

    setApplying(true);
    try {
      const res = await apiFetch('/api/products?endpoint=bulk-price-apply', {
        method: 'POST',
        body: JSON.stringify({
          scope: previewConfig.scope,
          family_id: previewConfig.familyId,
          company: previewConfig.company,
          product_id: previewConfig.productId,
          active_only: previewConfig.activeOnly,
          target_field: previewConfig.targetField,
          change_type: previewConfig.changeType,
          value: previewConfig.changeValue,
          update_sale_price: previewConfig.updateSalePrice,
          new_margin: previewConfig.newMargin,
          expected_product_ids: previewProducts.map((product) => product.id),
          user_email: 'grupoquatroarg@gmail.com',
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        const errorData = unwrapResponse(body);
        throw new Error((errorData as any)?.message || 'Error al aplicar cambios');
      }

      const result = unwrapResponse<{ count: number }>(body);
      const updatedCount = Number(result?.count || previewProducts.length);

      setShowConfirm(false);
      setConfirmationText('');
      setPreviewProducts([]);
      setPreviewConfig(null);
      setNotification({
        type: 'success',
        message: `Precios actualizados correctamente en ${updatedCount} producto(s).`,
      });

      await Promise.allSettled([fetchHistory(), fetchProducts()]);
      setTimeout(() => setNotification(null), 5000);
    } catch (error: any) {
      setNotification({
        type: 'error',
        message: error.message || 'No se pudieron aplicar los cambios. La vista previa sigue disponible.',
      });
      setTimeout(() => setNotification(null), 6000);
    } finally {
      setApplying(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-5 p-3 sm:p-5 lg:p-6" aria-busy="true">
        <div className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-5 sm:p-7">
          <div className="h-5 w-40 rounded bg-slate-200" />
          <div className="mt-4 h-9 w-3/4 max-w-xl rounded bg-slate-200" />
          <div className="mt-3 h-4 w-full max-w-2xl rounded bg-slate-100" />
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 rounded-2xl bg-slate-100" />)}
          </div>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.65fr)]">
          <div className="h-[520px] animate-pulse rounded-[28px] border border-slate-200 bg-white" />
          <div className="h-[520px] animate-pulse rounded-[28px] border border-slate-200 bg-white" />
        </div>
        <p className="text-center text-sm font-medium text-slate-500">Cargando productos, familias e historial…</p>
      </div>
    );
  }

  const activeProducts = products.filter((product) => product.estado === 'activo' || product.active === 1).length;

  return (
    <div className="relative mx-auto w-full max-w-[1600px] space-y-5 p-3 sm:p-5 lg:p-6">
      {notification && (
        <div
          className={`fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-xl items-start gap-3 rounded-2xl border p-4 shadow-2xl sm:inset-x-auto sm:right-5 sm:top-5 ${
            notification.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
          role="status"
        >
          {notification.type === 'success' ? <CheckCircle2 className="mt-0.5 shrink-0" size={20} /> : <AlertCircle className="mt-0.5 shrink-0" size={20} />}
          <span className="min-w-0 flex-1 text-sm font-semibold leading-5">{notification.message}</span>
          <button type="button" onClick={() => setNotification(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-black/5" aria-label="Cerrar mensaje">
            <X size={18} />
          </button>
        </div>
      )}

      {showConfirm && previewConfig && previewSummary && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="bulk-price-confirm-title">
            <div className="flex items-start gap-4 border-b border-rose-100 bg-rose-50 p-5 sm:p-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700"><AlertCircle size={25} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-700">Acción irreversible</p>
                <h3 id="bulk-price-confirm-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">Revisá antes de actualizar</h3>
                <p className="mt-1 text-sm leading-5 text-rose-800">Se modificarán precios reales y no existe una reversión automática.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!applying) {
                    setShowConfirm(false);
                    setConfirmationText('');
                  }
                }}
                disabled={applying}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-white/70 disabled:opacity-40"
                aria-label="Cerrar confirmación"
              ><X size={20} /></button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {previewConfig.scope === 'all' && (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-rose-950">
                  <p className="font-black">Seleccionaste todos los productos.</p>
                  <p className="mt-1 text-sm">Se actualizarán {previewProducts.length} productos {previewConfig.activeOnly ? 'activos' : 'activos e inactivos'}.</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Productos afectados</p>
                  <p className="mt-1 text-3xl font-black text-slate-950">{previewProducts.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Alcance</p>
                  <p className="mt-1 font-black text-slate-950">{scopeLabels[previewConfig.scope]}</p>
                  <p className="mt-1 break-words text-xs text-slate-500">{getScopeDescription(previewConfig)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Campo</p>
                  <p className="mt-1 font-black text-slate-950">{targetFieldLabels[previewConfig.targetField]}</p>
                  <p className="mt-1 text-xs text-slate-500">{changeTypeLabels[previewConfig.changeType]}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Valor aplicado</p>
                  <p className="mt-1 text-xl font-black text-slate-950">
                    {previewConfig.changeType.includes('pct') || previewConfig.changeType.includes('margin') || previewConfig.changeType === 'recalculate_peps'
                      ? `${previewConfig.changeValue}%`
                      : formatCurrency(previewConfig.changeValue)}
                  </p>
                  {previewConfig.targetField === 'cost' && previewConfig.updateSalePrice && <p className="mt-1 text-xs text-slate-500">Venta recalculada con margen de {previewConfig.newMargin}%.</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                <h4 className="font-black text-slate-950">Resumen antes y después</h4>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Promedio', current: previewSummary.currentAverage, next: previewSummary.nextAverage },
                    { label: 'Mínimo', current: previewSummary.currentMin, next: previewSummary.nextMin },
                    { label: 'Máximo', current: previewSummary.currentMax, next: previewSummary.nextMax },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{item.label}</p>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-2"><span className="text-slate-500">Antes</span><span className="break-all text-right font-mono font-semibold text-slate-700">{formatCurrency(item.current)}</span></div>
                        <div className="flex items-center justify-between gap-2"><span className="text-indigo-700">Después</span><span className="break-all text-right font-mono font-black text-indigo-700">{formatCurrency(item.next)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                <label htmlFor="bulk-price-confirmation" className="block text-sm font-black text-slate-950">Escribí exactamente la siguiente frase</label>
                <div className="mt-3 rounded-2xl bg-slate-950 px-4 py-3 text-center font-mono font-black tracking-wide text-white">{confirmationPhrase}</div>
                <input
                  id="bulk-price-confirmation"
                  type="text"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  disabled={applying}
                  autoComplete="off"
                  className={`mt-3 min-h-12 w-full rounded-2xl border-2 px-4 py-3 font-mono outline-none transition ${confirmationText.length === 0 ? 'border-slate-200 focus:border-indigo-500' : confirmationIsValid ? 'border-emerald-500 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}
                  placeholder={confirmationPhrase}
                />
                <p className="mt-2 text-xs text-slate-500">La actualización seguirá bloqueada hasta que la frase coincida.</p>
              </div>
            </div>

            <div className="grid shrink-0 gap-3 border-t border-slate-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
              <button type="button" onClick={() => { setShowConfirm(false); setConfirmationText(''); }} disabled={applying} className="min-h-12 rounded-2xl bg-slate-100 px-5 py-3 font-black text-slate-800 hover:bg-slate-200 disabled:opacity-50">Cancelar y revisar</button>
              <button type="button" onClick={handleApply} disabled={applying || !confirmationIsValid} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-rose-700 px-5 py-3 font-black text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-40">
                {applying ? <><RefreshCw className="animate-spin" size={18} />Aplicando cambios…</> : 'Confirmar actualización'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-5 text-white sm:p-7 lg:p-8">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20"><TrendingUp size={28} /></div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-200">Gestión comercial</p>
                <h1 className="mt-2 text-2xl font-black leading-tight sm:text-3xl lg:text-4xl">Cambio de Precios</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">Simulá, revisá y confirmá actualizaciones de costos o precios de venta con protección contra cambios accidentales.</p>
              </div>
            </div>
            <button type="button" onClick={() => void loadData(false)} disabled={refreshing || loading || applying} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 font-black text-slate-950 hover:bg-indigo-50 disabled:opacity-60 lg:w-auto">
              <RefreshCw className={refreshing ? 'animate-spin' : ''} size={18} />
              {refreshing ? 'Actualizando…' : 'Actualizar datos'}
            </button>
          </div>

          <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Productos', value: products.length, icon: Boxes },
              { label: 'Activos', value: activeProducts, icon: CheckCircle2 },
              { label: 'Familias', value: families.length, icon: Layers3 },
              { label: 'Cambios', value: history.length, icon: History },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur sm:p-4">
                <div className="flex items-center gap-2 text-indigo-200"><item.icon size={17} /><span className="text-[11px] font-black uppercase tracking-wide">{item.label}</span></div>
                <p className="mt-2 text-2xl font-black sm:text-3xl">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {dataError && (
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3"><AlertCircle className="mt-0.5 shrink-0" size={20} /><div><p className="font-black">No se pudieron actualizar todos los datos</p><p className="mt-1 break-words text-sm">{dataError}</p></div></div>
          <button type="button" onClick={() => void loadData(false)} disabled={refreshing} className="min-h-11 rounded-xl bg-rose-700 px-4 py-2 font-black text-white disabled:opacity-50">Reintentar</button>
        </div>
      )}

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-amber-700" size={22} /><div><p className="font-black">Actualización protegida</p><p className="mt-1 text-sm leading-5">Cualquier cambio en el alcance, valor o tipo de actualización invalida la vista previa y obliga a revisarla nuevamente.</p></div></div>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.65fr)]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><Filter size={21} /></div><div><h2 className="font-black text-slate-950">1. Definí el alcance</h2><p className="text-xs text-slate-500">Elegí qué productos y qué campo querés modificar.</p></div></div>
            <div className="mt-5 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-black text-slate-800">Campo a actualizar</label>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                  <button type="button" onClick={() => setTargetField('sale_price')} className={`min-h-12 rounded-2xl border px-4 py-3 text-sm font-black ${targetField === 'sale_price' ? 'border-indigo-700 bg-indigo-700 text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-indigo-50'}`}>Precio de venta</button>
                  <button type="button" onClick={() => { setTargetField('cost'); if (changeType === 'replace_margin' || changeType === 'recalculate_peps') setChangeType('increase_pct'); }} className={`min-h-12 rounded-2xl border px-4 py-3 text-sm font-black ${targetField === 'cost' ? 'border-indigo-700 bg-indigo-700 text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-indigo-50'}`}>Costo</button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-black text-slate-800">Alcance</label>
                <div className="grid grid-cols-1 gap-2 min-[520px]:grid-cols-2 xl:grid-cols-1">
                  {[
                    { id: 'manual', label: 'Producto individual', description: 'La opción más segura', icon: PackageSearch },
                    { id: 'family', label: 'Por familia', description: 'Productos asociados', icon: Layers3 },
                    { id: 'company', label: 'Por proveedor o empresa', description: 'Segmentación por origen', icon: Building2 },
                    { id: 'all', label: 'Todos los productos', description: 'Actualización masiva', icon: Boxes },
                  ].map((option) => (
                    <button key={option.id} type="button" onClick={() => setScope(option.id as PriceScope)} className={`flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left ${scope === option.id ? option.id === 'all' ? 'border-rose-500 bg-rose-50 text-rose-900' : 'border-indigo-600 bg-indigo-50 text-indigo-950' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${scope === option.id ? 'bg-white/80' : 'bg-slate-100'}`}><option.icon size={19} /></div>
                      <div className="min-w-0"><p className="font-black">{option.label}</p><p className="mt-0.5 text-xs opacity-70">{option.description}</p></div>
                    </button>
                  ))}
                </div>
              </div>

              {scope === 'manual' && (
                <div>
                  <label className="mb-2 block text-sm font-black text-slate-800">Buscar producto</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="text"
                      value={productSearch}
                      onFocus={() => setProductPickerOpen(true)}
                      onChange={(event) => { setProductSearch(event.target.value); setSelectedProductId(''); setProductPickerOpen(true); }}
                      onBlur={() => window.setTimeout(() => setProductPickerOpen(false), 150)}
                      className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-11 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      placeholder="Nombre, código, familia o empresa"
                      autoComplete="off"
                    />
                    {(productSearch || selectedProductId) && <button type="button" onClick={() => { setProductSearch(''); setSelectedProductId(''); setProductPickerOpen(false); }} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Limpiar producto"><X size={18} /></button>}
                    {productPickerOpen && (
                      <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
                        {productMatches.length > 0 ? productMatches.map((product) => (
                          <button key={product.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectProduct(product)} className="flex w-full items-start justify-between gap-3 rounded-xl p-3 text-left hover:bg-indigo-50">
                            <div className="min-w-0"><p className="break-words font-black text-slate-900">{product.name}</p><p className="mt-1 break-words text-xs text-slate-500">{product.code || product.codigo_unico || `ID ${product.id}`} · {product.family_name || 'Sin familia'}</p></div>
                            <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">{product.company}</span>
                          </button>
                        )) : <div className="p-4 text-center text-sm text-slate-500">No encontramos productos con esa búsqueda.</div>}
                      </div>
                    )}
                  </div>
                  {selectedProduct ? <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><span className="font-black">Seleccionado:</span> {selectedProduct.name}</div> : productSearch ? <p className="mt-2 text-xs font-semibold text-amber-700">Elegí una coincidencia de la lista antes de continuar.</p> : null}
                </div>
              )}

              {scope === 'family' && <div><label className="mb-2 block text-sm font-black text-slate-800">Familia</label><select className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" value={selectedFamilyId} onChange={(event) => setSelectedFamilyId(event.target.value)}><option value="">Seleccionar familia…</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></div>}
              {scope === 'company' && <div><label className="mb-2 block text-sm font-black text-slate-800">Proveedor o empresa</label><select className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" value={selectedCompany} onChange={(event) => setSelectedCompany(event.target.value)}><option value="">Seleccionar…</option><option value="Edu">Edu</option><option value="Peti">Peti</option></select></div>}

              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"><input type="checkbox" className="h-5 w-5 rounded border-slate-300 text-indigo-700 focus:ring-indigo-500" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} /><span className="text-sm font-bold text-slate-700">Incluir únicamente productos activos</span></label>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700"><Calculator size={21} /></div><div><h2 className="font-black text-slate-950">2. Configurá el cambio</h2><p className="text-xs text-slate-500">Definí cómo se recalculará el valor.</p></div></div>
            <div className="mt-5 space-y-5">
              <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-3 xl:grid-cols-2">
                {[
                  { id: 'increase_pct', label: 'Aumentar %', icon: TrendingUp },
                  { id: 'decrease_pct', label: 'Disminuir %', icon: TrendingDown },
                  { id: 'increase_fixed', label: 'Aumentar $', icon: TrendingUp },
                  { id: 'decrease_fixed', label: 'Disminuir $', icon: TrendingDown },
                  ...(targetField === 'sale_price' ? [{ id: 'replace_margin', label: 'Nuevo margen', icon: Percent }, { id: 'recalculate_peps', label: 'Desde costo', icon: Calculator }] : []),
                ].map((type) => (
                  <button key={type.id} type="button" onClick={() => setChangeType(type.id as PriceChangeType)} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center ${changeType === type.id ? 'border-indigo-700 bg-indigo-700 text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-indigo-50'}`}><type.icon size={20} /><span className="text-[11px] font-black uppercase leading-4">{type.label}</span></button>
                ))}
              </div>

              {targetField === 'cost' && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5 rounded border-slate-300 text-indigo-700 focus:ring-indigo-500" checked={updateSalePrice} onChange={(event) => setUpdateSalePrice(event.target.checked)} /><span className="text-sm font-black text-slate-900">Recalcular también el precio de venta</span></label>
                  {updateSalePrice && <div className="mt-3"><label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">Margen deseado</label><div className="relative"><input type="number" min="0" max="99.99" className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 pr-11 font-mono outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" value={newMargin} onChange={(event) => setNewMargin(parseFloat(event.target.value) || 0)} /><span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-slate-400">%</span></div></div>}
                </div>
              )}

              <div><label className="mb-2 block text-sm font-black text-slate-800">{changeType.includes('pct') ? 'Porcentaje' : changeType.includes('fixed') ? 'Importe fijo' : 'Margen deseado'}</label><div className="relative"><input type="number" min="0" className="min-h-14 w-full rounded-2xl border border-slate-200 px-4 pr-12 font-mono text-lg font-black outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" value={changeValue} onChange={(event) => setChangeValue(parseFloat(event.target.value) || 0)} /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-black text-slate-400">{changeType.includes('pct') || changeType.includes('margin') || changeType === 'recalculate_peps' ? '%' : '$'}</span></div></div>

              <button type="button" onClick={fetchPreview} disabled={loading || refreshing} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-5 py-3 font-black text-white shadow-lg shadow-indigo-100 hover:bg-indigo-800 disabled:opacity-60">{loading ? <RefreshCw className="animate-spin" size={19} /> : <Eye size={19} />}{loading ? 'Generando vista previa…' : 'Generar vista previa'}</button>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700"><History size={21} /></div><div><h2 className="font-black text-slate-950">Historial reciente</h2><p className="text-xs text-slate-500">Últimas actualizaciones registradas.</p></div></div>
            <div className="mt-4 space-y-3">
              {history.slice(0, 5).map((entry) => (
                <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-slate-900">{changeTypeLabels[entry.tipo_cambio as PriceChangeType] || entry.tipo_cambio}</p><p className="mt-1 text-xs text-slate-500">{new Date(entry.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</p></div><span className={`rounded-xl px-3 py-1.5 text-sm font-black ${entry.tipo_cambio.includes('increase') ? 'bg-emerald-100 text-emerald-800' : entry.tipo_cambio.includes('decrease') ? 'bg-rose-100 text-rose-800' : 'bg-indigo-100 text-indigo-800'}`}>{entry.tipo_cambio.includes('fixed') ? formatCurrency(entry.valor) : `${entry.valor}%`}</span></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-white p-3"><p className="text-slate-500">Productos</p><p className="mt-1 font-black text-slate-900">{entry.productos_afectados}</p></div><div className="rounded-xl bg-white p-3"><p className="text-slate-500">Alcance</p><p className="mt-1 break-words font-black text-slate-900">{entry.alcance}</p></div></div>
                </article>
              ))}
              {history.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Todavía no hay cambios registrados.</div>}
            </div>
          </section>
        </div>

        <section className="min-w-0 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Paso final</p><h2 className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">3. Revisá la vista previa</h2><p className="mt-1 text-sm text-slate-500">{previewProducts.length > 0 ? `${previewProducts.length} productos seleccionados` : 'Configurá el cambio para ver los resultados.'}</p></div>
            {previewProducts.length > 0 && previewConfig && <button type="button" onClick={openConfirmation} disabled={applying} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-700 px-5 py-3 font-black text-white shadow-lg shadow-rose-100 hover:bg-rose-800 disabled:opacity-60 sm:w-auto"><ShieldCheck size={19} />Revisar y confirmar</button>}
          </div>

          {previewProducts.length > 0 && previewConfig ? (
            <div className="space-y-4 p-4 sm:p-6">
              {previewSummary && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-indigo-700">Promedio actual</p><p className="mt-2 break-all text-xl font-black text-indigo-950">{formatCurrency(previewSummary.currentAverage)}</p></div>
                  <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-emerald-700">Promedio nuevo</p><p className="mt-2 break-all text-xl font-black text-emerald-950">{formatCurrency(previewSummary.nextAverage)}</p></div>
                  <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-600">Alcance</p><p className="mt-2 break-words font-black text-slate-950">{getScopeDescription(previewConfig)}</p></div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                {previewProducts.map((product) => {
                  const { newCost, newSalePrice } = calculateNewValues(product, previewConfig);
                  const currentValue = previewConfig.targetField === 'cost' ? product.cost : product.sale_price;
                  const nextValue = previewConfig.targetField === 'cost' ? newCost : newSalePrice;
                  const difference = nextValue - currentValue;
                  const variation = currentValue !== 0 ? (difference / currentValue) * 100 : 0;

                  return (
                    <article key={product.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                      <div className="flex flex-col gap-3 min-[440px]:flex-row min-[440px]:items-start min-[440px]:justify-between">
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">{product.code || product.codigo_unico || `ID ${product.id}`}</span><span className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase text-indigo-700">{product.company}</span></div><h3 className="mt-2 break-words text-lg font-black text-slate-950">{product.name}</h3><p className="mt-1 break-words text-xs text-slate-500">{product.family_name || 'Sin familia'}</p></div>
                        <span className={`w-fit shrink-0 rounded-xl px-3 py-1.5 text-sm font-black ${difference >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{variation >= 0 ? '+' : ''}{variation.toFixed(1)}%</span>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 min-[440px]:grid-cols-2">
                        <div className={`rounded-2xl p-4 ${previewConfig.targetField === 'cost' ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'}`}><p className="text-xs font-black uppercase tracking-wide text-slate-500">Costo</p><div className="mt-3 flex items-center justify-between gap-2 text-sm"><span className="break-all font-mono text-slate-500">{formatCurrency(product.cost)}</span><ArrowRight className="shrink-0 text-slate-400" size={17} /><span className="break-all text-right font-mono font-black text-slate-950">{formatCurrency(newCost)}</span></div></div>
                        <div className={`rounded-2xl p-4 ${previewConfig.targetField === 'sale_price' || previewConfig.updateSalePrice ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-slate-50'}`}><p className="text-xs font-black uppercase tracking-wide text-slate-500">Precio de venta</p><div className="mt-3 flex items-center justify-between gap-2 text-sm"><span className="break-all font-mono text-slate-500">{formatCurrency(product.sale_price)}</span><ArrowRight className="shrink-0 text-slate-400" size={17} /><span className="break-all text-right font-mono font-black text-slate-950">{formatCurrency(newSalePrice)}</span></div></div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center"><div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-indigo-50 text-indigo-700"><Eye size={34} /></div><h3 className="mt-5 text-xl font-black text-slate-950">Todavía no hay vista previa</h3><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Elegí el alcance, definí el tipo de cambio y generá una vista previa antes de confirmar cualquier actualización.</p></div>
          )}
        </section>
      </div>
    </div>
  );
}
