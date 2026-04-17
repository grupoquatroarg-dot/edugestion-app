import React, { useState, useEffect, useMemo } from 'react';
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
  XCircle
} from 'lucide-react';
import { Product } from '../types';
import { getSocket } from '../utils/socket';
import { generateSaleReceipt } from '../utils/pdfGenerator';
import CustomerDetail from './CustomerDetail';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

const socket = getSocket();

export default function SalesModule() {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'nueva' | 'historial' | 'saldos'>('nueva');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClienteId, setSelectedClienteId] = useState<number>(1);
  const [metodoPago, setMetodoPago] = useState<string>('');
  const [metodoPagoParcial, setMetodoPagoParcial] = useState<string>('');
  const [montoPagado, setMontoPagado] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [chequeData, setChequeData] = useState({
    banco: '',
    numero_cheque: '',
    fecha_vencimiento: new Date().toISOString().split('T')[0],
    importe: ''
  });
  const [clientes, setClientes] = useState<any[]>([]);
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastSaleData, setLastSaleData] = useState<any>(null);
  
  // History state
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [downloadingSaleId, setDownloadingSaleId] = useState<number | null>(null);
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

  const filteredSalesHistory = useMemo(() => {
    return salesHistory.filter(sale => {
      const matchesSearch = (sale.nombre_cliente || '').toLowerCase().includes(historySearchTerm.toLowerCase());
      const saleDate = new Date(sale.fecha).toISOString().split('T')[0];
      const matchesDateFrom = !historyDateFrom || saleDate >= historyDateFrom;
      const matchesDateTo = !historyDateTo || saleDate <= historyDateTo;
      return matchesSearch && matchesDateFrom && matchesDateTo;
    });
  }, [salesHistory, historySearchTerm, historyDateFrom, historyDateTo]);

  const saldosSummary = useMemo(() => {
    const pendingSales = salesHistory.filter(s => s.monto_pendiente > 0);
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
      if (sale.monto_pendiente > 0) {
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
    fetchActiveProducts();
    fetchClientes();
    fetchSalesHistory();
    fetchBusinessSettings();
    fetchPaymentMethods();

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

  const fetchActiveProducts = async () => {
    try {
      const res = await apiFetch('/api/products');
      const body = await res.json();
      const data = unwrapResponse(body);
      setProducts(data);
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchClientes = async () => {
    try {
      const res = await apiFetch('/api/clientes');
      const body = await res.json();
      const data = unwrapResponse(body);
      setClientes(data);
    } catch (error) {
      console.error("Error fetching customers:", error);
    }
  };

  const fetchSalesHistory = async () => {
    try {
      const res = await apiFetch('/api/sales');
      const body = await res.json();
      const data = unwrapResponse(body);
      setSalesHistory(data);
    } catch (error) {
      console.error("Error fetching sales history:", error);
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

  const fetchPaymentMethods = async () => {
    try {
      const res = await apiFetch('/api/config/payment-methods?active=true');
      const body = await res.json();
      const data = unwrapResponse(body);
      setPaymentMethods(data);
      if (data.length > 0) {
        setMetodoPago(data[0].name);
        setMetodoPagoParcial(data[0].name);
        setQuickPaymentForm(prev => ({ ...prev, metodo_pago: data[0].name }));
      }
    } catch (error) {
      console.error("Error fetching payment methods:", error);
    }
  };

  const fetchSaleDetails = async (saleId: number) => {
    try {
      const res = await apiFetch(`/api/sales/${saleId}`);
      const body = await res.json();
      const sale = unwrapResponse(body);
      setSelectedSale(sale);
    } catch (error) {
      console.error("Error fetching sale details:", error);
    }
  };

  const handleDownloadReceipt = async (saleId: number) => {
    try {
      setDownloadingSaleId(saleId);
      const res = await apiFetch(`/api/sales/${saleId}`);
      const body = await res.json();
      const sale = unwrapResponse(body);
      generateSaleReceipt(sale, businessSettings);
    } catch (error) {
      console.error("Error generating receipt:", error);
    } finally {
      setDownloadingSaleId(null);
    }
  };

  const handleQuickPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerForSaldos || !quickPaymentForm.monto) return;

    try {
      const res = await apiFetch(`/api/clientes/${selectedCustomerForSaldos.id}/pagos`, {
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
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.product.id === product.id 
            ? { ...item, quantity: item.quantity + 1 } 
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === productId) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const total = cart.reduce((sum, item) => sum + (item.product.sale_price * item.quantity), 0);

  const selectedCliente = useMemo(() => 
    clientes.find(c => c.id === selectedClienteId) || { id: 1, nombre_apellido: 'Consumidor Final', saldo_cta_cte: 0, limite_credito: 0, tiene_deuda_vencida: 0 }
  , [clientes, selectedClienteId]);

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

    try {
      const saleData = {
        total,
        cliente_id: selectedCliente.id,
        nombre_cliente: selectedCliente.nombre_apellido,
        metodo_pago: metodoPago === 'mixto' ? `mixto (${metodoPagoParcial} + cta_cte)` : metodoPago,
        monto_pagado: (metodoPago === 'cta_cte' || paymentMethods.find(pm => pm.name === metodoPago)?.tipo === 'Crédito') ? 0 : (metodoPago === 'mixto' ? parseFloat(montoPagado) || 0 : total),
        notes,
        cheque_data: metodoPago === 'Cheque' ? {
          ...chequeData,
          importe: parseFloat(chequeData.importe) || total
        } : null,
        items: cart.map(item => ({
          product_id: item.product.id,
          cantidad: item.quantity,
          precio_venta: item.product.sale_price
        }))
      };

      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify(saleData)
      });

      const body = await res.json();
      const data = unwrapResponse(body);
      
      if (data.insufficientStock) {
        alert(`Stock insuficiente para algunos productos. Se ha generado el Pedido a Proveedor N° ${data.orderNumber} automáticamente.`);
        setCart([]);
        setSelectedClienteId(1);
        setMetodoPago(paymentMethods.length > 0 ? paymentMethods[0].name : '');
        setMetodoPagoParcial(paymentMethods.length > 0 ? paymentMethods[0].name : '');
        setMontoPagado('');
        setNotes('');
        setChequeData({
          banco: '',
          numero_cheque: '',
          fecha_vencimiento: new Date().toISOString().split('T')[0],
          importe: ''
        });
        await Promise.all([fetchSalesHistory(), fetchActiveProducts(), fetchClientes()]);
        return;
      }

      const saleRes = await apiFetch(`/api/sales/${data.saleId}`);
      const saleBody = await saleRes.json();
      const fullSale = unwrapResponse(saleBody);
      setLastSaleData({ ...fullSale, results: data.results });
      setShowSuccessModal(true);

      setCart([]);
      setSelectedClienteId(1);
      setMetodoPago(paymentMethods.length > 0 ? paymentMethods[0].name : '');
      setMetodoPagoParcial(paymentMethods.length > 0 ? paymentMethods[0].name : '');
      setMontoPagado('');
      setNotes('');
      setChequeData({
        banco: '',
        numero_cheque: '',
        fecha_vencimiento: new Date().toISOString().split('T')[0],
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
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-50">
      {/* Tabs Header */}
      <div className="bg-white border-b border-zinc-200 px-4 sm:px-8 flex items-center justify-between overflow-x-auto no-scrollbar">
        <div className="flex whitespace-nowrap">
          <button 
            onClick={() => setActiveTab('nueva')}
            className={`px-4 sm:px-8 py-4 sm:py-5 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeTab === 'nueva' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <ShoppingCart size={18} />
            Nueva Venta
          </button>
          <button 
            onClick={() => setActiveTab('historial')}
            className={`px-4 sm:px-8 py-4 sm:py-5 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeTab === 'historial' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <History size={18} />
            Historial de Ventas
          </button>
          <button 
            onClick={() => setActiveTab('saldos')}
            className={`px-4 sm:px-8 py-4 sm:py-5 text-sm font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeTab === 'saldos' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <DollarSign size={18} />
            Saldos Pendientes
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'nueva' ? (
          <div className="flex h-full overflow-hidden flex-col lg:flex-row">
            {/* Product Selection */}
            <div className="flex-1 flex flex-col p-4 lg:p-8 border-r border-zinc-200 overflow-hidden">
              <div className="mb-6 lg:mb-8 flex flex-col sm:flex-row items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl lg:text-3xl font-black text-zinc-900 tracking-tight">Nueva Venta</h1>
                  <p className="text-zinc-500 mt-1 text-sm">Selecciona productos para el pedido</p>
                </div>
                
                <div className="w-full sm:w-72">
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Cliente Seleccionado</label>
                  <select
                    className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold shadow-sm"
                    value={selectedClienteId}
                    onChange={(e) => setSelectedClienteId(parseInt(e.target.value))}
                  >
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre_apellido}</option>
                    ))}
                  </select>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                      selectedCliente.tipo_cliente === 'mayorista' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {selectedCliente.tipo_cliente || 'minorista'}
                    </span>
                    {selectedCliente.tiene_deuda_vencida === 1 && (
                      <div className="flex items-center gap-2 p-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold border border-red-100 animate-pulse">
                        <AlertCircle size={12} />
                        Deuda Vencida
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative mb-6 lg:mb-8">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                <input
                  type="text"
                  placeholder="Buscar productos por nombre, código o familia..."
                  className="w-full pl-12 pr-4 py-3 lg:py-4 bg-white border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all shadow-sm text-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
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
                        </div>
                        <div className={`text-[10px] font-bold uppercase ${product.stock <= 5 ? 'text-red-600' : 'text-zinc-400'}`}>
                          Stock: {product.stock}
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
            <div className="w-full lg:w-[400px] bg-white flex flex-col shadow-2xl z-10 border-t lg:border-t-0 lg:border-l border-zinc-200">
              <div className="p-4 lg:p-8 border-b border-zinc-100 flex items-center gap-3">
                <div className="w-10 h-10 bg-zinc-900 text-white rounded-xl flex items-center justify-center">
                  <ShoppingCart size={20} />
                </div>
                <h2 className="text-lg lg:text-xl font-black text-zinc-900 uppercase tracking-tight">Resumen</h2>
              </div>

              <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-4 lg:space-y-6 max-h-[40vh] lg:max-h-none">
                {cart.map(item => (
                  <div key={item.product.id} className="flex items-center gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-100 group">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-zinc-900 truncate text-sm">{item.product.name}</h4>
                      <p className="text-xs text-zinc-500 font-mono">${item.product.sale_price.toFixed(2)} c/u</p>
                    </div>
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-zinc-200 p-1 shadow-sm">
                      <button 
                        onClick={() => updateQuantity(item.product.id, -1)}
                        className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-black">{item.quantity}</span>
                      <button 
                        onClick={() => updateQuantity(item.product.id, 1)}
                        className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <button 
                      onClick={() => removeFromCart(item.product.id)}
                      className="text-zinc-300 hover:text-red-600 transition-colors p-1"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                {cart.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 lg:py-24 text-zinc-300">
                    <ShoppingCart size={48} className="mb-4 opacity-10" />
                    <p className="text-xs font-bold uppercase tracking-widest">Carrito Vacío</p>
                  </div>
                )}
              </div>

              <div className="p-4 lg:p-8 bg-zinc-50 border-t border-zinc-200 space-y-4 lg:space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Forma de Pago</label>
                    <select
                      className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold shadow-sm"
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
                    <div className="space-y-4 p-4 bg-white border border-zinc-100 rounded-2xl shadow-sm">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Monto Pagado</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">$</span>
                          <input
                            type="number"
                            placeholder="0.00"
                            className="w-full pl-8 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-black"
                            value={montoPagado}
                            onChange={(e) => setMontoPagado(e.target.value)}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Método del Pago Parcial</label>
                        <select
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold"
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
                    <div className="space-y-4 p-4 bg-white border border-zinc-100 rounded-2xl shadow-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <CreditCard className="w-4 h-4 text-zinc-400" />
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Datos del Cheque</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Banco</label>
                          <input
                            type="text"
                            value={chequeData.banco}
                            onChange={(e) => setChequeData({ ...chequeData, banco: e.target.value })}
                            className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold"
                            placeholder="Ej: Banco Nación"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">N° Cheque</label>
                          <input
                            type="text"
                            value={chequeData.numero_cheque}
                            onChange={(e) => setChequeData({ ...chequeData, numero_cheque: e.target.value })}
                            className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold"
                            placeholder="00000000"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Vencimiento</label>
                          <input
                            type="date"
                            value={chequeData.fecha_vencimiento}
                            onChange={(e) => setChequeData({ ...chequeData, fecha_vencimiento: e.target.value })}
                            className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Importe</label>
                          <input
                            type="number"
                            value={chequeData.importe}
                            onChange={(e) => setChequeData({ ...chequeData, importe: e.target.value })}
                            className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-black"
                            placeholder={total.toFixed(2)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {isExceedingLimit && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 text-red-600 rounded-2xl text-[11px] font-bold border border-red-100 animate-pulse">
                      <AlertCircle size={20} />
                      El cliente está excediendo su límite de crédito.
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5 tracking-widest">Observaciones</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Notas adicionales..."
                      className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-medium shadow-sm min-h-[80px] resize-none"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-200">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-zinc-500 font-bold text-xs uppercase tracking-widest">Total a cobrar</span>
                    <span className="text-4xl font-black text-zinc-900 font-mono tracking-tighter">${total.toFixed(2)}</span>
                  </div>
                  
                  {metodoPago === 'mixto' && parseFloat(montoPagado) > 0 && (
                    <div className="flex justify-between items-center text-[10px] font-black text-red-600 uppercase tracking-widest">
                      <span>Saldo a Cta Cte:</span>
                      <span>${(total - (parseFloat(montoPagado) || 0)).toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {hasPermission('sales', 'create') && (
                  <button
                    disabled={cart.length === 0 || (metodoPago === 'mixto' && !montoPagado)}
                    onClick={handleConfirmOrder}
                    className="w-full py-5 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-2xl shadow-zinc-200"
                  >
                    <CheckCircle2 size={24} />
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
                <div className="bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm flex items-center gap-6">
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                    <TrendingDown size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Total Ventas Filtradas</p>
                    <p className="text-3xl font-black text-zinc-900 font-mono tracking-tighter">
                      ${filteredSalesHistory.reduce((acc, sale) => acc + sale.total, 0).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-emerald-600 font-bold uppercase">Monto acumulado</p>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm flex items-center gap-6">
                  <div className="w-16 h-16 bg-zinc-900 text-white rounded-2xl flex items-center justify-center shrink-0">
                    <History size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Cantidad de Operaciones</p>
                    <p className="text-3xl font-black text-zinc-900 font-mono tracking-tighter">{filteredSalesHistory.length}</p>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">Ventas encontradas</p>
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

              <div className="bg-white rounded-3xl border border-zinc-200 shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-50/50">
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">ID</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Forma de Pago</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {filteredSalesHistory.map((sale: any) => (
                        <tr key={sale.id} className="hover:bg-zinc-50/50 transition-colors group">
                          <td className="px-8 py-5 text-xs font-mono text-zinc-400">#{sale.id}</td>
                          <td className="px-8 py-5 text-xs text-zinc-600">
                            {new Date(sale.fecha).toLocaleDateString()} <span className="text-zinc-400 ml-1">{new Date(sale.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </td>
                          <td className="px-8 py-5">
                            <p className="text-sm font-bold text-zinc-900">{sale.nombre_cliente}</p>
                            <p className="text-[10px] text-zinc-400 uppercase font-bold">ID Cliente: {sale.cliente_id}</p>
                          </td>
                          <td className="px-8 py-5">
                            <span className="text-[10px] font-bold uppercase bg-zinc-100 text-zinc-600 px-3 py-1 rounded-full border border-zinc-200">
                              {sale.metodo_pago}
                            </span>
                          </td>
                          <td className="px-8 py-5 text-sm font-black text-zinc-900 font-mono text-right">
                            ${sale.total.toFixed(2)}
                          </td>
                          <td className="px-8 py-5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              {hasPermission('sales', 'view') && (
                                <button 
                                  onClick={() => fetchSaleDetails(sale.id)}
                                  className="p-2.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                                  title="Ver Detalle"
                                >
                                  <Eye size={18} />
                                </button>
                              )}
                              {hasPermission('sales', 'view') && (
                                <button 
                                  onClick={() => handleDownloadReceipt(sale.id)}
                                  disabled={downloadingSaleId === sale.id}
                                  className="p-2.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all disabled:opacity-50"
                                  title="Descargar PDF"
                                >
                                  {downloadingSaleId === sale.id ? (
                                    <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <FileDown size={18} />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredSalesHistory.length === 0 && (
                    <div className="p-24 text-center text-zinc-400">
                      <History size={64} className="mx-auto mb-4 opacity-10" />
                      <p className="text-lg font-medium">No se encontraron ventas con los filtros aplicados</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
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
                <div className="bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm flex items-center gap-6">
                  <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center shrink-0">
                    <DollarSign size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Deuda General</p>
                    <p className="text-3xl font-black text-zinc-900 font-mono tracking-tighter">${saldosSummary.totalDebt.toFixed(2)}</p>
                    <p className="text-[10px] text-red-600 font-bold uppercase">Total por cobrar</p>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm flex items-center gap-6">
                  <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
                    <Users size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Clientes con Deuda</p>
                    <p className="text-3xl font-black text-zinc-900 font-mono tracking-tighter">{saldosSummary.customersWithDebt}</p>
                    <p className="text-[10px] text-amber-600 font-bold uppercase">Cuentas activas</p>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm flex items-center gap-6">
                  <div className="w-16 h-16 bg-zinc-900 text-white rounded-2xl flex items-center justify-center shrink-0">
                    <History size={32} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Ventas Pendientes</p>
                    <p className="text-3xl font-black text-zinc-900 font-mono tracking-tighter">{saldosSummary.pendingSalesCount}</p>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">Operaciones sin saldar</p>
                  </div>
                </div>
              </div>

              {/* Saldos List */}
              <div className="bg-white rounded-3xl border border-zinc-200 shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-50/50">
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total Adeudado</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Última Compra</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Estado</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {saldosList.map((entry: any) => (
                        <tr key={entry.id} className="hover:bg-zinc-50/50 transition-colors group">
                          <td className="px-8 py-5">
                            <button 
                              onClick={() => setSelectedCustomerForSaldos(entry)}
                              className="text-left group-hover:translate-x-1 transition-transform"
                            >
                              <p className="text-sm font-bold text-zinc-900 group-hover:text-emerald-600 transition-colors">{entry.nombre}</p>
                              <p className="text-[10px] text-zinc-400 uppercase font-bold">ID: {entry.id}</p>
                            </button>
                          </td>
                          <td className="px-8 py-5 text-right">
                            <p className="text-lg font-black text-red-600 font-mono tracking-tighter">${entry.totalAdeudado.toFixed(2)}</p>
                          </td>
                          <td className="px-8 py-5 text-xs text-zinc-600">
                            {new Date(entry.ultimaCompra).toLocaleDateString()}
                          </td>
                          <td className="px-8 py-5 text-center">
                            <span className="text-[9px] font-black uppercase px-3 py-1 rounded-full border bg-red-50 text-red-600 border-red-100">
                              Con Deuda
                            </span>
                          </td>
                          <td className="px-8 py-5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button 
                                onClick={() => setSelectedCustomerForSaldos(entry)}
                                className="p-2.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                                title="Ver Ventas Pendientes"
                              >
                                <Eye size={18} />
                              </button>
                              <button 
                                onClick={() => setShowCustomerFichaId(entry.id)}
                                className="p-2.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                                title="Ver Ficha Cliente"
                              >
                                <ArrowRight size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {saldosList.length === 0 && (
                    <div className="p-24 text-center text-zinc-400">
                      <CheckCircle2 size={64} className="mx-auto mb-4 opacity-10 text-emerald-500" />
                      <p className="text-lg font-medium">¡Excelente! No hay saldos pendientes por cobrar</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Success Modal */}
      {showSuccessModal && lastSaleData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl sm:rounded-[40px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 sm:p-10 text-center">
              <div className="w-16 h-16 sm:w-24 sm:h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-inner">
                <CheckCircle2 size={32} className="sm:hidden" />
                <CheckCircle2 size={48} className="hidden sm:block" />
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-zinc-900 mb-2 sm:mb-3 tracking-tight">¡Venta Exitosa!</h3>
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
                    onClick={() => generateSaleReceipt(lastSaleData)}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100"
                  >
                    <Download size={20} />
                    Descargar Comprobante
                  </button>
                )}
                <button 
                  onClick={() => setShowSuccessModal(false)}
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
      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl sm:rounded-[40px] w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[95vh]">
            <div className="p-4 sm:p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-900 text-white shrink-0">
              <div>
                <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight">Detalle #{selectedSale.numero_venta || selectedSale.id}</h3>
                <p className="text-[10px] sm:text-xs text-white/60 font-medium">{selectedSale.fecha ? new Date(selectedSale.fecha).toLocaleString() : ''}</p>
              </div>
              <button 
                onClick={() => setSelectedSale(null)}
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
                      selectedSale.estado === 'Pagada' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                      selectedSale.estado === 'Parcialmente Pagada' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                      'bg-red-50 text-red-600 border-red-100'
                    }`}>
                      {selectedSale.estado}
                    </span>
                  </div>
                  <p className="text-[10px] sm:text-xs text-zinc-500 font-bold mt-1">Pagado: ${selectedSale.monto_pagado.toFixed(2)}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Productos Vendidos</h4>
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {selectedSale.items.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between p-3 sm:p-4 bg-zinc-50 rounded-xl sm:rounded-2xl border border-zinc-100 group hover:bg-white hover:shadow-md transition-all">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-lg sm:rounded-xl flex items-center justify-center text-zinc-400 border border-zinc-100 group-hover:bg-zinc-900 group-hover:text-white transition-all shrink-0">
                          <Package size={16} className="sm:hidden" />
                          <Package size={20} className="hidden sm:block" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-zinc-900 truncate">{item.product_name}</p>
                          <p className="text-[9px] sm:text-[10px] text-zinc-400 uppercase font-bold tracking-wider">{item.company}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] sm:text-xs font-bold text-zinc-500">{item.cantidad} x ${item.precio_venta.toFixed(2)}</p>
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
                {selectedSale.monto_pendiente > 0 && (
                  <div className="sm:text-right">
                    <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">Saldo Pendiente</p>
                    <p className="text-xl sm:text-2xl font-black text-red-500 font-mono tracking-tighter">${selectedSale.monto_pendiente.toFixed(2)}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 sm:p-8 bg-zinc-50 border-t border-zinc-100 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center shrink-0">
              {hasPermission('sales', 'view') && (
                <button 
                  onClick={() => generateSaleReceipt(selectedSale, businessSettings)}
                  className="flex items-center justify-center gap-3 px-6 sm:px-8 py-3 bg-emerald-600 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 text-sm"
                >
                  <Download size={18} />
                  Descargar PDF
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl sm:rounded-[40px] w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[95vh]">
            <div className="p-4 sm:p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-900 text-white shrink-0">
              <div>
                <h3 className="text-lg sm:text-xl font-black tracking-tight">Ventas Pendientes</h3>
                <p className="text-[10px] sm:text-xs text-white/60 uppercase font-bold tracking-widest truncate max-w-[200px] sm:max-w-none">{selectedCustomerForSaldos.nombre}</p>
              </div>
              <button 
                onClick={() => setSelectedCustomerForSaldos(null)}
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

              <div className="bg-white rounded-2xl sm:rounded-3xl border border-zinc-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="bg-zinc-50/50">
                        <th className="px-4 sm:px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                        <th className="px-4 sm:px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Venta</th>
                        <th className="px-4 sm:px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Total</th>
                        <th className="px-4 sm:px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Pagado</th>
                        <th className="px-4 sm:px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {selectedCustomerForSaldos.ventas.map((sale: any) => (
                        <tr key={sale.id} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-4 sm:px-6 py-4 text-xs text-zinc-600">
                            {new Date(sale.fecha).toLocaleDateString()}
                          </td>
                          <td className="px-4 sm:px-6 py-4 text-xs font-mono text-zinc-400">#{sale.numero_venta || sale.id}</td>
                          <td className="px-4 sm:px-6 py-4 text-xs font-bold text-zinc-900 text-right">${sale.total.toFixed(2)}</td>
                          <td className="px-4 sm:px-6 py-4 text-xs font-bold text-emerald-600 text-right">${sale.monto_pagado.toFixed(2)}</td>
                          <td className="px-4 sm:px-6 py-4 text-xs font-black text-red-600 font-mono text-right">${sale.monto_pendiente.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-emerald-600 text-white">
              <h3 className="text-xl font-black tracking-tight">Registrar Pago</h3>
              <button 
                onClick={() => setShowQuickPaymentModal(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleQuickPayment} className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Monto a Cobrar</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-mono text-lg">$</span>
                  <input
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
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Método de Pago</label>
                <div className="grid grid-cols-2 gap-2">
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
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Observaciones (Opcional)</label>
                <textarea
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
