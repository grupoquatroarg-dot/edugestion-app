import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Building2,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Eye,
  FileText,
  Loader2,
  Mail,
  MapPin,
  PackagePlus,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  Search,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import { Product, PurchaseInvoice } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, unwrapResponse } from '../utils/api';
import { formatBusinessDate, getBusinessDateInputValue } from '../utils/businessDate';

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

type Provider = ProviderForm & {
  id: number;
  estado?: string;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
  deactivation_reason?: string | null;
};

type ConfigPaymentMethod = {
  id: number;
  name: string;
  tipo?: string;
};

type ModuleView = 'invoices' | 'providers';
type InvoiceFilter = 'all' | 'paid' | 'pending' | 'cancelled';

const emptyProviderForm: ProviderForm = {
  nombre: '',
  cuit: '',
  telefono: '',
  email: '',
  direccion: '',
};

const getToday = getBusinessDateInputValue;

const formatCurrency = (value: unknown) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDate = (value: unknown) => formatBusinessDate(value);

const isInvoiceCancelled = (invoice: PurchaseInvoice) =>
  String((invoice as any).estado || '').toLowerCase() === 'anulada';

const isProviderActive = (provider: Provider) =>
  String(provider.estado || 'activo').toLowerCase() !== 'inactivo';

const getInvoiceBalance = (invoice: PurchaseInvoice) =>
  isInvoiceCancelled(invoice)
    ? 0
    : Math.max(0, Number((invoice as any).saldo_pendiente ?? Number(invoice.total || 0) - Number((invoice as any).monto_pagado || 0)));

const isInvoicePaid = (invoice: PurchaseInvoice) =>
  !isInvoiceCancelled(invoice) &&
  (String((invoice as any).estado_pago || '').toLowerCase() === 'pagado' || getInvoiceBalance(invoice) <= 0);

const getPaymentMethodLabel = (method: unknown) => {
  const value = String(method || '').toLowerCase();
  const labels: Record<string, string> = {
    efectivo: 'Efectivo',
    transferencia: 'Transferencia',
    mercado_pago: 'Mercado Pago',
    cheque: 'Cheque',
    'cta cte': 'Cuenta corriente',
  };

  return labels[value] || String(method || 'Sin informar');
};

const isCurrentAccountMethod = (method: unknown) =>
  String(method || '').trim().toLowerCase() === 'cta cte';

const toPurchasePaymentValue = (name: string) => {
  const normalized = name.trim().toLowerCase();
  const aliases: Record<string, string> = {
    efectivo: 'efectivo',
    transferencia: 'transferencia',
    'mercado pago': 'mercado_pago',
    cheque: 'cheque',
    'cta cte': 'Cta Cte',
  };
  return aliases[normalized] || name.trim();
};

const getPreferredPurchasePayment = (methods: ConfigPaymentMethod[], allowCurrentAccount: boolean) => {
  const available = methods
    .map((method) => toPurchasePaymentValue(method.name))
    .filter((method) => allowCurrentAccount || !isCurrentAccountMethod(method));
  return available.find((method) => String(method).toLowerCase() === 'efectivo') || available[0] || '';
};

export default function PurchaseInvoiceModule() {
  const { hasPermission } = useAuth();
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [proveedores, setProveedores] = useState<Provider[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ConfigPaymentMethod[]>([]);
  const [activeView, setActiveView] = useState<ModuleView>('invoices');
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [providerSearch, setProviderSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isCancellationModalOpen, setIsCancellationModalOpen] = useState(false);
  const [isProviderLifecycleModalOpen, setIsProviderLifecycleModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<PurchaseInvoice | null>(null);
  const [selectedInvoiceForCancellation, setSelectedInvoiceForCancellation] = useState<PurchaseInvoice | null>(null);
  const [selectedProviderForLifecycle, setSelectedProviderForLifecycle] = useState<Provider | null>(null);
  const [providerLifecycleAction, setProviderLifecycleAction] = useState<'deactivate' | 'reactivate'>('deactivate');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [isCreatingNewProduct, setIsCreatingNewProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [isCreatingProvider, setIsCreatingProvider] = useState(false);
  const [providerSubmitError, setProviderSubmitError] = useState('');
  const [providerLifecycleReason, setProviderLifecycleReason] = useState('');
  const [providerLifecycleError, setProviderLifecycleError] = useState('');
  const [isChangingProviderStatus, setIsChangingProviderStatus] = useState(false);
  const [isPayingInvoice, setIsPayingInvoice] = useState(false);
  const [paymentSubmitError, setPaymentSubmitError] = useState('');
  const [isCancellingInvoice, setIsCancellingInvoice] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationSubmitError, setCancellationSubmitError] = useState('');
  const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);
  const [invoiceSubmitError, setInvoiceSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [paymentForm, setPaymentForm] = useState({
    metodo_pago_real: '',
    fecha_pago: getToday(),
  });

  const [formData, setFormData] = useState({
    numero_factura: '',
    proveedor_id: 0,
    fecha_compra: getToday(),
    metodo_pago: '',
    items: [] as InvoiceFormItem[],
  });

  const [currentItem, setCurrentItem] = useState({
    product_id: 0 as number | string,
    cantidad: 1,
    costo_unitario: 0,
  });

  const handleApiJson = async <T,>(res: Response): Promise<T> => {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('El servidor devolvió una respuesta inesperada. Intente nuevamente.');
    }

    const body = await res.json();
    return unwrapResponse<T>(body);
  };

  const fetchProveedores = async () => {
    const res = await apiFetch('/api/purchase-invoices?endpoint=proveedores');
    const data = await handleApiJson<Provider[]>(res);
    setProveedores(Array.isArray(data) ? data : []);
  };

  const fetchInvoices = async () => {
    const res = await apiFetch('/api/purchase-invoices');
    const data = await handleApiJson<PurchaseInvoice[]>(res);
    setInvoices(Array.isArray(data) ? data : []);
  };

  const fetchProducts = async () => {
    const res = await apiFetch('/api/products?active_only=true');
    const data = await handleApiJson<Product[]>(res);
    setProducts(Array.isArray(data) ? data : []);
  };

  const fetchPaymentMethods = async () => {
    const res = await apiFetch('/api/purchase-invoices?endpoint=payment-methods');
    const data = await handleApiJson<ConfigPaymentMethod[]>(res);
    const activeMethods = Array.isArray(data) ? data : [];
    setPaymentMethods(activeMethods);

    const availableValues = activeMethods.map((method) => toPurchasePaymentValue(method.name));
    setFormData((previous) => ({
      ...previous,
      metodo_pago: availableValues.includes(previous.metodo_pago)
        ? previous.metodo_pago
        : getPreferredPurchasePayment(activeMethods, true),
    }));
    setPaymentForm((previous) => ({
      ...previous,
      metodo_pago_real: availableValues.includes(previous.metodo_pago_real) && !isCurrentAccountMethod(previous.metodo_pago_real)
        ? previous.metodo_pago_real
        : getPreferredPurchasePayment(activeMethods, false),
    }));
  };

  const loadData = async (background = false) => {
    if (background) setIsRefreshing(true);
    else setIsLoading(true);

    setLoadError('');

    try {
      await Promise.all([fetchInvoices(), fetchProducts(), fetchProveedores(), fetchPaymentMethods()]);
    } catch (error: any) {
      console.error('Error loading purchase invoice module:', error);
      setLoadError(error?.message || 'No se pudieron cargar las facturas y proveedores.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(''), 5000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const fetchInvoiceDetails = async (id: number) => {
    setDetailLoading(true);
    setDetailError('');
    setSelectedInvoice(null);
    setIsViewModalOpen(true);

    try {
      const res = await apiFetch(`/api/purchase-invoices?id=${id}`);
      const data = await handleApiJson<PurchaseInvoice>(res);
      setSelectedInvoice(data);
    } catch (error: any) {
      console.error('Error fetching invoice details:', error);
      setDetailError(error?.message || 'No se pudo obtener el detalle de la factura.');
    } finally {
      setDetailLoading(false);
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
      fecha_compra: getToday(),
      metodo_pago: getPreferredPurchasePayment(paymentMethods, true),
      items: [],
    });
    resetCurrentItem();
  };

  const openInvoiceForm = (providerId?: number) => {
    setInvoiceSubmitError('');
    if (providerId) {
      setFormData((previous) => ({ ...previous, proveedor_id: providerId }));
    }
    setIsModalOpen(true);
  };

  const handleCreateProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isCreatingProvider) return;

    setProviderSubmitError('');

    if (!providerForm.nombre.trim()) {
      setProviderSubmitError('Ingrese el nombre del proveedor.');
      return;
    }

    setIsCreatingProvider(true);

    try {
      const res = await apiFetch('/api/purchase-invoices?endpoint=proveedores', {
        method: 'POST',
        body: JSON.stringify({
          nombre: providerForm.nombre.trim(),
          cuit: providerForm.cuit.trim(),
          telefono: providerForm.telefono.trim(),
          email: providerForm.email.trim(),
          direccion: providerForm.direccion.trim(),
        }),
      });

      const createdProvider = await handleApiJson<Provider>(res);
      await fetchProveedores();

      if (createdProvider?.id) {
        setFormData((previous) => ({ ...previous, proveedor_id: Number(createdProvider.id) }));
      }

      setProviderForm(emptyProviderForm);
      setIsProviderModalOpen(false);
      setSuccessMessage(`Proveedor ${createdProvider?.nombre || ''} creado correctamente.`);
    } catch (error: any) {
      console.error('Error creating provider:', error);
      setProviderSubmitError(error?.message || 'No se pudo crear el proveedor.');
    } finally {
      setIsCreatingProvider(false);
    }
  };

  const openProviderLifecycleModal = (provider: Provider, action: 'deactivate' | 'reactivate') => {
    setSelectedProviderForLifecycle(provider);
    setProviderLifecycleAction(action);
    setProviderLifecycleReason('');
    setProviderLifecycleError('');
    setIsProviderLifecycleModalOpen(true);
  };

  const handleProviderLifecycle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProviderForLifecycle || isChangingProviderStatus) return;

    const reason = providerLifecycleReason.trim();
    if (reason.length < 3) {
      setProviderLifecycleError('Ingresá un motivo de al menos 3 caracteres.');
      return;
    }

    setIsChangingProviderStatus(true);
    setProviderLifecycleError('');

    try {
      const res = await apiFetch(
        `/api/purchase-invoices?endpoint=provider-lifecycle&id=${selectedProviderForLifecycle.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: providerLifecycleAction,
            motivo: reason,
          }),
        },
      );

      await handleApiJson(res);
      await fetchProveedores();

      if (
        providerLifecycleAction === 'deactivate' &&
        Number(formData.proveedor_id) === Number(selectedProviderForLifecycle.id)
      ) {
        setFormData((previous) => ({ ...previous, proveedor_id: 0 }));
      }

      setSuccessMessage(
        providerLifecycleAction === 'deactivate'
          ? `Proveedor ${selectedProviderForLifecycle.nombre} dado de baja correctamente.`
          : `Proveedor ${selectedProviderForLifecycle.nombre} reactivado correctamente.`,
      );
      setIsProviderLifecycleModalOpen(false);
      setSelectedProviderForLifecycle(null);
      setProviderLifecycleReason('');
    } catch (error: any) {
      console.error('Error changing provider status:', error);
      setProviderLifecycleError(error?.message || 'No se pudo cambiar el estado del proveedor.');
    } finally {
      setIsChangingProviderStatus(false);
    }
  };

  const openPaymentModal = (invoice: PurchaseInvoice) => {
    setSelectedInvoiceForPayment(invoice);
    setPaymentSubmitError('');
    setPaymentForm({ metodo_pago_real: getPreferredPurchasePayment(paymentMethods, false), fecha_pago: getToday() });
    setIsPaymentModalOpen(true);
  };

  const handlePayInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedInvoiceForPayment || isPayingInvoice) return;

    const saldoPendiente = getInvoiceBalance(selectedInvoiceForPayment);
    if (saldoPendiente <= 0) {
      setPaymentSubmitError('La factura no tiene saldo pendiente.');
      return;
    }

    if (isCurrentAccountMethod(paymentForm.metodo_pago_real)) {
      setPaymentSubmitError('Seleccione un método de pago real.');
      return;
    }

    setIsPayingInvoice(true);
    setPaymentSubmitError('');

    try {
      const res = await apiFetch(`/api/purchase-invoices?id=${selectedInvoiceForPayment.id}`, {
        method: 'PATCH',
        body: JSON.stringify(paymentForm),
      });

      await handleApiJson(res);
      setIsPaymentModalOpen(false);
      setSelectedInvoiceForPayment(null);
      await fetchInvoices();
      setSuccessMessage('Pago de proveedor registrado correctamente.');
    } catch (error: any) {
      console.error('Error paying supplier invoice:', error);
      setPaymentSubmitError(error?.message || 'No se pudo registrar el pago del proveedor.');
    } finally {
      setIsPayingInvoice(false);
    }
  };

  const openCancellationModal = (invoice: PurchaseInvoice) => {
    setSelectedInvoiceForCancellation(invoice);
    setCancellationReason('');
    setCancellationSubmitError('');
    setIsCancellationModalOpen(true);
  };

  const handleCancelInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedInvoiceForCancellation || isCancellingInvoice) return;

    const normalizedReason = cancellationReason.trim();
    if (normalizedReason.length < 3) {
      setCancellationSubmitError('El motivo debe tener al menos 3 caracteres.');
      return;
    }

    if (normalizedReason.length > 500) {
      setCancellationSubmitError('El motivo no puede superar los 500 caracteres.');
      return;
    }

    setIsCancellingInvoice(true);
    setCancellationSubmitError('');

    try {
      const res = await apiFetch(
        `/api/purchase-invoices?endpoint=cancel&id=${selectedInvoiceForCancellation.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ motivo: normalizedReason }),
        },
      );

      await handleApiJson(res);
      setIsCancellationModalOpen(false);
      setSelectedInvoiceForCancellation(null);
      setCancellationReason('');
      await Promise.all([fetchInvoices(), fetchProducts()]);
      setSuccessMessage(`Factura ${selectedInvoiceForCancellation.numero_factura} anulada correctamente.`);
    } catch (error: any) {
      console.error('Error cancelling purchase invoice:', error);
      setCancellationSubmitError(error?.message || 'No se pudo anular la factura de compra.');
    } finally {
      setIsCancellingInvoice(false);
    }
  };

  const handleAddItem = () => {
    const isNewValid = isCreatingNewProduct && newProductName.trim() !== '';
    const isExistingValid = !isCreatingNewProduct && currentItem.product_id !== 0;

    if (!(isNewValid || isExistingValid)) {
      setInvoiceSubmitError('Seleccione un producto o ingrese el nombre del producto nuevo.');
      return;
    }

    if (currentItem.cantidad <= 0) {
      setInvoiceSubmitError('La cantidad debe ser mayor a cero.');
      return;
    }

    if (currentItem.costo_unitario < 0) {
      setInvoiceSubmitError('El costo unitario no puede ser negativo.');
      return;
    }

    const finalProductId = isCreatingNewProduct ? `new:${newProductName.trim()}` : currentItem.product_id;

    setFormData((previous) => ({
      ...previous,
      items: [...previous.items, { ...currentItem, product_id: finalProductId }],
    }));
    setInvoiceSubmitError('');
    resetCurrentItem();
  };

  const handleRemoveItem = (index: number) => {
    setFormData((previous) => ({ ...previous, items: previous.items.filter((_, itemIndex) => itemIndex !== index) }));
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmittingInvoice) return;

    setInvoiceSubmitError('');
    const finalItems = getPendingItemsForSubmit();

    if (finalItems.length === 0) {
      setInvoiceSubmitError('Debe agregar al menos un producto a la factura.');
      return;
    }

    if (formData.proveedor_id === 0) {
      setInvoiceSubmitError('Seleccione un proveedor.');
      return;
    }

    const invoiceNumber = formData.numero_factura.trim();
    if (!invoiceNumber) {
      setInvoiceSubmitError('Ingrese el número de factura.');
      return;
    }

    const total = finalItems.reduce((sum, item) => sum + item.cantidad * item.costo_unitario, 0);
    const costChanges = finalItems
      .filter((item) => typeof item.product_id === 'number')
      .map((item) => {
        const product = products.find((candidate) => candidate.id === item.product_id);
        if (!product) return null;

        const currentCost = Number(product.cost || 0);
        const newCost = Number(item.costo_unitario || 0);
        if (currentCost === newCost) return null;

        return { name: product.name, currentCost, newCost };
      })
      .filter(Boolean) as Array<{ name: string; currentCost: number; newCost: number }>;

    if (costChanges.length > 0) {
      const message = [
        'Aviso: al guardar esta factura se actualizará el costo del producto al último costo comprado.',
        '',
        ...costChanges.map(
          (change) => `${change.name}: costo actual ${formatCurrency(change.currentCost)} → nuevo costo ${formatCurrency(change.newCost)}`,
        ),
        '',
        'La ganancia continuará calculándose con método PEPS/FIFO según los lotes de compra.',
        '¿Desea continuar?',
      ].join('\n');

      if (!window.confirm(message)) return;
    }

    setIsSubmittingInvoice(true);

    try {
      const res = await apiFetch('/api/purchase-invoices', {
        method: 'POST',
        body: JSON.stringify({
          proveedor_id: formData.proveedor_id,
          numero_factura: invoiceNumber,
          fecha: formData.fecha_compra,
          metodo_pago: formData.metodo_pago,
          total,
          items: finalItems,
        }),
      });

      await handleApiJson(res);
      setIsModalOpen(false);
      resetForm();
      setInvoiceSubmitError('');
      setSuccessMessage(`Factura ${invoiceNumber} guardada correctamente.`);
      await Promise.all([fetchInvoices(), fetchProducts(), fetchProveedores()]);
    } catch (error: any) {
      console.error('Error submitting invoice:', error);
      setInvoiceSubmitError(error?.message || 'No se pudo guardar la factura. Revise los datos e intente nuevamente.');
    } finally {
      setIsSubmittingInvoice(false);
    }
  };

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return invoices.filter((invoice) => {
      const matchesSearch =
        !term ||
        String(invoice.numero_factura || '').toLowerCase().includes(term) ||
        String((invoice as any).proveedor || '').toLowerCase().includes(term) ||
        String((invoice as any).metodo_pago || '').toLowerCase().includes(term);

      const cancelled = isInvoiceCancelled(invoice);
      const paid = isInvoicePaid(invoice);
      const matchesStatus =
        invoiceFilter === 'all' ||
        (invoiceFilter === 'cancelled' && cancelled) ||
        (invoiceFilter === 'paid' && paid) ||
        (invoiceFilter === 'pending' && !cancelled && !paid);
      return matchesSearch && matchesStatus;
    });
  }, [invoiceFilter, invoices, searchTerm]);

  const providerSummaries = useMemo(() => {
    return proveedores.map((provider) => {
      const relatedInvoices = invoices.filter(
        (invoice) =>
          !isInvoiceCancelled(invoice) &&
          (
            Number((invoice as any).proveedor_id) === Number(provider.id) ||
            String((invoice as any).proveedor || '').trim().toLowerCase() === provider.nombre.trim().toLowerCase()
          ),
      );
      const totalPurchased = relatedInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
      const pendingBalance = relatedInvoices.reduce((sum, invoice) => sum + getInvoiceBalance(invoice), 0);
      const lastInvoice = [...relatedInvoices].sort(
        (first, second) => new Date(String((second as any).fecha_compra || 0)).getTime() - new Date(String((first as any).fecha_compra || 0)).getTime(),
      )[0];

      return {
        ...provider,
        invoiceCount: relatedInvoices.length,
        totalPurchased,
        pendingBalance,
        lastInvoiceDate: (lastInvoice as any)?.fecha_compra || '',
      };
    });
  }, [invoices, proveedores]);

  const activeProviders = useMemo(
    () => proveedores.filter(isProviderActive),
    [proveedores],
  );

  const filteredProviders = useMemo(() => {
    const term = providerSearch.trim().toLowerCase();
    if (!term) return providerSummaries;

    return providerSummaries.filter((provider) =>
      [provider.nombre, provider.cuit, provider.telefono, provider.email, provider.direccion]
        .some((value) => String(value || '').toLowerCase().includes(term)),
    );
  }, [providerSearch, providerSummaries]);

  const activeInvoices = invoices.filter((invoice) => !isInvoiceCancelled(invoice));
  const cancelledInvoices = invoices.length - activeInvoices.length;
  const totalPurchases = activeInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const totalPending = activeInvoices.reduce((sum, invoice) => sum + getInvoiceBalance(invoice), 0);
  const paidInvoices = activeInvoices.filter(isInvoicePaid).length;
  const pendingInvoices = activeInvoices.length - paidInvoices;
  const currentItemSubtotal = currentItem.cantidad > 0 && currentItem.costo_unitario >= 0
    ? currentItem.cantidad * currentItem.costo_unitario
    : 0;
  const totalInvoice = formData.items.reduce((sum, item) => sum + item.cantidad * item.costo_unitario, 0);
  const totalInvoiceWithCurrentItem = totalInvoice + currentItemSubtotal;

  const getItemName = (item: InvoiceFormItem) => {
    if (typeof item.product_id === 'string' && item.product_id.startsWith('new:')) {
      return `${item.product_id.replace('new:', '')} (Nuevo)`;
    }
    return products.find((product) => product.id === item.product_id)?.name || 'Producto';
  };

  const openProviderInvoices = (provider: Provider) => {
    setActiveView('invoices');
    setInvoiceFilter('all');
    setSearchTerm(provider.nombre);
  };

  return (
    <div className="min-h-full w-full p-3 sm:p-5 xl:p-7">
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-3 right-3 top-3 z-[100] flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-xl sm:left-auto sm:right-6 sm:top-5 sm:w-full sm:max-w-md"
        >
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm font-bold leading-5">{successMessage}</p>
          <button
            type="button"
            onClick={() => setSuccessMessage('')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-emerald-700 hover:bg-emerald-100"
            aria-label="Cerrar mensaje"
            title="Cerrar mensaje"
          >
            <X size={17} />
          </button>
        </div>
      )}

      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />
        <div className="flex flex-col gap-5 p-4 sm:p-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200 sm:h-14 sm:w-14">
              <Receipt size={26} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Compras y proveedores</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Facturas de compra</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Gestioná ingresos de mercadería, costos PEPS, saldos y datos de proveedores.
              </p>
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:w-auto">
            <button
              type="button"
              onClick={() => void loadData(true)}
              disabled={isRefreshing}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={17} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
              {isRefreshing ? 'Actualizando…' : 'Actualizar'}
            </button>
            {hasPermission('suppliers', 'create') && (
              <button
                type="button"
                onClick={() => openInvoiceForm()}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700"
              >
                <Plus size={18} aria-hidden="true" />
                Registrar factura
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Facturas activas', value: activeInvoices.length.toLocaleString('es-AR'), icon: FileText, tone: 'indigo' },
          { label: 'Compras acumuladas', value: formatCurrency(totalPurchases), icon: CircleDollarSign, tone: 'blue' },
          { label: 'Saldo pendiente', value: formatCurrency(totalPending), icon: WalletCards, tone: totalPending > 0 ? 'amber' : 'emerald' },
          { label: 'Proveedores activos', value: activeProviders.length.toLocaleString('es-AR'), icon: Building2, tone: 'slate' },
        ].map((card) => {
          const tones: Record<string, string> = {
            indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
            blue: 'bg-blue-50 text-blue-700 ring-blue-100',
            amber: 'bg-amber-50 text-amber-700 ring-amber-100',
            emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
            slate: 'bg-slate-100 text-slate-700 ring-slate-200',
          };
          const Icon = card.icon;

          return (
            <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{card.label}</p>
                  <p className="mt-2 break-words text-xl font-black text-slate-950 sm:text-2xl">{card.value}</p>
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${tones[card.tone]}`}>
                  <Icon size={19} aria-hidden="true" />
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveView('invoices')}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition ${
            activeView === 'invoices' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <FileText size={17} aria-hidden="true" />
          Facturas
        </button>
        <button
          type="button"
          onClick={() => setActiveView('providers')}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition ${
            activeView === 'providers' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Building2 size={17} aria-hidden="true" />
          Proveedores
        </button>
      </div>

      {loadError && (
        <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AlertCircle size={21} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-black">No se pudieron cargar los datos</p>
              <p className="mt-1 text-sm text-red-700">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white hover:bg-red-800 sm:w-auto"
          >
            <RefreshCw size={17} aria-hidden="true" />
            Reintentar
          </button>
        </div>
      )}

      {isLoading ? (
        <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-busy="true">
          <div className="flex items-center gap-3 text-slate-700">
            <Loader2 size={22} className="animate-spin text-indigo-600" aria-hidden="true" />
            <div>
              <p className="font-black">Cargando compras y proveedores…</p>
              <p className="text-sm text-slate-500">Estamos preparando la información del módulo.</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-48 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        </section>
      ) : activeView === 'invoices' ? (
        <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="relative min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por factura, proveedor o medio de pago…"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-4">
              {([
                ['all', `Todas (${invoices.length})`],
                ['pending', `Pendientes (${pendingInvoices})`],
                ['paid', `Pagadas (${paidInvoices})`],
                ['cancelled', `Anuladas (${cancelledInvoices})`],
              ] as Array<[InvoiceFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInvoiceFilter(value)}
                  className={`min-h-11 rounded-xl px-2 py-2 text-xs font-black transition sm:px-4 ${
                    invoiceFilter === value
                      ? 'bg-slate-950 text-white shadow-md'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <p>
              <span className="font-black text-slate-900">{filteredInvoices.length}</span>{' '}
              {filteredInvoices.length === 1 ? 'factura visible' : 'facturas visibles'}
            </p>
            {(searchTerm || invoiceFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setInvoiceFilter('all');
                }}
                className="min-h-10 rounded-xl px-3 text-sm font-black text-indigo-700 hover:bg-indigo-50"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="mt-4 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <FileText size={38} className="text-slate-300" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-black text-slate-800">
                {invoices.length === 0 ? 'Todavía no hay facturas de compra' : 'No hay resultados para estos filtros'}
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                {invoices.length === 0
                  ? 'Registrá la primera factura para incorporar mercadería y actualizar costos.'
                  : 'Probá otro proveedor, número de factura o estado de pago.'}
              </p>
              {invoices.length === 0 && hasPermission('suppliers', 'create') && (
                <button
                  type="button"
                  onClick={() => openInvoiceForm()}
                  className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700"
                >
                  <Plus size={18} aria-hidden="true" />
                  Registrar factura
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {filteredInvoices.map((invoice) => {
                const cancelled = isInvoiceCancelled(invoice);
                const paid = isInvoicePaid(invoice);
                const balance = getInvoiceBalance(invoice);
                const hasTraceability = Number((invoice as any).reversion_version || 0) === 1;
                const canCancel =
                  !cancelled &&
                  hasTraceability &&
                  hasPermission('suppliers', 'delete');

                return (
                  <article
                    key={invoice.id}
                    className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm transition sm:p-5 ${
                      cancelled
                        ? 'border-red-200 bg-red-50/40'
                        : 'border-slate-200 hover:border-indigo-200 hover:shadow-md'
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-4 min-[540px]:flex-row min-[540px]:items-start min-[540px]:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${
                          cancelled
                            ? 'bg-red-100 text-red-700 ring-red-200'
                            : 'bg-indigo-50 text-indigo-700 ring-indigo-100'
                        }`}>
                          {cancelled ? <Ban size={20} aria-hidden="true" /> : <Receipt size={20} aria-hidden="true" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="break-all text-base font-black text-slate-950">Factura {invoice.numero_factura}</h2>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                              cancelled
                                ? 'bg-red-100 text-red-700'
                                : paid
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-700'
                            }`}>
                              {cancelled ? 'Anulada' : paid ? 'Pagada' : 'Pendiente'}
                            </span>
                            {!cancelled && !hasTraceability && (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">
                                Sin trazabilidad
                              </span>
                            )}
                          </div>
                          <p className="mt-1 break-words text-sm font-bold text-slate-700">{(invoice as any).proveedor || 'Proveedor sin informar'}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-slate-500">
                            <span className="inline-flex items-center gap-1.5"><Calendar size={14} /> {formatDate((invoice as any).fecha_compra)}</span>
                            <span className="inline-flex items-center gap-1.5"><CreditCard size={14} /> {getPaymentMethodLabel((invoice as any).metodo_pago)}</span>
                          </div>
                          {cancelled && (invoice as any).anulacion_motivo && (
                            <p className="mt-2 rounded-xl bg-red-100 px-3 py-2 text-xs font-bold text-red-800">
                              Motivo: {(invoice as any).anulacion_motivo}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="min-[540px]:text-right">
                        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Total histórico</p>
                        <p className="mt-1 break-words text-xl font-black text-slate-950">{formatCurrency(invoice.total)}</p>
                        {!cancelled && !paid && <p className="mt-1 text-xs font-black text-amber-700">Pendiente: {formatCurrency(balance)}</p>}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => void fetchInvoiceDetails(invoice.id)}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
                        aria-label={`Ver detalle de factura ${invoice.numero_factura}`}
                      >
                        <Eye size={17} aria-hidden="true" />
                        Ver detalle
                      </button>

                      {!cancelled && isCurrentAccountMethod((invoice as any).metodo_pago) && !paid && (
                        <button
                          type="button"
                          onClick={() => openPaymentModal(invoice)}
                          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
                          aria-label={`Registrar pago de factura ${invoice.numero_factura}`}
                        >
                          <WalletCards size={17} aria-hidden="true" />
                          Registrar pago
                        </button>
                      )}

                      {hasPermission('suppliers', 'delete') && (
                        canCancel ? (
                          <button
                            type="button"
                            onClick={() => openCancellationModal(invoice)}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-red-700"
                            aria-label={`Anular factura ${invoice.numero_factura}`}
                          >
                            <Ban size={17} aria-hidden="true" />
                            Anular factura
                          </button>
                        ) : (
                          <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-center text-xs font-black text-slate-500">
                            {cancelled ? 'Factura anulada' : 'Sin trazabilidad para anular'}
                          </div>
                        )
                      )}

                      {!cancelled &&
                        !(isCurrentAccountMethod((invoice as any).metodo_pago) && !paid) &&
                        !hasPermission('suppliers', 'delete') && (
                          <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-50 px-4 py-2 text-sm font-bold text-slate-500">
                            <CheckCircle2 size={17} className="text-emerald-600" aria-hidden="true" />
                            Sin acciones pendientes
                          </div>
                        )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="relative min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input
                type="search"
                value={providerSearch}
                onChange={(event) => setProviderSearch(event.target.value)}
                placeholder="Buscar por nombre, CUIT, teléfono, email o dirección…"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            {hasPermission('suppliers', 'create') && (
              <button
                type="button"
                onClick={() => {
                  setProviderSubmitError('');
                  setIsProviderModalOpen(true);
                }}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700 lg:w-auto"
              >
                <Plus size={18} aria-hidden="true" />
                Nuevo proveedor
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <p><span className="font-black text-slate-900">{filteredProviders.length}</span> proveedores visibles</p>
            {providerSearch && (
              <button
                type="button"
                onClick={() => setProviderSearch('')}
                className="min-h-10 rounded-xl px-3 text-sm font-black text-indigo-700 hover:bg-indigo-50"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>

          {filteredProviders.length === 0 ? (
            <div className="mt-4 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <Building2 size={38} className="text-slate-300" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-black text-slate-800">
                {proveedores.length === 0 ? 'Todavía no hay proveedores' : 'No hay proveedores que coincidan'}
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                {proveedores.length === 0
                  ? 'Creá el primer proveedor para comenzar a registrar facturas de compra.'
                  : 'Probá buscar por otro nombre, CUIT o dato de contacto.'}
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
              {filteredProviders.map((provider) => (
                <article
                  key={provider.id}
                  className={`min-w-0 rounded-2xl border p-4 shadow-sm transition sm:p-5 ${
                    isProviderActive(provider)
                      ? 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-md'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                      <Building2 size={21} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-lg font-black text-slate-950">{provider.nombre}</h2>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                            isProviderActive(provider)
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {isProviderActive(provider) ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      {provider.cuit && <p className="mt-1 break-all text-xs font-bold text-slate-500">CUIT {provider.cuit}</p>}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
                    {provider.telefono && (
                      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                        <Phone size={16} className="mt-0.5 shrink-0 text-slate-400" />
                        <span className="break-all font-semibold">{provider.telefono}</span>
                      </div>
                    )}
                    {provider.email && (
                      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                        <Mail size={16} className="mt-0.5 shrink-0 text-slate-400" />
                        <span className="break-all font-semibold">{provider.email}</span>
                      </div>
                    )}
                    {provider.direccion && (
                      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 min-[480px]:col-span-2">
                        <MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" />
                        <span className="break-words font-semibold">{provider.direccion}</span>
                      </div>
                    )}
                  </div>

                  {!isProviderActive(provider) && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                      <p className="font-black text-slate-800">Proveedor dado de baja</p>
                      {provider.deactivation_reason && (
                        <p className="mt-1 break-words"><span className="font-bold">Motivo:</span> {provider.deactivation_reason}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {provider.deactivated_at ? formatDate(provider.deactivated_at) : 'Fecha no informada'}
                        {provider.deactivated_by ? ` · ${provider.deactivated_by}` : ''}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Facturas</p>
                      <p className="mt-1 text-lg font-black text-slate-950">{provider.invoiceCount}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Comprado</p>
                      <p className="mt-1 break-words text-sm font-black text-slate-950">{formatCurrency(provider.totalPurchased)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pendiente</p>
                      <p className={`mt-1 break-words text-sm font-black ${provider.pendingBalance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {formatCurrency(provider.pendingBalance)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Última compra</p>
                      <p className="mt-1 text-xs font-black text-slate-700">{provider.lastInvoiceDate ? formatDate(provider.lastInvoiceDate) : 'Sin compras'}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => openProviderInvoices(provider)}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
                    >
                      <Eye size={17} aria-hidden="true" />
                      Ver facturas
                    </button>
                    {isProviderActive(provider) && hasPermission('suppliers', 'create') && (
                      <button
                        type="button"
                        onClick={() => openInvoiceForm(provider.id)}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700"
                      >
                        <PackagePlus size={17} aria-hidden="true" />
                        Registrar factura
                      </button>
                    )}
                    {hasPermission('suppliers', 'delete') && (
                      <button
                        type="button"
                        onClick={() => openProviderLifecycleModal(
                          provider,
                          isProviderActive(provider) ? 'deactivate' : 'reactivate',
                        )}
                        className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black min-[420px]:col-span-2 ${
                          isProviderActive(provider)
                            ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                            : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        {isProviderActive(provider) ? <Ban size={17} aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
                        {isProviderActive(provider) ? 'Dar de baja proveedor' : 'Reactivar proveedor'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="purchase-invoice-title">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[94dvh] sm:max-w-5xl sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                  <FileText size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 id="purchase-invoice-title" className="truncate text-lg font-black text-slate-950 sm:text-xl">Registrar factura de compra</h2>
                  <p className="text-xs text-slate-500">Proveedor, productos, cantidades y costos.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isSubmittingInvoice) return;
                  setInvoiceSubmitError('');
                  setIsModalOpen(false);
                }}
                disabled={isSubmittingInvoice}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                aria-label="Cerrar formulario de factura"
                title="Cerrar formulario"
              >
                <X size={22} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                {invoiceSubmitError && (
                  <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-black">Revisá la factura</p>
                      <p className="mt-1 text-sm text-red-700">{invoiceSubmitError}</p>
                    </div>
                  </div>
                )}

                <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-indigo-600">Datos principales</p>
                      <p className="mt-1 text-sm text-slate-500">Identificá la compra y su forma de pago.</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="min-w-0">
                      <span className="mb-2 flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500">
                        Proveedor
                        {hasPermission('suppliers', 'create') && (
                          <button
                            type="button"
                            onClick={() => {
                              setProviderSubmitError('');
                              setIsProviderModalOpen(true);
                            }}
                            className="normal-case tracking-normal text-indigo-700 hover:text-indigo-800"
                          >
                            + Nuevo
                          </button>
                        )}
                      </span>
                      <select
                        required
                        value={formData.proveedor_id}
                        onChange={(event) => setFormData({ ...formData, proveedor_id: Number(event.target.value) || 0 })}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      >
                        <option value={0}>Seleccionar proveedor</option>
                        {activeProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.nombre}</option>)}
                      </select>
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Número de factura</span>
                      <input
                        required
                        type="text"
                        value={formData.numero_factura}
                        onChange={(event) => setFormData({ ...formData, numero_factura: event.target.value })}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Fecha de compra</span>
                      <input
                        required
                        type="date"
                        value={formData.fecha_compra}
                        onChange={(event) => setFormData({ ...formData, fecha_compra: event.target.value })}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Método de pago</span>
                      <select
                        required
                        value={formData.metodo_pago}
                        onChange={(event) => setFormData({ ...formData, metodo_pago: event.target.value })}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      >
                        {paymentMethods.length === 0 && <option value="">No hay formas de pago activas</option>}
                        {paymentMethods.map((method) => (
                          <option key={method.id} value={toPurchasePaymentValue(method.name)}>
                            {getPaymentMethodLabel(toPurchasePaymentValue(method.name))}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="mt-4 rounded-2xl border border-slate-200 p-4 sm:p-5">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-indigo-600">Productos</p>
                      <p className="mt-1 text-sm text-slate-500">Agregá cada producto con su cantidad y costo unitario.</p>
                    </div>
                    <p className="text-sm font-black text-slate-900">Subtotal actual: {formatCurrency(currentItemSubtotal)}</p>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(100px,.6fr)_minmax(140px,.8fr)_auto] xl:items-end">
                    <div className="min-w-0 md:col-span-2 xl:col-span-1">
                      <label className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Producto</label>
                      {!isCreatingNewProduct ? (
                        <select
                          key={`purchase-product-select-${formData.items.length}`}
                          value={String(currentItem.product_id)}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === 'new') {
                              setIsCreatingNewProduct(true);
                              setCurrentItem({ ...currentItem, product_id: 'new' });
                              return;
                            }
                            const productId = Number(value) || 0;
                            const product = products.find((candidate) => candidate.id === productId);
                            setCurrentItem({ ...currentItem, product_id: productId, costo_unitario: Number(product?.cost || 0) });
                          }}
                          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                        >
                          <option value="0">Seleccionar producto…</option>
                          <option value="new">+ Crear producto nuevo…</option>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.code})</option>)}
                        </select>
                      ) : (
                        <div className="flex min-w-0 gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={newProductName}
                            onChange={(event) => setNewProductName(event.target.value)}
                            placeholder="Nombre del producto nuevo…"
                            className="min-h-11 min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-4 focus:ring-emerald-100"
                          />
                          <button type="button" onClick={resetCurrentItem} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-100" aria-label="Cancelar producto nuevo">
                            <X size={18} />
                          </button>
                        </div>
                      )}
                    </div>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Cantidad</span>
                      <input
                        type="number"
                        min="1"
                        value={currentItem.cantidad}
                        onChange={(event) => setCurrentItem({ ...currentItem, cantidad: Number(event.target.value) || 0 })}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>

                    <label className="min-w-0">
                      <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Costo unitario</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={currentItem.costo_unitario}
                        onChange={(event) => setCurrentItem({ ...currentItem, costo_unitario: Number(event.target.value) || 0 })}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 xl:w-auto"
                    >
                      <Plus size={18} aria-hidden="true" />
                      Agregar
                    </button>
                  </div>

                  {formData.items.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                      <PackagePlus size={32} className="mx-auto text-slate-300" aria-hidden="true" />
                      <p className="mt-3 font-black text-slate-700">Todavía no agregaste productos</p>
                      <p className="mt-1 text-sm text-slate-500">Seleccioná un producto, completá cantidad y costo, y tocá Agregar.</p>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
                      {formData.items.map((item, index) => (
                        <article key={`${String(item.product_id)}-${index}`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words font-black text-slate-900">{getItemName(item)}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">Cantidad: {item.cantidad} · Costo: {formatCurrency(item.costo_unitario)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(index)}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100"
                              aria-label={`Quitar ${getItemName(item)}`}
                              title="Quitar producto"
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Subtotal</span>
                            <span className="break-words text-base font-black text-slate-950">{formatCurrency(item.cantidad * item.costo_unitario)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total agregado</p>
                    <p className="mt-1 break-words text-2xl font-black text-slate-950">{formatCurrency(totalInvoice)}</p>
                    {currentItemSubtotal > 0 && <p className="mt-1 text-xs font-black text-emerald-700">Con el producto actual: {formatCurrency(totalInvoiceWithCurrentItem)}</p>}
                  </div>
                  <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:w-auto">
                    <button
                      type="button"
                      onClick={() => {
                        if (isSubmittingInvoice) return;
                        setInvoiceSubmitError('');
                        setIsModalOpen(false);
                      }}
                      disabled={isSubmittingInvoice}
                      className="min-h-11 rounded-xl border border-slate-200 px-5 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    {hasPermission('suppliers', 'create') && (
                      <button
                        type="submit"
                        disabled={isSubmittingInvoice}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-black text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSubmittingInvoice ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {isSubmittingInvoice ? 'Guardando…' : 'Guardar factura'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isProviderLifecycleModalOpen && selectedProviderForLifecycle && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-lifecycle-title"
        >
          <div className="w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
            <div className={`flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-6 ${
              providerLifecycleAction === 'deactivate'
                ? 'border-red-100 bg-red-50'
                : 'border-emerald-100 bg-emerald-50'
            }`}>
              <div className="min-w-0">
                <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${
                  providerLifecycleAction === 'deactivate' ? 'text-red-600' : 'text-emerald-700'
                }`}>
                  Cambio de estado auditable
                </p>
                <h2 id="provider-lifecycle-title" className="mt-1 break-words text-xl font-black text-slate-950">
                  {providerLifecycleAction === 'deactivate' ? 'Dar de baja proveedor' : 'Reactivar proveedor'}
                </h2>
                <p className="mt-1 break-words text-sm text-slate-600">{selectedProviderForLifecycle.nombre}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isChangingProviderStatus) return;
                  setIsProviderLifecycleModalOpen(false);
                  setSelectedProviderForLifecycle(null);
                  setProviderLifecycleError('');
                  setProviderLifecycleReason('');
                }}
                disabled={isChangingProviderStatus}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-white/70 disabled:opacity-40"
                aria-label="Cerrar cambio de estado del proveedor"
              >
                <X size={21} />
              </button>
            </div>

            <form onSubmit={handleProviderLifecycle} className="max-h-[calc(100dvh-88px)] overflow-y-auto p-4 sm:p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {providerLifecycleAction === 'deactivate' ? (
                  <p>
                    El proveedor conservará todas sus facturas y movimientos, pero dejará de estar disponible para nuevas compras y egresos.
                    La baja se bloqueará si tiene saldos pendientes o cheques todavía en proceso.
                  </p>
                ) : (
                  <p>
                    El proveedor volverá a estar disponible para nuevas facturas y egresos. El historial de la baja anterior se conservará.
                  </p>
                )}
              </div>

              {providerLifecycleError && (
                <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <p className="min-w-0 break-words text-sm font-bold">{providerLifecycleError}</p>
                </div>
              )}

              <label className="mt-4 block">
                <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Motivo obligatorio
                </span>
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  rows={4}
                  value={providerLifecycleReason}
                  onChange={(event) => setProviderLifecycleReason(event.target.value)}
                  placeholder={
                    providerLifecycleAction === 'deactivate'
                      ? 'Ejemplo: dejó de operar o se reemplazó por otro proveedor'
                      : 'Ejemplo: retomó la relación comercial'
                  }
                  className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
                <p className="mt-1 text-right text-xs font-bold text-slate-400">{providerLifecycleReason.length}/500</p>
              </label>

              <div className="mt-5 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isChangingProviderStatus) return;
                    setIsProviderLifecycleModalOpen(false);
                    setSelectedProviderForLifecycle(null);
                    setProviderLifecycleError('');
                    setProviderLifecycleReason('');
                  }}
                  disabled={isChangingProviderStatus}
                  className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isChangingProviderStatus || providerLifecycleReason.trim().length < 3}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                    providerLifecycleAction === 'deactivate'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isChangingProviderStatus ? <Loader2 size={18} className="animate-spin" /> : providerLifecycleAction === 'deactivate' ? <Ban size={18} /> : <RefreshCw size={18} />}
                  {isChangingProviderStatus
                    ? 'Guardando…'
                    : providerLifecycleAction === 'deactivate'
                      ? 'Confirmar baja'
                      : 'Confirmar reactivación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isProviderModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/65 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="provider-form-title">
          <div className="max-h-[100dvh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-xl sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><Building2 size={20} /></div>
                <div>
                  <h2 id="provider-form-title" className="text-lg font-black text-slate-950">Crear proveedor</h2>
                  <p className="text-xs text-slate-500">Datos básicos para compras y pagos.</p>
                </div>
              </div>
              <button type="button" onClick={() => !isCreatingProvider && setIsProviderModalOpen(false)} disabled={isCreatingProvider} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="Cerrar formulario de proveedor">
                <X size={21} />
              </button>
            </div>

            <form onSubmit={handleCreateProvider} className="max-h-[calc(100dvh-76px)] overflow-y-auto p-4 sm:p-6">
              {providerSubmitError && (
                <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" />
                  <p className="text-sm font-bold">{providerSubmitError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Nombre *</span>
                  <input required type="text" value={providerForm.nombre} onChange={(event) => setProviderForm({ ...providerForm, nombre: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
                </label>
                <label>
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">CUIT</span>
                  <input type="text" inputMode="numeric" value={providerForm.cuit} onChange={(event) => setProviderForm({ ...providerForm, cuit: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
                </label>
                <label>
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Teléfono</span>
                  <input type="tel" value={providerForm.telefono} onChange={(event) => setProviderForm({ ...providerForm, telefono: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Email</span>
                  <input type="email" value={providerForm.email} onChange={(event) => setProviderForm({ ...providerForm, email: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Dirección</span>
                  <input type="text" value={providerForm.direccion} onChange={(event) => setProviderForm({ ...providerForm, direccion: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
                </label>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <button type="button" onClick={() => setIsProviderModalOpen(false)} disabled={isCreatingProvider} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isCreatingProvider} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                  {isCreatingProvider ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {isCreatingProvider ? 'Creando…' : 'Crear proveedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isCancellationModalOpen && selectedInvoiceForCancellation && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-invoice-cancellation-title"
        >
          <div className="w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-600">Operación irreversible</p>
                <h2 id="purchase-invoice-cancellation-title" className="mt-1 text-lg font-black text-slate-950">
                  Anular factura {selectedInvoiceForCancellation.numero_factura}
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  Se revertirán stock, costo y pagos vinculados cuando la trazabilidad sea válida.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isCancellingInvoice) return;
                  setIsCancellationModalOpen(false);
                  setSelectedInvoiceForCancellation(null);
                  setCancellationSubmitError('');
                }}
                disabled={isCancellingInvoice}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-white disabled:opacity-40"
                aria-label="Cerrar anulación"
              >
                <X size={21} />
              </button>
            </div>

            <form onSubmit={handleCancelInvoice} className="p-4 sm:p-6">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-black">La factura seguirá visible como Anulada.</p>
                    <p className="mt-1 text-sm font-semibold">
                      Si algún lote fue consumido, existe una compra posterior o un cheque procesado, la operación se bloqueará sin aplicar cambios parciales.
                    </p>
                  </div>
                </div>
              </div>

              {cancellationSubmitError && (
                <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <p className="text-sm font-bold">{cancellationSubmitError}</p>
                </div>
              )}

              <label className="mt-4 block">
                <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Motivo obligatorio
                </span>
                <textarea
                  autoFocus
                  required
                  minLength={3}
                  maxLength={500}
                  rows={4}
                  value={cancellationReason}
                  onChange={(event) => setCancellationReason(event.target.value)}
                  placeholder="Ejemplo: factura cargada por duplicado o mercadería devuelta al proveedor."
                  className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100"
                />
                <div className="mt-1 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                  <span>Mínimo 3 caracteres.</span>
                  <span>{cancellationReason.length}/500</span>
                </div>
              </label>

              <div className="mt-6 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCancellationModalOpen(false);
                    setSelectedInvoiceForCancellation(null);
                    setCancellationSubmitError('');
                  }}
                  disabled={isCancellingInvoice}
                  className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Volver
                </button>
                <button
                  type="submit"
                  disabled={isCancellingInvoice || cancellationReason.trim().length < 3}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCancellingInvoice ? <Loader2 size={18} className="animate-spin" /> : <Ban size={18} />}
                  {isCancellingInvoice ? 'Anulando…' : 'Confirmar anulación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isPaymentModalOpen && selectedInvoiceForPayment && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/65 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="provider-payment-title">
          <div className="w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 id="provider-payment-title" className="text-lg font-black text-slate-950">Registrar pago</h2>
                <p className="truncate text-xs text-slate-500">Factura {selectedInvoiceForPayment.numero_factura} · {(selectedInvoiceForPayment as any).proveedor}</p>
              </div>
              <button type="button" onClick={() => !isPayingInvoice && setIsPaymentModalOpen(false)} disabled={isPayingInvoice} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="Cerrar registro de pago"><X size={21} /></button>
            </div>

            <form onSubmit={handlePayInvoice} className="p-4 sm:p-6">
              {paymentSubmitError && (
                <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" />
                  <p className="text-sm font-bold">{paymentSubmitError}</p>
                </div>
              )}

              <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Saldo pendiente</p>
                <p className="mt-1 break-words text-2xl font-black text-slate-950">{formatCurrency(getInvoiceBalance(selectedInvoiceForPayment))}</p>
              </div>

              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Método de pago</span>
                  <select required value={paymentForm.metodo_pago_real} onChange={(event) => setPaymentForm({ ...paymentForm, metodo_pago_real: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100">
                    {paymentMethods.filter((method) => !isCurrentAccountMethod(method.name)).length === 0 && (
                      <option value="">No hay formas de pago activas</option>
                    )}
                    {paymentMethods
                      .filter((method) => !isCurrentAccountMethod(method.name))
                      .map((method) => (
                        <option key={method.id} value={toPurchasePaymentValue(method.name)}>
                          {getPaymentMethodLabel(toPurchasePaymentValue(method.name))}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Fecha de pago</span>
                  <input required type="date" value={paymentForm.fecha_pago} onChange={(event) => setPaymentForm({ ...paymentForm, fecha_pago: event.target.value })} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
                </label>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <button type="button" onClick={() => setIsPaymentModalOpen(false)} disabled={isPayingInvoice} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPayingInvoice} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60">
                  {isPayingInvoice ? <Loader2 size={18} className="animate-spin" /> : <WalletCards size={18} />}
                  {isPayingInvoice ? 'Registrando…' : 'Registrar pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isViewModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/65 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 id="invoice-detail-title" className="text-lg font-black text-slate-950">Detalle de factura</h2>
                <p className="truncate text-xs text-slate-500">{selectedInvoice ? `Factura ${selectedInvoice.numero_factura}` : 'Cargando información…'}</p>
              </div>
              <button type="button" onClick={() => setIsViewModalOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Cerrar detalle"><X size={21} /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {detailLoading ? (
                <div className="flex min-h-64 flex-col items-center justify-center text-center">
                  <Loader2 size={30} className="animate-spin text-indigo-600" />
                  <p className="mt-4 font-black text-slate-800">Cargando detalle de factura…</p>
                </div>
              ) : detailError ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
                  <AlertCircle size={34} className="text-red-500" />
                  <p className="mt-4 font-black text-red-900">No se pudo cargar el detalle</p>
                  <p className="mt-1 text-sm text-red-700">{detailError}</p>
                </div>
              ) : selectedInvoice ? (
                <>
                  <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Proveedor</p>
                      <p className="mt-1 break-words font-black text-slate-900">{(selectedInvoice as any).proveedor}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fecha</p>
                      <p className="mt-1 font-black text-slate-900">{formatDate((selectedInvoice as any).fecha_compra)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Medio de pago</p>
                      <p className="mt-1 font-black text-slate-900">{getPaymentMethodLabel((selectedInvoice as any).metodo_pago)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total factura</p>
                      <p className="mt-1 break-words text-xl font-black text-slate-950">{formatCurrency(selectedInvoice.total)}</p>
                    </div>
                  </div>

                  {isInvoiceCancelled(selectedInvoice) && (
                    <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
                      <div className="flex items-start gap-3">
                        <Ban size={21} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="font-black">Factura anulada</p>
                          <p className="mt-1 break-words text-sm font-bold">
                            Motivo: {(selectedInvoice as any).anulacion_motivo || 'Sin motivo informado'}
                          </p>
                          <p className="mt-2 text-xs font-semibold text-red-700">
                            Por {(selectedInvoice as any).anulada_por || 'Sistema'}
                            {(selectedInvoice as any).anulada_at
                              ? ` · ${formatDate((selectedInvoice as any).anulada_at)}`
                              : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-5">
                    <h3 className="text-sm font-black text-slate-900">Productos de la factura</h3>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {((selectedInvoice as any).items || []).map((item: any) => (
                        <article key={item.id} className="min-w-0 rounded-2xl border border-slate-200 p-4">
                          <p className="break-words font-black text-slate-900">{item.product_name}</p>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl bg-slate-50 p-2">
                              <p className="text-[9px] font-black uppercase text-slate-400">Cantidad</p>
                              <p className="mt-1 text-sm font-black text-slate-900">{item.cantidad}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-2">
                              <p className="text-[9px] font-black uppercase text-slate-400">Costo</p>
                              <p className="mt-1 break-words text-xs font-black text-slate-900">{formatCurrency(item.costo_unitario)}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-2">
                              <p className="text-[9px] font-black uppercase text-slate-400">Restante</p>
                              <p className={`mt-1 text-sm font-black ${Number(item.cantidad_restante) > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{item.cantidad_restante}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="border-t border-slate-200 bg-white p-4 sm:px-6">
              <button type="button" onClick={() => setIsViewModalOpen(false)} className="min-h-11 w-full rounded-xl bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800 sm:ml-auto sm:block sm:w-auto">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
