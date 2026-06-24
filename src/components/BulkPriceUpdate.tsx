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
    fetchFamilies();
    fetchProducts();
    fetchHistory();
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
    const res = await apiFetch('/api/products?endpoint=bulk-price-history');
    const body = await res.json();
    const data = unwrapResponse(body);
    setHistory(data);
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

      await Promise.all([fetchHistory(), fetchProducts()]);
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
      {showConfirm && previewConfig && previewSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-zinc-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-price-confirm-title"
          >
            <div className="p-5 md:p-6 border-b border-red-100 bg-red-50">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 shrink-0 rounded-full bg-red-100 text-red-700 flex items-center justify-center">
                  <AlertCircle size={26} />
                </div>
                <div>
                  <h3 id="bulk-price-confirm-title" className="text-lg md:text-xl font-bold text-zinc-950">
                    Confirmación obligatoria
                  </h3>
                  <p className="text-sm text-red-800 mt-1">
                    Esta acción modificará precios reales y no tiene deshacer automático.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 md:p-6 space-y-5">
              {previewConfig.scope === 'all' && (
                <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
                  <p className="font-bold">Atención: seleccionaste todos los productos.</p>
                  <p className="text-sm mt-1">
                    Se actualizarán {previewProducts.length} productos {previewConfig.activeOnly ? 'activos' : 'activos e inactivos'}.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-[11px] uppercase font-bold text-zinc-500">Productos afectados</p>
                  <p className="text-2xl font-bold text-zinc-950 mt-1">{previewProducts.length}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-[11px] uppercase font-bold text-zinc-500">Alcance</p>
                  <p className="font-bold text-zinc-950 mt-1">{scopeLabels[previewConfig.scope]}</p>
                  <p className="text-xs text-zinc-500 mt-1">{getScopeDescription(previewConfig)}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-[11px] uppercase font-bold text-zinc-500">Campo y modificación</p>
                  <p className="font-bold text-zinc-950 mt-1">{targetFieldLabels[previewConfig.targetField]}</p>
                  <p className="text-xs text-zinc-500 mt-1">{changeTypeLabels[previewConfig.changeType]}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-[11px] uppercase font-bold text-zinc-500">Valor aplicado</p>
                  <p className="font-bold text-zinc-950 mt-1">
                    {previewConfig.changeType.includes('pct') ||
                    previewConfig.changeType.includes('margin') ||
                    previewConfig.changeType === 'recalculate_peps'
                      ? `${previewConfig.changeValue}%`
                      : formatCurrency(previewConfig.changeValue)}
                  </p>
                  {previewConfig.targetField === 'cost' && previewConfig.updateSalePrice && (
                    <p className="text-xs text-zinc-500 mt-1">
                      También recalcula venta con margen de {previewConfig.newMargin}%.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 overflow-hidden">
                <div className="px-4 py-3 bg-zinc-100 border-b border-zinc-200">
                  <p className="font-bold text-zinc-900">Resumen de valores antes y después</p>
                </div>
                <div className="grid grid-cols-3 text-sm">
                  <div className="p-3 font-bold text-zinc-500 bg-zinc-50">Referencia</div>
                  <div className="p-3 font-bold text-zinc-500 bg-zinc-50 text-right">Antes</div>
                  <div className="p-3 font-bold text-zinc-500 bg-zinc-50 text-right">Después</div>

                  <div className="p-3 border-t border-zinc-100">Promedio</div>
                  <div className="p-3 border-t border-zinc-100 text-right font-mono">{formatCurrency(previewSummary.currentAverage)}</div>
                  <div className="p-3 border-t border-zinc-100 text-right font-mono font-bold">{formatCurrency(previewSummary.nextAverage)}</div>

                  <div className="p-3 border-t border-zinc-100">Mínimo</div>
                  <div className="p-3 border-t border-zinc-100 text-right font-mono">{formatCurrency(previewSummary.currentMin)}</div>
                  <div className="p-3 border-t border-zinc-100 text-right font-mono font-bold">{formatCurrency(previewSummary.nextMin)}</div>

                  <div className="p-3 border-t border-zinc-100">Máximo</div>
                  <div className="p-3 border-t border-zinc-100 text-right font-mono">{formatCurrency(previewSummary.currentMax)}</div>
                  <div className="p-3 border-t border-zinc-100 text-right font-mono font-bold">{formatCurrency(previewSummary.nextMax)}</div>
                </div>
              </div>

              <div>
                <label htmlFor="bulk-price-confirmation" className="block text-sm font-bold text-zinc-900 mb-2">
                  Para confirmar, escribí exactamente:
                </label>
                <div className="rounded-lg bg-zinc-950 text-white px-4 py-3 font-mono font-bold text-center tracking-wide mb-3">
                  {confirmationPhrase}
                </div>
                <input
                  id="bulk-price-confirmation"
                  type="text"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  disabled={applying}
                  autoComplete="off"
                  className={`w-full px-4 py-3 rounded-xl border-2 outline-none font-mono ${
                    confirmationText.length === 0
                      ? 'border-zinc-200 focus:border-zinc-500'
                      : confirmationIsValid
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-red-300 bg-red-50'
                  }`}
                  placeholder={confirmationPhrase}
                  aria-describedby="bulk-price-confirmation-help"
                />
                <p id="bulk-price-confirmation-help" className="text-xs text-zinc-500 mt-2">
                  El botón permanecerá bloqueado hasta que la frase coincida.
                </p>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirm(false);
                    setConfirmationText('');
                  }}
                  disabled={applying}
                  className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl font-bold transition-all disabled:opacity-50"
                >
                  Cancelar y revisar
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying || !confirmationIsValid}
                  className="flex-1 py-3 px-4 bg-red-700 hover:bg-red-800 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {applying ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Aplicando cambios…
                    </>
                  ) : (
                    'Confirmar actualización'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 md:mb-8 space-y-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-zinc-900">Actualización Masiva de Precios</h1>
          <p className="text-sm text-zinc-500 mt-1">Revisá la vista previa antes de modificar precios reales.</p>
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3 text-amber-950">
          <AlertCircle size={22} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Acción protegida</p>
            <p className="text-sm mt-1">
              El alcance inicial es un producto individual. Para aplicar cambios será obligatorio generar una vista previa y escribir una confirmación.
            </p>
          </div>
        </div>
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
              {previewProducts.length > 0 && previewConfig && (
                <button
                  onClick={openConfirmation}
                  disabled={applying}
                  className="w-full sm:w-auto px-6 py-2 bg-red-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-red-800 transition-all shadow-lg shadow-red-100"
                >
                  {applying ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <CheckCircle2 size={18} />}
                  Revisar y confirmar
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              {previewProducts.length > 0 && previewConfig ? (
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
                          const { newCost, newSalePrice } = calculateNewValues(p, previewConfig!);
                          const diff = previewConfig.targetField === 'cost' ? newCost - p.cost : newSalePrice - p.sale_price;
                          const base = previewConfig.targetField === 'cost' ? p.cost : p.sale_price;
                          const pct = base !== 0 ? (diff / base) * 100 : 0;
                          
                          return (
                            <tr key={p.id} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-4 md:px-6 py-4">
                                <div className="font-bold text-zinc-900 text-sm md:text-base">{p.name}</div>
                                <div className="text-[10px] text-zinc-400">{p.family_name || 'Sin familia'}</div>
                              </td>
                              <td className="px-4 md:px-6 py-4 text-right">
                                <div className="text-[10px] text-zinc-400 font-mono">${p.cost.toFixed(2)}</div>
                                <div className={`font-mono font-bold text-sm ${previewConfig.targetField === 'cost' ? 'text-zinc-900' : 'text-zinc-500'}`}>
                                  ${newCost.toFixed(2)}
                                </div>
                              </td>
                              <td className="px-4 md:px-6 py-4 text-right">
                                <div className="text-[10px] text-zinc-400 font-mono">${p.sale_price.toFixed(2)}</div>
                                <div className={`font-mono font-bold text-sm ${previewConfig.targetField === 'sale_price' || previewConfig.updateSalePrice ? 'text-zinc-900' : 'text-zinc-500'}`}>
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
