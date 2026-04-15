import React, { useState, useEffect, useMemo } from 'react';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Calendar, 
  Search, 
  Download, 
  Plus, 
  Filter,
  DollarSign,
  CreditCard,
  FileText,
  Clock,
  History,
  User,
  CheckCircle2,
  AlertCircle,
  X,
  Eye
} from 'lucide-react';
import { getSocket } from '../utils/socket';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

type Movimiento = {
  id: number;
  fecha: string;
  tipo: 'ingreso' | 'egreso';
  origen: 'venta' | 'pago_cc' | 'egreso_manual' | 'ajuste';
  cliente_id: number | null;
  venta_id: number | null;
  descripcion: string;
  categoria?: string;
  forma_pago: string;
  monto: number;
  usuario: string;
  nombre_cliente?: string;
};

export default function FinanceModule() {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'resumen' | 'caja' | 'egresos' | 'movimientos' | 'cheques'>('resumen');
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cheques, setCheques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showEgresoModal, setShowEgresoModal] = useState(false);
  const [movimientosSearch, setMovimientosSearch] = useState('');
  const [movimientosTypeFilter, setMovimientosTypeFilter] = useState<'todos' | 'ingreso' | 'egreso'>('todos');
  const [movimientosDateFilter, setMovimientosDateFilter] = useState('');
  const [chequesSearch, setChequesSearch] = useState('');
  const [chequesEstadoFilter, setChequesEstadoFilter] = useState('todos');
  const [chequesVencimientoFilter, setChequesVencimientoFilter] = useState('');
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [selectedCheque, setSelectedCheque] = useState<any>(null);
  const [showChequeDetailModal, setShowChequeDetailModal] = useState(false);
  const [egresoForm, setEgresoForm] = useState({
    monto: '',
    descripcion: '',
    categoria: 'Otros',
    forma_pago: 'efectivo',
    fecha: new Date().toISOString().split('T')[0],
    cheque_id: '',
    proveedor_id: ''
  });

  const fetchMovimientos = async () => {
    try {
      const res = await apiFetch('/api/finanzas/movimientos');
      const body = await res.json();
      const data = unwrapResponse(body);
      setMovimientos(data);
    } catch (error) {
      console.error("Error fetching movements:", error);
    }
  };

  const fetchCheques = async () => {
    try {
      const res = await apiFetch('/api/finanzas/cheques');
      const body = await res.json();
      const data = unwrapResponse(body);
      setCheques(data);
    } catch (error) {
      console.error("Error fetching cheques:", error);
    }
  };

  const fetchProveedores = async () => {
    try {
      const res = await apiFetch('/api/proveedores');
      const body = await res.json();
      const data = unwrapResponse(body);
      setProveedores(data);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchMovimientos(), fetchCheques(), fetchProveedores()]);
      setLoading(false);
    };
    loadData();

    const socket = getSocket();
    socket.on('financial_movement_created', fetchMovimientos);
    socket.on('sale_confirmed', () => {
      fetchMovimientos();
      fetchCheques();
    });
    return () => {
      socket.off('financial_movement_created');
      socket.off('sale_confirmed');
    };
  }, []);

  const handleEgresoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/finanzas/egresos', {
        method: 'POST',
        body: JSON.stringify({
          ...egresoForm,
          monto: parseFloat(egresoForm.monto)
        })
      });
      
      const body = await res.json();
      unwrapResponse(body);
      
      setShowEgresoModal(false);
      setEgresoForm({
        monto: '',
        descripcion: '',
        categoria: 'Otros',
        forma_pago: 'efectivo',
        fecha: new Date().toISOString().split('T')[0],
        cheque_id: '',
        proveedor_id: ''
      });
      fetchMovimientos();
      fetchCheques();
    } catch (error) {
      console.error("Error saving expense:", error);
      alert("No se pudo registrar el egreso");
    }
  };

  const stats = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStr = now.toISOString().slice(0, 7); // YYYY-MM

    const ingresosDia = movimientos
      .filter(m => m.tipo === 'ingreso' && m.fecha.startsWith(todayStr))
      .reduce((acc, m) => acc + m.monto, 0);
    
    const egresosDia = movimientos
      .filter(m => m.tipo === 'egreso' && m.fecha.startsWith(todayStr))
      .reduce((acc, m) => acc + m.monto, 0);

    const ingresosMes = movimientos
      .filter(m => m.tipo === 'ingreso' && m.fecha.startsWith(monthStr))
      .reduce((acc, m) => acc + m.monto, 0);
    
    const egresosMes = movimientos
      .filter(m => m.tipo === 'egreso' && m.fecha.startsWith(monthStr))
      .reduce((acc, m) => acc + m.monto, 0);

    return {
      ingresosDia,
      egresosDia,
      resultadoDia: ingresosDia - egresosDia,
      ingresosMes,
      egresosMes,
      resultadoMes: ingresosMes - egresosMes
    };
  }, [movimientos]);

  const cajaDiaria = useMemo(() => {
    return movimientos.filter(m => m.fecha.startsWith(selectedDate));
  }, [movimientos, selectedDate]);

  const cajaStats = useMemo(() => {
    const ingresos = cajaDiaria.filter(m => m.tipo === 'ingreso');
    const egresos = cajaDiaria.filter(m => m.tipo === 'egreso');

    const efectivo = ingresos
      .filter(m => m.forma_pago.toLowerCase() === 'efectivo')
      .reduce((acc, m) => acc + m.monto, 0);
    
    const transferencia = ingresos
      .filter(m => m.forma_pago.toLowerCase() === 'transferencia')
      .reduce((acc, m) => acc + m.monto, 0);
    
    const mercadoPago = ingresos
      .filter(m => m.forma_pago.toLowerCase() === 'mercado_pago')
      .reduce((acc, m) => acc + m.monto, 0);

    const totalIngresos = ingresos.reduce((acc, m) => acc + m.monto, 0);
    const totalEgresos = egresos.reduce((acc, m) => acc + m.monto, 0);

    return {
      efectivo,
      transferencia,
      mercadoPago,
      totalIngresos,
      totalEgresos,
      resultadoNeto: totalIngresos - totalEgresos
    };
  }, [cajaDiaria]);

  const egresosList = useMemo(() => {
    return movimientos.filter(m => m.tipo === 'egreso');
  }, [movimientos]);

  const handleUpdateChequeStatus = async (id: number, nuevoEstado: string) => {
    try {
      const res = await apiFetch(`/api/finanzas/cheques/${id}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado })
      });
      
      const body = await res.json();
      unwrapResponse(body);
      fetchCheques();
    } catch (error) {
      console.error("Error updating cheque status:", error);
      alert("No se pudo actualizar el estado del cheque");
    }
  };

  const filteredMovimientos = useMemo(() => {
    return movimientos.filter(m => {
      const matchesSearch = !movimientosSearch || 
        m.descripcion.toLowerCase().includes(movimientosSearch.toLowerCase()) ||
        (m.nombre_cliente && m.nombre_cliente.toLowerCase().includes(movimientosSearch.toLowerCase()));
      
      const matchesType = movimientosTypeFilter === 'todos' || m.tipo === movimientosTypeFilter;
      
      const matchesDate = !movimientosDateFilter || m.fecha.startsWith(movimientosDateFilter);
      
      return matchesSearch && matchesType && matchesDate;
    });
  }, [movimientos, movimientosSearch, movimientosTypeFilter, movimientosDateFilter]);

  const filteredCheques = useMemo(() => {
    return cheques.filter(c => {
      const matchesSearch = !chequesSearch || 
        c.numero_cheque.toLowerCase().includes(chequesSearch.toLowerCase()) ||
        (c.nombre_cliente && c.nombre_cliente.toLowerCase().includes(chequesSearch.toLowerCase())) ||
        c.banco.toLowerCase().includes(chequesSearch.toLowerCase());
      
      const matchesEstado = chequesEstadoFilter === 'todos' || c.estado === chequesEstadoFilter;
      
      const matchesVencimiento = !chequesVencimientoFilter || c.fecha_vencimiento === chequesVencimientoFilter;
      
      return matchesSearch && matchesEstado && matchesVencimiento;
    });
  }, [cheques, chequesSearch, chequesEstadoFilter, chequesVencimientoFilter]);

  const chequesProximosAVencer = useMemo(() => {
    const hoy = new Date();
    const limite = new Date();
    limite.setDate(hoy.getDate() + 7);

    return cheques.filter(c => {
      if (c.estado !== 'en_cartera') return false;
      const vencimiento = new Date(c.fecha_vencimiento);
      return vencimiento >= hoy && vencimiento <= limite;
    });
  }, [cheques]);

  return (
    <div className="h-full flex flex-col bg-zinc-50">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 p-4 sm:p-8 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">FINANZAS</h2>
            <p className="text-zinc-500 text-xs sm:text-sm font-medium">Gestión de caja y movimientos financieros</p>
          </div>
          <div className="flex gap-3">
            {hasPermission('current_accounts', 'create') && (
              <button 
                onClick={() => setShowEgresoModal(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-100 text-xs sm:text-sm"
              >
                <Plus size={20} />
                Registrar Egreso
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-zinc-100 rounded-2xl w-full sm:w-fit overflow-x-auto custom-scrollbar no-scrollbar">
          {[
            { id: 'resumen', label: 'Resumen', icon: Wallet },
            { id: 'caja', label: 'Caja Diaria', icon: Clock },
            { id: 'egresos', label: 'Egresos', icon: TrendingDown },
            { id: 'movimientos', label: 'Movimientos', icon: History },
            { id: 'cheques', label: 'Cheques', icon: CreditCard }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              {/* @ts-ignore */}
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
        {activeTab === 'resumen' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Daily Stats Grid */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Resumen del Día</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                <div className="bg-white p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] border border-zinc-200 shadow-sm">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-4">
                    <ArrowUpRight size={24} />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Ingresos del Día</p>
                  <p className="text-2xl sm:text-3xl font-black text-zinc-900 font-mono tracking-tighter">${stats.ingresosDia.toFixed(2)}</p>
                </div>
                <div className="bg-white p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] border border-zinc-200 shadow-sm">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mb-4">
                    <ArrowDownLeft size={24} />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Egresos del Día</p>
                  <p className="text-2xl sm:text-3xl font-black text-zinc-900 font-mono tracking-tighter">${stats.egresosDia.toFixed(2)}</p>
                </div>
                <div className={`p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] shadow-2xl ${stats.resultadoDia >= 0 ? 'bg-zinc-900 shadow-zinc-200' : 'bg-red-900 shadow-red-200'}`}>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/10 rounded-2xl flex items-center justify-center text-white mb-4">
                    <DollarSign size={24} />
                  </div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Resultado del Día</p>
                  <p className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tighter">${stats.resultadoDia.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Monthly Stats Grid */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Resumen del Mes</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                <div className="bg-white p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] border border-zinc-200 shadow-sm">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-4">
                    <TrendingUp size={24} />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Ingresos del Mes</p>
                  <p className="text-2xl sm:text-3xl font-black text-zinc-900 font-mono tracking-tighter">${stats.ingresosMes.toFixed(2)}</p>
                </div>
                <div className="bg-white p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] border border-zinc-200 shadow-sm">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mb-4">
                    <TrendingDown size={24} />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Egresos del Mes</p>
                  <p className="text-2xl sm:text-3xl font-black text-zinc-900 font-mono tracking-tighter">${stats.egresosMes.toFixed(2)}</p>
                </div>
                <div className={`p-6 sm:p-8 rounded-[24px] sm:rounded-[32px] shadow-2xl ${stats.resultadoMes >= 0 ? 'bg-emerald-600 shadow-emerald-100' : 'bg-red-600 shadow-red-100'}`}>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 rounded-2xl flex items-center justify-center text-white mb-4">
                    <Wallet size={24} />
                  </div>
                  <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">Resultado del Mes</p>
                  <p className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tighter">${stats.resultadoMes.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Recent Activity in Resumen */}
            <div className="bg-white rounded-[24px] sm:rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
              <div className="p-6 sm:p-8 border-b border-zinc-100 flex items-center justify-between">
                <h3 className="text-lg sm:text-xl font-black tracking-tight">Actividad Reciente</h3>
                <button 
                  onClick={() => setActiveTab('movimientos')}
                  className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900 transition-colors"
                >
                  Ver Todo
                </button>
              </div>
              <div className="divide-y divide-zinc-50">
                {movimientos.slice(0, 5).map((m) => (
                  <div key={m.id} className="p-4 sm:p-6 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center ${
                        m.tipo === 'ingreso' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                      }`}>
                        {m.tipo === 'ingreso' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold text-zinc-900 line-clamp-1">{m.descripcion}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{m.forma_pago}</span>
                          <span className="text-zinc-200">•</span>
                          <span className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{new Date(m.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>
                    <p className={`text-sm sm:text-lg font-black font-mono ${
                      m.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {m.tipo === 'ingreso' ? '+' : '-'}${m.monto.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'caja' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h3 className="text-2xl font-black tracking-tight">Caja Diaria</h3>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input 
                    type="date" 
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900 shadow-sm"
                  />
                </div>
                <div className="px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
              </div>
            </div>

            {/* Caja Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Efectivo</p>
                <p className="text-xl font-black text-zinc-900 font-mono">${cajaStats.efectivo.toFixed(2)}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Transferencia</p>
                <p className="text-xl font-black text-zinc-900 font-mono">${cajaStats.transferencia.toFixed(2)}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Mercado Pago</p>
                <p className="text-xl font-black text-zinc-900 font-mono">${cajaStats.mercadoPago.toFixed(2)}</p>
              </div>
              <div className={`p-6 rounded-3xl shadow-lg ${cajaStats.resultadoNeto >= 0 ? 'bg-emerald-600' : 'bg-red-600'} text-white`}>
                <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">Resultado Neto</p>
                <p className="text-xl font-black font-mono">${cajaStats.resultadoNeto.toFixed(2)}</p>
              </div>
            </div>
            
            <div className="bg-white rounded-[24px] sm:rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-zinc-50/50">
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Hora</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Descripción</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Forma de Pago</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Ingreso</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Egreso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {cajaDiaria.length > 0 ? cajaDiaria.map((m) => (
                      <tr key={m.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 sm:px-8 py-5 text-xs text-zinc-500 font-mono">
                          {new Date(m.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 sm:px-8 py-5">
                          <p className="text-xs sm:text-sm font-bold text-zinc-900">{m.descripcion}</p>
                          <p className="text-[9px] sm:text-[10px] text-zinc-400 uppercase font-bold tracking-wider">{m.origen.replace('_', ' ')}</p>
                        </td>
                        <td className="px-4 sm:px-8 py-5 text-center">
                          <span className="text-[9px] sm:text-[10px] font-bold uppercase bg-zinc-100 text-zinc-600 px-2 sm:px-3 py-1 rounded-full border border-zinc-200">
                            {m.forma_pago}
                          </span>
                        </td>
                        <td className="px-4 sm:px-8 py-5 text-right font-mono font-black text-emerald-600 text-xs sm:text-sm">
                          {m.tipo === 'ingreso' ? `$${m.monto.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-4 sm:px-8 py-5 text-right font-mono font-black text-red-600 text-xs sm:text-sm">
                          {m.tipo === 'egreso' ? `$${m.monto.toFixed(2)}` : '-'}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="px-8 py-20 text-center text-zinc-400">
                          No hay movimientos registrados para esta fecha.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-zinc-900 text-white">
                    <tr>
                      <td colSpan={3} className="px-4 sm:px-8 py-6 text-xs sm:text-sm font-black uppercase tracking-widest">Totales del Día</td>
                      <td className="px-4 sm:px-8 py-6 text-right text-lg sm:text-xl font-black font-mono text-emerald-400">
                        +${cajaStats.totalIngresos.toFixed(2)}
                      </td>
                      <td className="px-4 sm:px-8 py-6 text-right text-lg sm:text-xl font-black font-mono text-red-400">
                        -${cajaStats.totalEgresos.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cheques' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h3 className="text-2xl font-black tracking-tight">Cheques en cartera</h3>
              <div className="flex items-center gap-3">
                <div className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                  {cheques.filter(c => c.estado === 'en_cartera').length} En Cartera
                </div>
                <div className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">
                  Total: ${cheques.reduce((acc, c) => acc + c.importe, 0).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Alertas de Vencimiento */}
            {chequesProximosAVencer.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 space-y-4">
                <div className="flex items-center gap-3 text-amber-800">
                  <AlertCircle size={24} className="animate-pulse" />
                  <h4 className="text-sm font-black uppercase tracking-widest">Cheques próximos a vencer (7 días)</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {chequesProximosAVencer.map(c => (
                    <div key={c.id} className="bg-white/50 border border-amber-100 rounded-2xl p-4 flex justify-between items-center">
                      <div>
                        <p className="text-xs font-black text-zinc-900">{c.banco} - N° {c.numero_cheque}</p>
                        <p className="text-[10px] font-bold text-amber-600 uppercase mt-1">Vence: {new Date(c.fecha_vencimiento).toLocaleDateString()}</p>
                      </div>
                      <p className="text-sm font-black text-zinc-900 font-mono">${c.importe.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filtros y Búsqueda */}
            <div className="flex flex-wrap gap-4 items-center bg-white p-6 rounded-[32px] border border-zinc-200 shadow-sm">
              <div className="relative flex-1 min-w-[300px]">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Buscar por cliente, banco o número de cheque..."
                  value={chequesSearch}
                  onChange={(e) => setChequesSearch(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-zinc-900 transition-all"
                />
              </div>
              
              <div className="flex gap-3">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input 
                    type="date" 
                    value={chequesVencimientoFilter}
                    onChange={(e) => setChequesVencimientoFilter(e.target.value)}
                    className="pl-10 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>

                <select
                  value={chequesEstadoFilter}
                  onChange={(e) => setChequesEstadoFilter(e.target.value)}
                  className="px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900"
                >
                  <option value="todos">Todos los Estados</option>
                  <option value="en_cartera">En Cartera</option>
                  <option value="depositado">Depositado</option>
                  <option value="entregado_proveedor">Entregado a Prov.</option>
                  <option value="cobrado">Cobrado</option>
                  <option value="rechazado">Rechazado</option>
                </select>

                {(chequesSearch || chequesEstadoFilter !== 'todos' || chequesVencimientoFilter) && (
                  <button 
                    onClick={() => {
                      setChequesSearch('');
                      setChequesEstadoFilter('todos');
                      setChequesVencimientoFilter('');
                    }}
                    className="px-6 py-3 bg-zinc-100 text-zinc-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[24px] sm:rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead>
                    <tr className="bg-zinc-50/50">
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Banco / N°</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Vencimiento</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Importe</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Estado</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {filteredCheques.length > 0 ? filteredCheques.map((cheque) => (
                      <tr key={cheque.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 sm:px-8 py-5">
                          <p className="text-xs sm:text-sm font-black text-zinc-900">{cheque.banco}</p>
                          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-0.5">N° {cheque.numero_cheque}</p>
                        </td>
                        <td className="px-4 sm:px-8 py-5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center text-[10px] font-bold text-zinc-600">
                              {cheque.nombre_cliente?.charAt(0)}
                            </div>
                            <p className="text-[10px] sm:text-xs font-bold text-zinc-900">{cheque.nombre_cliente}</p>
                          </div>
                        </td>
                        <td className="px-4 sm:px-8 py-5">
                          <p className={`text-[10px] sm:text-xs font-mono font-black ${
                            new Date(cheque.fecha_vencimiento) < new Date() && cheque.estado === 'en_cartera' 
                              ? 'text-red-600' 
                              : 'text-zinc-600'
                          }`}>
                            {new Date(cheque.fecha_vencimiento).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="px-4 sm:px-8 py-5 text-right font-mono font-black text-zinc-900 text-xs sm:text-sm">
                          ${cheque.importe.toFixed(2)}
                        </td>
                        <td className="px-4 sm:px-8 py-5 text-center">
                          <span className={`text-[8px] sm:text-[9px] font-black uppercase px-2 sm:px-3 py-1 rounded-full border ${
                            cheque.estado === 'en_cartera' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                            cheque.estado === 'depositado' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                            cheque.estado === 'cobrado' ? 'bg-zinc-50 text-zinc-600 border-zinc-100' :
                            cheque.estado === 'rechazado' ? 'bg-red-50 text-red-600 border-red-100' :
                            'bg-amber-50 text-amber-600 border-amber-100'
                          }`}>
                            {cheque.estado.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 sm:px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-1 sm:gap-2">
                            <button
                              onClick={() => {
                                setSelectedCheque(cheque);
                                setShowChequeDetailModal(true);
                              }}
                              className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                              title="Ver detalles"
                            >
                              <Eye size={14} />
                            </button>
                            {hasPermission('current_accounts', 'edit') ? (
                              <select 
                                className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest bg-zinc-100 border-none rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 outline-none focus:ring-2 focus:ring-zinc-900 cursor-pointer"
                                value={cheque.estado}
                                onChange={(e) => handleUpdateChequeStatus(cheque.id, e.target.value)}
                              >
                                <option value="en_cartera">En Cartera</option>
                                <option value="depositado">Depositado</option>
                                <option value="entregado_proveedor">Entregado a Prov.</option>
                                <option value="cobrado">Cobrado</option>
                                <option value="rechazado">Rechazado</option>
                              </select>
                            ) : (
                              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest bg-zinc-50 text-zinc-400 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl border border-zinc-100">
                                {cheque.estado.replace('_', ' ')}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="px-8 py-20 text-center text-zinc-400 italic">
                          No se encontraron cheques con los filtros aplicados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'egresos' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <h3 className="text-xl sm:text-2xl font-black tracking-tight">Historial de Egresos</h3>
              <div className="w-full sm:w-auto bg-red-50 text-red-600 px-4 sm:px-6 py-2 rounded-2xl font-black text-xs sm:text-sm text-center">
                Total Gastos del Mes: ${stats.egresosMes.toFixed(2)}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {egresosList.map((e) => (
                <div key={e.id} className="bg-white p-5 sm:p-6 rounded-[24px] sm:rounded-[32px] border border-zinc-200 shadow-sm hover:shadow-md transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-10 h-10 bg-red-50 text-red-600 rounded-xl flex items-center justify-center">
                      <TrendingDown size={20} />
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-black text-zinc-900 font-mono">-${e.monto.toFixed(2)}</p>
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded-full border border-zinc-200">
                        {e.categoria || 'Otros'}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-zinc-900 mb-1">{e.descripcion}</p>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                    <Calendar size={12} />
                    {new Date(e.fecha).toLocaleDateString()}
                    <span className="text-zinc-200">•</span>
                    <CreditCard size={12} />
                    {e.forma_pago}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'movimientos' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h3 className="text-2xl font-black tracking-tight">Todos los Movimientos</h3>
              <div className="flex flex-wrap gap-3">
                <div className="relative min-w-[240px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="Buscar por cliente o descripción..."
                    value={movimientosSearch}
                    onChange={(e) => setMovimientosSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-zinc-900 shadow-sm"
                  />
                </div>
                
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input 
                    type="date" 
                    value={movimientosDateFilter}
                    onChange={(e) => setMovimientosDateFilter(e.target.value)}
                    className="pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900 shadow-sm"
                  />
                </div>

                <select
                  value={movimientosTypeFilter}
                  onChange={(e) => setMovimientosTypeFilter(e.target.value as any)}
                  className="px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-900 shadow-sm"
                >
                  <option value="todos">Todos los Tipos</option>
                  <option value="ingreso">Ingresos</option>
                  <option value="egreso">Egresos</option>
                </select>

                {(movimientosSearch || movimientosTypeFilter !== 'todos' || movimientosDateFilter) && (
                  <button 
                    onClick={() => {
                      setMovimientosSearch('');
                      setMovimientosTypeFilter('todos');
                      setMovimientosDateFilter('');
                    }}
                    className="px-4 py-2.5 bg-zinc-100 text-zinc-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[24px] sm:rounded-[40px] border border-zinc-200 shadow-xl overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead>
                    <tr className="bg-zinc-50/50">
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Tipo</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Origen</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Descripción</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Forma de Pago</th>
                      <th className="px-4 sm:px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {filteredMovimientos.length > 0 ? filteredMovimientos.map((m) => (
                      <tr key={m.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 sm:px-8 py-5">
                          <p className="text-xs text-zinc-900 font-bold">{new Date(m.fecha).toLocaleDateString()}</p>
                          <p className="text-[10px] text-zinc-400 font-mono">{new Date(m.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </td>
                        <td className="px-4 sm:px-8 py-5">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                            m.tipo === 'ingreso' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'
                          }`}>
                            {m.tipo}
                          </span>
                        </td>
                        <td className="px-4 sm:px-8 py-5">
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider bg-zinc-100 px-2 py-1 rounded-lg">
                            {m.origen.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 sm:px-8 py-5">
                          {m.nombre_cliente ? (
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center text-[10px] font-bold text-zinc-600">
                                {m.nombre_cliente.charAt(0)}
                              </div>
                              <p className="text-xs font-bold text-zinc-900">{m.nombre_cliente}</p>
                            </div>
                          ) : (
                            <span className="text-zinc-300 text-[10px] font-bold uppercase tracking-widest">N/A</span>
                          )}
                        </td>
                        <td className="px-4 sm:px-8 py-5">
                          <p className="text-sm font-bold text-zinc-900 line-clamp-1">{m.descripcion}</p>
                        </td>
                        <td className="px-4 sm:px-8 py-5 text-center">
                          <span className="text-[10px] font-bold uppercase bg-zinc-100 text-zinc-600 px-3 py-1 rounded-full border border-zinc-200">
                            {m.forma_pago}
                          </span>
                        </td>
                        <td className={`px-4 sm:px-8 py-5 text-right font-mono font-black ${
                          m.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {m.tipo === 'ingreso' ? '+' : '-'}${m.monto.toFixed(2)}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={7} className="px-8 py-20 text-center text-zinc-400">
                          No se encontraron movimientos con los filtros seleccionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cheque Detail Modal */}
      {showChequeDetailModal && selectedCheque && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-[32px] sm:rounded-[40px] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 max-h-[95vh] flex flex-col">
            <div className="p-6 sm:p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-900 text-white shrink-0">
              <div>
                <h3 className="text-lg sm:text-xl font-black tracking-tight">Detalles del Cheque</h3>
                <p className="text-zinc-400 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mt-1">
                  N° {selectedCheque.numero_cheque} • {selectedCheque.banco}
                </p>
              </div>
              <button 
                onClick={() => setShowChequeDetailModal(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={20} sm:size={24} />
              </button>
            </div>
            
            <div className="p-6 sm:p-8 space-y-6 sm:space-y-8 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-4 sm:gap-8">
                <div>
                  <label className="block text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Importe</label>
                  <p className="text-xl sm:text-2xl font-black text-zinc-900 font-mono">${selectedCheque.importe.toFixed(2)}</p>
                </div>
                <div>
                  <label className="block text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase mb-1 tracking-widest">Estado Actual</label>
                  <span className={`inline-block text-[9px] sm:text-[10px] font-black uppercase px-2 sm:px-3 py-1 rounded-full border mt-1 ${
                    selectedCheque.estado === 'en_cartera' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                    selectedCheque.estado === 'depositado' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                    selectedCheque.estado === 'cobrado' ? 'bg-zinc-50 text-zinc-600 border-zinc-100' :
                    selectedCheque.estado === 'rechazado' ? 'bg-red-50 text-red-600 border-red-100' :
                    'bg-amber-50 text-amber-600 border-amber-100'
                  }`}>
                    {selectedCheque.estado.replace('_', ' ')}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-zinc-50">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente Emisor</span>
                  <div className="text-right">
                    <p className="text-sm font-bold text-zinc-900">{selectedCheque.nombre_cliente}</p>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">ID Cliente: {selectedCheque.cliente_id}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-zinc-50">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Venta Asociada</span>
                  <div className="text-right">
                    {selectedCheque.numero_venta ? (
                      <p className="text-sm font-bold text-zinc-900">Venta N° {selectedCheque.numero_venta}</p>
                    ) : (
                      <p className="text-sm font-bold text-zinc-300 italic">No asociada a venta</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-zinc-50">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Vencimiento</span>
                  <p className="text-sm font-bold text-zinc-900">{new Date(selectedCheque.fecha_vencimiento).toLocaleDateString()}</p>
                </div>

                {selectedCheque.proveedor_id && (
                  <div className="flex items-center justify-between py-3 border-b border-zinc-50">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Entregado a Proveedor</span>
                    <div className="text-right">
                      <p className="text-sm font-bold text-zinc-900">{selectedCheque.nombre_proveedor}</p>
                      {selectedCheque.fecha_entrega && (
                        <p className="text-[10px] text-zinc-400 font-bold uppercase">Fecha: {new Date(selectedCheque.fecha_entrega).toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>
                )}

                {selectedCheque.observaciones && (
                  <div className="pt-2">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-2">Observaciones</span>
                    <div className="bg-zinc-50 p-4 rounded-2xl text-sm text-zinc-600 border border-zinc-100 italic">
                      "{selectedCheque.observaciones}"
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4">
                <button
                  onClick={() => setShowChequeDetailModal(false)}
                  className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20"
                >
                  Cerrar Detalles
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Egreso Modal */}
      {showEgresoModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-[32px] sm:rounded-[40px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 max-h-[95vh] flex flex-col">
            <div className="p-6 sm:p-8 border-b border-zinc-100 flex items-center justify-between bg-red-600 text-white shrink-0">
              <h3 className="text-lg sm:text-xl font-black tracking-tight">Registrar Egreso</h3>
              <button 
                onClick={() => setShowEgresoModal(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-all"
              >
                <X size={20} sm:size={24} />
              </button>
            </div>
            <form onSubmit={handleEgresoSubmit} className="p-6 sm:p-8 space-y-4 sm:space-y-6 overflow-y-auto custom-scrollbar">
              <div>
                <label className="block text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Monto del Gasto</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-mono text-lg">$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    autoFocus
                    className="w-full pl-10 pr-4 py-3 sm:py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-xl sm:text-2xl font-black font-mono"
                    placeholder="0.00"
                    value={egresoForm.monto}
                    onChange={(e) => setEgresoForm({ ...egresoForm, monto: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Descripción / Concepto</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-sm"
                  placeholder="Ej: Pago de luz, Alquiler, Artículos de limpieza..."
                  value={egresoForm.descripcion}
                  onChange={(e) => setEgresoForm({ ...egresoForm, descripcion: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Categoría</label>
                  <select
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-sm font-bold"
                    value={egresoForm.categoria}
                    onChange={(e) => setEgresoForm({ ...egresoForm, categoria: e.target.value })}
                  >
                    <option value="Proveedor">Proveedor</option>
                    <option value="Servicios">Servicios</option>
                    <option value="Impuestos">Impuestos</option>
                    <option value="Sueldos">Sueldos</option>
                    <option value="Otros">Otros</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Forma de Pago</label>
                  <select
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-sm font-bold"
                    value={egresoForm.forma_pago}
                    onChange={(e) => setEgresoForm({ ...egresoForm, forma_pago: e.target.value })}
                  >
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="mercado_pago">Mercado Pago</option>
                    <option value="cheque_en_cartera">Cheque en Cartera</option>
                  </select>
                </div>
              </div>

              {egresoForm.forma_pago === 'cheque_en_cartera' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Seleccionar Cheque</label>
                    <select
                      required
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-sm font-bold"
                      value={egresoForm.cheque_id}
                      onChange={(e) => {
                        const cheque = cheques.find(c => c.id === parseInt(e.target.value));
                        setEgresoForm({ 
                          ...egresoForm, 
                          cheque_id: e.target.value,
                          monto: cheque ? cheque.importe.toString() : egresoForm.monto,
                          descripcion: cheque ? `Pago con Cheque N° ${cheque.numero_cheque} - ${cheque.banco}` : egresoForm.descripcion
                        });
                      }}
                    >
                      <option value="">Seleccione un cheque...</option>
                      {cheques.filter(c => c.estado === 'en_cartera').map(c => (
                        <option key={c.id} value={c.id}>
                          N° {c.numero_cheque} - {c.banco} (${c.importe.toFixed(2)}) - Vence: {new Date(c.fecha_vencimiento).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>

                  {egresoForm.categoria === 'Proveedor' && (
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Proveedor Destino</label>
                      <select
                        required
                        className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-sm font-bold"
                        value={egresoForm.proveedor_id}
                        onChange={(e) => setEgresoForm({ ...egresoForm, proveedor_id: e.target.value })}
                      >
                        <option value="">Seleccione un proveedor...</option>
                        {proveedores.map(p => (
                          <option key={p.id} value={p.id}>{p.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2 tracking-widest">Fecha</label>
                <input
                  type="date"
                  required
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-sm"
                  value={egresoForm.fecha}
                  onChange={(e) => setEgresoForm({ ...egresoForm, fecha: e.target.value })}
                />
              </div>

              <button
                type="submit"
                className="w-full py-5 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-red-700 transition-all shadow-2xl shadow-red-100"
              >
                <CheckCircle2 size={24} />
                Confirmar Egreso
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
