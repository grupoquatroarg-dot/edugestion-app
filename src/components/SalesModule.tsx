import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, 
  ShoppingCart, 
  Package, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle,
  Download, 
  X, 
  History, 
  Eye, 
  FileDown,
  Calendar,
  Users,
  DollarSign,
  TrendingDown,
  ArrowRight,
  CreditCard,
  XCircle,
  MessageCircle,
  Loader2,
  Printer,
  BarChart3,
  RefreshCw
} from 'lucide-react';
import { Product } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getSocket } from '../utils/socket';
import { generateSaleReceipt, printSaleReceipt, printSaleReceipts } from '../utils/pdfGenerator';
import CustomerDetail from './CustomerDetail';
import CustomerOrdersAdmin from './CustomerOrdersAdmin';
import { openPrintWindowPlaceholder, outputPdfDocument, type PdfOutputMode } from '../utils/pdfOutput';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';
import {
  formatBusinessDate,
  formatBusinessDateTime,
  formatBusinessTime,
  getBusinessDateInputValue,
  getBusinessDateKey,
} from '../utils/businessDate';
import {
  formatMeasurementQuantity,
  formatProductQuantity,
  getProductMeasurementUnit,
  getProductPresentationLabel,
  getProductPriceReferenceQuantity,
  getProductSaleUnitPrice,
  isMeasuredProduct,
  normalizeProductQuantity,
  parseLocalizedDecimal,
  roundMeasurementQuantity,
} from '../../shared/productMeasurement';

const socket = getSocket();

const getDefaultSalePaymentMethod = (methods: any[]) => {
  const cashMethod = methods.find(
    method => String(method?.name || '').trim().toLowerCase() === 'efectivo'
  );

  return cashMethod?.name || methods[0]?.name || '';
};

const normalizeSearchValue = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const getClienteDisplayName = (cliente: any) =>
  String(cliente?.nombre_apellido || cliente?.razon_social || 'Cliente').trim();

const getClienteSearchValue = (cliente: any) =>
  normalizeSearchValue([
    cliente?.nombre_apellido,
    cliente?.razon_social,
    cliente?.cuit,
    cliente?.telefono,
    cliente?.localidad,
  ].filter(Boolean).join(' '));

const openWhatsAppPlaceholder = () => {
  const popup = window.open('', '_blank');

  if (!popup) return null;

  try {
    popup.opener = null;
    popup.document.title = 'Abriendo WhatsApp...';
    popup.document.body.innerHTML = `
      <main style="font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;margin:0;padding:24px;text-align:center">
        <div>
          <div style="width:44px;height:44px;border:4px solid #dcfce7;border-top-color:#16a34a;border-radius:9999px;margin:0 auto 16px;animation:spin 0.8s linear infinite"></div>
          <strong>Abriendo WhatsApp...</strong>
          <p style="color:#64748b;margin:8px 0 0">Estamos preparando el chat del cliente.</p>
        </div>
      </main>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
  } catch {}

  return popup;
};

interface PetiSalesReportRow {
  cliente: string;
  pedidos: number;
  unidades: number;
  total: number;
  efectivo: number;
  cobrado: number;
  cuenta_corriente: number;
}

interface PetiSalesReport {
  empresa: 'Peti';
  desde: string | null;
  hasta: string | null;
  ventas_incluidas: number;
  clientes: PetiSalesReportRow[];
  totales: {
    pedidos: number;
    unidades: number;
    total: number;
    efectivo: number;
    cobrado: number;
    cuenta_corriente: number;
  };
}

export default function SalesModule() {
  const { user, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'nueva' | 'historial' | 'saldos' | 'pedidos-clientes' | 'reporte-peti'>('nueva');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClienteId, setSelectedClienteId] = useState<number>(1);
  const [metodoPago, setMetodoPago] = useState<string>('');
  const [metodoPagoParcial, setMetodoPagoParcial] = useState<string>('');
  const [montoPagado, setMontoPagado] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [freightEnabled, setFreightEnabled] = useState(false);
  const [freightPercentage, setFreightPercentage] = useState<string>('');
  const [chequeData, setChequeData] = useState({
    banco: '',
    numero_cheque: '',
    fecha_vencimiento: getBusinessDateInputValue(),
    importe: ''
  });
  const [clientes, setClientes] = useState<any[]>([]);
  const [clienteSearchTerm, setClienteSearchTerm] = useState('');
  const [showClienteSuggestions, setShowClienteSuggestions] = useState(false);
  const [highlightedClienteIndex, setHighlightedClienteIndex] = useState(0);
  const [clienteSelectionDirty, setClienteSelectionDirty] = useState(false);
  const clienteSearchContainerRef = useRef<HTMLDivElement | null>(null);
  const [cart, setCart] = useState<{
    product: Product;
    quantity: number;
    quantityInput: string;
    discountType: 'none' | 'percentage' | 'fixed';
    discountValue: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastSaleData, setLastSaleData] = useState<any>(null);
  
  // History state
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [downloadingSaleId, setDownloadingSaleId] = useState<number | null>(null);
  const [printingSaleId, setPrintingSaleId] = useState<number | null>(null);
  const [selectedPrintSaleIds, setSelectedPrintSaleIds] = useState<number[]>([]);
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const [whatsAppSendingSaleId, setWhatsAppSendingSaleId] = useState<number | null>(null);
  const [saleToCancel, setSaleToCancel] = useState<any>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationError, setCancellationError] = useState('');
  const [isCancellingSale, setIsCancellingSale] = useState(false);
  const [businessSettings, setBusinessSettings] = useState<Record<string, string>>({});
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);

  // Saldos Pendientes state
  const [selectedCustomerForSaldos, setSelectedCustomerForSaldos] = useState<any>(null);
  const [showCustomerFichaId, setShowCustomerFichaId] = useState<number | null>(null);
  const [showQuickPaymentModal, setShowQuickPaymentModal] = useState(false);
  const [quickPaymentForm, setQuickPaymentForm] = useState({
    monto: '',
    metodo_pago: 'efectivo' as 'efectivo' | 'transferencia' | 'mercado_pago',
    observaciones: ''
  });

  // History filters state
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');

  // Reporte de ventas Peti por cliente
  const [petiReportDateFrom, setPetiReportDateFrom] = useState('');
  const [petiReportDateTo, setPetiReportDateTo] = useState('');
  const [petiReport, setPetiReport] = useState<PetiSalesReport | null>(null);
  const [petiReportLoading, setPetiReportLoading] = useState(false);
  const [petiReportError, setPetiReportError] = useState('');

  const filteredSalesHistory = useMemo(() => {
    return salesHistory.filter(sale => {
      const matchesSearch = (sale.nombre_cliente || '').toLowerCase().includes(historySearchTerm.toLowerCase());
      const saleDate = getBusinessDateKey(sale.fecha);
      const matchesDateFrom = !historyDateFrom || saleDate >= historyDateFrom;
      const matchesDateTo = !historyDateTo || saleDate <= historyDateTo;
      return matchesSearch && matchesDateFrom && matchesDateTo;
    });
  }, [salesHistory, historySearchTerm, historyDateFrom, historyDateTo]);


  const filteredClientes = useMemo(() => {
    const query = normalizeSearchValue(clienteSearchTerm);
    const matches = query
      ? clientes.filter(cliente => getClienteSearchValue(cliente).includes(query))
      : clientes;

    return matches.slice(0, 10);
  }, [clientes, clienteSearchTerm]);

  const activeFilteredSalesHistory = useMemo(
    () => filteredSalesHistory.filter(sale => String(sale.estado || '').toLowerCase() !== 'anulada'),
    [filteredSalesHistory]
  );

  const allFilteredSalesSelected = useMemo(() => {
    return filteredSalesHistory.length > 0
      && filteredSalesHistory.every(sale => selectedPrintSaleIds.includes(Number(sale.id)));
  }, [filteredSalesHistory, selectedPrintSaleIds]);

  const saldosSummary = useMemo(() => {
    const pendingSales = salesHistory.filter(
      s => s.monto_pendiente > 0 && String(s.estado || '').toLowerCase() !== 'anulada'
    );
    const totalDebt = pendingSales.reduce((acc, s) => acc + s.monto_pendiente, 0);
    const uniqueCustomersWithDebt = new Set(pendingSales.map(s => s.cliente_id)).size;
    
    return {
      totalDebt,
      customersWithDebt: uniqueCustomersWithDebt,
      pendingSalesCount: pendingSales.length
    };
  }, [salesHistory]);

  const saldosList = useMemo(() => {
    const customerMap = new Map<number, any>();
    
    salesHistory.forEach(sale => {
      if (sale.monto_pendiente > 0 && String(sale.estado || '').toLowerCase() !== 'anulada') {
        if (!customerMap.has(sale.cliente_id)) {
          customerMap.set(sale.cliente_id, {
            id: sale.cliente_id,
            nombre: sale.nombre_cliente,
            totalAdeudado: 0,
            ultimaCompra: sale.fecha,
            ventas: []
          });
        }
        const entry = customerMap.get(sale.cliente_id);
        entry.totalAdeudado += sale.monto_pendiente;
        entry.ventas.push(sale);
        if (new Date(sale.fecha) > new Date(entry.ultimaCompra)) {
          entry.ultimaCompra = sale.fecha;
        }
      }
    });

    return Array.from(customerMap.values()).sort((a, b) => b.totalAdeudado - a.totalAdeudado);
  }, [salesHistory]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        clienteSearchContainerRef.current &&
        !clienteSearchContainerRef.current.contains(event.target as Node)
      ) {
        setShowClienteSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    void loadInitialData();

    socket.on('product_updated', (updatedProduct: Product) => {
      setProducts(prev => {
        if (updatedProduct.estado === 'inactivo') {
          return prev.filter(p => p.id !== updatedProduct.id);
        }
        const exists = prev.find(p => p.id === updatedProduct.id);
        if (exists) {
          return prev.map(p => p.id === updatedProduct.id ? updatedProduct : p);
        } else {
          return [...prev, updatedProduct].sort((a, b) => a.name.localeCompare(b.name));
        }
      });

      if (updatedProduct.estado === 'inactivo') {
        setCart(prev => prev.filter(item => item.product.id !== updatedProduct.id));
      } else {
        setCart(prev => prev.map(item => 
          item.product.id === updatedProduct.id 
            ? { ...item, product: updatedProduct } 
            : item
        ));
      }
    });

    socket.on('product_deleted', ({ id }) => {
      setProducts(prev => prev.filter(p => p.id !== id));
      setCart(prev => prev.filter(item => item.product.id !== id));
    });

    socket.on('sale_confirmed', () => {
      fetchSalesHistory();
    });

    return () => {
      socket.off('product_updated');
      socket.off('product_deleted');
      socket.off('sale_confirmed');
    };
  }, []);

  useEffect(() => {
    const availableSaleIds = new Set(salesHistory.map(sale => Number(sale.id)));
    setSelectedPrintSaleIds(currentIds => currentIds.filter(id => availableSaleIds.has(id)));
  }, [salesHistory]);

  const fetchActiveProducts = async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/products?active_only=true');
      const body = await res.json();
      const data = unwrapResponse(body);
      setProducts(Array.isArray(data) ? data : []);
      return true;
    } catch (error) {
      console.error("Error fetching products:", error);
      return false;
    }
  };

  const fetchClientes = async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/clientes?active_only=true');
      const body = await res.json();
      const data = unwrapResponse(body);
      setClientes(Array.isArray(data) ? data : []);
      return true;
    } catch (error) {
      console.error("Error fetching customers:", error);
      return false;
    }
  };

  const fetchSalesHistory = async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/sales');
      const body = await res.json();
      const data = unwrapResponse(body);
      setSalesHistory(Array.isArray(data) ? data : []);
      return true;
    } catch (error) {
      console.error("Error fetching sales history:", error);
      return false;
    }
  };

  const fetchBusinessSettings = async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/config/settings');
      const body = await res.json();
      const data = unwrapResponse(body);
      setBusinessSettings(data || {});
      return true;
    } catch (error) {
      console.error("Error fetching business settings:", error);
      return false;
    }
  };

  const fetchPaymentMethods = async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/config/payment-methods?active=true');
      const body = await res.json();
      const data = unwrapResponse(body);
      const safeMethods = Array.isArray(data) ? data : [];
      setPaymentMethods(safeMethods);
      if (safeMethods.length > 0) {
        const defaultPaymentMethod = getDefaultSalePaymentMethod(safeMethods);
        setMetodoPago(defaultPaymentMethod);
        setMetodoPagoParcial(defaultPaymentMethod);
        setQuickPaymentForm(prev => ({ ...prev, metodo_pago: defaultPaymentMethod }));
      }
      return true;
    } catch (error) {
      console.error("Error fetching payment methods:", error);
      return false;
    }
  };

  const formatPetiCurrency = (value: number | string | null | undefined) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(Number(value || 0));

  const formatPetiUnits = (value: number | string | null | undefined) => {
    const numeric = Number(value || 0);
    return Number.isInteger(numeric)
      ? numeric.toString()
      : numeric.toLocaleString('es-AR', { maximumFractionDigits: 3 });
  };

  const fetchPetiSalesReport = async () => {
    setPetiReportLoading(true);
    setPetiReportError('');

    try {
      if (petiReportDateFrom && petiReportDateTo && petiReportDateFrom > petiReportDateTo) {
        throw new Error('La fecha Desde no puede ser posterior a Hasta.');
      }

      const params = new URLSearchParams({ endpoint: 'peti-customer-report' });
      if (petiReportDateFrom) params.set('from', petiReportDateFrom);
      if (petiReportDateTo) params.set('to', petiReportDateTo);

      const response = await apiFetch(`/api/sales?${params.toString()}`);
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.message || 'No se pudo generar el reporte de ventas Peti.');
      }

      const data = unwrapResponse(body);
      setPetiReport(data as PetiSalesReport);
    } catch (error: any) {
      console.error('Error fetching Peti sales report:', error);
      setPetiReport(null);
      setPetiReportError(error?.message || 'No se pudo generar el reporte de ventas Peti.');
    } finally {
      setPetiReportLoading(false);
    }
  };

  const generatePetiSalesReportPDF = (mode: PdfOutputMode = 'download') => {
    if (!petiReport) return;

    const isPrint = mode === 'print';
    const doc = new jsPDF({
      orientation: isPrint ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(isPrint ? 20 : 16);
    doc.setFont('helvetica', 'bold');
    doc.text('REPORTE VENTAS PETI POR CLIENTE', pageWidth / 2, 18, { align: 'center' });

    doc.setFontSize(isPrint ? 11 : 9);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Desde: ${petiReport.desde || 'Inicio'}  Hasta: ${petiReport.hasta || 'Hoy'}`,
      14,
      30,
    );
    doc.text(`Ventas incluidas: ${petiReport.ventas_incluidas}`, 14, 36);

    autoTable(doc, {
      startY: 45,
      head: [[
        'Cliente',
        'Pedidos',
        'Unidades',
        'Total',
        'Efectivo',
        'Cobrado',
        'Cuenta Corriente',
      ]],
      body: petiReport.clientes.map(row => [
        row.cliente,
        row.pedidos.toString(),
        formatPetiUnits(row.unidades),
        `$${row.total.toFixed(2)}`,
        `$${row.efectivo.toFixed(2)}`,
        `$${row.cobrado.toFixed(2)}`,
        `$${row.cuenta_corriente.toFixed(2)}`,
      ]),
      theme: 'grid',
      headStyles: isPrint
        ? {
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            lineColor: [70, 70, 70],
            lineWidth: 0.35,
          }
        : {
            fillColor: [20, 20, 20],
            textColor: [255, 255, 255],
          },
      styles: {
        fontSize: isPrint ? 9 : 7,
        cellPadding: isPrint ? 3 : 2,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineColor: isPrint ? [110, 110, 110] : [200, 200, 200],
        lineWidth: isPrint ? 0.25 : 0.1,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
      },
    });

    const finalY = (doc as any).lastAutoTable?.finalY || 80;
    doc.setFontSize(isPrint ? 13 : 11);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL GENERAL: $${petiReport.totales.total.toFixed(2)}`, 14, finalY + 12);
    doc.text(`EFECTIVO: $${petiReport.totales.efectivo.toFixed(2)}`, 14, finalY + 19);
    doc.text(`COBRADO: $${petiReport.totales.cobrado.toFixed(2)}`, 14, finalY + 26);
    doc.text(`CTA CTE: $${petiReport.totales.cuenta_corriente.toFixed(2)}`, 14, finalY + 33);

    outputPdfDocument(doc, 'Reporte_Ventas_Peti_Por_Cliente.pdf', mode);
  };

  const loadInitialData = async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [
        productsLoaded,
        clientesLoaded,
        historyLoaded,
      ] = await Promise.all([
        fetchActiveProducts(),
        fetchClientes(),
        fetchSalesHistory(),
        fetchBusinessSettings(),
        fetchPaymentMethods(),
      ]);

      if (!productsLoaded || !clientesLoaded || !historyLoaded) {
        setLoadError('No se pudieron cargar todos los datos necesarios de Ventas.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchSaleDetails = async (saleId: number) => {
    try {
      const res = await apiFetch(`/api/sales?id=${saleId}`);
      const body = await res.json();
      const sale = unwrapResponse(body);
      setSelectedSale(sale);
    } catch (error) {
      console.error("Error fetching sale details:", error);
    }
  };

  const openCancellationModal = (sale: any) => {
    setSaleToCancel(sale);
    setCancellationReason('');
    setCancellationError('');
  };

  const closeCancellationModal = () => {
    if (isCancellingSale) return;
    setSaleToCancel(null);
    setCancellationReason('');
    setCancellationError('');
  };

  const handleCancelSale = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!saleToCancel) return;

    const motivo = cancellationReason.trim();
    if (motivo.length < 3) {
      setCancellationError('Ingresá un motivo de al menos 3 caracteres.');
      return;
    }

    try {
      setIsCancellingSale(true);
      setCancellationError('');

      const response = await apiFetch(`/api/sales?endpoint=sale-cancel&id=${saleToCancel.id}`, {
        method: 'POST',
        body: JSON.stringify({ motivo }),
      });
      const body = await response.json();
      const cancellationResult = unwrapResponse(body);

      await Promise.all([fetchSalesHistory(), fetchActiveProducts(), fetchClientes()]);
      if (selectedSale?.id === saleToCancel.id) {
        await fetchSaleDetails(saleToCancel.id);
      }

      setSaleToCancel(null);
      setCancellationReason('');
      const pendingDeliveries = Number(cancellationResult?.pendingCustomerOrderDeliveryReversalIds?.length || 0);
      alert(
        pendingDeliveries > 0
          ? `La venta N° ${saleToCancel.numero_venta || saleToCancel.id} fue anulada correctamente. Ahora revertí la entrega desde Pedidos de Clientes.`
          : `La venta N° ${saleToCancel.numero_venta || saleToCancel.id} fue anulada correctamente.`
      );
    } catch (error: any) {
      console.error('Error cancelling sale:', error);
      setCancellationError(error?.message || 'No se pudo anular la venta.');
    } finally {
      setIsCancellingSale(false);
    }
  };

  const handleDownloadReceipt = async (saleId: number) => {
    try {
      setDownloadingSaleId(saleId);
      const res = await apiFetch(`/api/sales?id=${saleId}`);
      const body = await res.json();
      const sale = unwrapResponse(body);
      generateSaleReceipt(sale, businessSettings);
    } catch (error) {
      console.error("Error generating receipt:", error);
      alert("No se pudo generar el PDF de la venta");
    } finally {
      setDownloadingSaleId(null);
    }
  };

  const handlePrintReceipt = async (saleId: number) => {
    const printWindow = openPrintWindowPlaceholder();

    try {
      setPrintingSaleId(saleId);
      const res = await apiFetch(`/api/sales?id=${saleId}`);
      const body = await res.json();
      const sale = unwrapResponse(body);
      printSaleReceipt(sale, businessSettings, printWindow);
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      console.error("Error printing receipt:", error);
      alert("No se pudo preparar la impresión económica de la venta");
    } finally {
      setPrintingSaleId(null);
    }
  };

  const toggleSaleForPrint = (saleId: number) => {
    setSelectedPrintSaleIds(currentIds => currentIds.includes(saleId)
      ? currentIds.filter(id => id !== saleId)
      : [...currentIds, saleId]);
  };

  const toggleAllFilteredSalesForPrint = () => {
    const filteredIds = filteredSalesHistory.map(sale => Number(sale.id));

    if (allFilteredSalesSelected) {
      const filteredIdSet = new Set(filteredIds);
      setSelectedPrintSaleIds(currentIds => currentIds.filter(id => !filteredIdSet.has(id)));
      return;
    }

    setSelectedPrintSaleIds(currentIds => Array.from(new Set([...currentIds, ...filteredIds])));
  };

  const handlePrintSelectedSales = async () => {
    const selectedSales = salesHistory.filter(sale => selectedPrintSaleIds.includes(Number(sale.id)));
    if (selectedSales.length === 0 || isBatchPrinting) return;

    const printWindow = openPrintWindowPlaceholder();

    try {
      setIsBatchPrinting(true);
      const detailedSales = await Promise.all(selectedSales.map(async sale => {
        const response = await apiFetch(`/api/sales?id=${sale.id}`);
        const body = await response.json();
        return unwrapResponse(body);
      }));

      printSaleReceipts(detailedSales, businessSettings, printWindow);
      setSelectedPrintSaleIds([]);
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      console.error('Error printing selected receipts:', error);
      alert('No se pudo preparar la impresión de las ventas seleccionadas.');
    } finally {
      setIsBatchPrinting(false);
    }
  };

  const normalizeWhatsAppPhone = (rawPhone: any) => {
    let digits = String(rawPhone || '').replace(/\D/g, '');

    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);

    if (digits.startsWith('549')) return digits;

    if (digits.startsWith('54')) {
      let localNumber = digits.slice(2);
      while (localNumber.startsWith('0')) localNumber = localNumber.slice(1);
      if (localNumber.startsWith('9')) return `54${localNumber}`;
      return localNumber ? `549${localNumber}` : '';
    }

    while (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.startsWith('9') && digits.length === 11) return `54${digits}`;

    return digits.length >= 10 ? `549${digits}` : '';
  };

  const enrichSaleWithClientData = async (sale: any) => {
    const existingPhone = sale.cliente_telefono || sale.telefono || sale.customer_phone || sale.phone;

    if (existingPhone || !sale.cliente_id) {
      return sale;
    }

    try {
      const res = await apiFetch(`/api/clientes?id=${sale.cliente_id}`);
      const body = await res.json();
      const cliente = unwrapResponse(body);

      return {
        ...sale,
        cliente_telefono: cliente?.telefono || cliente?.phone || '',
        cliente_localidad: cliente?.localidad || sale.cliente_localidad,
        cliente_direccion: cliente?.direccion || sale.cliente_direccion,
      };
    } catch (error) {
      console.error('Error fetching client data for WhatsApp:', error);
      return sale;
    }
  };

  const copyTextToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch (error) {
      console.warn('No se pudo copiar el texto al portapapeles:', error);
    }
  };

  const handleSendReceiptWhatsApp = async (saleId: number) => {
    const whatsappWindow = openWhatsAppPlaceholder();

    if (!whatsappWindow) {
      alert('El navegador bloqueó la nueva pestaña. Habilitá las ventanas emergentes para abrir WhatsApp.');
      return;
    }

    try {
      setWhatsAppSendingSaleId(saleId);

      const res = await apiFetch(`/api/sales?id=${saleId}`);
      const body = await res.json();
      const rawSale = unwrapResponse(body);
      const sale = await enrichSaleWithClientData(rawSale);

      const phone = normalizeWhatsAppPhone(
        sale.cliente_telefono || sale.telefono || sale.customer_phone || sale.phone
      );

      if (!phone) {
        whatsappWindow.close();
        alert('El cliente no tiene un teléfono válido cargado para WhatsApp.');
        return;
      }

      const saleNumber = sale.numero_venta || sale.id;
      const message = `Hola ${sale.nombre_cliente || ''}, te enviamos el remito/comprobante de tu venta N° ${saleNumber}. Total: $${Number(sale.total || 0).toFixed(2)}.`;

      await copyTextToClipboard(message);

      // Se descarga el PDF y se abre el chat directo. El archivo se adjunta manualmente.
      generateSaleReceipt(sale, businessSettings);

      const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      whatsappWindow.location.replace(whatsappUrl);
    } catch (error) {
      whatsappWindow.close();
      console.error('Error sending receipt via WhatsApp:', error);
      alert('No se pudo preparar el envío por WhatsApp.');
    } finally {
      setWhatsAppSendingSaleId(null);
    }
  };

  const handleQuickPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerForSaldos || !quickPaymentForm.monto) return;

    try {
      const res = await apiFetch(`/api/sales?endpoint=client-payment&id=${selectedCustomerForSaldos.id}`, {
        method: 'POST',
        body: JSON.stringify({
          monto: parseFloat(quickPaymentForm.monto),
          metodo_pago: quickPaymentForm.metodo_pago,
          observaciones: quickPaymentForm.observaciones,
          fecha: new Date().toISOString()
        })
      });

      const body = await res.json();
      const data = unwrapResponse(body);

      setShowQuickPaymentModal(false);
      setQuickPaymentForm({ monto: '', metodo_pago: 'efectivo', observaciones: '' });
      setSelectedCustomerForSaldos(null);
      // fetchSalesHistory is already triggered by socket 'sale_confirmed' or manual refresh
      fetchSalesHistory();
      fetchClientes();
    } catch (error) {
      console.error("Error in quick payment:", error);
      alert("No se pudo registrar el pago");
    }
  };

  const calculateDiscountedUnitPrice = (item: { product: Product; discountType: 'none' | 'percentage' | 'fixed'; discountValue: number }) => {
    const originalPrice = getProductSaleUnitPrice(item.product);
    const discountValue = Number(item.discountValue || 0);

    if (item.discountType === 'percentage') {
      return Math.max(0, originalPrice * (1 - Math.min(Math.max(discountValue, 0), 100) / 100));
    }

    if (item.discountType === 'fixed') {
      return Math.max(0, originalPrice - Math.max(discountValue, 0));
    }

    return originalPrice;
  };

  const isAdmin = user?.role === 'administrador';
  const activeFreightPercentage = isAdmin && freightEnabled
    ? Math.min(Math.max(Number(freightPercentage) || 0, 0), 100)
    : 0;
  const applyFreightToUnitPrice = (price: number, product: Product) => {
    const precision = isMeasuredProduct(product) ? 6 : 2;
    const factor = 10 ** precision;
    return Math.round((price * (1 + activeFreightPercentage / 100) + Number.EPSILON) * factor) / factor;
  };
  const calculateClientUnitPrice = (item: { product: Product; discountType: 'none' | 'percentage' | 'fixed'; discountValue: number }) =>
    applyFreightToUnitPrice(calculateDiscountedUnitPrice(item), item.product);

  const updateCartDiscount = (
    productId: number,
    field: 'discountType' | 'discountValue',
    value: 'none' | 'percentage' | 'fixed' | number
  ) => {
    setCart(prev => prev.map(item => {
      if (item.product.id !== productId) return item;

      if (field === 'discountType') {
        return {
          ...item,
          discountType: value as 'none' | 'percentage' | 'fixed',
          discountValue: value === 'none' ? 0 : item.discountValue,
        };
      }

      return {
        ...item,
        discountValue: Number(value || 0),
      };
    }));
  };

  const filteredProducts = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    if (!query) return products;

    return products.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(query);
      const codeMatch = p.code?.toLowerCase().includes(query);
      const familyMatch = p.family_name?.toLowerCase().includes(query);
      const descMatch = p.description?.toLowerCase().includes(query);
      return nameMatch || codeMatch || familyMatch || descMatch;
    });
  }, [products, searchTerm]);

  const addToCart = (product: Product) => {
    if (product.estado !== 'activo') {
      alert('El producto está inactivo y no puede agregarse a una venta.');
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        const increment = isMeasuredProduct(product) ? 0.1 : 1;
        const quantity = roundMeasurementQuantity(existing.quantity + increment);
        return prev.map(item => 
          item.product.id === product.id 
            ? { ...item, quantity, quantityInput: String(quantity).replace('.', ',') }
            : item
        );
      }
      const initialQuantity = isMeasuredProduct(product) ? getProductPriceReferenceQuantity(product) : 1;
      return [...prev, {
        product,
        quantity: initialQuantity,
        quantityInput: String(initialQuantity).replace('.', ','),
        discountType: 'none',
        discountValue: 0,
      }];
    });
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === productId) {
        const minimum = isMeasuredProduct(item.product) ? 0.001 : 1;
        const newQty = roundMeasurementQuantity(Math.max(minimum, item.quantity + delta));
        return { ...item, quantity: newQty, quantityInput: String(newQty).replace('.', ',') };
      }
      return item;
    }));
  };

  const setQuantity = (productId: number, rawValue: string) => {
    setCart(prev => prev.map(item => (
      item.product.id === productId
        ? {
            ...item,
            quantityInput: rawValue,
            quantity: normalizeProductQuantity(item.product, parseLocalizedDecimal(rawValue)),
          }
        : item
    )));
  };

  const normalizeQuantityInput = (productId: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id !== productId) return item;
      const fallback = isMeasuredProduct(item.product) ? getProductPriceReferenceQuantity(item.product) : 1;
      const quantity = item.quantity > 0 ? item.quantity : fallback;
      return { ...item, quantity, quantityInput: String(quantity).replace('.', ',') };
    }));
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const total = cart.reduce((sum, item) => sum + (calculateClientUnitPrice(item) * item.quantity), 0);

  const selectedCliente = useMemo(() => 
    clientes.find(c => c.id === selectedClienteId) || { id: 1, nombre_apellido: 'Consumidor Final', saldo_cta_cte: 0, limite_credito: 0, tiene_deuda_vencida: 0 }
  , [clientes, selectedClienteId]);


  useEffect(() => {
    if (!clienteSelectionDirty) {
      setClienteSearchTerm(getClienteDisplayName(selectedCliente));
    }
  }, [selectedCliente, clienteSelectionDirty]);

  const selectCliente = (cliente: any) => {
    setSelectedClienteId(Number(cliente.id));
    setClienteSearchTerm(getClienteDisplayName(cliente));
    setClienteSelectionDirty(false);
    setShowClienteSuggestions(false);
    setHighlightedClienteIndex(0);
  };

  const handleClienteSearchChange = (value: string) => {
    setClienteSearchTerm(value);
    setClienteSelectionDirty(
      normalizeSearchValue(value) !== normalizeSearchValue(getClienteDisplayName(selectedCliente))
    );
    setHighlightedClienteIndex(0);
    setShowClienteSuggestions(true);
  };

  const handleClienteSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setShowClienteSuggestions(false);
      return;
    }

    if (!showClienteSuggestions && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      setShowClienteSuggestions(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedClienteIndex(current =>
        Math.min(current + 1, Math.max(filteredClientes.length - 1, 0))
      );
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedClienteIndex(current => Math.max(current - 1, 0));
    }

    if (event.key === 'Enter' && filteredClientes.length > 0) {
      event.preventDefault();
      selectCliente(filteredClientes[highlightedClienteIndex] || filteredClientes[0]);
    }
  };

  const newDebt = useMemo(() => {
    if (metodoPago === 'cta_cte') return total;
    if (metodoPago === 'mixto') return Math.max(0, total - (parseFloat(montoPagado) || 0));
    return 0;
  }, [metodoPago, total, montoPagado]);

  const isExceedingLimit = useMemo(() => {
    if (selectedClienteId === 1) return false;
    return (selectedCliente.saldo_cta_cte + newDebt) > selectedCliente.limite_credito;
  }, [selectedCliente, newDebt, selectedClienteId]);

  const handleConfirmOrder = async () => {
    if (cart.length === 0) return;

    if (cart.some(item => item.quantity <= 0)) {
      alert('Revisá las cantidades del carrito antes de confirmar la venta.');
      return;
    }

    if (clienteSelectionDirty) {
      alert('Seleccioná un cliente de la lista de resultados antes de confirmar la venta.');
      return;
    }

    try {
      const saleData = {
        total,
        cliente_id: selectedCliente.id,
        nombre_cliente: selectedCliente.nombre_apellido,
        metodo_pago: metodoPago === 'mixto' ? `mixto (${metodoPagoParcial} + cta_cte)` : metodoPago,
        monto_pagado: (metodoPago === 'cta_cte' || paymentMethods.find(pm => pm.name === metodoPago)?.tipo === 'Crédito') ? 0 : (metodoPago === 'mixto' ? parseFloat(montoPagado) || 0 : total),
        notes,
        flete_porcentaje: activeFreightPercentage,
        cheque_data: metodoPago === 'Cheque' ? {
          ...chequeData,
          importe: parseFloat(chequeData.importe) || total
        } : null,
        items: cart.map(item => {
          const precioBonificado = calculateDiscountedUnitPrice(item);
          const precioFinalCliente = calculateClientUnitPrice(item);

          return {
            product_id: item.product.id,
            cantidad: item.quantity,
            precio_venta: precioFinalCliente,
            precio_unitario_original: getProductSaleUnitPrice(item.product),
            bonificacion_tipo: item.discountType,
            bonificacion_valor: item.discountValue,
            precio_unitario_bonificado: precioBonificado
          };
        })
      };

      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify(saleData)
      });

      const body = await res.json();
      const data = unwrapResponse(body);
      
      if (data.supplierOrderGenerated) {
        alert(`Venta registrada. Se generó el Pedido a Proveedor N° ${data.orderNumber} solo por las unidades faltantes.`);
      }

      const saleRes = await apiFetch(`/api/sales?id=${data.saleId}`);
      const saleBody = await saleRes.json();
      const fullSale = unwrapResponse(saleBody);
      setLastSaleData({ ...fullSale, results: data.results });
      setShowSuccessModal(true);

      setCart([]);
      setSelectedClienteId(1);
      setClienteSelectionDirty(false);
      setShowClienteSuggestions(false);
      const defaultPaymentMethod = getDefaultSalePaymentMethod(paymentMethods);
      setMetodoPago(defaultPaymentMethod);
      setMetodoPagoParcial(defaultPaymentMethod);
      setMontoPagado('');
      setNotes('');
      setFreightEnabled(false);
      setFreightPercentage('');
      setChequeData({
        banco: '',
        numero_cheque: '',
        fecha_vencimiento: getBusinessDateInputValue(),
        importe: ''
      });
      await Promise.all([fetchSalesHistory(), fetchActiveProducts(), fetchClientes()]);
    } catch (error: any) {
      console.error("Error en venta:", error);
      alert(error.message || "Error al procesar la venta");
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-full overflow-y-auto bg-slate-50 px-3 py-4 sm:px-5 sm:py-6 lg:px-6"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="mx-auto w-full max-w-[1600px] animate-pulse space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map(item => (
              <div key={item} className="h-12 rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>

          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="bg-slate-900 p-5 sm:p-7">
              <div className="h-4 w-36 rounded bg-white/15" />
              <div className="mt-4 h-9 w-64 max-w-full rounded bg-white/15" />
              <div className="mt-3 h-4 w-full max-w-xl rounded bg-white/10" />
            </div>
            <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <div className="space-y-4">
                <div className="h-12 rounded-2xl bg-slate-100" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[0, 1, 2, 3, 4, 5].map(item => (
                    <div key={item} className="h-32 rounded-2xl bg-slate-100" />
                  ))}
                </div>
              </div>
              <div className="h-[420px] rounded-3xl bg-slate-100" />
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 py-3 text-sm font-bold text-slate-600">
            <Loader2 size={20} className="animate-spin text-indigo-600" />
            Cargando ventas, productos y clientes...
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50 p-4 sm:p-6">
        <div className="w-full max-w-md rounded-[28px] border border-rose-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertCircle size={30} />
          </div>
          <h2 className="mt-5 text-xl font-black text-slate-950">No se pudo cargar Ventas</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadInitialData()}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800"
          >
            <Loader2 size={18} />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col overflow-x-hidden bg-slate-50">
      {/* Tabs Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 sm:px-5 lg:px-6">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <button 
            onClick={() => setActiveTab('nueva')}
            className={`min-h-11 min-w-0 rounded-xl border px-3 py-2.5 text-xs font-black transition-all flex items-center justify-center gap-2 sm:text-sm ${
              activeTab === 'nueva' ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <ShoppingCart size={18} />
            Nueva Venta
          </button>
          <button 
            onClick={() => setActiveTab('historial')}
            className={`min-h-11 min-w-0 rounded-xl border px-3 py-2.5 text-xs font-black transition-all flex items-center justify-center gap-2 sm:text-sm ${
              activeTab === 'historial' ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <History size={18} />
            Historial de Ventas
          </button>
          <button 
            onClick={() => setActiveTab('saldos')}
            className={`min-h-11 min-w-0 rounded-xl border px-3 py-2.5 text-xs font-black transition-all flex items-center justify-center gap-2 sm:text-sm ${
              activeTab === 'saldos' ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <DollarSign size={18} />
            Saldos Pendientes
          </button>
          <button 
            onClick={() => setActiveTab('pedidos-clientes')}
            className={`min-h-11 min-w-0 rounded-xl border px-3 py-2.5 text-xs font-black transition-all flex items-center justify-center gap-2 sm:text-sm ${
              activeTab === 'pedidos-clientes' ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <ShoppingCart size={18} />
            Pedidos de Clientes
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('reporte-peti');
              if (!petiReport && !petiReportLoading) void fetchPetiSalesReport();
            }}
            className={`min-h-11 min-w-0 rounded-xl border px-3 py-2.5 text-xs font-black transition-all flex items-center justify-center gap-2 sm:text-sm ${
              activeTab === 'reporte-peti' ? 'border-orange-200 bg-orange-50 text-orange-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <BarChart3 size={18} />
            Reporte Peti
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'nueva' ? (
          <div className="flex min-h-full flex-col overflow-y-auto 2xl:h-full 2xl:flex-row 2xl:overflow-hidden">
            {/* Product Selection */}
            <div className="flex min-w-0 flex-col p-3 sm:p-5 lg:p-6 2xl:flex-1 2xl:overflow-hidden 2xl:border-r 2xl:border-slate-200">
              <div className="mb-4 lg:mb-6 flex flex-col sm:flex-row items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl lg:text-3xl font-black text-zinc-900 tracking-tight">Nueva Venta</h1>
                  <p className="text-zinc-500 mt-1 text-sm">Selecciona productos para el pedido</p>
                </div>
                
                <div className="w-full sm:w-80" ref={clienteSearchContainerRef}>
                  <label
                    htmlFor="sale-customer-search"
                    className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400"
                  >
                    Cliente seleccionado
                  </label>

                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"
                      size={17}
                    />
                    <input
                      id="sale-customer-search"
                      type="text"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={showClienteSuggestions}
                      aria-controls="sale-customer-suggestions"
                      autoComplete="off"
                      value={clienteSearchTerm}
                      onFocus={(event) => {
                        event.currentTarget.select();
                        setShowClienteSuggestions(true);
                      }}
                      onChange={(event) => handleClienteSearchChange(event.target.value)}
                      onKeyDown={handleClienteSearchKeyDown}
                      placeholder="Escribí nombre, razón social, CUIT o teléfono"
                      className={`min-h-11 w-full rounded-xl border bg-white py-2.5 pl-10 pr-4 text-sm font-bold shadow-sm outline-none transition focus:ring-2 ${
                        clienteSelectionDirty
                          ? 'border-amber-300 focus:border-amber-400 focus:ring-amber-100'
                          : 'border-zinc-200 focus:border-indigo-400 focus:ring-indigo-100'
                      }`}
                    />

                    {showClienteSuggestions && (
                      <div
                        id="sale-customer-suggestions"
                        role="listbox"
                        className="absolute left-0 right-0 z-50 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"
                      >
                        {filteredClientes.length > 0 ? (
                          filteredClientes.map((cliente, index) => (
                            <button
                              key={cliente.id}
                              type="button"
                              role="option"
                              aria-selected={cliente.id === selectedClienteId}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                selectCliente(cliente);
                              }}
                              onMouseEnter={() => setHighlightedClienteIndex(index)}
                              className={`w-full rounded-xl px-3 py-3 text-left transition ${
                                index === highlightedClienteIndex
                                  ? 'bg-indigo-50 text-indigo-900'
                                  : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="break-words text-sm font-black">{getClienteDisplayName(cliente)}</p>
                                  {cliente.razon_social && cliente.razon_social !== cliente.nombre_apellido && (
                                    <p className="mt-0.5 break-words text-xs font-medium text-slate-500">
                                      {cliente.razon_social}
                                    </p>
                                  )}
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                                    {cliente.cuit && <span>CUIT {cliente.cuit}</span>}
                                    {cliente.telefono && <span>{cliente.telefono}</span>}
                                  </div>
                                </div>
                                {cliente.id === selectedClienteId && !clienteSelectionDirty && (
                                  <CheckCircle2 className="shrink-0 text-emerald-500" size={18} />
                                )}
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-6 text-center">
                            <Users className="mx-auto mb-2 text-slate-300" size={28} />
                            <p className="text-sm font-bold text-slate-600">No encontramos clientes</p>
                            <p className="mt-1 text-xs text-slate-400">Probá con otro nombre, CUIT o teléfono.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {clienteSelectionDirty ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-amber-700">
                      <AlertCircle size={14} />
                      Elegí un cliente de la lista para confirmar la venta.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                        selectedCliente.tipo_cliente === 'mayorista'
                          ? 'bg-indigo-50 text-indigo-600'
                          : 'bg-emerald-50 text-emerald-600'
                      }`}>
                        {selectedCliente.tipo_cliente || 'minorista'}
                      </span>
                      {selectedCliente.tiene_deuda_vencida === 1 && (
                        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-1 text-[9px] font-bold text-red-600 animate-pulse">
                          <AlertCircle size={12} />
                          Deuda vencida
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="relative mb-4 lg:mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                <input
                  type="text"
                  placeholder="Buscar productos por nombre, código o familia..."
                  className="w-full pl-12 pr-4 py-3 lg:py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all shadow-sm text-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="min-h-0 overflow-y-auto pr-1 sm:pr-2 custom-scrollbar max-h-[52dvh] 2xl:max-h-none 2xl:flex-1">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-2">
                  {filteredProducts.map(product => (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="group p-4 lg:p-5 bg-white border border-zinc-200 rounded-2xl text-left hover:border-zinc-900 hover:shadow-xl transition-all relative overflow-hidden flex flex-col h-full"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-10 h-10 lg:w-12 lg:h-12 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-500 group-hover:bg-zinc-900 group-hover:text-white transition-colors">
                          <Package size={20} />
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            product.company === 'Edu' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                          }`}>
                            {product.company}
                          </span>
                          {product.code && <span className="text-[9px] font-mono text-zinc-400 bg-zinc-50 px-1 rounded border border-zinc-100">{product.code}</span>}
                        </div>
                      </div>
                      <h3 className="font-bold text-zinc-900 line-clamp-2 mb-1 flex-1 text-sm lg:text-base">{product.name}</h3>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider bg-zinc-50 px-1.5 py-0.5 rounded border border-zinc-100">
                          {product.family_name || 'Sin familia'}
                        </span>
                      </div>
                      <div className="flex items-end justify-between mt-auto pt-4 border-t border-zinc-50">
                        <div className="text-lg lg:text-xl font-black text-zinc-900 font-mono">
                          ${product.sale_price.toFixed(2)}
                          <span className="mt-0.5 block font-sans text-[9px] font-bold text-zinc-500">{getProductPresentationLabel(product)}</span>
                          {isMeasuredProduct(product) && <span className="block font-sans text-[9px] font-black text-indigo-600">${getProductSaleUnitPrice(product).toFixed(4)} / {getProductMeasurementUnit(product)}</span>}
                        </div>
                        <div className={`text-[10px] font-bold uppercase ${product.stock <= 5 ? 'text-red-600' : 'text-zinc-400'}`}>
                          Stock: {formatProductQuantity(product, product.stock)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {filteredProducts.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
                    <Package size={64} className="mb-4 opacity-10" />
                    <p className="text-lg font-medium">No se encontraron productos activos</p>
                  </div>
                )}
              </div>
            </div>

            {/* Cart / Order Summary */}
            <div className="z-10 flex min-h-0 w-full shrink-0 flex-col border-t border-slate-200 bg-white shadow-xl 2xl:w-[520px] 2xl:border-l 2xl:border-t-0">
              <div className="p-3 lg:p-4 border-b border-zinc-100 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-zinc-900 text-white rounded-xl flex items-center justify-center shrink-0">
                    <ShoppingCart size={20} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base lg:text-lg font-black text-zinc-900 uppercase tracking-tight">Carrito de Venta</h2>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">{cart.length} productos cargados</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest">Total</p>
                  <p className="text-xl lg:text-2xl font-black text-zinc-900 font-mono">${total.toFixed(2)}</p>
                </div>
              </div>

              <div className="shrink-0 space-y-3 overflow-y-auto border-b border-slate-100 p-3 sm:p-4 max-h-[42dvh] 2xl:max-h-[32dvh] custom-scrollbar">
                {cart.map(item => {
                  const discountedUnitPrice = calculateDiscountedUnitPrice(item);
                  const clientUnitPrice = calculateClientUnitPrice(item);
                  const itemSubtotal = clientUnitPrice * item.quantity;
                  const missingUnits = Math.max(0, item.quantity - Number(item.product.stock || 0));

                  return (
                    <div key={item.product.id} className="bg-zinc-50 p-3 lg:p-4 rounded-2xl border border-zinc-100 group space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="font-black text-zinc-900 text-sm lg:text-base leading-tight break-words">{item.product.name}</h4>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {item.product.code && (
                              <span className="text-[9px] font-mono text-zinc-400 bg-white px-2 py-0.5 rounded-lg border border-zinc-100">
                                {item.product.code}
                              </span>
                            )}
                            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border ${
                              missingUnits > 0 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            }`}>
                              Stock: {formatProductQuantity(item.product, item.product.stock)} {missingUnits > 0 ? `| Faltan: ${formatProductQuantity(item.product, missingUnits)}` : ''}
                            </span>
                          </div>
                        </div>

                        <button 
                          onClick={() => removeFromCart(item.product.id)}
                          className="shrink-0 text-zinc-300 hover:text-red-600 hover:bg-red-50 transition-colors p-2 rounded-xl"
                          title="Quitar producto"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[9px] font-black text-zinc-400 uppercase mb-1 tracking-widest">
                            Cantidad{isMeasuredProduct(item.product) ? ` (${getProductMeasurementUnit(item.product)})` : ''}
                          </label>
                          <div className="flex items-center gap-2">
                            <button 
                              type="button"
                              onClick={() => updateQuantity(item.product.id, isMeasuredProduct(item.product) ? -0.1 : -1)}
                              className="h-10 w-10 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-xl transition-colors flex items-center justify-center shrink-0"
                            >
                              <Minus size={15} />
                            </button>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.quantityInput}
                              onChange={(e) => setQuantity(item.product.id, e.target.value)}
                              onBlur={() => normalizeQuantityInput(item.product.id)}
                              className="w-full h-10 text-center bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-base font-black font-mono"
                            />
                            <button 
                              type="button"
                              onClick={() => updateQuantity(item.product.id, isMeasuredProduct(item.product) ? 0.1 : 1)}
                              className="h-10 w-10 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-xl transition-colors flex items-center justify-center shrink-0"
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-zinc-400 uppercase mb-1 tracking-widest">Precio por {isMeasuredProduct(item.product) ? getProductMeasurementUnit(item.product) : 'unidad'}</label>
                          <div className="h-10 px-3 bg-white border border-zinc-200 rounded-xl flex items-center justify-between gap-2">
                            <span className="text-sm font-black text-zinc-900 font-mono">${clientUnitPrice.toFixed(isMeasuredProduct(item.product) ? 4 : 2)}</span>
                            {activeFreightPercentage > 0 ? (
                              <span className="text-[9px] text-indigo-600 font-bold uppercase">Base ${discountedUnitPrice.toFixed(2)}</span>
                            ) : item.discountType !== 'none' && (
                              <span className="text-[9px] text-emerald-600 font-bold uppercase">Lista ${getProductSaleUnitPrice(item.product).toFixed(2)}</span>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-zinc-400 uppercase mb-1 tracking-widest">Bonificación</label>
                          <div className="grid grid-cols-[1fr_1fr] gap-2">
                            <select
                              value={item.discountType}
                              onChange={(e) => updateCartDiscount(item.product.id, 'discountType', e.target.value as any)}
                              className="h-10 px-2 bg-white border border-zinc-200 rounded-xl text-[11px] font-bold outline-none focus:ring-2 focus:ring-zinc-900"
                            >
                              <option value="none">Sin bonif.</option>
                              <option value="percentage">% OFF</option>
                              <option value="fixed">$ OFF</option>
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              disabled={item.discountType === 'none'}
                              value={item.discountValue || ''}
                              onChange={(e) => updateCartDiscount(item.product.id, 'discountValue', Number(e.target.value))}
                              className="h-10 px-2 bg-white border border-zinc-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-zinc-900 disabled:bg-zinc-100"
                              placeholder="Valor"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-zinc-400 uppercase mb-1 tracking-widest">Importe</label>
                          <div className="h-10 px-3 bg-zinc-900 text-white rounded-xl flex items-center justify-between">
                            <span className="text-[9px] font-black uppercase tracking-widest text-white/50">Subtotal</span>
                            <span className="text-base font-black font-mono">${itemSubtotal.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {cart.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-zinc-300 border-2 border-dashed border-zinc-100 rounded-3xl">
                    <ShoppingCart size={48} className="mb-4 opacity-10" />
                    <p className="text-xs font-bold uppercase tracking-widest">Carrito Vacío</p>
                    <p className="text-xs text-zinc-400 mt-2 text-center">Seleccioná productos para armar la venta</p>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 lg:p-4 bg-zinc-50 space-y-3 custom-scrollbar">
                {isAdmin && (
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Flete interno</p>
                        <p className="mt-1 text-[10px] font-medium leading-4 text-indigo-600">Se incorpora al precio unitario y no aparece en el comprobante.</p>
                      </div>
                      <label className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-700">
                        <input
                          type="checkbox"
                          checked={freightEnabled}
                          onChange={(event) => setFreightEnabled(event.target.checked)}
                          className="h-4 w-4 accent-indigo-700"
                        />
                        Habilitar
                      </label>
                    </div>
                    {freightEnabled && (
                      <div className="mt-3">
                        <label htmlFor="sale-freight-percentage" className="block text-[9px] font-black uppercase tracking-widest text-indigo-700">Porcentaje de flete</label>
                        <div className="relative mt-1">
                          <input
                            id="sale-freight-percentage"
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            inputMode="decimal"
                            value={freightPercentage}
                            onChange={(event) => setFreightPercentage(event.target.value)}
                            className="h-11 w-full rounded-xl border border-indigo-200 bg-white px-3 pr-9 text-sm font-black outline-none focus:ring-2 focus:ring-indigo-700"
                            placeholder="0,00"
                            aria-describedby="sale-freight-result"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-black text-indigo-500">%</span>
                        </div>
                        <p id="sale-freight-result" className="mt-2 text-[10px] font-bold text-indigo-700">
                          Precio final aplicado a todos los productos: +{activeFreightPercentage.toFixed(2)}%
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Forma de Pago</label>
                  <select
                    className="w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold shadow-sm"
                    value={metodoPago}
                    onChange={(e) => setMetodoPago(e.target.value)}
                  >
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.name}>{pm.name}</option>
                    ))}
                    <option value="mixto">Mixto (Pago Parcial)</option>
                  </select>
                </div>

                {metodoPago === 'mixto' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-white border border-zinc-100 rounded-2xl shadow-sm">
                    <div>
                      <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Monto Pagado</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">$</span>
                        <input
                          type="number"
                          placeholder="0.00"
                          className="w-full pl-8 pr-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-black"
                          value={montoPagado}
                          onChange={(e) => setMontoPagado(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Método parcial</label>
                      <select
                        className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold"
                        value={metodoPagoParcial}
                        onChange={(e) => setMetodoPagoParcial(e.target.value)}
                      >
                        {paymentMethods.filter(pm => pm.tipo !== 'Crédito').map(pm => (
                          <option key={pm.id} value={pm.name}>{pm.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {metodoPago === 'cta_cte' && selectedClienteId === 1 && (
                  <div className="flex items-center gap-3 p-3 bg-amber-50 text-amber-600 rounded-xl text-[10px] font-bold border border-amber-100">
                    <AlertCircle size={16} />
                    No se recomienda usar Cta Cte con Consumidor Final
                  </div>
                )}

                {metodoPago === 'Cheque' && (
                  <div className="space-y-2.5 p-3 bg-white border border-zinc-100 rounded-2xl shadow-sm">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-zinc-400" />
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Datos del Cheque</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Banco</label>
                        <input
                          type="text"
                          value={chequeData.banco}
                          onChange={(e) => setChequeData({ ...chequeData, banco: e.target.value })}
                          className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-xs font-bold"
                          placeholder="Banco"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">N° Cheque</label>
                        <input
                          type="text"
                          value={chequeData.numero_cheque}
                          onChange={(e) => setChequeData({ ...chequeData, numero_cheque: e.target.value })}
                          className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-xs font-bold"
                          placeholder="00000000"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Venc.</label>
                        <input
                          type="date"
                          value={chequeData.fecha_vencimiento}
                          onChange={(e) => setChequeData({ ...chequeData, fecha_vencimiento: e.target.value })}
                          className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Importe</label>
                        <input
                          type="number"
                          value={chequeData.importe}
                          onChange={(e) => setChequeData({ ...chequeData, importe: e.target.value })}
                          className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-xs font-black"
                          placeholder={total.toFixed(2)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {isExceedingLimit && (
                  <div className="flex items-center gap-3 p-3 bg-red-50 text-red-600 rounded-2xl text-[10px] font-bold border border-red-100 animate-pulse">
                    <AlertCircle size={18} />
                    El cliente está excediendo su límite de crédito.
                  </div>
                )}

                <div>
                  <label className="block text-[9px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Observaciones</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notas adicionales..."
                    className="w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-medium shadow-sm min-h-[56px] resize-none"
                  />
                </div>
              </div>

              <div className="shrink-0 p-3 lg:p-4 bg-white border-t border-zinc-200 space-y-3">
                <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-end min-[420px]:justify-between">
                  <div>
                    <span className="block text-zinc-500 font-bold text-[10px] uppercase tracking-widest">Total a cobrar</span>
                    {metodoPago === 'mixto' && parseFloat(montoPagado) > 0 && (
                      <span className="block text-[10px] font-black text-red-600 uppercase tracking-widest mt-1">
                        Saldo Cta Cte: ${(total - (parseFloat(montoPagado) || 0)).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <span className="text-3xl lg:text-4xl font-black text-zinc-900 font-mono tracking-tighter">${total.toFixed(2)}</span>
                </div>

                {hasPermission('sales', 'create') && (
                  <button
                    disabled={cart.length === 0 || (metodoPago === 'mixto' && !montoPagado)}
                    onClick={handleConfirmOrder}
                    className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-zinc-200"
                  >
                    <CheckCircle2 size={22} />
                    Confirmar Venta
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'historial' ? (
          <div className="p-4 sm:p-8 h-full overflow-y-auto custom-scrollbar">
            <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">Historial de Ventas</h1>
                  <p className="text-zinc-500 mt-1 text-sm">Listado completo de todas las operaciones realizadas</p>
                </div>
              </div>

              {/* History Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:gap-6 sm:p-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 sm:h-16 sm:w-16">
                    <TrendingDown size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Total Ventas Filtradas</p>
                    <p className="break-all text-2xl font-black text-zinc-900 font-mono tracking-tighter sm:text-3xl">
                      ${activeFilteredSalesHistory.reduce((acc, sale) => acc + sale.total, 0).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-emerald-600 font-bold uppercase">Monto acumulado</p>
                  </div>
                </div>

                <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:gap-6 sm:p-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white sm:h-16 sm:w-16">
                    <History size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Cantidad de Operaciones</p>
                    <p className="break-all text-2xl font-black text-zinc-900 font-mono tracking-tighter sm:text-3xl">{activeFilteredSalesHistory.length}</p>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">Ventas vigentes encontradas</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <div className="relative">
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Buscar Cliente</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                    <input
                      type="text"
                      placeholder="Nombre o Razón Social..."
                      className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm"
                      value={historySearchTerm}
                      onChange={(e) => setHistorySearchTerm(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Desde</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                    <input
                      type="date"
                      className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm"
                      value={historyDateFrom}
                      onChange={(e) => setHistoryDateFrom(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Hasta</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                    <input
                      type="date"
                      className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm"
                      value={historyDateTo}
                      onChange={(e) => setHistoryDateTo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {hasPermission('sales', 'view') && filteredSalesHistory.length > 0 && (
                <div className="flex flex-col gap-4 rounded-3xl border border-slate-300 bg-slate-900 p-4 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <p className="text-sm font-black uppercase tracking-wide">Impresión económica por lote</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">
                      Hasta 8 productos: dos ventas por hoja A4. Ventas más extensas: una hoja A4 completa.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 min-[430px]:flex-row">
                    <button
                      type="button"
                      onClick={toggleAllFilteredSalesForPrint}
                      className="min-h-11 rounded-xl border border-white/25 bg-white/10 px-4 text-xs font-black uppercase tracking-wide text-white hover:bg-white/20"
                    >
                      {allFilteredSalesSelected ? 'Quitar visibles' : 'Seleccionar visibles'}
                    </button>
                    {selectedPrintSaleIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedPrintSaleIds([])}
                        className="min-h-11 rounded-xl border border-white/25 bg-white/10 px-4 text-xs font-black uppercase tracking-wide text-white hover:bg-white/20"
                      >
                        Limpiar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePrintSelectedSales}
                      disabled={selectedPrintSaleIds.length === 0 || isBatchPrinting}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-black uppercase tracking-wide text-slate-950 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isBatchPrinting ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                      {isBatchPrinting ? 'Preparando...' : `Imprimir selección (${selectedPrintSaleIds.length})`}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {filteredSalesHistory.map((sale: any) => (
                  <article
                    key={sale.id}
                    className={`rounded-2xl border p-4 shadow-sm transition sm:p-5 ${selectedPrintSaleIds.includes(Number(sale.id)) ? 'ring-2 ring-slate-900 ring-offset-2' : ''} ${
                      String(sale.estado || '').toLowerCase() === 'anulada'
                        ? 'border-red-200 bg-red-50/60'
                        : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-md'
                    }`}
                  >
                    {hasPermission('sales', 'view') && (
                      <label className="mb-4 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700">
                        <input
                          type="checkbox"
                          checked={selectedPrintSaleIds.includes(Number(sale.id))}
                          onChange={() => toggleSaleForPrint(Number(sale.id))}
                          className="h-4 w-4 accent-slate-900"
                          aria-label={`Seleccionar venta ${sale.numero_venta || sale.id} para impresión económica`}
                        />
                        Seleccionar para imprimir
                      </label>
                    )}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            Venta #{sale.numero_venta || sale.id}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">
                            {sale.metodo_pago}
                          </span>
                          {String(sale.estado || '').toLowerCase() === 'anulada' && (
                            <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-red-700">
                              Anulada
                            </span>
                          )}
                        </div>
                        <h3 className="break-words text-base font-black text-slate-900">
                          {sale.nombre_cliente}
                        </h3>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          {formatBusinessDate(sale.fecha)} · {formatBusinessTime(sale.fecha)}
                        </p>
                        {String(sale.estado || '').toLowerCase() === 'anulada' && (
                          <p className="mt-2 text-xs font-bold text-red-700">
                            Motivo: {sale.anulacion_motivo || 'Sin detalle'}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center lg:justify-end">
                        <div className={`rounded-2xl px-4 py-3 text-left text-white min-[420px]:text-right ${
                          String(sale.estado || '').toLowerCase() === 'anulada' ? 'bg-red-700' : 'bg-slate-900'
                        }`}>
                          <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Total</p>
                          <p className="text-xl font-black font-mono">${sale.total.toFixed(2)}</p>
                        </div>

                        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
                          {hasPermission('sales', 'view') && (
                            <button
                              onClick={() => fetchSaleDetails(sale.id)}
                              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50"
                              title="Ver detalle"
                              aria-label={`Ver detalle de la venta ${sale.numero_venta || sale.id}`}
                            >
                              <Eye size={16} />
                              <span>Detalle</span>
                            </button>
                          )}
                          {hasPermission('sales', 'view') && (
                            <button
                              onClick={() => handleDownloadReceipt(sale.id)}
                              disabled={downloadingSaleId === sale.id}
                              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                              title="Descargar PDF"
                              aria-label={`Descargar PDF de la venta ${sale.numero_venta || sale.id}`}
                            >
                              {downloadingSaleId === sale.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                              ) : (
                                <FileDown size={16} />
                              )}
                              <span>PDF</span>
                            </button>
                          )}
                          {hasPermission('sales', 'view') && (
                            <button
                              onClick={() => handlePrintReceipt(sale.id)}
                              disabled={printingSaleId === sale.id}
                              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              title="Imprimir versión económica"
                              aria-label={`Imprimir versión económica de la venta ${sale.numero_venta || sale.id}`}
                            >
                              {printingSaleId === sale.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
                              ) : (
                                <Printer size={16} />
                              )}
                              <span>Imprimir</span>
                            </button>
                          )}
                          {hasPermission('sales', 'view') && String(sale.estado || '').toLowerCase() !== 'anulada' && (
                            <button
                              onClick={() => handleSendReceiptWhatsApp(sale.id)}
                              disabled={whatsAppSendingSaleId === sale.id}
                              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 text-xs font-black text-green-700 hover:bg-green-100 disabled:opacity-50"
                              title="Preparar envío por WhatsApp"
                              aria-label={`Preparar WhatsApp de la venta ${sale.numero_venta || sale.id}`}
                            >
                              {whatsAppSendingSaleId === sale.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                              ) : (
                                <MessageCircle size={16} />
                              )}
                              <span>WhatsApp</span>
                            </button>
                          )}
                          {hasPermission('sales', 'delete') && String(sale.estado || '').toLowerCase() !== 'anulada' && (
                            <button
                              type="button"
                              onClick={() => openCancellationModal(sale)}
                              disabled={Number(sale.reversion_version || 0) !== 1}
                              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                              title={Number(sale.reversion_version || 0) === 1 ? 'Anular venta' : 'Venta anterior sin trazabilidad reversible'}
                              aria-label={`Anular venta ${sale.numero_venta || sale.id}`}
                            >
                              <XCircle size={16} />
                              <span>{Number(sale.reversion_version || 0) === 1 ? 'Anular' : 'Sin trazabilidad'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}

                {filteredSalesHistory.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center text-slate-400 sm:p-16">
                    <History size={52} className="mx-auto mb-4 opacity-20" />
                    <p className="font-bold">No se encontraron ventas con los filtros aplicados</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'reporte-peti' ? (
          <div className="h-full overflow-y-auto p-4 custom-scrollbar sm:p-8">
            <div className="mx-auto max-w-7xl space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
                      <BarChart3 size={24} />
                    </div>
                    <div className="min-w-0">
                      <h1 className="break-words text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
                        Reporte de ventas Peti por cliente
                      </h1>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-500">
                        Incluye solamente los productos cuya empresa actual es Peti, aun cuando la venta también tenga productos de otras empresas.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid w-full grid-cols-1 gap-2 min-[460px]:grid-cols-2 lg:w-auto">
                  <button
                    type="button"
                    onClick={() => generatePetiSalesReportPDF('download')}
                    disabled={!petiReport || petiReportLoading}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={16} />
                    Descargar PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => generatePetiSalesReportPDF('print')}
                    disabled={!petiReport || petiReportLoading}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Printer size={16} />
                    Imprimir económico
                  </button>
                </div>
              </div>

              <section className="rounded-3xl border border-orange-200 bg-orange-50/70 p-4 text-sm leading-relaxed text-orange-900 sm:p-5">
                <p className="font-black">Criterio del reporte</p>
                <p className="mt-1">
                  Las unidades y el total se calculan solo con productos Peti. En ventas mixtas, Efectivo, Cobrado y Cuenta Corriente se asignan proporcionalmente al valor Peti dentro de la venta. El cálculo incluye la venta completa, sin depender de si había stock o si se generó un pedido a proveedor.
                </p>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                  <label className="space-y-2">
                    <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Desde</span>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                        type="date"
                        value={petiReportDateFrom}
                        onChange={event => setPetiReportDateFrom(event.target.value)}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
                      />
                    </div>
                  </label>

                  <label className="space-y-2">
                    <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Hasta</span>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                        type="date"
                        value={petiReportDateTo}
                        onChange={event => setPetiReportDateTo(event.target.value)}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
                      />
                    </div>
                  </label>

                  <button
                    type="button"
                    onClick={() => void fetchPetiSalesReport()}
                    disabled={petiReportLoading}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                  >
                    <RefreshCw size={16} className={petiReportLoading ? 'animate-spin' : ''} />
                    {petiReportLoading ? 'Generando...' : 'Generar reporte'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-500">
                  <span>
                    Período aplicado: {petiReport?.desde || 'Inicio'} al {petiReport?.hasta || 'Hoy'}
                  </span>
                  {(petiReportDateFrom || petiReportDateTo) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPetiReportDateFrom('');
                        setPetiReportDateTo('');
                      }}
                      className="rounded-lg px-3 py-2 font-black text-slate-600 hover:bg-slate-100"
                    >
                      Limpiar fechas
                    </button>
                  )}
                </div>
              </section>

              {petiReportError && (
                <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">
                  <AlertCircle size={19} className="mt-0.5 shrink-0" />
                  <span>{petiReportError}</span>
                </div>
              )}

              {petiReportLoading && !petiReport ? (
                <div className="flex min-h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white">
                  <div className="text-center">
                    <Loader2 size={34} className="mx-auto animate-spin text-orange-600" />
                    <p className="mt-3 text-sm font-black text-slate-600">Calculando ventas Peti...</p>
                  </div>
                </div>
              ) : petiReport ? (
                <>
                  <section className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-5">
                    {[
                      { label: 'Ventas incluidas', value: petiReport.ventas_incluidas.toString() },
                      { label: 'Unidades Peti', value: formatPetiUnits(petiReport.totales.unidades) },
                      { label: 'Total Peti', value: formatPetiCurrency(petiReport.totales.total) },
                      { label: 'Cobrado', value: formatPetiCurrency(petiReport.totales.cobrado) },
                      { label: 'Cuenta corriente', value: formatPetiCurrency(petiReport.totales.cuenta_corriente) },
                    ].map(card => (
                      <div key={card.label} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{card.label}</p>
                        <p className="mt-2 break-words text-xl font-black text-slate-950">{card.value}</p>
                      </div>
                    ))}
                  </section>

                  <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div>
                        <h2 className="text-lg font-black text-slate-950">Totales por cliente</h2>
                        <p className="mt-1 text-xs text-slate-500">
                          “Pedidos” representa la cantidad de ventas distintas que contienen al menos un producto Peti.
                        </p>
                      </div>
                      <span className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-700">
                        {petiReport.clientes.length} clientes
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-[900px] w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-950 text-left text-[10px] font-black uppercase tracking-[0.12em] text-white">
                            <th className="px-4 py-3">Cliente</th>
                            <th className="px-4 py-3 text-center">Pedidos</th>
                            <th className="px-4 py-3 text-center">Unidades</th>
                            <th className="px-4 py-3 text-right">Total</th>
                            <th className="px-4 py-3 text-right">Efectivo</th>
                            <th className="px-4 py-3 text-right">Cobrado</th>
                            <th className="px-4 py-3 text-right">Cuenta Corriente</th>
                          </tr>
                        </thead>
                        <tbody>
                          {petiReport.clientes.map(row => (
                            <tr key={row.cliente} className="border-b border-slate-100 last:border-b-0 hover:bg-orange-50/40">
                              <td className="px-4 py-3 font-black text-slate-900">{row.cliente}</td>
                              <td className="px-4 py-3 text-center font-bold text-slate-700">{row.pedidos}</td>
                              <td className="px-4 py-3 text-center font-bold text-slate-700">{formatPetiUnits(row.unidades)}</td>
                              <td className="px-4 py-3 text-right font-black text-slate-900">{formatPetiCurrency(row.total)}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-700">{formatPetiCurrency(row.efectivo)}</td>
                              <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatPetiCurrency(row.cobrado)}</td>
                              <td className="px-4 py-3 text-right font-bold text-amber-700">{formatPetiCurrency(row.cuenta_corriente)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-100 font-black text-slate-950">
                            <td className="px-4 py-4">TOTAL GENERAL</td>
                            <td className="px-4 py-4 text-center">{petiReport.totales.pedidos}</td>
                            <td className="px-4 py-4 text-center">{formatPetiUnits(petiReport.totales.unidades)}</td>
                            <td className="px-4 py-4 text-right">{formatPetiCurrency(petiReport.totales.total)}</td>
                            <td className="px-4 py-4 text-right">{formatPetiCurrency(petiReport.totales.efectivo)}</td>
                            <td className="px-4 py-4 text-right text-emerald-700">{formatPetiCurrency(petiReport.totales.cobrado)}</td>
                            <td className="px-4 py-4 text-right text-amber-700">{formatPetiCurrency(petiReport.totales.cuenta_corriente)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {petiReport.clientes.length === 0 && (
                      <div className="p-10 text-center text-slate-400 sm:p-14">
                        <BarChart3 size={48} className="mx-auto mb-3 opacity-20" />
                        <p className="font-black">No hay ventas con productos Peti en el período seleccionado.</p>
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
                  <BarChart3 size={48} className="mx-auto mb-3 opacity-20" />
                  <p className="font-black">Elegí un período y generá el reporte.</p>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'pedidos-clientes' ? (
          <CustomerOrdersAdmin onChanged={() => { fetchSalesHistory(); fetchClientes(); }} />
        ) : (
          <div className="p-4 sm:p-8 h-full overflow-y-auto custom-scrollbar">
            <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">Saldos Pendientes</h1>
                  <p className="text-zinc-500 mt-1 text-sm">Resumen de deudas y clientes con saldo a favor del negocio</p>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:gap-6 sm:p-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600 sm:h-16 sm:w-16">
                    <DollarSign size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Deuda General</p>
                    <p className="break-all text-2xl font-black text-zinc-900 font-mono tracking-tighter sm:text-3xl">${saldosSummary.totalDebt.toFixed(2)}</p>
                    <p className="text-[10px] text-red-600 font-bold uppercase">Total por cobrar</p>
                  </div>
                </div>

                <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:gap-6 sm:p-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 sm:h-16 sm:w-16">
                    <Users size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Clientes con Deuda</p>
                    <p className="break-all text-2xl font-black text-zinc-900 font-mono tracking-tighter sm:text-3xl">{saldosSummary.customersWithDebt}</p>
                    <p className="text-[10px] text-amber-600 font-bold uppercase">Cuentas activas</p>
                  </div>
                </div>

                <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:gap-6 sm:p-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white sm:h-16 sm:w-16">
                    <History size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Ventas Pendientes</p>
                    <p className="break-all text-2xl font-black text-zinc-900 font-mono tracking-tighter sm:text-3xl">{saldosSummary.pendingSalesCount}</p>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">Operaciones sin saldar</p>
                  </div>
                </div>
              </div>

              {/* Saldos List */}
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {saldosList.map((entry: any) => (
                  <article
                    key={entry.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
                  >
                    <div className="flex flex-col gap-4 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[9px] font-black uppercase text-red-600">
                            Con deuda
                          </span>
                          <span className="text-[10px] font-bold uppercase text-slate-400">
                            ID {entry.id}
                          </span>
                        </div>
                        <h3 className="break-words text-base font-black text-slate-900">{entry.nombre}</h3>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          Última compra: {formatBusinessDate(entry.ultimaCompra)}
                        </p>
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          {entry.ventas.length} {entry.ventas.length === 1 ? 'venta pendiente' : 'ventas pendientes'}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-red-50 px-4 py-3 min-[480px]:text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-red-400">Total adeudado</p>
                        <p className="text-2xl font-black font-mono text-red-600">${entry.totalAdeudado.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                      <button
                        onClick={() => setSelectedCustomerForSaldos(entry)}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-black uppercase tracking-wide text-white hover:bg-slate-800"
                      >
                        <Eye size={16} />
                        Ver ventas pendientes
                      </button>
                      <button
                        onClick={() => setShowCustomerFichaId(entry.id)}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-black uppercase tracking-wide text-emerald-700 hover:bg-emerald-100"
                      >
                        <ArrowRight size={16} />
                        Ver ficha
                      </button>
                    </div>
                  </article>
                ))}

                {saldosList.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-emerald-200 bg-white p-10 text-center text-slate-400 sm:p-16 xl:col-span-2">
                    <CheckCircle2 size={52} className="mx-auto mb-4 text-emerald-500 opacity-30" />
                    <p className="font-bold">¡Excelente! No hay saldos pendientes por cobrar</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Success Modal */}
      {showSuccessModal && lastSaleData && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="sale-success-title">
          <div className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl animate-in zoom-in-95 duration-300 sm:max-h-[95dvh] sm:rounded-[32px]">
            <div className="overflow-y-auto p-5 text-center sm:p-8">
              <div className="w-16 h-16 sm:w-24 sm:h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-inner">
                <CheckCircle2 size={32} className="sm:hidden" />
                <CheckCircle2 size={48} className="hidden sm:block" />
              </div>
              <h3 id="sale-success-title" className="text-2xl sm:text-3xl font-black text-zinc-900 mb-2 sm:mb-3 tracking-tight">¡Venta Exitosa!</h3>
              <p className="text-zinc-500 mb-6 sm:mb-10 leading-relaxed text-sm sm:text-base">La operación <b>#{lastSaleData.numero_venta || lastSaleData.id}</b> ha sido procesada y registrada correctamente.</p>
              
              {lastSaleData.results?.some((r: any) => r.pending > 0) && (
                <div className="mb-6 sm:mb-8 p-4 sm:p-6 bg-amber-50 border border-amber-100 rounded-2xl sm:rounded-[32px] text-left">
                  <div className="flex items-center gap-2 text-amber-600 font-black text-[10px] uppercase tracking-widest mb-3">
                    <AlertTriangle size={14} />
                    Productos Pendientes
                  </div>
                  <div className="space-y-2">
                    {lastSaleData.results.filter((r: any) => r.pending > 0).map((r: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <span className="text-zinc-600 font-medium">{r.name}</span>
                        <span className="font-black text-zinc-900 bg-white px-2 py-0.5 rounded-lg border border-amber-200">{r.pending} u.</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-[10px] text-amber-600/80 font-bold leading-tight uppercase tracking-tight">
                    Agregados automáticamente a "Pedidos a Proveedor"
                  </p>
                </div>
              )}
              
              <div className="space-y-4">
                {hasPermission('sales', 'view') && (
                  <button 
                    onClick={() => generateSaleReceipt(lastSaleData, businessSettings)}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100"
                  >
                    <Download size={20} />
                    Descargar Comprobante
                  </button>
                )}
                {hasPermission('sales', 'view') && (
                  <button
                    onClick={() => printSaleReceipt(lastSaleData, businessSettings)}
                    className="w-full py-4 bg-white text-slate-900 rounded-2xl border border-slate-300 font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-slate-50 transition-all"
                  >
                    <Printer size={20} />
                    Imprimir económico
                  </button>
                )}
                {hasPermission('sales', 'view') && (
                  <button 
                    onClick={() => handleSendReceiptWhatsApp(lastSaleData.id)}
                    disabled={whatsAppSendingSaleId === lastSaleData.id}
                    className="w-full py-4 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-green-700 transition-all shadow-xl shadow-green-100 disabled:opacity-50"
                  >
                    <MessageCircle size={20} />
                    {whatsAppSendingSaleId === lastSaleData.id ? 'Preparando...' : 'Enviar por WhatsApp'}
                  </button>
                )}
                <button 
                  onClick={() => setShowSuccessModal(false)}
                  aria-label="Cerrar confirmación de venta"
                  className="w-full py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sale Detail Modal (History) */}
      {saleToCancel && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-sale-title">
          <form onSubmit={handleCancelSale} className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[95dvh] sm:rounded-[32px]">
            <div className="flex items-center justify-between border-b border-red-100 bg-red-700 p-5 text-white sm:p-6">
              <div>
                <h3 id="cancel-sale-title" className="text-lg font-black uppercase tracking-tight">Anular venta #{saleToCancel.numero_venta || saleToCancel.id}</h3>
                <p className="mt-1 text-xs font-medium text-white/75">La operación conservará el historial y generará contramovimientos.</p>
              </div>
              <button type="button" onClick={closeCancellationModal} disabled={isCancellingSale} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-50" aria-label="Cerrar anulación">
                <X size={22} />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5 sm:p-6">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-black">Esta acción no elimina la venta.</p>
                <p className="mt-1">Restaurará stock y FIFO, revertirá pagos y saldo pendiente, y cancelará pedidos pendientes vinculados.</p>
              </div>
              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-widest text-slate-600">Motivo obligatorio</span>
                <textarea
                  autoFocus
                  value={cancellationReason}
                  onChange={(event) => {
                    setCancellationReason(event.target.value);
                    if (cancellationError) setCancellationError('');
                  }}
                  rows={4}
                  maxLength={500}
                  placeholder="Ejemplo: venta cargada por duplicado"
                  className="w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
                  disabled={isCancellingSale}
                />
                <span className="mt-1 block text-right text-[10px] font-bold text-slate-400">{cancellationReason.length}/500</span>
              </label>
              {cancellationError && (
                <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <span>{cancellationError}</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50 p-5 sm:grid-cols-2 sm:p-6">
              <button type="button" onClick={closeCancellationModal} disabled={isCancellingSale} className="min-h-12 rounded-2xl border border-slate-300 bg-white px-5 text-sm font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
              <button type="submit" disabled={isCancellingSale || cancellationReason.trim().length < 3} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-700 px-5 text-sm font-black uppercase tracking-widest text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">
                {isCancellingSale ? <Loader2 size={18} className="animate-spin" /> : <XCircle size={18} />}
                {isCancellingSale ? 'Anulando…' : 'Confirmar anulación'}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedSale && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="sale-detail-title">
          <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl animate-in zoom-in-95 duration-300 sm:max-h-[95dvh] sm:rounded-[36px]">
            <div className="p-4 sm:p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-900 text-white shrink-0">
              <div>
                <h3 id="sale-detail-title" className="text-lg sm:text-xl font-black uppercase tracking-tight">Detalle #{selectedSale.numero_venta || selectedSale.id}</h3>
                <p className="text-[10px] sm:text-xs text-white/60 font-medium">{selectedSale.fecha ? formatBusinessDateTime(selectedSale.fecha) : ''}</p>
              </div>
              <button 
                onClick={() => setSelectedSale(null)}
                aria-label="Cerrar detalle de venta"
                autoFocus
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-4 sm:p-8 space-y-6 sm:space-y-8 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div className="bg-zinc-50 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Información del Cliente</p>
                  <p className="text-base sm:text-lg font-black text-zinc-900">{selectedSale.nombre_cliente}</p>
                  <p className="text-[10px] sm:text-xs text-zinc-500 font-bold uppercase mt-1">ID: {selectedSale.cliente_id}</p>
                </div>
                <div className="bg-zinc-50 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Pago y Estado</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-black text-zinc-900 uppercase">{selectedSale.metodo_pago}</span>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      selectedSale.estado === 'Anulada' ? 'bg-red-100 text-red-700 border-red-200' :
                      selectedSale.estado === 'Pagada' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                      selectedSale.estado === 'Parcialmente Pagada' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                      'bg-red-50 text-red-600 border-red-100'
                    }`}>
                      {selectedSale.estado}
                    </span>
                  </div>
                  <p className="text-[10px] sm:text-xs text-zinc-500 font-bold mt-1">Pagado: ${Number(selectedSale.cancellation?.monto_pagado_original ?? selectedSale.monto_pagado ?? 0).toFixed(2)}</p>
                </div>
              </div>

              {String(selectedSale.estado || '').toLowerCase() === 'anulada' && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <XCircle className="mt-0.5 shrink-0 text-red-700" size={20} />
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-red-700">Venta anulada</p>
                      <p className="mt-2 text-sm font-bold text-red-900">Motivo: {selectedSale.anulacion_motivo || selectedSale.cancellation?.motivo || 'Sin detalle'}</p>
                      <p className="mt-1 text-xs text-red-700">
                        {selectedSale.anulada_at || selectedSale.cancellation?.anulada_at
                          ? formatBusinessDateTime(selectedSale.anulada_at || selectedSale.cancellation?.anulada_at)
                          : ''}
                        {(selectedSale.anulada_por || selectedSale.cancellation?.anulada_por)
                          ? ` · ${selectedSale.anulada_por || selectedSale.cancellation?.anulada_por}`
                          : ''}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Productos Vendidos</h4>
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {selectedSale.items.map((item: any) => (
                    <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 transition-all group hover:bg-white hover:shadow-md min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between sm:rounded-2xl sm:p-4">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-lg sm:rounded-xl flex items-center justify-center text-zinc-400 border border-zinc-100 group-hover:bg-zinc-900 group-hover:text-white transition-all shrink-0">
                          <Package size={16} className="sm:hidden" />
                          <Package size={20} className="hidden sm:block" />
                        </div>
                        <div className="min-w-0">
                          <p className="break-words text-xs font-bold text-zinc-900 sm:text-sm">{item.product_name}</p>
                          <p className="text-[9px] sm:text-[10px] text-zinc-400 uppercase font-bold tracking-wider">{item.company}</p>
                        </div>
                      </div>
                      <div className="w-full text-left min-[420px]:w-auto min-[420px]:shrink-0 min-[420px]:text-right">
                        <p className="text-[10px] sm:text-xs font-bold text-zinc-500">
                          {formatMeasurementQuantity(item.cantidad, item.measurement_unit, { includeUnit: item.quantity_mode === 'measure' })} x ${item.precio_venta.toFixed(item.quantity_mode === 'measure' ? 4 : 2)}
                        </p>
                        <p className="text-sm sm:text-base font-black text-zinc-900 font-mono">${(item.cantidad * item.precio_venta).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 sm:p-8 bg-zinc-900 text-white rounded-2xl sm:rounded-[32px] shadow-2xl gap-4">
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Total de la Operación</p>
                  <p className="text-3xl sm:text-4xl font-black font-mono tracking-tighter">${selectedSale.total.toFixed(2)}</p>
                </div>
                {String(selectedSale.estado || '').toLowerCase() !== 'anulada' && selectedSale.monto_pendiente > 0 && (
                  <div className="sm:text-right">
                    <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">Saldo Pendiente</p>
                    <p className="text-xl sm:text-2xl font-black text-red-500 font-mono tracking-tighter">${selectedSale.monto_pendiente.toFixed(2)}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-1 gap-3 border-t border-zinc-100 bg-zinc-50 p-4 sm:grid-cols-2 sm:p-8">
              {hasPermission('sales', 'view') && (
                <button 
                  onClick={() => generateSaleReceipt(selectedSale, businessSettings)}
                  className="flex items-center justify-center gap-3 px-6 sm:px-8 py-3 bg-emerald-600 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 text-sm"
                >
                  <Download size={18} />
                  Descargar PDF
                </button>
              )}
              {hasPermission('sales', 'view') && (
                <button
                  onClick={() => printSaleReceipt(selectedSale, businessSettings)}
                  className="flex items-center justify-center gap-3 px-6 sm:px-8 py-3 bg-white text-slate-900 border border-slate-300 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-slate-100 transition-all text-sm"
                >
                  <Printer size={18} />
                  Imprimir económico
                </button>
              )}
              {hasPermission('sales', 'view') && String(selectedSale.estado || '').toLowerCase() !== 'anulada' && (
                <button 
                  onClick={() => handleSendReceiptWhatsApp(selectedSale.id)}
                  disabled={whatsAppSendingSaleId === selectedSale.id}
                  className="flex items-center justify-center gap-3 px-6 sm:px-8 py-3 bg-green-600 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-green-700 transition-all shadow-xl shadow-green-100 text-sm disabled:opacity-50"
                >
                  <MessageCircle size={18} />
                  {whatsAppSendingSaleId === selectedSale.id ? 'Preparando...' : 'WhatsApp'}
                </button>
              )}
              {hasPermission('sales', 'delete') && String(selectedSale.estado || '').toLowerCase() !== 'anulada' && (
                <button
                  type="button"
                  onClick={() => openCancellationModal(selectedSale)}
                  disabled={Number(selectedSale.reversion_version || 0) !== 1}
                  className="flex items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-3 text-sm font-black uppercase tracking-widest text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-2xl sm:px-8"
                  title={Number(selectedSale.reversion_version || 0) === 1 ? 'Anular venta' : 'Venta anterior sin trazabilidad reversible'}
                >
                  <XCircle size={18} />
                  {Number(selectedSale.reversion_version || 0) === 1 ? 'Anular venta' : 'Sin trazabilidad'}
                </button>
              )}
              <button 
                onClick={() => setSelectedSale(null)}
                className="px-6 sm:px-8 py-3 bg-zinc-900 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 text-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Pending Sales Detail Modal (Saldos) */}
      {selectedCustomerForSaldos && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="pending-sales-title">
          <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl animate-in zoom-in-95 duration-300 sm:max-h-[95dvh] sm:rounded-[36px]">
            <div className="p-4 sm:p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-900 text-white shrink-0">
              <div>
                <h3 id="pending-sales-title" className="text-lg sm:text-xl font-black tracking-tight">Ventas Pendientes</h3>
                <p className="text-[10px] sm:text-xs text-white/60 uppercase font-bold tracking-widest truncate max-w-[200px] sm:max-w-none">{selectedCustomerForSaldos.nombre}</p>
              </div>
              <button 
                onClick={() => setSelectedCustomerForSaldos(null)}
                aria-label="Cerrar panel de ventas pendientes"
                autoFocus
                className="p-2 sm:p-3 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-4 sm:p-8 space-y-6 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-zinc-50 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Adeudado</p>
                  <p className="text-2xl sm:text-3xl font-black text-red-600 font-mono tracking-tighter">${selectedCustomerForSaldos.totalAdeudado.toFixed(2)}</p>
                </div>
                <div className="bg-zinc-50 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Ventas Pendientes</p>
                  <p className="text-2xl sm:text-3xl font-black text-zinc-900 font-mono tracking-tighter">{selectedCustomerForSaldos.ventas.length}</p>
                </div>
              </div>

              <div className="space-y-3">
                {selectedCustomerForSaldos.ventas.map((sale: any) => (
                  <div key={sale.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-black text-slate-900">Venta #{sale.numero_venta || sale.id}</p>
                        <p className="mt-1 text-[11px] font-medium text-slate-500">
                          {formatBusinessDate(sale.fecha)}
                        </p>
                      </div>
                      <p className="text-lg font-black font-mono text-slate-900">${sale.total.toFixed(2)}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <p className="text-[9px] font-black uppercase text-emerald-500">Pagado</p>
                        <p className="font-black font-mono text-emerald-700">${sale.monto_pagado.toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl bg-red-50 p-3">
                        <p className="text-[9px] font-black uppercase text-red-400">Saldo</p>
                        <p className="font-black font-mono text-red-600">${sale.monto_pendiente.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 sm:p-8 bg-zinc-50 border-t border-zinc-100 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center shrink-0">
              {hasPermission('current_accounts', 'create') && (
                <button 
                  onClick={() => setShowQuickPaymentModal(true)}
                  className="px-6 sm:px-8 py-3 bg-emerald-600 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 flex items-center justify-center gap-2 text-sm"
                >
                  <DollarSign size={18} />
                  Registrar Pago
                </button>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={() => {
                    setShowCustomerFichaId(selectedCustomerForSaldos.id);
                    setSelectedCustomerForSaldos(null);
                  }}
                  className="px-6 sm:px-8 py-3 bg-zinc-100 text-zinc-600 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-zinc-200 transition-all text-sm"
                >
                  Ver Ficha
                </button>
                <button 
                  onClick={() => setSelectedCustomerForSaldos(null)}
                  aria-label="Cerrar panel de ventas pendientes"
                  className="px-6 sm:px-8 py-3 bg-zinc-900 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 text-sm"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Payment Modal */}
      {showQuickPaymentModal && selectedCustomerForSaldos && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="quick-payment-title">
          <div className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl animate-in zoom-in-95 duration-300 sm:max-h-[95dvh] sm:rounded-[32px]">
            <div className="flex shrink-0 items-center justify-between border-b border-emerald-500 bg-emerald-600 p-4 text-white sm:p-6">
              <h3 id="quick-payment-title" className="text-xl font-black tracking-tight">Registrar Pago</h3>
              <button 
                onClick={() => setShowQuickPaymentModal(false)}
                aria-label="Cerrar modal de registro de pago"
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleQuickPayment} className="space-y-5 overflow-y-auto p-4 sm:p-6">
              <div>
                <label htmlFor="quick-payment-amount" className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Monto a Cobrar</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-mono text-lg">$</span>
                  <input
                    id="quick-payment-amount"
                    type="number"
                    step="0.01"
                    required
                    autoFocus
                    className="w-full pl-10 pr-4 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none text-2xl font-black font-mono"
                    placeholder="0.00"
                    value={quickPaymentForm.monto}
                    onChange={(e) => setQuickPaymentForm({ ...quickPaymentForm, monto: e.target.value })}
                  />
                </div>
                <p className="mt-2 text-[10px] text-zinc-400 font-bold uppercase">Deuda Total: ${selectedCustomerForSaldos.totalAdeudado.toFixed(2)}</p>
              </div>

              <div>
                <p id="quick-payment-method-label" className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Método de Pago</p>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2" role="group" aria-labelledby="quick-payment-method-label">
                  {paymentMethods.map((pm) => (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setQuickPaymentForm({ ...quickPaymentForm, metodo_pago: pm.name })}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all border ${
                        quickPaymentForm.metodo_pago === pm.name
                          ? 'bg-zinc-900 text-white border-zinc-900 shadow-lg'
                          : 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400'
                      }`}
                    >
                      {pm.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="quick-payment-notes" className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Observaciones (Opcional)</label>
                <textarea
                  id="quick-payment-notes"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none text-sm resize-none"
                  rows={2}
                  placeholder="Ej: Pago parcial, entrega en efectivo..."
                  value={quickPaymentForm.observaciones}
                  onChange={(e) => setQuickPaymentForm({ ...quickPaymentForm, observaciones: e.target.value })}
                />
              </div>

              <button
                type="submit"
                className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-700 transition-all shadow-2xl shadow-emerald-100"
              >
                <CheckCircle2 size={24} />
                Confirmar Pago
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Customer Detail Modal */}
      {showCustomerFichaId && (
        <CustomerDetail 
          clienteId={showCustomerFichaId} 
          onClose={() => setShowCustomerFichaId(null)} 
        />
      )}
    </div>
  );
}
