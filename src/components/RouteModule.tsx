import React, { useState, useEffect, useMemo } from 'react';
import { 
  Map, 
  Plus, 
  Calendar, 
  Users, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ChevronRight, 
  Trash2, 
  Save, 
  ArrowRight,
  MapPin,
  Phone,
  MessageSquare,
  AlertCircle,
  Eye,
  ArrowUp,
  ArrowDown,
  Check,
  ClipboardList,
  ShoppingCart,
  Minus,
  BellRing
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import CustomerDetail from './CustomerDetail';
import RouteMap from './RouteMap';
import { unwrapResponse, apiFetch } from '../utils/api';

interface RouteItem {
  id: number;
  route_id: number;
  cliente_id: number;
  order_index: number;
  status: 'pendiente' | 'visitado' | 'omitido' | 'pedido tomado' | 'venta realizada';
  visitado: number;
  venta_registrada: number;
  pedido_generado: number;
  cobranza_realizada: number;
  notes: string | null;
  visited_at: string | null;
  nombre_apellido: string;
  razon_social: string;
  localidad: string;
  direccion: string;
  latitud: number | null;
  longitud: number | null;
  telefono: string;
  tipo_cliente: string;
  saldo_cta_cte: number;
}

interface Route {
  id: number;
  name: string;
  date: string;
  status: 'planificada' | 'en curso' | 'finalizada' | 'cancelada';
  created_at: string;
  total_customers?: number;
  visited_customers?: number;
  sales_count?: number;
  orders_count?: number;
  items?: RouteItem[];
}

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function RouteModule() {
  const { user, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'planificar' | 'hoy' | 'historial'>('hoy');
  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [todayRoute, setTodayRoute] = useState<Route | null>(null);
  const [clientes, setClientes] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [showCustomerDetailId, setShowCustomerDetailId] = useState<number | null>(null);
  const [selectedRouteForDetail, setSelectedRouteForDetail] = useState<Route | null>(null);
  const [showQuickActionModal, setShowQuickActionModal] = useState(false);
  const [quickActionType, setQuickActionType] = useState<'venta' | 'pedido' | 'pago'>('venta');
  const [selectedItemForAction, setSelectedItemForAction] = useState<RouteItem | null>(null);
  const [actionCart, setActionCart] = useState<{ productId: number; quantity: number }[]>([]);
  const [actionNotes, setActionNotes] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('efectivo');
  const [showMap, setShowMap] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>([-32.8596, -61.1447]); // Default to Carcaraña, Santa Fe (Edu's house area)
  const [nearbyClient, setNearbyClient] = useState<any | null>(null);
  const [lastNotifiedClientId, setLastNotifiedClientId] = useState<number | null>(null);
  const [showProximityAlert, setShowProximityAlert] = useState(false);

  // Planning state
  const [planDate, setPlanDate] = useState(new Date(Date.now() + 86400000).toISOString().split('T')[0]);
  const [planName, setPlanName] = useState('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');

  useEffect(() => {
    fetchInitialData();

    // Request location permission and start watching
    let watchId: number | null = null;
    if ("geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          console.error("Error watching location:", error);
        },
        { enableHighAccuracy: true }
      );
    }

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  useEffect(() => {
    if (!userLocation || !todayRoute || !todayRoute.items) return;

    const proximityThreshold = 0.05; // 50 meters in km
    const hideThreshold = 0.07; // 70 meters to hide
    const resetThreshold = 0.2; // 200 meters to allow re-notifying

    // Check if we should reset lastNotifiedClientId (if user is far from that client)
    if (lastNotifiedClientId) {
      const lastClient = todayRoute.items.find(i => i.id === lastNotifiedClientId);
      if (lastClient && lastClient.latitud && lastClient.longitud) {
        const dist = calculateDistance(userLocation[0], userLocation[1], lastClient.latitud, lastClient.longitud);
        if (dist > resetThreshold) {
          setLastNotifiedClientId(null);
        }
      }
    }

    // Check if current nearby client is still nearby
    if (nearbyClient) {
      const dist = calculateDistance(userLocation[0], userLocation[1], nearbyClient.latitud!, nearbyClient.longitud!);
      if (dist > hideThreshold) {
        setShowProximityAlert(false);
        setNearbyClient(null);
      }
    }

    // Search for new nearby clients if not already showing one
    if (!showProximityAlert) {
      const nearby = todayRoute.items.find(item => {
        if (item.status !== 'pendiente' || !item.latitud || !item.longitud) return false;
        const dist = calculateDistance(userLocation[0], userLocation[1], item.latitud, item.longitud);
        return dist <= proximityThreshold;
      });

      if (nearby && nearby.id !== lastNotifiedClientId) {
        setNearbyClient(nearby);
        setLastNotifiedClientId(nearby.id);
        setShowProximityAlert(true);
      }
    }
  }, [userLocation, todayRoute, lastNotifiedClientId, nearbyClient, showProximityAlert]);
  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [routesRes, todayRes, clientesRes, productsRes] = await Promise.all([
        apiFetch('/api/routes'),
        apiFetch('/api/routes/today'),
        apiFetch('/api/clientes'),
        apiFetch('/api/products')
      ]);
      
      const routesBody = await routesRes.json();
      const todayBody = await todayRes.json();
      const clientesBody = await clientesRes.json();
      const productsBody = await productsRes.json();

      const routesData = unwrapResponse(routesBody);
      const todayData = unwrapResponse(todayBody);
      const clientesData = unwrapResponse(clientesBody);
      const productsData = unwrapResponse(productsBody);

      setRoutes(routesData);
      setTodayRoute(todayData);
      setClientes(clientesData);
      setProducts(productsData);
      
      // Set default plan name
      const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString();
      setPlanName(`Ruta ${tomorrow}`);
    } catch (error) {
      console.error("Error fetching route data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedRouteForDetail && !selectedRouteForDetail.items) {
      apiFetch(`/api/routes/${selectedRouteForDetail.id}`)
        .then(res => res.json())
        .then(body => {
          const data = unwrapResponse(body);
          setSelectedRouteForDetail(data);
        })
        .catch(err => console.error("Error fetching route detail:", err));
    }
  }, [selectedRouteForDetail]);

  const fetchRoutes = async () => {
    try {
      const res = await apiFetch('/api/routes');
      const body = await res.json();
      const data = unwrapResponse(body);
      setRoutes(data);
    } catch (error) {
      console.error("Error fetching routes:", error);
    }
  };

  const fetchTodayRoute = async () => {
    try {
      const res = await apiFetch('/api/routes/today');
      const body = await res.json();
      const data = unwrapResponse(body);
      setTodayRoute(data);
    } catch (error) {
      console.error("Error fetching today's route:", error);
    }
  };

  const handleCreateRoute = async () => {
    if (selectedCustomerIds.length === 0) {
      alert("Selecciona al menos un cliente para la ruta.");
      return;
    }

    try {
      const res = await apiFetch('/api/routes', {
        method: 'POST',
        body: JSON.stringify({
          name: planName,
          date: planDate,
          customerIds: selectedCustomerIds
        })
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        alert("Ruta planificada con éxito.");
        setSelectedCustomerIds([]);
        fetchInitialData();
        setActiveTab('historial');
      } else {
        const errorData = unwrapResponse(body);
        alert(errorData.message || "Error al crear la ruta");
      }
    } catch (error) {
      console.error("Error creating route:", error);
    }
  };

  const handleConfirmQuickAction = async () => {
    if (!selectedItemForAction) return;

    try {
      if (quickActionType === 'venta') {
        if (actionCart.length === 0) return;
        // Register sale
        const res = await apiFetch('/api/sales', {
          method: 'POST',
          body: JSON.stringify({
            cliente_id: selectedItemForAction.cliente_id,
            nombre_cliente: selectedItemForAction.nombre_apellido,
            items: actionCart.map(item => ({
              product_id: item.productId,
              cantidad: item.quantity,
              precio_venta: products.find(p => p.id === item.productId)?.sale_price || 0
            })),
            metodo_pago: 'efectivo', // Default for quick sale
            notes: actionNotes,
            total: actionCart.reduce((sum, item) => {
              const product = products.find(p => p.id === item.productId);
              return sum + (product?.sale_price || 0) * item.quantity;
            }, 0)
          })
        });

        if (res.ok) {
          const body = await res.json();
          const data = unwrapResponse(body);
          if (data.type === 'supplier_order') {
            alert(data.message);
            await handleUpdateItemStatus(selectedItemForAction.id, 'pedido tomado');
          } else {
            await handleUpdateItemStatus(selectedItemForAction.id, 'venta realizada');
          }
        } else {
          const body = await res.json();
          const errorData = unwrapResponse(body);
          alert(errorData.message || "Error al procesar la venta");
        }
      } else if (quickActionType === 'pedido') {
        if (actionCart.length === 0) return;
        // Register order
        const res = await apiFetch('/api/supplier-orders', {
          method: 'POST',
          body: JSON.stringify({
            cliente: selectedItemForAction.nombre_apellido,
            cliente_id: selectedItemForAction.cliente_id,
            notes: actionNotes,
            items: actionCart.map(item => ({
              product_id: item.productId,
              cantidad: item.quantity
            }))
          })
        });
        const body = await res.json();
        if (res.ok) {
          unwrapResponse(body);
          await handleUpdateItemStatus(selectedItemForAction.id, 'pedido tomado');
        } else {
          const errorData = unwrapResponse(body);
          alert(errorData.message || "Error al procesar el pedido");
        }
      } else if (quickActionType === 'pago') {
        if (paymentAmount <= 0) return;
        // Register payment
        const res = await apiFetch(`/api/clientes/${selectedItemForAction.cliente_id}/pagos`, {
          method: 'POST',
          body: JSON.stringify({
            monto: paymentAmount,
            metodo_pago: paymentMethod,
            fecha: new Date().toISOString()
          })
        });
        const body = await res.json();
        if (res.ok) {
          unwrapResponse(body);
          await handleUpdateItemStatus(selectedItemForAction.id, 'visitado', `Pago registrado: $${paymentAmount}`, { cobranza_realizada: 1 });
        } else {
          const errorData = unwrapResponse(body);
          alert(errorData.message || "Error al registrar el pago");
        }
      }
      setActionNotes('');
      setShowQuickActionModal(false);
      fetchTodayRoute();
    } catch (error) {
      console.error("Error confirming quick action:", error);
    }
  };

  const handleUpdateItemStatus = async (itemId: number, status: 'visitado' | 'omitido' | 'pendiente' | 'pedido tomado' | 'venta realizada', notes: string = '', extraFields: any = {}) => {
    try {
      // If the route is still 'planificada', update it to 'en curso'
      if (todayRoute && todayRoute.status === 'planificada') {
        const routeRes = await apiFetch(`/api/routes/${todayRoute.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'en curso' })
        });
        const routeBody = await routeRes.json();
        unwrapResponse(routeBody);
      }

      const body: any = { status, notes, ...extraFields };
      if (status === 'visitado' || status === 'pedido tomado' || status === 'venta realizada') {
        body.visitado = 1;
      }
      if (status === 'pedido tomado') body.pedido_generado = 1;
      if (status === 'venta realizada') body.venta_registrada = 1;

      const res = await apiFetch(`/api/routes/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });

      const resBody = await res.json();
      if (res.ok) {
        unwrapResponse(resBody);
        fetchTodayRoute();
      } else {
        const errorData = unwrapResponse(resBody);
        alert(errorData.message || "Error al actualizar el estado");
      }
    } catch (error) {
      console.error("Error updating route item:", error);
    }
  };

  const handleCompleteRoute = async (routeId: number) => {
    if (!confirm("¿Estás seguro de marcar esta ruta como completada?")) return;
    
    try {
      const res = await apiFetch(`/api/routes/${routeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'finalizada' })
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        fetchInitialData();
        setActiveTab('historial');
      } else {
        const errorData = unwrapResponse(body);
        alert(errorData.message || "Error al finalizar la ruta");
      }
    } catch (error) {
      console.error("Error completing route:", error);
    }
  };

  const handleReorderItem = async (routeId: number, itemId: number, direction: 'up' | 'down') => {
    if (!todayRoute || !todayRoute.items) return;

    const items = [...todayRoute.items];
    const index = items.findIndex(i => i.id === itemId);
    if (index === -1) return;

    if (direction === 'up' && index > 0) {
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
    } else if (direction === 'down' && index < items.length - 1) {
      [items[index + 1], items[index]] = [items[index], items[index + 1]];
    } else {
      return;
    }

    const reorderedItems = items.map((item, idx) => ({
      id: item.id,
      order_index: idx
    }));

    try {
      const res = await apiFetch(`/api/routes/${routeId}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ items: reorderedItems })
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        fetchTodayRoute();
      } else {
        const errorData = unwrapResponse(body);
        alert(errorData.message || "Error al reordenar items");
      }
    } catch (error) {
      console.error("Error reordering items:", error);
    }
  };

  const handleVisitNext = async (routeId: number, itemId: number) => {
    if (!todayRoute || !todayRoute.items || !userLocation) return;

    const items = [...todayRoute.items];
    const targetIdx = items.findIndex(i => i.id === itemId);
    if (targetIdx === -1) return;

    // Separate visited and unvisited
    const visited = items.filter(i => i.status !== 'pendiente');
    const unvisited = items.filter(i => i.status === 'pendiente');
    
    // Find the target item in unvisited
    const targetItemIdx = unvisited.findIndex(i => i.id === itemId);
    if (targetItemIdx === -1) return; // Already visited

    const targetItem = unvisited.splice(targetItemIdx, 1)[0];
    
    // Optimize the rest of unvisited starting from targetItem
    const optimized: any[] = [targetItem];
    let currentPos: [number, number] = [targetItem.latitud || 0, targetItem.longitud || 0];

    while (unvisited.length > 0) {
      let nearestIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const item = unvisited[i];
        if (item.latitud && item.longitud) {
          const dist = calculateDistance(currentPos[0], currentPos[1], item.latitud, item.longitud);
          if (dist < minDistance) {
            minDistance = dist;
            nearestIdx = i;
          }
        }
      }

      if (nearestIdx === -1) {
        optimized.push(...unvisited);
        break;
      }

      const nextItem = unvisited.splice(nearestIdx, 1)[0];
      optimized.push(nextItem);
      currentPos = [nextItem.latitud || 0, nextItem.longitud || 0];
    }

    const finalOrder = [...visited, ...optimized];
    const reorderedItems = finalOrder.map((item, idx) => ({
      id: item.id,
      order_index: idx
    }));

    try {
      const res = await apiFetch(`/api/routes/${routeId}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ items: reorderedItems })
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        fetchTodayRoute();
      } else {
        const errorData = unwrapResponse(body);
        alert(errorData.message || "Error al reordenar items");
      }
    } catch (error) {
      console.error("Error reordering items:", error);
    }
  };

  const handleDeleteRoute = async (routeId: number) => {
    if (!confirm("¿Estás seguro de eliminar esta ruta?")) return;

    try {
      const res = await apiFetch(`/api/routes/${routeId}`, {
        method: 'DELETE'
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        fetchRoutes();
      } else {
        const errorData = unwrapResponse(body);
        alert(errorData.message || "Error al eliminar la ruta");
      }
    } catch (error) {
      console.error("Error deleting route:", error);
    }
  };

  const optimizeRoute = () => {
    if (selectedCustomerIds.length === 0 || !userLocation) {
      if (!userLocation) alert("Se requiere tu ubicación actual para optimizar la ruta.");
      return;
    }

    const unvisited = [...selectedCustomerIds];
    const optimized: number[] = [];
    let currentPos = userLocation;

    while (unvisited.length > 0) {
      let nearestIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const cliente = clientes.find(c => c.id === unvisited[i]);
        if (cliente && cliente.latitud && cliente.longitud) {
          const dist = calculateDistance(currentPos[0], currentPos[1], cliente.latitud, cliente.longitud);
          if (dist < minDistance) {
            minDistance = dist;
            nearestIdx = i;
          }
        }
      }

      // If no more customers with coordinates are found, add the rest as they are
      if (nearestIdx === -1) {
        optimized.push(...unvisited);
        break;
      }

      const nextId = unvisited.splice(nearestIdx, 1)[0];
      optimized.push(nextId);
      const nextCliente = clientes.find(c => c.id === nextId);
      if (nextCliente && nextCliente.latitud && nextCliente.longitud) {
        currentPos = [nextCliente.latitud, nextCliente.longitud];
      }
    }

    setSelectedCustomerIds(optimized);
  };

  const filteredClientes = useMemo(() => {
    return clientes.filter(c => 
      c.nombre_apellido.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.razon_social.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.localidad.toLowerCase().includes(customerSearch.toLowerCase())
    );
  }, [clientes, customerSearch]);

  const toggleCustomerSelection = (id: number) => {
    setSelectedCustomerIds(prev => 
      prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id]
    );
  };

  const moveCustomer = (index: number, direction: 'up' | 'down') => {
    const newIds = [...selectedCustomerIds];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newIds.length) return;
    
    [newIds[index], newIds[targetIndex]] = [newIds[targetIndex], newIds[index]];
    setSelectedCustomerIds(newIds);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-4 md:px-8 py-3 md:py-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl md:text-2xl font-black text-zinc-900 tracking-tight flex items-center gap-2">
              <Map className="text-zinc-400" size={24} />
              RUTA DEL DÍA
            </h2>
            <p className="text-zinc-500 text-[10px] md:text-xs font-medium uppercase tracking-widest">Logística y Seguimiento</p>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            {hasPermission('routes', 'create') && (
              <button
                onClick={() => setActiveTab('planificar')}
                className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                  activeTab === 'planificar' ? 'bg-zinc-900 text-white shadow-md' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                Planificar
              </button>
            )}
            <button
              onClick={() => setActiveTab('hoy')}
              className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'hoy' ? 'bg-zinc-900 text-white shadow-md' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Ruta de Hoy
            </button>
            <button
              onClick={() => setActiveTab('historial')}
              className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'historial' ? 'bg-zinc-900 text-white shadow-md' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Historial
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <AnimatePresence mode="wait">
          {activeTab === 'planificar' && (
            <motion.div
              key="planificar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8"
            >
              {/* Route Info & Selection */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm space-y-4">
                  <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                    <Calendar size={20} className="text-zinc-400" />
                    Detalles de la Ruta
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Fecha</label>
                      <input
                        type="date"
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm"
                        value={planDate}
                        onChange={(e) => setPlanDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Nombre de Ruta</label>
                      <input
                        type="text"
                        className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm"
                        placeholder="Ej: Ruta Norte"
                        value={planName}
                        onChange={(e) => setPlanName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex flex-col h-[500px]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                      <Users size={20} className="text-zinc-400" />
                      Seleccionar Clientes
                    </h3>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                      <input
                        type="text"
                        placeholder="Buscar cliente..."
                        className="pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs focus:ring-2 focus:ring-zinc-900 outline-none w-48"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                    {filteredClientes.map(cliente => (
                      <button
                        key={cliente.id}
                        onClick={() => toggleCustomerSelection(cliente.id)}
                        className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all ${
                          selectedCustomerIds.includes(cliente.id)
                            ? 'bg-zinc-900 border-zinc-900 text-white shadow-md'
                            : 'bg-white border-zinc-100 text-zinc-900 hover:border-zinc-300'
                        }`}
                      >
                        <div className="text-left">
                          <p className="text-sm font-bold">{cliente.nombre_apellido}</p>
                          <p className={`text-[10px] font-medium ${selectedCustomerIds.includes(cliente.id) ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            {cliente.localidad} • {cliente.razon_social}
                          </p>
                        </div>
                        {selectedCustomerIds.includes(cliente.id) ? (
                          <CheckCircle2 size={18} />
                        ) : (
                          <Plus size={18} className="text-zinc-300" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Order & Summary */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex flex-col h-[500px]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                      <Map size={20} className="text-zinc-400" />
                      Vista Previa del Recorrido
                    </h3>
                  </div>
                  <div className="flex-1 rounded-2xl overflow-hidden border border-zinc-100">
                    <RouteMap 
                      items={selectedCustomerIds.map(id => {
                        const c = clientes.find(cli => cli.id === id);
                        return { ...c, status: 'pendiente' };
                      })} 
                      userLocation={userLocation}
                    />
                  </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex flex-col h-[600px]">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                      <Plus size={20} className="text-zinc-400" />
                      Orden de Visita
                    </h3>
                    <div className="flex items-center gap-2">
                      {selectedCustomerIds.length > 1 && (
                        <button
                          onClick={optimizeRoute}
                          className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full hover:bg-indigo-100 transition-all flex items-center gap-1"
                        >
                          <Map size={12} />
                          Optimizar Recorrido
                        </button>
                      )}
                      <span className="text-xs font-bold text-zinc-400 bg-zinc-100 px-3 py-1 rounded-full">
                        {selectedCustomerIds.length} Clientes
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
                    {selectedCustomerIds.map((id, index) => {
                      const cliente = clientes.find(c => c.id === id);
                      if (!cliente) return null;
                      return (
                        <div
                          key={id}
                          className="flex items-center gap-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-100 group"
                        >
                          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-xs font-bold text-zinc-400 border border-zinc-100">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-bold text-zinc-900">{cliente.nombre_apellido}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] text-zinc-500">{cliente.direccion}, {cliente.localidad}</p>
                              {index > 0 && userLocation && (
                                <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">
                                  {(() => {
                                    const prevId = selectedCustomerIds[index - 1];
                                    const prevCliente = clientes.find(c => c.id === prevId);
                                    let dist = 0;
                                    if (prevCliente && prevCliente.latitud && prevCliente.longitud && cliente.latitud && cliente.longitud) {
                                      dist = calculateDistance(prevCliente.latitud, prevCliente.longitud, cliente.latitud, cliente.longitud);
                                    } else if (index === 0 && userLocation && cliente.latitud && cliente.longitud) {
                                      dist = calculateDistance(userLocation[0], userLocation[1], cliente.latitud, cliente.longitud);
                                    }
                                    
                                    const estTime = (d: number) => {
                                      const mins = Math.round((d / 30) * 60) + 5; // 30km/h + 5 min buffer
                                      return mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
                                    };

                                    return dist > 0 ? `~${dist.toFixed(1)}km (${estTime(dist)})` : '';
                                  })()}
                                </span>
                              )}
                              {index === 0 && userLocation && cliente.latitud && cliente.longitud && (
                                <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded">
                                  {(() => {
                                    const dist = calculateDistance(userLocation[0], userLocation[1], cliente.latitud, cliente.longitud);
                                    const estTime = (d: number) => {
                                      const mins = Math.round((d / 30) * 60) + 2; // 30km/h + 2 min buffer
                                      return mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
                                    };
                                    return `Desde tu ubicación: ~${dist.toFixed(1)}km (${estTime(dist)})`;
                                  })()}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => moveCustomer(index, 'up')}
                              disabled={index === 0}
                              className="p-1.5 hover:bg-white rounded-lg text-zinc-400 hover:text-zinc-900 disabled:opacity-30"
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              onClick={() => moveCustomer(index, 'down')}
                              disabled={index === selectedCustomerIds.length - 1}
                              className="p-1.5 hover:bg-white rounded-lg text-zinc-400 hover:text-zinc-900 disabled:opacity-30"
                            >
                              <ArrowDown size={16} />
                            </button>
                            <button
                              onClick={() => toggleCustomerSelection(id)}
                              className="p-1.5 hover:bg-red-50 rounded-lg text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {selectedCustomerIds.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-2">
                        <Users size={48} className="opacity-10" />
                        <p className="text-sm">No hay clientes seleccionados</p>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 px-2 space-y-1">
                    {selectedCustomerIds.length > 0 && userLocation && (
                      <div className="flex items-center justify-between text-[11px] font-bold text-zinc-500">
                        <span>Resumen del Recorrido:</span>
                        <div className="flex gap-3">
                          <span className="flex items-center gap-1">
                            <Map size={12} />
                            {(() => {
                              let totalDist = 0;
                              let currentPos = userLocation;
                              selectedCustomerIds.forEach(id => {
                                const c = clientes.find(cli => cli.id === id);
                                if (c && c.latitud && c.longitud) {
                                  totalDist += calculateDistance(currentPos[0], currentPos[1], c.latitud, c.longitud);
                                  currentPos = [c.latitud, c.longitud];
                                }
                              });
                              return `~${totalDist.toFixed(1)} km`;
                            })()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {(() => {
                              let totalDist = 0;
                              let currentPos = userLocation;
                              selectedCustomerIds.forEach(id => {
                                const c = clientes.find(cli => cli.id === id);
                                if (c && c.latitud && c.longitud) {
                                  totalDist += calculateDistance(currentPos[0], currentPos[1], c.latitud, c.longitud);
                                  currentPos = [c.latitud, c.longitud];
                                }
                              });
                              const mins = Math.round((totalDist / 30) * 60) + (selectedCustomerIds.length * 10); // 30km/h + 10 min per stop
                              return mins < 60 ? `${mins} min` : `${Math.floor(mins/60)}h ${mins%60}m`;
                            })()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-6 mt-auto border-t border-zinc-100">
                    <button
                      onClick={handleCreateRoute}
                      disabled={selectedCustomerIds.length === 0}
                      className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save size={20} />
                      Guardar y Planificar Ruta
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'hoy' && (
            <motion.div
              key="hoy"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl mx-auto"
            >
              {!todayRoute ? (
                <div className="bg-white p-12 rounded-[40px] border border-zinc-200 shadow-sm text-center space-y-4">
                  <div className="w-20 h-20 bg-zinc-50 rounded-3xl flex items-center justify-center mx-auto text-zinc-300">
                    <Map size={40} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-zinc-900">No hay ruta para hoy</h3>
                    <p className="text-zinc-500 text-sm max-w-xs mx-auto mt-2">
                      Planifica una nueva ruta para comenzar el día con organización.
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('planificar')}
                    className="px-8 py-3 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 inline-flex items-center gap-2"
                  >
                    <Plus size={20} />
                    Planificar Ahora
                  </button>
                </div>
              ) : (
                <div className="space-y-4 md:space-y-6">
                  <div className="bg-zinc-900 p-4 md:p-8 rounded-3xl md:rounded-[40px] text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-0">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-wider">Ruta Activa</span>
                        <span className="text-white/60 text-xs font-medium">{new Date(todayRoute.date).toLocaleDateString()}</span>
                      </div>
                      <h3 className="text-xl md:text-3xl font-black tracking-tight">{todayRoute.name}</h3>
                      <div className="flex items-center gap-4 md:gap-6 mt-3 md:mt-4">
                        <div>
                          <p className="text-white/40 text-[8px] md:text-[10px] font-bold uppercase">Progreso</p>
                          <p className="text-lg md:text-xl font-black">
                            {todayRoute.items?.filter(i => i.status !== 'pendiente').length} / {todayRoute.items?.length}
                          </p>
                        </div>
                        <div className="h-6 md:h-8 w-px bg-white/10" />
                        <div>
                          <p className="text-white/40 text-[8px] md:text-[10px] font-bold uppercase">Estado</p>
                          <p className="text-lg md:text-xl font-black capitalize">{todayRoute.status}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 md:gap-3">
                      <button
                        onClick={() => setShowMap(!showMap)}
                        className={`flex-1 md:flex-none px-4 md:px-6 py-3 md:py-4 rounded-xl md:rounded-2xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 text-xs md:text-base ${
                          showMap ? 'bg-white text-zinc-900' : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        <Map size={18} />
                        <span className="whitespace-nowrap">{showMap ? 'Ocultar Mapa' : 'Ver Mapa'}</span>
                      </button>
                      {todayRoute.status === 'planificada' && hasPermission('routes', 'edit') && (
                        <button
                          onClick={async () => {
                            const res = await apiFetch(`/api/routes/${todayRoute.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'en curso' })
                            });
                            const body = await res.json();
                            unwrapResponse(body);
                            fetchTodayRoute();
                          }}
                          className="flex-1 md:flex-none px-4 md:px-8 py-3 md:py-4 bg-emerald-500 text-white rounded-xl md:rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg flex items-center justify-center gap-2 text-xs md:text-base"
                        >
                          <ArrowRight size={18} />
                          <span className="whitespace-nowrap">Iniciar Ruta</span>
                        </button>
                      )}
                      {hasPermission('routes', 'edit') && (
                        <button
                          onClick={() => handleCompleteRoute(todayRoute.id)}
                          className="flex-1 md:flex-none px-4 md:px-8 py-3 md:py-4 bg-white text-zinc-900 rounded-xl md:rounded-2xl font-bold hover:bg-zinc-100 transition-all shadow-lg flex items-center justify-center gap-2 text-xs md:text-base"
                        >
                          <CheckCircle2 size={18} />
                          <span className="whitespace-nowrap">Finalizar</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {showMap && todayRoute.items && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden rounded-3xl border border-zinc-200"
                    >
                      <RouteMap 
                        items={todayRoute.items} 
                        userLocation={userLocation}
                        onClientClick={(clientId) => setShowCustomerDetailId(clientId)}
                        className="h-[300px] md:h-[450px]"
                      />
                    </motion.div>
                  )}

                  <div className="space-y-3 md:space-y-4">
                    {todayRoute.items?.map((item, index) => (
                      <div
                        key={item.id}
                        className={`bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl border transition-all ${
                          item.status === 'visitado' ? 'border-emerald-100 bg-emerald-50/10' : 
                          item.status === 'venta realizada' ? 'border-indigo-100 bg-indigo-50/10' :
                          item.status === 'pedido tomado' ? 'border-amber-100 bg-amber-50/10' :
                          item.status === 'omitido' ? 'border-red-100 bg-red-50/10' : 
                          'border-zinc-200'
                        }`}
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-6">
                          <div className="flex items-start gap-3 md:gap-4">
                            <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center text-xs md:text-sm font-bold shrink-0 ${
                              item.status === 'visitado' ? 'bg-emerald-600 text-white' : 
                              item.status === 'venta realizada' ? 'bg-indigo-600 text-white' :
                              item.status === 'pedido tomado' ? 'bg-amber-600 text-white' :
                              item.status === 'omitido' ? 'bg-red-600 text-white' : 
                              'bg-zinc-100 text-zinc-400'
                            }`}>
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-base md:text-lg font-bold text-zinc-900 truncate">{item.nombre_apellido}</h4>
                                <span className={`px-2 py-0.5 rounded-full text-[8px] md:text-[9px] font-bold uppercase ${
                                  item.tipo_cliente === 'mayorista' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
                                }`}>
                                  {item.tipo_cliente}
                                </span>
                              </div>
                              <p className="text-zinc-500 text-xs md:text-sm font-medium flex items-center gap-1 mt-0.5 truncate">
                                <MapPin size={12} className="text-zinc-300" />
                                {item.direccion}, {item.localidad}
                              </p>
                              {item.status === 'pendiente' && userLocation && item.latitud && item.longitud && (
                                <p className="text-[9px] md:text-[10px] font-bold text-indigo-500 mt-1.5 md:mt-2 flex items-center gap-1">
                                  <Clock size={10} />
                                  A ~{calculateDistance(userLocation[0], userLocation[1], item.latitud, item.longitud).toFixed(1)} km
                                </p>
                              )}
                              
                              <div className="flex flex-wrap items-center gap-3 md:gap-4 mt-2 md:mt-3">
                                <span className="flex items-center gap-1 text-[10px] md:text-xs text-zinc-400">
                                  <Phone size={10} /> {item.telefono || 'Sin tel.'}
                                </span>
                                <span className={`flex items-center gap-1 text-[10px] md:text-xs font-bold ${item.saldo_cta_cte > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                  <AlertCircle size={10} /> Saldo: ${item.saldo_cta_cte.toFixed(2)}
                                </span>
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 md:mt-4">
                                <div className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${item.visitado ? 'bg-emerald-500' : 'bg-zinc-200'}`} />
                                  <span className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Visitado</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${item.venta_registrada ? 'bg-indigo-500' : 'bg-zinc-200'}`} />
                                  <span className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Venta</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${item.pedido_generado ? 'bg-amber-500' : 'bg-zinc-200'}`} />
                                  <span className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Pedido</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full ${item.cobranza_realizada ? 'bg-emerald-500' : 'bg-zinc-200'}`} />
                                  <span className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Cobranza</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col items-stretch md:items-end gap-2 md:gap-3">
                            {item.status === 'pendiente' ? (
                              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-end gap-2">
                                {hasPermission('routes', 'edit') && (
                                  <div className="flex items-center gap-1 bg-zinc-50 p-1 rounded-lg border border-zinc-100 col-span-2 sm:col-auto justify-center">
                                    <button
                                      onClick={() => handleReorderItem(todayRoute.id, item.id, 'up')}
                                      disabled={index === 0 || todayRoute.items?.[index-1].status !== 'pendiente'}
                                      className="p-2 hover:bg-white rounded-md text-zinc-400 disabled:opacity-20 transition-colors"
                                      title="Subir"
                                    >
                                      <ArrowUp size={16} />
                                    </button>
                                    <div className="w-px h-4 bg-zinc-200 mx-1" />
                                    <button
                                      onClick={() => handleReorderItem(todayRoute.id, item.id, 'down')}
                                      disabled={index === (todayRoute.items?.length || 0) - 1}
                                      className="p-2 hover:bg-white rounded-md text-zinc-400 disabled:opacity-20 transition-colors"
                                      title="Bajar"
                                    >
                                      <ArrowDown size={16} />
                                    </button>
                                  </div>
                                )}
                                {hasPermission('routes', 'edit') && (
                                  <button
                                    onClick={() => handleVisitNext(todayRoute.id, item.id)}
                                    className="px-3 md:px-4 py-2.5 md:py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-all flex items-center justify-center gap-2 text-xs md:text-sm"
                                  >
                                    <ArrowRight size={16} />
                                    <span className="whitespace-nowrap">Siguiente</span>
                                  </button>
                                )}
                                {hasPermission('routes', 'edit') && (
                                  <>
                                    <button
                                      onClick={() => handleUpdateItemStatus(item.id, 'omitido')}
                                      className="p-2.5 md:p-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-all flex items-center justify-center"
                                    >
                                      <XCircle size={18} />
                                    </button>
                                    <button
                                      onClick={() => handleUpdateItemStatus(item.id, 'visitado')}
                                      className="px-3 md:px-4 py-2.5 md:py-3 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 text-xs md:text-sm"
                                    >
                                      <Check size={16} />
                                      Visitar
                                    </button>
                                  </>
                                )}
                                {hasPermission('suppliers', 'create') && (
                                  <button
                                    onClick={() => {
                                      setSelectedItemForAction(item);
                                      setQuickActionType('pedido');
                                      setActionCart([]);
                                      setShowQuickActionModal(true);
                                    }}
                                    className="px-3 md:px-4 py-2.5 md:py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-all flex items-center justify-center gap-2 text-xs md:text-sm shadow-sm"
                                  >
                                    <ClipboardList size={16} />
                                    Pedido
                                  </button>
                                )}
                                {hasPermission('sales', 'create') && (
                                  <button
                                    onClick={() => {
                                      setSelectedItemForAction(item);
                                      setQuickActionType('venta');
                                      setActionCart([]);
                                      setShowQuickActionModal(true);
                                    }}
                                    className="px-3 md:px-4 py-2.5 md:py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 text-xs md:text-sm shadow-sm"
                                  >
                                    <ShoppingCart size={16} />
                                    Venta
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center justify-between md:justify-end gap-3">
                                <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase ${
                                  item.status === 'visitado' ? 'bg-emerald-100 text-emerald-700' : 
                                  item.status === 'venta realizada' ? 'bg-indigo-100 text-indigo-700' :
                                  item.status === 'pedido tomado' ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {item.status === 'visitado' ? <CheckCircle2 size={14} /> : 
                                   item.status === 'venta realizada' ? <ShoppingCart size={14} /> :
                                   item.status === 'pedido tomado' ? <ClipboardList size={14} /> :
                                   <XCircle size={14} />}
                                  {item.status}
                                </div>
                                <button
                                  onClick={() => handleUpdateItemStatus(item.id, 'pendiente')}
                                  className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                                  title="Deshacer"
                                >
                                  <Clock size={16} />
                                </button>
                              </div>
                            )}
                            <button
                              onClick={() => setShowCustomerDetailId(item.cliente_id)}
                              className="text-[10px] md:text-xs font-bold text-zinc-400 hover:text-zinc-900 flex items-center justify-center md:justify-end gap-1 transition-all py-1"
                            >
                              Ver Ficha <ArrowRight size={12} />
                            </button>
                          </div>
                        </div>

                        {item.notes && (
                          <div className="mt-4 p-3 bg-zinc-50 rounded-xl border border-zinc-100 flex items-start gap-2">
                            <MessageSquare size={14} className="text-zinc-400 mt-0.5" />
                            <p className="text-xs text-zinc-600 italic">{item.notes}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'historial' && (
            <motion.div
              key="historial"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-6xl mx-auto"
            >
              <div className="bg-white rounded-[40px] border border-zinc-200 shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/50">
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Nombre de Ruta</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Visitados</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Ventas</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Pedidos</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Estado</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {routes.map(route => (
                      <tr key={route.id} className="hover:bg-zinc-50/50 transition-colors group">
                        <td className="px-8 py-6 text-sm font-medium text-zinc-600">
                          {new Date(route.date).toLocaleDateString()}
                        </td>
                        <td className="px-8 py-6">
                          <p className="text-sm font-bold text-zinc-900">{route.name}</p>
                          <p className="text-[10px] text-zinc-400 font-medium">Creada el {new Date(route.created_at).toLocaleDateString()}</p>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <div className="inline-flex flex-col items-center">
                            <p className="text-sm font-black text-zinc-900">{route.visited_customers} / {route.total_customers}</p>
                            <div className="w-16 h-1 bg-zinc-100 rounded-full mt-1 overflow-hidden">
                              <div 
                                className="h-full bg-zinc-900 transition-all duration-500" 
                                style={{ width: `${(route.visited_customers! / route.total_customers!) * 100}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
                            {route.sales_count || 0}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <span className="text-sm font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                            {route.orders_count || 0}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            route.status === 'finalizada' ? 'bg-emerald-50 text-emerald-600' :
                            route.status === 'en curso' ? 'bg-blue-50 text-blue-600' :
                            route.status === 'cancelada' ? 'bg-red-50 text-red-600' :
                            'bg-zinc-100 text-zinc-500'
                          }`}>
                            {route.status}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedRouteForDetail(route);
                              }}
                              className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                            >
                              <Eye size={18} />
                            </button>
                            {hasPermission('routes', 'delete') && (
                              <button
                                onClick={() => handleDeleteRoute(route.id)}
                                className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                              >
                                <Trash2 size={18} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {routes.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-20 text-center text-zinc-400">
                          <Map size={48} className="mx-auto mb-4 opacity-10" />
                          <p className="text-sm font-medium">No hay rutas registradas en el historial</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Customer Detail Modal Overlay */}
      {showCustomerDetailId && (
        <CustomerDetail 
          clienteId={showCustomerDetailId} 
          onClose={() => setShowCustomerDetailId(null)} 
        />
      )}

      {/* Route Detail Modal */}
      {selectedRouteForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[40px] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div>
                <h2 className="text-2xl font-black text-zinc-900">{selectedRouteForDetail.name}</h2>
                <p className="text-sm font-medium text-zinc-500">
                  {new Date(selectedRouteForDetail.date).toLocaleDateString()} • {selectedRouteForDetail.status}
                </p>
              </div>
              <button
                onClick={() => setSelectedRouteForDetail(null)}
                className="p-3 hover:bg-white rounded-2xl transition-all text-zinc-400 hover:text-zinc-900 shadow-sm"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-4 gap-4 mb-8">
                <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Clientes</p>
                  <p className="text-2xl font-black text-zinc-900">{selectedRouteForDetail.total_customers}</p>
                </div>
                <div className="p-6 bg-emerald-50 rounded-3xl border border-emerald-100">
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1">Visitados</p>
                  <p className="text-2xl font-black text-emerald-600">{selectedRouteForDetail.visited_customers}</p>
                </div>
                <div className="p-6 bg-indigo-50 rounded-3xl border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Ventas</p>
                  <p className="text-2xl font-black text-indigo-600">{selectedRouteForDetail.sales_count || 0}</p>
                </div>
                <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1">Pedidos</p>
                  <p className="text-2xl font-black text-amber-600">{selectedRouteForDetail.orders_count || 0}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-black text-zinc-900">Listado de Clientes</h3>
                <div className="bg-white rounded-3xl border border-zinc-100 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-50/50">
                        <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                        <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Estado</th>
                        <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Notas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {selectedRouteForDetail.items?.map((item) => (
                        <tr key={item.id} className="hover:bg-zinc-50/30 transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-zinc-900">{item.nombre_apellido}</p>
                            <p className="text-[10px] text-zinc-400">{item.localidad}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              item.status === 'venta realizada' ? 'bg-emerald-50 text-emerald-600' :
                              item.status === 'pedido tomado' ? 'bg-amber-50 text-amber-600' :
                              item.status === 'visitado' ? 'bg-blue-50 text-blue-600' :
                              item.status === 'omitido' ? 'bg-red-50 text-red-600' :
                              'bg-zinc-100 text-zinc-500'
                            }`}>
                              {item.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs text-zinc-500 italic">
                            {item.notes || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Proximity Alert Modal */}
      <AnimatePresence>
        {showProximityAlert && nearbyClient && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4">
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9, x: '-50%' }}
              animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
              exit={{ opacity: 0, y: 50, scale: 0.9, x: '-50%' }}
              className="bg-zinc-900/95 backdrop-blur-md text-white p-6 rounded-[32px] shadow-2xl border border-white/10 flex flex-col gap-4"
              style={{ left: '50%', position: 'fixed' }}
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center shrink-0 animate-pulse shadow-lg shadow-indigo-500/20">
                  <BellRing size={24} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-black tracking-tight leading-tight">¡Llegaste a destino!</h3>
                  <p className="text-white/60 text-sm font-medium truncate">{nearbyClient.nombre_apellido}</p>
                </div>
                <button 
                  onClick={() => setShowProximityAlert(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <XCircle size={20} className="text-white/40" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setShowProximityAlert(false);
                    handleUpdateItemStatus(nearbyClient.id, 'visitado');
                  }}
                  className="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-white/5"
                >
                  <Check size={16} />
                  Solo Visita
                </button>
                <button
                  onClick={() => {
                    setShowProximityAlert(false);
                    setSelectedItemForAction(nearbyClient);
                    setQuickActionType('venta');
                    setActionCart([]);
                    setShowQuickActionModal(true);
                  }}
                  className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <ShoppingCart size={16} />
                  Venta
                </button>
                <button
                  onClick={() => {
                    setShowProximityAlert(false);
                    setSelectedItemForAction(nearbyClient);
                    setQuickActionType('pedido');
                    setActionCart([]);
                    setShowQuickActionModal(true);
                  }}
                  className="px-4 py-3 bg-amber-500 hover:bg-amber-600 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
                >
                  <ClipboardList size={16} />
                  Pedido
                </button>
                <button
                  onClick={() => {
                    setShowProximityAlert(false);
                    setSelectedItemForAction(nearbyClient);
                    setQuickActionType('pago');
                    setPaymentAmount(0);
                    setShowQuickActionModal(true);
                  }}
                  className="px-4 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  <AlertCircle size={16} />
                  Pago
                </button>
                <button
                  onClick={() => {
                    setShowMap(true);
                    // The map will automatically center on user/items if we trigger a re-render or if we had a panTo function
                    // For now, just showing the map is a good start.
                    setShowProximityAlert(false);
                  }}
                  className="col-span-2 px-4 py-2 text-[10px] font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest"
                >
                  Ver en el mapa
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quick Action Modal */}
      {showQuickActionModal && selectedItemForAction && (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[32px] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className={`p-6 flex items-center justify-between text-white ${
              quickActionType === 'venta' ? 'bg-indigo-600' : 
              quickActionType === 'pedido' ? 'bg-amber-500' : 'bg-emerald-500'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  {quickActionType === 'venta' ? <ShoppingCart size={20} /> : 
                   quickActionType === 'pedido' ? <ClipboardList size={20} /> : <AlertCircle size={20} />}
                </div>
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tight">
                    Registrar {quickActionType === 'venta' ? 'Venta' : quickActionType === 'pedido' ? 'Pedido' : 'Pago'}
                  </h3>
                  <p className="text-white/80 text-xs font-bold">Cliente: {selectedItemForAction.nombre_apellido}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowQuickActionModal(false)}
                className="p-2 hover:bg-white/20 rounded-xl transition-all"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {quickActionType === 'pago' ? (
                <div className="flex-1 p-8 flex flex-col items-center justify-center space-y-6">
                  <div className="w-full max-w-sm space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Monto del Pago</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-zinc-300">$</span>
                        <input 
                          type="number"
                          value={paymentAmount || ''}
                          onChange={(e) => setPaymentAmount(Number(e.target.value))}
                          placeholder="0.00"
                          className="w-full pl-10 pr-4 py-6 bg-zinc-50 border-2 border-zinc-100 rounded-[24px] focus:border-emerald-500 outline-none text-4xl font-black text-zinc-900 font-mono"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Método de Pago</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['efectivo', 'transferencia', 'cheque', 'otro'].map(method => (
                          <button
                            key={method}
                            onClick={() => setPaymentMethod(method)}
                            className={`py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border-2 ${
                              paymentMethod === method 
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-700' 
                                : 'bg-white border-zinc-100 text-zinc-400 hover:border-zinc-200'
                            }`}
                          >
                            {method}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="w-full max-w-sm pt-6">
                    <button
                      onClick={handleConfirmQuickAction}
                      disabled={paymentAmount <= 0}
                      className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Check size={20} />
                      Confirmar Pago
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Product Selection */}
                  <div className="flex-1 p-6 border-r border-zinc-100 flex flex-col overflow-hidden">
                    <div className="relative mb-6">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                      <input 
                        type="text"
                        placeholder="Buscar productos..."
                        className="w-full pl-10 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm"
                        onChange={(e) => {
                          const term = e.target.value.toLowerCase();
                          // Local filtering would go here if needed
                        }}
                      />
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                      {products.filter(p => p.estado === 'activo').map(product => (
                        <button
                          key={product.id}
                          onClick={() => {
                            setActionCart(prev => {
                              const existing = prev.find(item => item.productId === product.id);
                              if (existing) {
                                return prev.map(item => 
                                  item.productId === product.id 
                                    ? { ...item, quantity: item.quantity + 1 } 
                                    : item
                                );
                              }
                              return [...prev, { productId: product.id, quantity: 1 }];
                            });
                          }}
                          className="w-full flex items-center justify-between p-3 bg-white border border-zinc-100 rounded-2xl hover:border-zinc-900 transition-all group"
                        >
                          <div className="text-left">
                            <p className="text-sm font-bold text-zinc-900">{product.name}</p>
                            <p className="text-[10px] text-zinc-400 font-mono">${product.sale_price.toFixed(2)}</p>
                          </div>
                          <Plus size={16} className="text-zinc-300 group-hover:text-zinc-900" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Cart Summary */}
                  <div className="w-80 p-6 bg-zinc-50 flex flex-col">
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Productos Seleccionados</h4>
                    <div className="flex-1 overflow-y-auto space-y-3 mb-6 pr-2 custom-scrollbar">
                      {actionCart.map(item => {
                        const product = products.find(p => p.id === item.productId);
                        return (
                          <div key={item.productId} className="flex items-center gap-3 bg-white p-3 rounded-xl border border-zinc-200 shadow-sm">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-zinc-900 truncate">{product?.name}</p>
                              <p className="text-[10px] text-zinc-400">${((product?.sale_price || 0) * item.quantity).toFixed(2)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  setActionCart(prev => prev.map(i => 
                                    i.productId === item.productId 
                                      ? { ...i, quantity: Math.max(1, i.quantity - 1) } 
                                      : i
                                  ));
                                }}
                                className="p-1 hover:bg-zinc-100 rounded-md"
                              >
                                <Minus size={12} />
                              </button>
                              <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                              <button 
                                onClick={() => {
                                  setActionCart(prev => prev.map(i => 
                                    i.productId === item.productId 
                                      ? { ...i, quantity: i.quantity + 1 } 
                                      : i
                                  ));
                                }}
                                className="p-1 hover:bg-zinc-100 rounded-md"
                              >
                                <Plus size={12} />
                              </button>
                              <button 
                                onClick={() => setActionCart(prev => prev.filter(i => i.productId !== item.productId))}
                                className="p-1 text-red-400 hover:text-red-600 ml-1"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {actionCart.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-300">
                          <ShoppingCart size={32} className="mb-2 opacity-10" />
                          <p className="text-[10px] font-bold uppercase">Sin productos</p>
                        </div>
                      )}
                    </div>

                    <div className="mb-4">
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Observaciones</label>
                      <textarea
                        value={actionNotes}
                        onChange={(e) => setActionNotes(e.target.value)}
                        placeholder="Notas adicionales..."
                        className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-xs font-medium resize-none h-20"
                      />
                    </div>

                    <div className="pt-4 border-t border-zinc-200 mt-auto">
                      {quickActionType === 'venta' && (
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-xs font-bold text-zinc-500 uppercase">Total</span>
                          <span className="text-2xl font-black text-zinc-900 font-mono">
                            ${actionCart.reduce((sum, item) => {
                              const product = products.find(p => p.id === item.productId);
                              return sum + (product?.sale_price || 0) * item.quantity;
                            }, 0).toFixed(2)}
                          </span>
                        </div>
                      )}
                      <button
                        disabled={actionCart.length === 0}
                        onClick={handleConfirmQuickAction}
                        className={`w-full py-4 rounded-2xl text-white font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg ${
                          quickActionType === 'venta' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-amber-500 hover:bg-amber-600'
                        }`}
                      >
                        <CheckCircle2 size={18} />
                        Confirmar {quickActionType === 'venta' ? 'Venta' : 'Pedido'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
