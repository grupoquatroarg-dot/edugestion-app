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
  BellRing,
  RefreshCw,
  Loader2,
  Navigation,
  History,
  Route as RouteIcon,
  DollarSign,
  PackageCheck,
  WalletCards,
  X,
  RotateCcw,
  LocateFixed,
  ListOrdered
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import CustomerDetail from './CustomerDetail';
import RouteMap from './RouteMap';
import { unwrapResponse, apiFetch } from '../utils/api';
import { addBusinessDays, formatBusinessDate, getBusinessDateInputValue } from '../utils/businessDate';

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
  const { hasPermission } = useAuth();
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
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [quickActionSaving, setQuickActionSaving] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<number | null>(null);
  const [routeActionId, setRouteActionId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'complete' | 'delete'; routeId: number; routeName: string } | null>(null);

  // Planning state
  const [planDate, setPlanDate] = useState(() => addBusinessDays(getBusinessDateInputValue(), 1));
  const [planName, setPlanName] = useState('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), type === 'success' ? 3200 : 5200);
  };

  const readApiError = async (response: Response, fallback: string) => {
    try {
      const body = await response.json();
      return body?.message || body?.error || fallback;
    } catch {
      return fallback;
    }
  };

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
  const fetchInitialData = async (showFullLoader: boolean = true) => {
    if (showFullLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setLoadError(null);

    try {
      const responses = await Promise.all([
        apiFetch('/api/clientes?endpoint=routes'),
        apiFetch('/api/clientes?endpoint=routes-today'),
        apiFetch('/api/clientes'),
        apiFetch('/api/products')
      ]);

      const failed = responses.find(response => !response.ok);
      if (failed) {
        throw new Error(await readApiError(failed, 'No se pudieron cargar las rutas.'));
      }

      const [routesBody, todayBody, clientesBody, productsBody] = await Promise.all(
        responses.map(response => response.json())
      );

      setRoutes(unwrapResponse(routesBody));
      setTodayRoute(unwrapResponse(todayBody));
      setClientes(unwrapResponse(clientesBody));
      setProducts(unwrapResponse(productsBody));

      const tomorrow = formatBusinessDate(addBusinessDays(getBusinessDateInputValue(), 1));
      setPlanName(current => current || `Ruta ${tomorrow}`);
    } catch (error: any) {
      console.error('Error fetching route data:', error);
      setLoadError(error?.message || 'No se pudieron cargar los datos de rutas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!selectedRouteForDetail || selectedRouteForDetail.items) return;

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    apiFetch(`/api/clientes?endpoint=routes&id=${selectedRouteForDetail.id}`)
      .then(async response => {
        if (!response.ok) {
          throw new Error(await readApiError(response, 'No se pudo cargar el detalle de la ruta.'));
        }
        return response.json();
      })
      .then(body => {
        if (!cancelled) setSelectedRouteForDetail(unwrapResponse(body));
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Error fetching route detail:', error);
        setDetailError(error?.message || 'No se pudo cargar el detalle de la ruta.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRouteForDetail?.id]);

  const fetchRoutes = async () => {
    try {
      const res = await apiFetch('/api/clientes?endpoint=routes');
      const body = await res.json();
      const data = unwrapResponse(body);
      setRoutes(data);
    } catch (error) {
      console.error("Error fetching routes:", error);
    }
  };

  const fetchTodayRoute = async () => {
    try {
      const res = await apiFetch('/api/clientes?endpoint=routes-today');
      const body = await res.json();
      const data = unwrapResponse(body);
      setTodayRoute(data);
    } catch (error) {
      console.error("Error fetching today's route:", error);
    }
  };

  const handleCreateRoute = async () => {
    if (selectedCustomerIds.length === 0) {
      showNotification('error', 'Seleccioná al menos un cliente para la ruta.');
      return;
    }

    setSavingRoute(true);
    try {
      const res = await apiFetch('/api/clientes?endpoint=routes', {
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
        showNotification('success', 'Ruta planificada correctamente.');
        setSelectedCustomerIds([]);
        await fetchInitialData(false);
        setActiveTab('historial');
      } else {
        const errorData = unwrapResponse(body);
        showNotification('error', errorData.message || 'No se pudo crear la ruta.');
      }
    } catch (error) {
      console.error("Error creating route:", error);
      showNotification('error', 'No se pudo crear la ruta.');
    } finally {
      setSavingRoute(false);
    }
  };

  const handleConfirmQuickAction = async () => {
    if (!selectedItemForAction || quickActionSaving) return;

    setQuickActionSaving(true);
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
            showNotification('success', data.message);
            await handleUpdateItemStatus(selectedItemForAction.id, 'pedido tomado');
          } else {
            await handleUpdateItemStatus(selectedItemForAction.id, 'venta realizada');
            showNotification('success', 'Venta registrada correctamente.');
          }
        } else {
          const body = await res.json();
          const errorData = unwrapResponse(body);
          showNotification('error', errorData.message || 'No se pudo procesar la venta.');
        }
      } else if (quickActionType === 'pedido') {
        if (actionCart.length === 0) return;
        // Register order
        const res = await apiFetch('/api/clientes?endpoint=route-supplier-order', {
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
          showNotification('success', 'Pedido registrado correctamente.');
        } else {
          const errorData = unwrapResponse(body);
          showNotification('error', errorData.message || 'No se pudo procesar el pedido.');
        }
      } else if (quickActionType === 'pago') {
        if (paymentAmount <= 0) return;
        // Register payment
        const res = await apiFetch(`/api/sales?endpoint=client-payment&id=${selectedItemForAction.cliente_id}`, {
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
          showNotification('success', 'Cobro registrado correctamente.');
        } else {
          const errorData = unwrapResponse(body);
          showNotification('error', errorData.message || 'No se pudo registrar el pago.');
        }
      }
      setActionNotes('');
      setShowQuickActionModal(false);
      fetchTodayRoute();
    } catch (error) {
      console.error("Error confirming quick action:", error);
      showNotification('error', 'No se pudo completar la operación.');
    } finally {
      setQuickActionSaving(false);
    }
  };

  const handleUpdateItemStatus = async (itemId: number, status: 'visitado' | 'omitido' | 'pendiente' | 'pedido tomado' | 'venta realizada', notes: string = '', extraFields: any = {}) => {
    setUpdatingItemId(itemId);
    try {
      // If the route is still 'planificada', update it to 'en curso'
      if (todayRoute && todayRoute.status === 'planificada') {
        const routeRes = await apiFetch(`/api/clientes?endpoint=routes&id=${todayRoute.id}`, {
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

      const res = await apiFetch(`/api/clientes?endpoint=route-item&id=${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });

      const resBody = await res.json();
      if (res.ok) {
        unwrapResponse(resBody);
        fetchTodayRoute();
      } else {
        const errorData = unwrapResponse(resBody);
        showNotification('error', errorData.message || 'No se pudo actualizar el estado.');
      }
    } catch (error) {
      console.error("Error updating route item:", error);
      showNotification('error', 'No se pudo actualizar la visita.');
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleCompleteRoute = async (routeId: number) => {
    setRouteActionId(routeId);
    try {
      const res = await apiFetch(`/api/clientes?endpoint=routes&id=${routeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'finalizada' })
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        await fetchInitialData(false);
        setActiveTab('historial');
      } else {
        const errorData = unwrapResponse(body);
        showNotification('error', errorData.message || 'No se pudo finalizar la ruta.');
      }
    } catch (error) {
      console.error("Error completing route:", error);
      showNotification('error', 'No se pudo finalizar la ruta.');
    } finally {
      setRouteActionId(null);
      setConfirmAction(null);
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
      const res = await apiFetch(`/api/clientes?endpoint=routes-reorder&id=${routeId}`, {
        method: 'POST',
        body: JSON.stringify({ items: reorderedItems })
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        fetchTodayRoute();
      } else {
        const errorData = unwrapResponse(body);
        showNotification('error', errorData.message || 'No se pudo actualizar el orden de la ruta.');
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
      const res = await apiFetch(`/api/clientes?endpoint=routes-reorder&id=${routeId}`, {
        method: 'POST',
        body: JSON.stringify({ items: reorderedItems })
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        fetchTodayRoute();
      } else {
        const errorData = unwrapResponse(body);
        showNotification('error', errorData.message || 'No se pudo actualizar el orden de la ruta.');
      }
    } catch (error) {
      console.error("Error reordering items:", error);
    }
  };

  const handleDeleteRoute = async (routeId: number) => {
    setRouteActionId(routeId);
    try {
      const res = await apiFetch(`/api/clientes?endpoint=routes&id=${routeId}`, {
        method: 'DELETE'
      });

      const body = await res.json();
      if (res.ok) {
        unwrapResponse(body);
        await fetchRoutes();
        showNotification('success', 'Ruta eliminada correctamente.');
      } else {
        const errorData = unwrapResponse(body);
        showNotification('error', errorData.message || 'No se pudo eliminar la ruta.');
      }
    } catch (error) {
      console.error("Error deleting route:", error);
      showNotification('error', 'No se pudo eliminar la ruta.');
    } finally {
      setRouteActionId(null);
      setConfirmAction(null);
    }
  };

  const optimizeRoute = () => {
    if (selectedCustomerIds.length === 0 || !userLocation) {
      if (!userLocation) showNotification('error', 'Se requiere tu ubicación actual para optimizar la ruta.');
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

  const todayItems = todayRoute?.items || [];
  const completedToday = todayItems.filter(item => item.status !== 'pendiente').length;
  const pendingToday = todayItems.filter(item => item.status === 'pendiente').length;
  const salesToday = todayItems.filter(item => item.venta_registrada || item.status === 'venta realizada').length;
  const ordersToday = todayItems.filter(item => item.pedido_generado || item.status === 'pedido tomado').length;
  const selectedCustomers = selectedCustomerIds
    .map(id => clientes.find(cliente => cliente.id === id))
    .filter(Boolean);
  const selectedDistance = (() => {
    if (!userLocation || selectedCustomers.length === 0) return 0;
    let total = 0;
    let current: [number, number] = userLocation;
    selectedCustomers.forEach((cliente: any) => {
      if (cliente.latitud && cliente.longitud) {
        total += calculateDistance(current[0], current[1], cliente.latitud, cliente.longitud);
        current = [cliente.latitud, cliente.longitud];
      }
    });
    return total;
  })();
  const selectedMinutes = Math.round((selectedDistance / 30) * 60) + selectedCustomers.length * 10;
  const activeProducts = products.filter(product => {
    const active = product.estado === 'activo';
    const term = productSearch.trim().toLowerCase();
    if (!term) return active;
    return active && [product.name, product.code, product.family_name, product.empresa]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(term));
  });
  const routeProgress = todayItems.length > 0 ? Math.round((completedToday / todayItems.length) * 100) : 0;
  const formatCurrency = (value: number | null | undefined) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value || 0));
  const formatDate = (value: string) => formatBusinessDate(value);
  const routeStatusClasses = (status: Route['status']) => {
    if (status === 'finalizada') return 'bg-emerald-100 text-emerald-700';
    if (status === 'en curso') return 'bg-indigo-100 text-indigo-700';
    if (status === 'cancelada') return 'bg-rose-100 text-rose-700';
    return 'bg-amber-100 text-amber-700';
  };
  const itemStatusClasses = (status: RouteItem['status']) => {
    if (status === 'visitado') return 'border-emerald-200 bg-emerald-50/70 text-emerald-700';
    if (status === 'venta realizada') return 'border-indigo-200 bg-indigo-50/70 text-indigo-700';
    if (status === 'pedido tomado') return 'border-amber-200 bg-amber-50/70 text-amber-700';
    if (status === 'omitido') return 'border-rose-200 bg-rose-50/70 text-rose-700';
    return 'border-slate-200 bg-white text-slate-700';
  };

  if (loading) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-5 lg:px-8">
        <div className="mx-auto w-full max-w-[1500px] animate-pulse space-y-5">
          <div className="h-48 rounded-[28px] bg-slate-200" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map(item => <div key={item} className="h-14 rounded-2xl bg-slate-200" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-96 rounded-[28px] bg-white" />
            <div className="h-96 rounded-[28px] bg-white" />
          </div>
          <div className="flex items-center justify-center gap-3 py-4 text-sm font-bold text-slate-500">
            <Loader2 size={20} className="animate-spin text-indigo-600" />
            Cargando rutas y clientes...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50">
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-3 py-4 pb-24 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
        <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-5 text-white shadow-xl sm:p-7 lg:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10">
                  <RouteIcon size={25} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200">Logística comercial</p>
                  <h1 className="mt-1 break-words text-2xl font-black tracking-tight sm:text-3xl">Ruta del día</h1>
                </div>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
                Planificá recorridos, registrá visitas y seguí ventas o pedidos desde cualquier dispositivo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchInitialData(false)}
              disabled={refreshing}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-lg transition hover:bg-indigo-50 disabled:opacity-60 sm:w-auto"
            >
              <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Actualizando...' : 'Actualizar datos'}
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="min-w-0 rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ruta de hoy</p>
              <p className="mt-1 break-words text-lg font-black">{todayRoute ? todayRoute.name : 'Sin planificar'}</p>
            </div>
            <div className="rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Clientes</p>
              <p className="mt-1 text-2xl font-black">{todayItems.length}</p>
            </div>
            <div className="rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Completados</p>
              <p className="mt-1 text-2xl font-black text-emerald-300">{completedToday}</p>
            </div>
            <div className="rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Historial</p>
              <p className="mt-1 text-2xl font-black text-indigo-200">{routes.length}</p>
            </div>
          </div>
        </section>

        {notification && (
          <div className={`flex min-w-0 items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm ${notification.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            <div className="flex min-w-0 items-start gap-2">
              {notification.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
              <span className="break-words">{notification.message}</span>
            </div>
            <button type="button" onClick={() => setNotification(null)} className="shrink-0 rounded-lg p-1 hover:bg-black/5" aria-label="Cerrar mensaje"><X size={16} /></button>
          </div>
        )}

        {loadError && (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-rose-800">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <AlertCircle size={22} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-black">No se pudieron cargar las rutas</p>
                  <p className="mt-1 break-words text-sm">{loadError}</p>
                </div>
              </div>
              <button type="button" onClick={() => fetchInitialData(true)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white sm:w-auto">
                <RefreshCw size={17} /> Reintentar
              </button>
            </div>
          </div>
        )}

        <nav className={`grid ${hasPermission('routes', 'create') ? 'grid-cols-3' : 'grid-cols-2'} gap-2 rounded-[22px] border border-slate-200 bg-white p-2 shadow-sm`} aria-label="Secciones de rutas">
          {hasPermission('routes', 'create') && (
            <button type="button" onClick={() => setActiveTab('planificar')} className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center text-xs font-black transition sm:flex-row sm:text-sm ${activeTab === 'planificar' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
              <Plus size={17} className="shrink-0" /><span className="break-words">Planificar</span>
            </button>
          )}
          <button type="button" onClick={() => setActiveTab('hoy')} className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center text-xs font-black transition sm:flex-row sm:text-sm ${activeTab === 'hoy' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
            <Navigation size={17} className="shrink-0" /><span className="break-words">Ruta de hoy</span>
          </button>
          <button type="button" onClick={() => setActiveTab('historial')} className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center text-xs font-black transition sm:flex-row sm:text-sm ${activeTab === 'historial' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
            <History size={17} className="shrink-0" /><span className="break-words">Historial</span>
          </button>
        </nav>

        <AnimatePresence mode="wait">
          {activeTab === 'planificar' && (
            <motion.div key="planificar" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-5">
              <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700"><Calendar size={21} /></div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-slate-900">Datos de la nueva ruta</h2>
                    <p className="mt-1 text-sm text-slate-500">Elegí la fecha, el nombre y los clientes que formarán parte del recorrido.</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="min-w-0">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Fecha</span>
                    <input type="date" value={planDate} onChange={event => setPlanDate(event.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
                  </label>
                  <label className="min-w-0">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Nombre de la ruta</span>
                    <input type="text" value={planName} onChange={event => setPlanName(event.target.value)} placeholder="Ejemplo: Ruta zona norte" className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
                  </label>
                </div>
              </section>

              <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.78fr)]">
                <section className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-lg font-black text-slate-900">Seleccionar clientes</h2>
                      <p className="mt-1 text-sm text-slate-500">{filteredClientes.length} disponibles · {selectedCustomerIds.length} seleccionados</p>
                    </div>
                    <label className="relative block w-full sm:max-w-sm">
                      <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="search" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Nombre, razón social o localidad" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
                    </label>
                  </div>

                  <div className="mt-5 grid max-h-[620px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-2">
                    {filteredClientes.map(cliente => {
                      const selected = selectedCustomerIds.includes(cliente.id);
                      return (
                        <button key={cliente.id} type="button" onClick={() => toggleCustomerSelection(cliente.id)} className={`min-h-24 min-w-0 rounded-2xl border p-4 text-left transition ${selected ? 'border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-black">{cliente.nombre_apellido}</p>
                              <p className={`mt-1 break-words text-xs ${selected ? 'text-indigo-100' : 'text-slate-500'}`}>{cliente.razon_social || 'Sin razón social'}</p>
                              <p className={`mt-2 flex items-start gap-1 break-words text-xs ${selected ? 'text-indigo-100' : 'text-slate-500'}`}><MapPin size={13} className="mt-0.5 shrink-0" />{cliente.localidad || 'Sin localidad'}</p>
                            </div>
                            {selected ? <CheckCircle2 size={20} className="shrink-0" /> : <Plus size={20} className="shrink-0 text-slate-300" />}
                          </div>
                        </button>
                      );
                    })}
                    {filteredClientes.length === 0 && (
                      <div className="col-span-full rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
                        <Users size={34} className="mx-auto text-slate-300" />
                        <p className="mt-3 font-black text-slate-800">No hay clientes que coincidan</p>
                        <p className="mt-1 text-sm text-slate-500">Probá con otro nombre, razón social o localidad.</p>
                      </div>
                    )}
                  </div>
                </section>

                <div className="min-w-0 space-y-5">
                  <section className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h2 className="text-lg font-black text-slate-900">Orden de visita</h2>
                        <p className="mt-1 text-sm text-slate-500">Reordená el recorrido antes de guardarlo.</p>
                      </div>
                      {selectedCustomerIds.length > 1 && (
                        <button type="button" onClick={optimizeRoute} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 hover:bg-indigo-100 sm:w-auto"><LocateFixed size={17} />Optimizar</button>
                      )}
                    </div>

                    <div className="mt-4 space-y-3">
                      {selectedCustomers.map((cliente: any, index) => (
                        <article key={cliente.id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-black text-indigo-700 shadow-sm ring-1 ring-slate-200">{index + 1}</div>
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm font-black text-slate-900">{cliente.nombre_apellido}</p>
                              <p className="mt-1 flex items-start gap-1 break-words text-xs text-slate-500"><MapPin size={13} className="mt-0.5 shrink-0" />{cliente.direccion || 'Sin dirección'}, {cliente.localidad || 'Sin localidad'}</p>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => moveCustomer(index, 'up')} disabled={index === 0} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-30"><ArrowUp size={15} />Subir</button>
                            <button type="button" onClick={() => moveCustomer(index, 'down')} disabled={index === selectedCustomers.length - 1} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-30"><ArrowDown size={15} />Bajar</button>
                            <button type="button" onClick={() => toggleCustomerSelection(cliente.id)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700"><Trash2 size={15} />Quitar</button>
                          </div>
                        </article>
                      ))}
                      {selectedCustomers.length === 0 && (
                        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-7 text-center">
                          <ListOrdered size={32} className="mx-auto text-slate-300" />
                          <p className="mt-3 font-black text-slate-800">Todavía no seleccionaste clientes</p>
                          <p className="mt-1 text-sm text-slate-500">Elegí clientes del listado para armar el orden de visita.</p>
                        </div>
                      )}
                    </div>

                    {selectedCustomers.length > 0 && (
                      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-950 p-3 text-white">
                        <div className="min-w-0 text-center"><p className="text-[9px] font-bold uppercase text-slate-400">Paradas</p><p className="mt-1 text-lg font-black">{selectedCustomers.length}</p></div>
                        <div className="min-w-0 text-center"><p className="text-[9px] font-bold uppercase text-slate-400">Distancia</p><p className="mt-1 break-words text-lg font-black">~{selectedDistance.toFixed(1)} km</p></div>
                        <div className="min-w-0 text-center"><p className="text-[9px] font-bold uppercase text-slate-400">Tiempo</p><p className="mt-1 break-words text-lg font-black">{selectedMinutes < 60 ? `${selectedMinutes} min` : `${Math.floor(selectedMinutes / 60)}h ${selectedMinutes % 60}m`}</p></div>
                      </div>
                    )}
                  </section>

                  <section className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="min-w-0"><h2 className="text-lg font-black text-slate-900">Mapa del recorrido</h2><p className="mt-1 text-sm text-slate-500">Vista previa según el orden seleccionado.</p></div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{selectedCustomers.length}</span>
                    </div>
                    <RouteMap items={selectedCustomers.map((cliente: any) => ({ ...cliente, status: 'pendiente' }))} userLocation={userLocation} className="h-[300px] sm:h-[380px]" />
                  </section>

                  <button type="button" onClick={handleCreateRoute} disabled={selectedCustomerIds.length === 0 || savingRoute} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {savingRoute ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                    {savingRoute ? 'Guardando ruta...' : 'Guardar y planificar ruta'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'hoy' && (
            <motion.div key="hoy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-5">
              {!todayRoute ? (
                <section className="rounded-[28px] border-2 border-dashed border-slate-200 bg-white p-8 text-center sm:p-12">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100 text-slate-400"><Navigation size={38} /></div>
                  <h2 className="mt-5 text-xl font-black text-slate-900">No hay una ruta planificada para hoy</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Creá una ruta para organizar visitas, ventas y pedidos del día.</p>
                  {hasPermission('routes', 'create') && <button type="button" onClick={() => setActiveTab('planificar')} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white sm:w-auto"><Plus size={18} />Planificar ahora</button>}
                </section>
              ) : (
                <>
                  <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-indigo-700 to-indigo-950 p-5 text-white shadow-xl sm:p-7">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider">Ruta activa</span><span className="text-xs font-semibold text-indigo-200">{formatDate(todayRoute.date)}</span></div>
                        <h2 className="mt-3 break-words text-2xl font-black sm:text-3xl">{todayRoute.name}</h2>
                        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${routeProgress}%` }} /></div>
                        <p className="mt-2 text-sm text-indigo-100">{completedToday} de {todayItems.length} visitas procesadas · {routeProgress}%</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        <button type="button" onClick={() => setShowMap(value => !value)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-white hover:bg-white/20"><Map size={17} />{showMap ? 'Ocultar mapa' : 'Ver mapa'}</button>
                        {todayRoute.status === 'planificada' && hasPermission('routes', 'edit') && (
                          <button type="button" onClick={async () => { try { const response = await apiFetch(`/api/clientes?endpoint=routes&id=${todayRoute.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'en curso' }) }); if (!response.ok) throw new Error(await readApiError(response, 'No se pudo iniciar la ruta.')); await response.json(); await fetchTodayRoute(); showNotification('success', 'Ruta iniciada.'); } catch (error: any) { showNotification('error', error?.message || 'No se pudo iniciar la ruta.'); } }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-white hover:bg-emerald-600"><ArrowRight size={17} />Iniciar</button>
                        )}
                        {hasPermission('routes', 'edit') && (
                          <button type="button" onClick={() => setConfirmAction({ type: 'complete', routeId: todayRoute.id, routeName: todayRoute.name })} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-indigo-900 sm:col-auto"><CheckCircle2 size={17} />Finalizar ruta</button>
                        )}
                      </div>
                    </div>
                    <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <div className="rounded-2xl bg-white/10 p-3 text-center"><p className="text-[9px] font-bold uppercase text-indigo-200">Pendientes</p><p className="mt-1 text-xl font-black">{pendingToday}</p></div>
                      <div className="rounded-2xl bg-white/10 p-3 text-center"><p className="text-[9px] font-bold uppercase text-indigo-200">Procesados</p><p className="mt-1 text-xl font-black">{completedToday}</p></div>
                      <div className="rounded-2xl bg-white/10 p-3 text-center"><p className="text-[9px] font-bold uppercase text-indigo-200">Ventas</p><p className="mt-1 text-xl font-black">{salesToday}</p></div>
                      <div className="rounded-2xl bg-white/10 p-3 text-center"><p className="text-[9px] font-bold uppercase text-indigo-200">Pedidos</p><p className="mt-1 text-xl font-black">{ordersToday}</p></div>
                    </div>
                  </section>

                  {showMap && <RouteMap items={todayItems} userLocation={userLocation} onClientClick={clientId => setShowCustomerDetailId(clientId)} className="h-[320px] sm:h-[440px]" />}

                  <div className="space-y-4">
                    {todayItems.map((item, index) => {
                      const processing = updatingItemId === item.id;
                      const distance = userLocation && item.latitud && item.longitud ? calculateDistance(userLocation[0], userLocation[1], item.latitud, item.longitud) : null;
                      return (
                        <article key={item.id} className={`min-w-0 rounded-[26px] border p-4 shadow-sm sm:p-5 ${itemStatusClasses(item.status)}`}>
                          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">{index + 1}</div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="break-words text-base font-black text-slate-950 sm:text-lg">{item.nombre_apellido}</h3>
                                <span className="rounded-full bg-white/80 px-2 py-1 text-[9px] font-black uppercase">{item.tipo_cliente || 'cliente'}</span>
                                <span className="rounded-full bg-white/80 px-2 py-1 text-[9px] font-black uppercase">{item.status}</span>
                              </div>
                              <p className="mt-2 flex items-start gap-2 break-words text-sm text-slate-600"><MapPin size={15} className="mt-0.5 shrink-0" />{item.direccion || 'Sin dirección'}, {item.localidad || 'Sin localidad'}</p>
                              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                                <span className="flex min-w-0 items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-slate-600"><Phone size={14} className="shrink-0" /><span className="break-all">{item.telefono || 'Sin teléfono'}</span></span>
                                <span className={`flex min-w-0 items-center gap-2 rounded-xl bg-white/70 px-3 py-2 font-bold ${item.saldo_cta_cte > 0 ? 'text-rose-700' : 'text-emerald-700'}`}><WalletCards size={14} className="shrink-0" /><span className="break-words">{formatCurrency(item.saldo_cta_cte)}</span></span>
                                <span className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-slate-600"><Navigation size={14} />{distance !== null ? `~${distance.toFixed(1)} km` : 'Sin coordenadas'}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {[['Visitado', item.visitado], ['Venta', item.venta_registrada], ['Pedido', item.pedido_generado], ['Cobranza', item.cobranza_realizada]].map(([label, done]) => <span key={String(label)} className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${done ? 'bg-emerald-600 text-white' : 'bg-white/70 text-slate-400'}`}>{String(label)}</span>)}
                              </div>
                              {item.notes && <div className="mt-3 flex items-start gap-2 rounded-xl bg-white/70 p-3 text-xs text-slate-600"><MessageSquare size={14} className="mt-0.5 shrink-0" /><p className="break-words italic">{item.notes}</p></div>}
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                            {item.status === 'pendiente' ? (
                              <>
                                {hasPermission('routes', 'edit') && <button type="button" onClick={() => handleVisitNext(todayRoute.id, item.id)} disabled={processing} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-black text-indigo-700 disabled:opacity-50"><ArrowRight size={15} />Siguiente</button>}
                                {hasPermission('routes', 'edit') && <button type="button" onClick={() => handleUpdateItemStatus(item.id, 'visitado')} disabled={processing} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50">{processing ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Visitar</button>}
                                {hasPermission('routes', 'edit') && <button type="button" onClick={() => handleUpdateItemStatus(item.id, 'omitido')} disabled={processing} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 disabled:opacity-50"><XCircle size={15} />Omitir</button>}
                                {hasPermission('suppliers', 'create') && <button type="button" onClick={() => { setSelectedItemForAction(item); setQuickActionType('pedido'); setActionCart([]); setProductSearch(''); setShowQuickActionModal(true); }} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-amber-500 px-3 text-xs font-black text-white"><ClipboardList size={15} />Pedido</button>}
                                {hasPermission('sales', 'create') && <button type="button" onClick={() => { setSelectedItemForAction(item); setQuickActionType('venta'); setActionCart([]); setProductSearch(''); setShowQuickActionModal(true); }} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white"><ShoppingCart size={15} />Venta</button>}
                                {hasPermission('routes', 'edit') && <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => handleReorderItem(todayRoute.id, item.id, 'up')} disabled={index === 0} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-30" aria-label="Subir visita"><ArrowUp size={16} /></button><button type="button" onClick={() => handleReorderItem(todayRoute.id, item.id, 'down')} disabled={index === todayItems.length - 1} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-30" aria-label="Bajar visita"><ArrowDown size={16} /></button></div>}
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={() => setShowCustomerDetailId(item.cliente_id)} className="col-span-1 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700"><Eye size={15} />Ver ficha</button>
                                {hasPermission('routes', 'edit') && <button type="button" onClick={() => handleUpdateItemStatus(item.id, 'pendiente')} disabled={processing} className="col-span-1 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"><RotateCcw size={15} />Deshacer</button>}
                              </>
                            )}
                          </div>
                          {item.status === 'pendiente' && <button type="button" onClick={() => setShowCustomerDetailId(item.cliente_id)} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/80 text-xs font-black text-slate-700 sm:w-auto sm:px-4"><Eye size={15} />Ver ficha del cliente</button>}
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'historial' && (
            <motion.div key="historial" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-5">
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Rutas registradas</p><p className="mt-2 text-2xl font-black text-slate-900">{routes.length}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Finalizadas</p><p className="mt-2 text-2xl font-black text-emerald-600">{routes.filter(route => route.status === 'finalizada').length}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Ventas</p><p className="mt-2 text-2xl font-black text-indigo-600">{routes.reduce((sum, route) => sum + Number(route.sales_count || 0), 0)}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Pedidos</p><p className="mt-2 text-2xl font-black text-amber-600">{routes.reduce((sum, route) => sum + Number(route.orders_count || 0), 0)}</p></div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                {routes.map(route => {
                  const total = Number(route.total_customers || 0);
                  const visited = Number(route.visited_customers || 0);
                  const percentage = total > 0 ? Math.round((visited / total) * 100) : 0;
                  return (
                    <article key={route.id} className="min-w-0 rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${routeStatusClasses(route.status)}`}>{route.status}</span><span className="text-xs font-semibold text-slate-500">{formatDate(route.date)}</span></div>
                          <h3 className="mt-2 break-words text-lg font-black text-slate-900">{route.name}</h3>
                          <p className="mt-1 text-xs text-slate-500">Creada el {formatBusinessDate(route.created_at)}</p>
                        </div>
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-black text-indigo-700">{percentage}%</div>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${percentage}%` }} /></div>
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[9px] font-bold uppercase text-slate-400">Visitados</p><p className="mt-1 font-black text-slate-900">{visited}/{total}</p></div>
                        <div className="rounded-xl bg-indigo-50 p-3 text-center"><p className="text-[9px] font-bold uppercase text-indigo-400">Ventas</p><p className="mt-1 font-black text-indigo-700">{route.sales_count || 0}</p></div>
                        <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-[9px] font-bold uppercase text-amber-500">Pedidos</p><p className="mt-1 font-black text-amber-700">{route.orders_count || 0}</p></div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => { setSelectedRouteForDetail(route); setDetailError(null); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:border-indigo-300"><Eye size={16} />Ver detalle</button>
                        {hasPermission('routes', 'delete') && <button type="button" onClick={() => setConfirmAction({ type: 'delete', routeId: route.id, routeName: route.name })} disabled={routeActionId === route.id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-black text-rose-700 disabled:opacity-50">{routeActionId === route.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}Eliminar</button>}
                      </div>
                    </article>
                  );
                })}
                {routes.length === 0 && <div className="col-span-full rounded-[28px] border-2 border-dashed border-slate-200 bg-white p-10 text-center"><History size={38} className="mx-auto text-slate-300" /><h2 className="mt-4 text-lg font-black text-slate-900">Todavía no hay rutas registradas</h2><p className="mt-1 text-sm text-slate-500">Las rutas planificadas aparecerán en este historial.</p></div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showCustomerDetailId && <CustomerDetail clienteId={showCustomerDetailId} onClose={() => setShowCustomerDetailId(null)} />}

      <AnimatePresence>
        {selectedRouteForDetail && (
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
            <motion.section initial={{ opacity: 0, y: 35, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 35, scale: 0.98 }} className="flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-[28px]">
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
                <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">Detalle de ruta</p><h2 className="mt-1 break-words text-xl font-black text-slate-900 sm:text-2xl">{selectedRouteForDetail.name}</h2><p className="mt-1 text-sm text-slate-500">{formatDate(selectedRouteForDetail.date)} · {selectedRouteForDetail.status}</p></div>
                <button type="button" onClick={() => setSelectedRouteForDetail(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600" aria-label="Cerrar detalle"><X size={20} /></button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                {detailLoading ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-500"><Loader2 size={28} className="animate-spin text-indigo-600" /><p className="font-bold">Cargando detalle...</p></div>
                ) : detailError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800"><p className="font-black">No se pudo cargar la ruta</p><p className="mt-1 text-sm">{detailError}</p><button type="button" onClick={() => { const route = { ...selectedRouteForDetail }; setSelectedRouteForDetail(null); window.setTimeout(() => setSelectedRouteForDetail(route), 0); }} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white"><RefreshCw size={16} />Reintentar</button></div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-2xl bg-slate-50 p-4 text-center"><p className="text-[9px] font-bold uppercase text-slate-400">Clientes</p><p className="mt-1 text-xl font-black text-slate-900">{selectedRouteForDetail.total_customers || selectedRouteForDetail.items?.length || 0}</p></div>
                      <div className="rounded-2xl bg-emerald-50 p-4 text-center"><p className="text-[9px] font-bold uppercase text-emerald-500">Visitados</p><p className="mt-1 text-xl font-black text-emerald-700">{selectedRouteForDetail.visited_customers || selectedRouteForDetail.items?.filter(item => item.status !== 'pendiente').length || 0}</p></div>
                      <div className="rounded-2xl bg-indigo-50 p-4 text-center"><p className="text-[9px] font-bold uppercase text-indigo-500">Ventas</p><p className="mt-1 text-xl font-black text-indigo-700">{selectedRouteForDetail.sales_count || 0}</p></div>
                      <div className="rounded-2xl bg-amber-50 p-4 text-center"><p className="text-[9px] font-bold uppercase text-amber-500">Pedidos</p><p className="mt-1 text-xl font-black text-amber-700">{selectedRouteForDetail.orders_count || 0}</p></div>
                    </div>
                    <div className="space-y-3">
                      {selectedRouteForDetail.items?.map((item, index) => (
                        <article key={item.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex min-w-0 items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-sm font-black text-white">{index + 1}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-black text-slate-900">{item.nombre_apellido}</p><span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${itemStatusClasses(item.status)}`}>{item.status}</span></div><p className="mt-1 flex items-start gap-1 break-words text-xs text-slate-500"><MapPin size={13} className="mt-0.5 shrink-0" />{item.direccion || 'Sin dirección'}, {item.localidad || 'Sin localidad'}</p>{item.notes && <p className="mt-2 break-words rounded-xl bg-slate-50 p-2 text-xs italic text-slate-600">{item.notes}</p>}</div></div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.section>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProximityAlert && nearbyClient && (
          <motion.div initial={{ opacity: 0, y: 35 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 35 }} className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-lg rounded-[24px] bg-slate-950 p-4 text-white shadow-2xl ring-1 ring-white/10 sm:bottom-6 sm:p-5">
            <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-500"><BellRing size={22} /></div><div className="min-w-0 flex-1"><h3 className="font-black">Llegaste cerca de un cliente</h3><p className="mt-1 break-words text-sm text-slate-300">{nearbyClient.nombre_apellido}</p></div><button type="button" onClick={() => setShowProximityAlert(false)} className="rounded-xl p-2 text-slate-400 hover:bg-white/10" aria-label="Cerrar aviso"><X size={18} /></button></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setShowProximityAlert(false); handleUpdateItemStatus(nearbyClient.id, 'visitado'); }} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white/10 text-xs font-black"><Check size={15} />Visita</button>
              <button type="button" onClick={() => { setShowProximityAlert(false); setSelectedItemForAction(nearbyClient); setQuickActionType('venta'); setActionCart([]); setProductSearch(''); setShowQuickActionModal(true); }} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-indigo-600 text-xs font-black"><ShoppingCart size={15} />Venta</button>
              <button type="button" onClick={() => { setShowProximityAlert(false); setSelectedItemForAction(nearbyClient); setQuickActionType('pedido'); setActionCart([]); setProductSearch(''); setShowQuickActionModal(true); }} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-amber-500 text-xs font-black"><ClipboardList size={15} />Pedido</button>
              <button type="button" onClick={() => { setShowProximityAlert(false); setSelectedItemForAction(nearbyClient); setQuickActionType('pago'); setPaymentAmount(0); setShowQuickActionModal(true); }} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-emerald-500 text-xs font-black"><DollarSign size={15} />Cobro</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQuickActionModal && selectedItemForAction && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
            <motion.section initial={{ opacity: 0, y: 35, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 35, scale: 0.98 }} className="flex max-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-[28px]">
              <header className={`flex items-start justify-between gap-4 p-5 text-white sm:p-6 ${quickActionType === 'venta' ? 'bg-indigo-700' : quickActionType === 'pedido' ? 'bg-amber-500' : 'bg-emerald-600'}`}>
                <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">Acción rápida</p><h2 className="mt-1 break-words text-xl font-black sm:text-2xl">Registrar {quickActionType === 'venta' ? 'venta' : quickActionType === 'pedido' ? 'pedido' : 'cobro'}</h2><p className="mt-1 break-words text-sm text-white/80">{selectedItemForAction.nombre_apellido}</p></div>
                <button type="button" onClick={() => setShowQuickActionModal(false)} disabled={quickActionSaving} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10" aria-label="Cerrar acción"><X size={20} /></button>
              </header>

              {quickActionType === 'pago' ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                  <div className="mx-auto max-w-md space-y-5">
                    <label className="block"><span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Monto del cobro</span><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-slate-300">$</span><input type="number" min="0" value={paymentAmount || ''} onChange={event => setPaymentAmount(Number(event.target.value))} placeholder="0" className="min-h-16 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-3xl font-black text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" /></div></label>
                    <div><p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-500">Medio de pago</p><div className="grid grid-cols-2 gap-2">{['efectivo', 'transferencia', 'cheque', 'otro'].map(method => <button key={method} type="button" onClick={() => setPaymentMethod(method)} className={`min-h-11 rounded-xl border px-3 text-xs font-black capitalize ${paymentMethod === method ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{method}</button>)}</div></div>
                    <button type="button" onClick={handleConfirmQuickAction} disabled={paymentAmount <= 0 || quickActionSaving} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-black text-white disabled:opacity-50">{quickActionSaving ? <Loader2 size={19} className="animate-spin" /> : <DollarSign size={19} />}{quickActionSaving ? 'Registrando...' : 'Confirmar cobro'}</button>
                  </div>
                </div>
              ) : (
                <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
                  <div className="min-h-0 overflow-y-auto border-b border-slate-200 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                    <label className="relative block"><Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Buscar producto por nombre, código o familia" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></label>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {activeProducts.map(product => <button key={product.id} type="button" onClick={() => setActionCart(previous => { const existing = previous.find(item => item.productId === product.id); return existing ? previous.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...previous, { productId: product.id, quantity: 1 }]; })} className="min-h-20 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/40"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-black text-slate-900">{product.name}</p><p className="mt-1 break-words text-xs text-slate-500">{product.code || 'Sin código'} · {product.family_name || 'Sin familia'}</p><p className="mt-2 text-sm font-black text-indigo-700">{formatCurrency(product.sale_price)}</p></div><Plus size={19} className="shrink-0 text-indigo-600" /></div></button>)}
                      {activeProducts.length === 0 && <div className="col-span-full rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center"><PackageCheck size={34} className="mx-auto text-slate-300" /><p className="mt-3 font-black text-slate-800">No hay productos que coincidan</p></div>}
                    </div>
                  </div>

                  <div className="min-h-0 overflow-y-auto bg-slate-50 p-4 sm:p-6">
                    <div className="flex items-center justify-between gap-3"><div><h3 className="font-black text-slate-900">Productos seleccionados</h3><p className="text-xs text-slate-500">{actionCart.reduce((sum, item) => sum + item.quantity, 0)} unidades</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 shadow-sm">{actionCart.length}</span></div>
                    <div className="mt-4 space-y-3">
                      {actionCart.map(item => { const product = products.find(productItem => productItem.id === item.productId); return <article key={item.productId} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="break-words text-sm font-black text-slate-900">{product?.name}</p><p className="mt-1 text-xs text-slate-500">{formatCurrency((product?.sale_price || 0) * item.quantity)}</p><div className="mt-3 grid grid-cols-[44px_1fr_44px_44px] gap-2"><button type="button" onClick={() => setActionCart(previous => previous.map(cartItem => cartItem.productId === item.productId ? { ...cartItem, quantity: Math.max(1, cartItem.quantity - 1) } : cartItem))} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white"><Minus size={16} /></button><span className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 text-sm font-black">{item.quantity}</span><button type="button" onClick={() => setActionCart(previous => previous.map(cartItem => cartItem.productId === item.productId ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem))} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white"><Plus size={16} /></button><button type="button" onClick={() => setActionCart(previous => previous.filter(cartItem => cartItem.productId !== item.productId))} className="flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700" aria-label="Quitar producto"><Trash2 size={16} /></button></div></article>; })}
                      {actionCart.length === 0 && <div className="rounded-2xl border-2 border-dashed border-slate-200 p-7 text-center"><ShoppingCart size={32} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Sin productos seleccionados</p></div>}
                    </div>
                    <label className="mt-4 block"><span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">Observaciones</span><textarea value={actionNotes} onChange={event => setActionNotes(event.target.value)} placeholder="Notas adicionales" className="min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></label>
                    {quickActionType === 'venta' && <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 p-4 text-white"><span className="text-xs font-bold uppercase text-slate-400">Total</span><span className="break-words text-xl font-black">{formatCurrency(actionCart.reduce((sum, item) => { const product = products.find(productItem => productItem.id === item.productId); return sum + Number(product?.sale_price || 0) * item.quantity; }, 0))}</span></div>}
                    <button type="button" onClick={handleConfirmQuickAction} disabled={actionCart.length === 0 || quickActionSaving} className={`mt-4 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-sm font-black text-white disabled:opacity-50 ${quickActionType === 'venta' ? 'bg-indigo-600' : 'bg-amber-500'}`}>{quickActionSaving ? <Loader2 size={19} className="animate-spin" /> : <CheckCircle2 size={19} />}{quickActionSaving ? 'Procesando...' : `Confirmar ${quickActionType}`}</button>
                  </div>
                </div>
              )}
            </motion.section>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmAction && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
            <motion.section initial={{ opacity: 0, y: 30, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.98 }} className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${confirmAction.type === 'delete' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{confirmAction.type === 'delete' ? <Trash2 size={22} /> : <CheckCircle2 size={22} />}</div>
              <h2 className="mt-4 text-xl font-black text-slate-900">{confirmAction.type === 'delete' ? 'Eliminar ruta' : 'Finalizar ruta'}</h2>
              <p className="mt-2 break-words text-sm leading-6 text-slate-500">{confirmAction.type === 'delete' ? `Se eliminará “${confirmAction.routeName}”. Esta acción no se puede deshacer.` : `La ruta “${confirmAction.routeName}” quedará marcada como finalizada.`}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmAction(null)} disabled={routeActionId !== null} className="min-h-12 rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-700">Cancelar</button>
                <button type="button" onClick={() => confirmAction.type === 'delete' ? handleDeleteRoute(confirmAction.routeId) : handleCompleteRoute(confirmAction.routeId)} disabled={routeActionId !== null} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-black text-white disabled:opacity-60 ${confirmAction.type === 'delete' ? 'bg-rose-600' : 'bg-emerald-600'}`}>{routeActionId !== null && <Loader2 size={17} className="animate-spin" />}{confirmAction.type === 'delete' ? 'Eliminar' : 'Finalizar'}</button>
              </div>
            </motion.section>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
