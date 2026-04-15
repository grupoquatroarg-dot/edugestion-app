import React, { useState, useEffect, useMemo } from 'react';
import { Search, UserPlus, User, Phone, Mail, MapPin, MoreVertical, Edit2, Trash2, Plus, X, AlertCircle, Building2, CreditCard, Eye } from 'lucide-react';
import CustomerDetail from './CustomerDetail';
import AddressAutocomplete from './AddressAutocomplete';
import { getSocket } from '../utils/socket';
import { useAuth } from '../contexts/AuthContext';
import { unwrapResponse, apiFetch } from '../utils/api';

const socket = getSocket();

interface Cliente {
  id: number;
  nombre_apellido: string;
  razon_social?: string;
  cuit?: string;
  localidad?: string;
  provincia?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  latitud?: number;
  longitud?: number;
  observaciones?: string;
  tipo_cliente: 'minorista' | 'mayorista';
  lista_precio: string;
  limite_credito: number;
  saldo_cta_cte: number;
  fecha_alta: string;
  activo: boolean;
  tiene_deuda_vencida?: number;
}

export default function CustomerModule() {
  const { hasPermission } = useAuth();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMovementsModalOpen, setIsMovementsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedClienteId, setSelectedClienteId] = useState<number | null>(null);
  const [selectedClienteForMovements, setSelectedClienteForMovements] = useState<Cliente | null>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    nombre_apellido: '',
    razon_social: '',
    cuit: '',
    localidad: '',
    provincia: '',
    telefono: '',
    email: '',
    direccion: '',
    latitud: 0,
    longitud: 0,
    observaciones: '',
    tipo_cliente: 'minorista' as 'minorista' | 'mayorista',
    lista_precio: 'lista1',
    limite_credito: 0
  });

  useEffect(() => {
    fetchClientes();

    socket.on('sale_confirmed', () => {
      fetchClientes();
    });

    return () => {
      socket.off('sale_confirmed');
    };
  }, []);

  const fetchClientes = async () => {
    try {
      const res = await apiFetch('/api/clientes');
      const body = await res.json();
      const data = unwrapResponse(body);
      setClientes(data);
    } catch (error) {
      console.error("Error fetching customers:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredClientes = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    if (!query) return clientes;
    return clientes.filter(c => 
      (c.nombre_apellido || '').toLowerCase().includes(query) ||
      (c.razon_social || '').toLowerCase().includes(query) ||
      (c.localidad || '').toLowerCase().includes(query)
    );
  }, [clientes, searchTerm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingCliente ? `/api/clientes/${editingCliente.id}` : '/api/clientes';
    const method = editingCliente ? 'PUT' : 'POST';

    try {
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(formData)
      });
      
      const body = await res.json();
      unwrapResponse(body);

      fetchClientes();
      closeModal();
    } catch (error) {
      console.error("Error saving customer:", error);
      alert("Error al guardar el cliente");
    }
  };

  const handleDelete = async (id: number) => {
    if (id === 1) {
      alert("No se puede eliminar el cliente por defecto");
      return;
    }
    if (!window.confirm("¿Estás seguro de eliminar este cliente?")) return;

    try {
      const res = await apiFetch(`/api/clientes/${id}`, { method: 'DELETE' });
      const body = await res.json();
      unwrapResponse(body);
      fetchClientes();
    } catch (error) {
      console.error("Error deleting customer:", error);
      alert("Error al eliminar el cliente");
    }
  };

  const openModal = async (cliente?: Cliente) => {
    if (cliente) {
      setEditingCliente(cliente);
      setFormData({
        nombre_apellido: cliente.nombre_apellido,
        razon_social: cliente.razon_social || '',
        cuit: cliente.cuit || '',
        localidad: cliente.localidad || '',
        provincia: cliente.provincia || '',
        telefono: cliente.telefono || '',
        email: cliente.email || '',
        direccion: cliente.direccion || '',
        latitud: cliente.latitud || 0,
        longitud: cliente.longitud || 0,
        observaciones: cliente.observaciones || '',
        tipo_cliente: cliente.tipo_cliente,
        lista_precio: cliente.lista_precio || 'lista1',
        limite_credito: cliente.limite_credito
      });
    } else {
      let defaultLimit = 0;
      try {
        const res = await apiFetch('/api/config/settings');
        const body = await res.json();
        const settings = unwrapResponse(body);
        defaultLimit = parseFloat(settings.default_credit_limit || '0');
      } catch (e) {
        console.error("Error fetching default credit limit:", e);
      }

      setEditingCliente(null);
      setFormData({
        nombre_apellido: '',
        razon_social: '',
        cuit: '',
        localidad: '',
        provincia: '',
        telefono: '',
        email: '',
        direccion: '',
        latitud: 0,
        longitud: 0,
        observaciones: '',
        tipo_cliente: 'minorista',
        lista_precio: 'lista1',
        limite_credito: defaultLimit
      });
    }
    setIsModalOpen(true);
  };

  const openMovementsModal = async (cliente: Cliente) => {
    setSelectedClienteForMovements(cliente);
    setIsMovementsModalOpen(true);
    try {
      const res = await apiFetch(`/api/clientes/${cliente.id}/movimientos`);
      const body = await res.json();
      const data = unwrapResponse(body);
      setMovements(data);
    } catch (error) {
      console.error("Error fetching movements:", error);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCliente(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto h-full flex flex-col overflow-hidden">
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">Gestión de Clientes</h1>
          <p className="text-sm text-zinc-500 mt-1">Administra tu base de datos de clientes y sus condiciones comerciales</p>
        </div>
        {hasPermission('customers', 'create') && (
          <button
            onClick={() => openModal()}
            className="w-full sm:w-auto bg-zinc-900 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
          >
            <UserPlus size={20} />
            Nuevo Cliente
          </button>
        )}
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
        <input
          type="text"
          placeholder="Buscar por nombre, razón social o localidad..."
          className="w-full pl-10 pr-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all shadow-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClientes.map(cliente => (
            <div key={cliente.id} className="bg-white rounded-2xl border border-zinc-200 p-6 hover:shadow-md transition-all group relative">
              <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => {
                    setSelectedClienteId(cliente.id);
                    setIsDetailOpen(true);
                  }}
                  className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                  title="Ver Detalle"
                >
                  <Eye size={16} />
                </button>
                {hasPermission('customers', 'edit') && (
                  <button 
                    onClick={() => openModal(cliente)}
                    className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                  >
                    <Edit2 size={16} />
                  </button>
                )}
                {hasPermission('customers', 'delete') && (
                  <button 
                    onClick={() => handleDelete(cliente.id)}
                    className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-500 group-hover:bg-zinc-900 group-hover:text-white transition-all">
                  <User size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-zinc-900 line-clamp-1">{cliente.nombre_apellido}</h3>
                  <div className="flex items-center gap-1 text-xs text-zinc-400">
                    <Building2 size={12} />
                    <span className="truncate">{cliente.razon_social}</span>
                  </div>
                </div>
              </div>

              {cliente.tiene_deuda_vencida === 1 && (
                <div className="mb-4 flex items-center gap-2 p-2 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold border border-red-100">
                  <AlertCircle size={14} />
                  Cliente con deuda vencida mayor a 7 días
                </div>
              )}

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <MapPin size={14} className="shrink-0" />
                  <span className="truncate">{cliente.localidad}{cliente.direccion ? `, ${cliente.direccion}` : ''}</span>
                </div>
                {cliente.telefono && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Phone size={14} className="shrink-0" />
                    <span>{cliente.telefono}</span>
                  </div>
                )}
                {cliente.email && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Mail size={14} className="shrink-0" />
                    <span className="truncate">{cliente.email}</span>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-zinc-100 flex items-center justify-between">
                <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                  cliente.tipo_cliente === 'mayorista' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
                }`}>
                  {cliente.tipo_cliente}
                </span>
                <button 
                  onClick={() => openMovementsModal(cliente)}
                  className="flex items-center gap-1 text-zinc-900 font-mono font-bold hover:bg-zinc-50 px-2 py-1 rounded-lg transition-all"
                >
                  <CreditCard size={14} className="text-zinc-400" />
                  <span className="text-sm">${cliente.saldo_cta_cte.toFixed(2)}</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredClientes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <User size={48} className="mb-4 opacity-10" />
            <p className="font-medium">No se encontraron clientes</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
            <div className="p-4 sm:p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50 shrink-0">
              <h2 className="text-lg sm:text-xl font-bold text-zinc-900">{editingCliente ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
              <button onClick={closeModal} className="p-2 hover:bg-zinc-200 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 sm:p-8 space-y-6 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Nombre y Apellido *</label>
                  <input
                    required
                    type="text"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.nombre_apellido}
                    onChange={(e) => setFormData({ ...formData, nombre_apellido: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Razón Social</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.razon_social}
                    onChange={(e) => setFormData({ ...formData, razon_social: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">CUIT/CUIL</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.cuit}
                    onChange={(e) => setFormData({ ...formData, cuit: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Localidad</label>
                  <input
                    readOnly
                    type="text"
                    placeholder="Se completa al elegir dirección"
                    className="w-full px-4 py-2 bg-zinc-100 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none cursor-default"
                    value={formData.localidad}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Provincia</label>
                  <input
                    readOnly
                    type="text"
                    placeholder="Se completa al elegir dirección"
                    className="w-full px-4 py-2 bg-zinc-100 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none cursor-default"
                    value={formData.provincia}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Tipo de Cliente</label>
                  <select
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.tipo_cliente}
                    onChange={(e) => setFormData({ ...formData, tipo_cliente: e.target.value as any })}
                  >
                    <option value="minorista">Minorista</option>
                    <option value="mayorista">Mayorista</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Lista de Precios</label>
                  <select
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.lista_precio}
                    onChange={(e) => setFormData({ ...formData, lista_precio: e.target.value })}
                  >
                    <option value="lista1">Lista 1 (Minorista)</option>
                    <option value="lista2">Lista 2 (Mayorista)</option>
                    <option value="lista3">Lista 3 (Especial)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Teléfono</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.telefono}
                    onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Email</label>
                  <input
                    type="email"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Dirección *</label>
                  <AddressAutocomplete
                    value={formData.direccion}
                    onChange={(addr) => setFormData({
                      ...formData,
                      direccion: addr.direccion,
                      localidad: addr.localidad,
                      provincia: addr.provincia || '',
                      latitud: addr.latitud,
                      longitud: addr.longitud
                    })}
                    placeholder="Escribe una dirección para buscar..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Límite de Crédito</label>
                  <input
                    type="number"
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none"
                    value={formData.limite_credito}
                    onChange={(e) => setFormData({ ...formData, limite_credito: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Observaciones</label>
                  <textarea
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none h-24 resize-none"
                    value={formData.observaciones || ''}
                    onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
                >
                  {editingCliente ? 'Guardar Cambios' : 'Crear Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Detail Screen */}
      {isDetailOpen && selectedClienteId && (
        <CustomerDetail 
          clienteId={selectedClienteId} 
          onClose={() => {
            setIsDetailOpen(false);
            setSelectedClienteId(null);
          }} 
        />
      )}

      {/* Movements Modal */}
      {isMovementsModalOpen && selectedClienteForMovements && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-4 sm:p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50 shrink-0">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-zinc-900">Cuenta Corriente</h2>
                <p className="text-[10px] sm:text-xs text-zinc-500">{selectedClienteForMovements.nombre_apellido}</p>
              </div>
              <button onClick={() => setIsMovementsModalOpen(false)} className="p-2 hover:bg-zinc-200 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
              <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Saldo Actual</span>
                  <p className="text-xl sm:text-2xl font-black text-zinc-900 font-mono">${selectedClienteForMovements.saldo_cta_cte.toFixed(2)}</p>
                </div>
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Límite de Crédito</span>
                  <p className="text-xl sm:text-2xl font-black text-zinc-900 font-mono">${selectedClienteForMovements.limite_credito.toFixed(2)}</p>
                </div>
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Estado</span>
                  <p className={`text-sm font-bold mt-1 sm:mt-2 ${selectedClienteForMovements.saldo_cta_cte > selectedClienteForMovements.limite_credito ? 'text-red-600' : 'text-emerald-600'}`}>
                    {selectedClienteForMovements.saldo_cta_cte > selectedClienteForMovements.limite_credito ? 'Excedido' : 'Al día'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b border-zinc-100">
                      <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                      <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Descripción</th>
                      <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Debe</th>
                      <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Haber</th>
                      <th className="py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {movements.map((m) => (
                      <tr key={m.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="py-4 text-xs text-zinc-500">{new Date(m.fecha).toLocaleDateString()}</td>
                        <td className="py-4 text-xs font-medium text-zinc-900">{m.descripcion}</td>
                        <td className="py-4 text-xs font-mono text-right text-red-600">{m.debe > 0 ? `+$${m.debe.toFixed(2)}` : '-'}</td>
                        <td className="py-4 text-xs font-mono text-right text-emerald-600">{m.haber > 0 ? `-$${m.haber.toFixed(2)}` : '-'}</td>
                        <td className="py-4 text-xs font-mono text-right font-bold text-zinc-900">${m.saldo_resultante.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {movements.length === 0 && (
                <div className="text-center py-10 text-zinc-300">
                  <AlertCircle size={32} className="mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No hay movimientos registrados</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
