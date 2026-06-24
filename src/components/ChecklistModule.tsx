import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { 
  ChecklistTemplate as Template, 
  ChecklistTemplateItem as TemplateItem, 
  Checklist, 
  ChecklistItem 
} from '../types';
import { unwrapResponse, apiFetch } from '../utils/api';
import { 
  ClipboardCheck, 
  Plus, 
  Trash2, 
  Save, 
  History, 
  Layout, 
  CheckCircle2, 
  Circle, 
  X, 
  ChevronRight,
  Calendar,
  AlertCircle,
  MoreVertical,
  Edit3,
  Users,
  ShoppingCart,
  DollarSign,
  Map,
  ClipboardList,
  Loader2,
  RefreshCw
} from 'lucide-react';

export default function ChecklistModule() {
  const { user, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'hoy' | 'ruta' | 'plantillas' | 'historial'>('hoy');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [todayChecklists, setTodayChecklists] = useState<Checklist[]>([]);
  const [todayRoute, setTodayRoute] = useState<any | null>(null);
  const [selectedActiveChecklistId, setSelectedActiveChecklistId] = useState<number | null>(null);
  const [history, setHistory] = useState<Checklist[]>([]);
  const [summary, setSummary] = useState<{
    routeClients: number;
    pendingMoney: number;
    criticalStock: number;
    pendingSupplierOrders: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<number | null>(null);
  const [updatingItemIds, setUpdatingItemIds] = useState<number[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedChecklistForDetail, setSelectedChecklistForDetail] = useState<Checklist | null>(null);

  // Template Creation State
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [newTemplateType, setNewTemplateType] = useState<'Apertura' | 'Cierre' | 'Ruta' | 'General'>('General');
  const [newTemplateTasks, setNewTemplateTasks] = useState<string[]>(['']);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), type === 'success' ? 3000 : 5000);
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
    if (selectedChecklistForDetail && !selectedChecklistForDetail.items) {
      apiFetch(`/api/clientes?endpoint=checklist&id=${selectedChecklistForDetail.id}`)
        .then(res => res.json())
        .then(body => {
          const data = unwrapResponse(body);
          setSelectedChecklistForDetail(data);
        })
        .catch(err => console.error("Error fetching checklist detail:", err));
    }
  }, [selectedChecklistForDetail]);

  const fetchInitialData = async (showFullLoader: boolean = true) => {
    if (showFullLoader) {
      setLoading(true);
      setLoadError(null);
    }

    try {
      const responses = await Promise.all([
        apiFetch('/api/clientes?endpoint=checklist-templates'),
        apiFetch('/api/clientes?endpoint=checklists-today'),
        apiFetch('/api/clientes?endpoint=checklists'),
        apiFetch('/api/clientes?endpoint=routes-today'),
        apiFetch('/api/clientes?endpoint=checklist-summary')
      ]);

      const failedResponse = responses.find(response => !response.ok);
      if (failedResponse) {
        throw new Error(await readApiError(failedResponse, 'No se pudieron cargar los datos del checklist.'));
      }

      const [templatesBody, todayBody, historyBody, routeBody, summaryBody] = await Promise.all(
        responses.map(response => response.json())
      );

      const templatesData = unwrapResponse<Template[]>(templatesBody);
      const todayData = unwrapResponse<Checklist[]>(todayBody);
      const historyData = unwrapResponse<Checklist[]>(historyBody);
      const routeData = unwrapResponse<any | null>(routeBody);
      const summaryData = unwrapResponse<{
        routeClients: number;
        pendingMoney: number;
        criticalStock: number;
        pendingSupplierOrders: number;
      }>(summaryBody);

      const safeTemplates = Array.isArray(templatesData) ? templatesData : [];
      const safeTodayChecklists = Array.isArray(todayData) ? todayData : [];
      const safeHistory = Array.isArray(historyData) ? historyData : [];

      setTemplates(safeTemplates);
      setTodayChecklists(safeTodayChecklists);
      setHistory(safeHistory);
      setTodayRoute(routeData || null);
      setSummary(summaryData || null);
      setSelectedActiveChecklistId(currentId => {
        if (currentId && safeTodayChecklists.some(checklist => checklist.id === currentId)) return currentId;
        return safeTodayChecklists[0]?.id ?? null;
      });
    } catch (error: any) {
      console.error("Error fetching checklist data:", error);
      const message = error?.message || 'No se pudieron cargar los datos del checklist.';
      if (showFullLoader) {
        setLoadError(message);
      } else {
        showNotification('error', message);
      }
    } finally {
      if (showFullLoader) setLoading(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateName || newTemplateTasks.filter(t => t.trim()).length === 0) return;

    const payload = {
      name: newTemplateName,
      description: newTemplateDesc,
      type: newTemplateType,
      items: newTemplateTasks.filter(t => t.trim())
    };

    try {
      const url = editingTemplateId 
        ? `/api/clientes?endpoint=checklist-template&id=${editingTemplateId}`
        : '/api/clientes?endpoint=checklist-templates';
      
      const res = await apiFetch(url, {
        method: editingTemplateId ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        resetTemplateForm();
        fetchInitialData();
      }
    } catch (error) {
      console.error("Error saving template:", error);
    }
  };

  const resetTemplateForm = () => {
    setShowNewTemplateModal(false);
    setEditingTemplateId(null);
    setNewTemplateName('');
    setNewTemplateDesc('');
    setNewTemplateType('General');
    setNewTemplateTasks(['']);
  };

  const handleEditTemplate = async (template: Template) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist-template&id=${template.id}`);
      const body = await res.json();
      const data = unwrapResponse(body);
      setEditingTemplateId(template.id);
      setNewTemplateName(data.name);
      setNewTemplateDesc(data.description || '');
      setNewTemplateType(data.type || 'General');
      setNewTemplateTasks(data.items?.map((i: any) => i.task_name) || ['']);
      setShowNewTemplateModal(true);
    } catch (error) {
      console.error("Error fetching template for edit:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTemplateStatus = async (id: number, currentActive: number) => {
    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist-template-status&id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: currentActive === 1 ? 0 : 1 })
      });
      if (res.ok) fetchInitialData();
    } catch (error) {
      console.error("Error toggling template status:", error);
    }
  };

  const handleStartTodayChecklist = async (templateId: number) => {
    if (startingTemplateId !== null) return;

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    setStartingTemplateId(templateId);

    try {
      const res = await apiFetch('/api/clientes?endpoint=checklists', {
        method: 'POST',
        body: JSON.stringify({
          template_id: templateId,
          date: today,
          notes: ''
        })
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo iniciar el checklist.'));
      }

      const body = await res.json();
      const newChecklist = unwrapResponse<{ id: number }>(body);
      const newChecklistId = Number(newChecklist.id);

      const detailRes = await apiFetch(`/api/clientes?endpoint=checklist&id=${newChecklistId}`);
      if (!detailRes.ok) {
        throw new Error(await readApiError(detailRes, 'El checklist se creó, pero no se pudo cargar su detalle.'));
      }

      const detailBody = await detailRes.json();
      const checklistDetail = unwrapResponse<Checklist>(detailBody);

      setTodayChecklists(previous => [
        checklistDetail,
        ...previous.filter(checklist => checklist.id !== checklistDetail.id)
      ]);
      setSelectedActiveChecklistId(checklistDetail.id);
      setActiveTab('hoy');
      showNotification('success', 'Checklist iniciado correctamente.');
    } catch (error: any) {
      console.error("Error starting checklist:", error);
      showNotification('error', error?.message || 'No se pudo iniciar el checklist.');
    } finally {
      setStartingTemplateId(null);
    }
  };

  const handleToggleItem = async (checklistId: number, itemId: number, currentStatus: number) => {
    if (updatingItemIds.length > 0) return;

    const nextCompleted = Number(currentStatus) === 1 ? 0 : 1;
    const completedAt = nextCompleted === 1 ? new Date().toISOString() : null;
    const completedBy = nextCompleted === 1 ? user?.name || 'Admin' : null;
    const previousChecklists = todayChecklists;

    setUpdatingItemIds(previous => [...previous, itemId]);

    setTodayChecklists(previous => previous.map(checklist => {
      if (checklist.id !== checklistId) return checklist;

      const updatedItems = (checklist.items || []).map(item =>
        item.id === itemId
          ? {
              ...item,
              completed: nextCompleted,
              completed_at: completedAt,
              completed_by: completedBy
            }
          : item
      );
      const completedTasks = updatedItems.filter(item => Number(item.completed) === 1).length;

      return {
        ...checklist,
        items: updatedItems,
        total_tasks: updatedItems.length,
        completed_tasks: completedTasks,
        status: updatedItems.length > 0 && completedTasks === updatedItems.length ? 'completado' : 'pendiente'
      };
    }));

    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist-item&id=${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          completed: nextCompleted,
          completed_by: completedBy
        })
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo actualizar la tarea.'));
      }

      const body = await res.json();
      const data = unwrapResponse<{
        item?: ChecklistItem;
        checklist?: {
          id: number;
          status: 'pendiente' | 'completado';
          total_tasks: number;
          completed_tasks: number;
          completed_at?: string | null;
        };
      }>(body);

      setTodayChecklists(previous => previous.map(checklist => {
        if (checklist.id !== checklistId) return checklist;

        const serverItem = data?.item;
        const updatedItems = (checklist.items || []).map(item =>
          item.id === itemId && serverItem ? { ...item, ...serverItem } : item
        );
        const completedTasks = data?.checklist?.completed_tasks
          ?? updatedItems.filter(item => Number(item.completed) === 1).length;
        const totalTasks = data?.checklist?.total_tasks ?? updatedItems.length;

        return {
          ...checklist,
          items: updatedItems,
          completed_tasks: completedTasks,
          total_tasks: totalTasks,
          status: data?.checklist?.status
            ?? (totalTasks > 0 && completedTasks === totalTasks ? 'completado' : 'pendiente'),
          completed_at: data?.checklist ? data.checklist.completed_at ?? null : checklist.completed_at
        };
      }));
    } catch (error: any) {
      console.error("Error toggling item:", error);
      setTodayChecklists(previousChecklists);
      showNotification('error', error?.message || 'No se pudo actualizar la tarea.');
    } finally {
      setUpdatingItemIds(previous => previous.filter(id => id !== itemId));
    }
  };

  const handleToggleRouteItem = async (itemId: number, field: string, currentValue: number) => {
    try {
      const res = await apiFetch(`/api/clientes?endpoint=route-item&id=${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: currentValue === 0 ? 1 : 0 })
      });

      if (res.ok) {
        setTodayRoute((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((item: any) => 
              item.id === itemId ? { ...item, [field]: currentValue === 0 ? 1 : 0 } : item
            )
          };
        });
      }
    } catch (error) {
      console.error("Error toggling route item field:", error);
    }
  };

  const handleFinishChecklist = async (id: number) => {
    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist&id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completado' })
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo finalizar el checklist.'));
      }

      setTodayChecklists(previous => previous.filter(checklist => checklist.id !== id));
      setSelectedActiveChecklistId(previousId => previousId === id ? null : previousId);
      showNotification('success', 'Checklist finalizado correctamente.');
      void fetchInitialData(false);
    } catch (error: any) {
      console.error("Error finishing checklist:", error);
      showNotification('error', error?.message || 'No se pudo finalizar el checklist.');
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm("¿Estás seguro de eliminar esta plantilla?")) return;
    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist-template&id=${id}`, { method: 'DELETE' });
      if (res.ok) fetchInitialData();
    } catch (error) {
      console.error("Error deleting template:", error);
    }
  };

  if (loading) {
    return (
      <div className="h-full min-h-[520px] flex flex-col bg-zinc-50" aria-busy="true" aria-live="polite">
        <header className="bg-white border-b border-zinc-200 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="text-zinc-300" size={32} />
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">CHECK LIST</h2>
              <p className="text-zinc-500 text-sm font-medium mt-1">Cargando controles y tareas...</p>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-hidden p-4 sm:p-6 lg:p-8">
          <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map(item => (
                <div key={item} className="h-32 bg-white border border-zinc-100 rounded-3xl shadow-sm p-5">
                  <div className="h-3 w-24 bg-zinc-200 rounded mb-5" />
                  <div className="h-8 w-16 bg-zinc-200 rounded mb-3" />
                  <div className="h-2 w-32 bg-zinc-100 rounded" />
                </div>
              ))}
            </div>
            <div className="bg-white border border-zinc-100 rounded-[32px] p-6 sm:p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <Loader2 className="animate-spin text-zinc-400" size={22} />
                <span className="font-bold text-zinc-700">Cargando datos del checklist...</span>
              </div>
              <div className="space-y-3">
                {[0, 1, 2].map(item => (
                  <div key={item} className="h-16 bg-zinc-100 rounded-2xl" />
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full min-h-[520px] flex items-center justify-center bg-zinc-50 p-4">
        <div className="max-w-md w-full bg-white border border-red-100 rounded-[32px] p-8 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-5">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-black text-zinc-900 mb-2">No se pudo cargar el Checklist</h2>
          <p className="text-sm text-zinc-500 mb-6">{loadError}</p>
          <button
            onClick={() => fetchInitialData()}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all"
          >
            <RefreshCw size={18} />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-50 overflow-hidden">
      {notification && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 left-4 sm:left-auto z-[70] p-4 rounded-2xl shadow-2xl border flex items-center gap-3 ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="font-bold text-sm">{notification.message}</span>
        </div>
      )}
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight flex items-center gap-3">
              <ClipboardCheck className="text-zinc-400" size={32} />
              CHECK LIST
            </h2>
            <p className="text-zinc-500 text-sm font-medium mt-1">Control de tareas diarias y procesos.</p>
          </div>
          <div className="flex items-center gap-3 bg-zinc-100 p-2 rounded-2xl px-4 w-fit">
            <Users size={18} className="text-zinc-400" />
            <span className="text-sm font-bold text-zinc-900">
              {user?.name || 'Admin'}
            </span>
          </div>
        </div>

        <div className="flex gap-1 bg-zinc-100 p-1 rounded-xl w-full sm:w-fit overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('hoy')}
            className={`px-3 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
              activeTab === 'hoy' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Check List del Día
          </button>
          <button
            onClick={() => setActiveTab('ruta')}
            className={`px-3 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
              activeTab === 'ruta' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Ruta del Día
          </button>
          <button
            onClick={() => setActiveTab('plantillas')}
            className={`px-3 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
              activeTab === 'plantillas' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Plantillas
          </button>
          <button
            onClick={() => setActiveTab('historial')}
            className={`px-3 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
              activeTab === 'historial' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Historial
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'hoy' && (
            <motion.div
              key="hoy"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl w-full mx-auto space-y-6 sm:space-y-8"
            >
              {/* Resumen del día Section */}
              {summary && (
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <Layout size={20} className="text-zinc-400" />
                    <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Resumen del día</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="p-4 sm:p-6 bg-white border border-zinc-100 rounded-2xl sm:rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <Users size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Clientes en Ruta</span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-black text-zinc-900">{summary.routeClients}</p>
                      <p className="text-[10px] text-zinc-400">Programados para hoy</p>
                    </div>

                    <div className="p-4 sm:p-6 bg-white border border-zinc-100 rounded-2xl sm:rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <DollarSign size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Dinero Pendiente</span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-black text-zinc-900">${(summary.pendingMoney ?? 0).toLocaleString()}</p>
                      <p className="text-[10px] text-zinc-400">Cuentas por cobrar</p>
                    </div>

                    <div className="p-4 sm:p-6 bg-white border border-zinc-100 rounded-2xl sm:rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <AlertCircle size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Stock Crítico</span>
                      </div>
                      <p className={`text-2xl sm:text-3xl font-black ${summary.criticalStock > 0 ? 'text-red-600' : 'text-zinc-900'}`}>{summary.criticalStock}</p>
                      <p className="text-[10px] text-zinc-400">Productos bajo el mínimo</p>
                    </div>

                    <div className="p-4 sm:p-6 bg-white border border-zinc-100 rounded-2xl sm:rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <ShoppingCart size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Pedidos Pendientes</span>
                      </div>
                      <p className="text-2xl sm:text-3xl font-black text-zinc-900">{summary.pendingSupplierOrders}</p>
                      <p className="text-[10px] text-zinc-400">A proveedores</p>
                    </div>
                  </div>
                </section>
              )}

              {/* Iniciar Nuevo Control Section */}
              <section>
                <div className="flex items-center gap-2 mb-6">
                  <Plus size={20} className="text-zinc-400" />
                  <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Iniciar Nuevo Control</h3>
                </div>
                
                <div className="space-y-8">
                  {['Apertura', 'Cierre', 'Ruta', 'General'].map(type => {
                    const filteredTemplates = templates.filter(t => t.active === 1 && t.type === type);
                    if (filteredTemplates.length === 0) return null;
                    
                    return (
                      <div key={type} className="space-y-4">
                        <h4 className="text-xs font-black text-zinc-400 uppercase tracking-tighter flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            type === 'Apertura' ? 'bg-emerald-500' :
                            type === 'Cierre' ? 'bg-amber-500' :
                            type === 'Ruta' ? 'bg-blue-500' :
                            'bg-zinc-300'
                          }`}></span>
                          {type === 'Apertura' ? 'Inicio del día' : type === 'Cierre' ? 'Cierre del día' : type === 'General' ? 'Control comercial' : type}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                          {filteredTemplates.map(template => (
                            <button
                              key={template.id}
                              onClick={() => hasPermission('checklist', 'create') && handleStartTodayChecklist(template.id)}
                              disabled={!hasPermission('checklist', 'create') || startingTemplateId !== null}
                              aria-label={`Usar hoy la plantilla ${template.name}`}
                              className={`p-4 sm:p-5 bg-white border border-zinc-100 rounded-2xl sm:rounded-3xl hover:border-zinc-900 transition-all group shadow-sm text-left ${
                                !hasPermission('checklist', 'create') || startingTemplateId !== null
                                  ? 'opacity-60 cursor-not-allowed'
                                  : ''
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                {startingTemplateId === template.id ? (
                                  <Loader2 size={16} className="animate-spin text-zinc-500 ml-auto" />
                                ) : (
                                  <ChevronRight size={14} className="text-zinc-300 group-hover:text-zinc-900 ml-auto" />
                                )}
                              </div>
                              <h4 className="font-bold text-zinc-900 text-sm line-clamp-1">{template.name}</h4>
                              <p className="text-[10px] text-zinc-400 mt-1 line-clamp-1">
                                {startingTemplateId === template.id ? 'Iniciando checklist...' : template.description}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  
                  {templates.filter(t => t.active === 1).length === 0 && (
                    <div className="p-8 border-2 border-dashed border-zinc-200 rounded-3xl flex flex-col items-center justify-center text-zinc-400">
                      <Layout size={24} className="mb-2 opacity-20" />
                      <p className="text-xs font-bold">No hay plantillas activas</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Controles en Curso Section */}
              {todayChecklists.length > 0 && (
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                  <div className="lg:col-span-1 space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                      <AlertCircle size={20} className="text-amber-400" />
                      <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Controles en Curso</h3>
                    </div>
                    <div className="space-y-3">
                      {todayChecklists.map(cl => (
                        <button
                          key={cl.id}
                          onClick={() => setSelectedActiveChecklistId(cl.id)}
                          className={`w-full p-5 rounded-3xl border transition-all text-left flex flex-col gap-2 ${
                            selectedActiveChecklistId === cl.id 
                              ? 'bg-zinc-900 border-zinc-900 text-white shadow-xl shadow-zinc-200' 
                              : 'bg-white border-zinc-100 text-zinc-900 hover:border-zinc-300'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <h4 className="font-black text-sm">{cl.template_name}</h4>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              selectedActiveChecklistId === cl.id ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500'
                            }`}>
                              {cl.items?.filter(i => Number(i.completed) === 1).length}/{cl.items?.length || 0}
                            </span>
                          </div>
                          <p className={`text-[10px] font-medium ${selectedActiveChecklistId === cl.id ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            Iniciado {new Date(cl.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-2">
                    {selectedActiveChecklistId && todayChecklists.find(cl => cl.id === selectedActiveChecklistId) && (
                      <div className="bg-white rounded-3xl sm:rounded-[40px] shadow-sm border border-zinc-100 overflow-hidden">
                        {(() => {
                          const cl = todayChecklists.find(c => c.id === selectedActiveChecklistId)!;
                          return (
                            <>
                              <div className="p-4 sm:p-6 lg:p-8 border-b border-zinc-100 bg-zinc-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <div>
                                  <h3 className="text-xl font-black text-zinc-900">{cl.template_name}</h3>
                                  <p className="text-sm text-zinc-500 font-medium">
                                    Control activo del día • {cl.items?.filter(item => Number(item.completed) === 1).length || 0}/{cl.items?.length || 0} tareas completadas
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleFinishChecklist(cl.id)}
                                  className="w-full sm:w-auto px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
                                >
                                  Finalizar Control
                                </button>
                              </div>
                              <div className="p-4 sm:p-6 lg:p-8 space-y-3">
                                {cl.items?.map((item) => (
                                  <button
                                    key={item.id}
                                    onClick={() => handleToggleItem(cl.id, item.id, item.completed)}
                                    disabled={updatingItemIds.length > 0 || !hasPermission('checklist', 'edit')}
                                    aria-label={`${Number(item.completed) === 1 ? 'Desmarcar' : 'Marcar'} tarea: ${item.task_name}`}
                                    title={!hasPermission('checklist', 'edit') ? 'No tenés permiso para modificar tareas' : undefined}
                                    className={`w-full flex items-start sm:items-center gap-3 sm:gap-4 p-4 sm:p-5 rounded-2xl sm:rounded-3xl border transition-all text-left disabled:cursor-not-allowed ${
                                      Number(item.completed) === 1
                                        ? 'bg-emerald-50 border-emerald-100 text-emerald-900'
                                        : 'bg-white border-zinc-100 hover:border-zinc-300 text-zinc-900'
                                    } ${updatingItemIds.includes(item.id) ? 'opacity-70' : ''}`}
                                  >
                                    {updatingItemIds.includes(item.id) ? (
                                      <Loader2 size={24} className="animate-spin text-zinc-400 shrink-0" />
                                    ) : Number(item.completed) === 1 ? (
                                      <CheckCircle2 size={24} className="text-emerald-500 shrink-0" />
                                    ) : (
                                      <Circle size={24} className="text-zinc-200 shrink-0" />
                                    )}
                                    <span className={`font-bold ${Number(item.completed) === 1 ? 'line-through opacity-50' : ''}`}>
                                      {item.task_name}
                                    </span>
                                    {Number(item.completed) === 1 && (
                                      <div className="ml-auto flex flex-col items-end">
                                        <span className="text-[10px] font-bold text-emerald-400 uppercase">
                                          {new Date(item.completed_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <span className="text-[8px] font-black text-zinc-400 uppercase tracking-tighter">
                                          {item.completed_by || 'Admin'}
                                        </span>
                                      </div>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {todayChecklists.length === 0 && (
                <div className="text-center py-12 sm:py-20 px-4 bg-white rounded-3xl sm:rounded-[40px] border border-zinc-100 border-dashed">
                  <div className="w-24 h-24 bg-zinc-50 rounded-[40px] flex items-center justify-center mx-auto mb-6">
                    <ClipboardCheck size={48} className="text-zinc-200" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-zinc-900 mb-2">No hay controles activos</h3>
                  <p className="text-zinc-500 mb-8 max-w-sm mx-auto">Selecciona una plantilla arriba para iniciar el control de tareas de hoy.</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'ruta' && (
            <motion.div
              key="ruta"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl w-full mx-auto space-y-6 sm:space-y-8"
            >
              {!todayRoute ? (
                <div className="text-center py-12 sm:py-20 px-4 bg-white rounded-3xl sm:rounded-[40px] border border-zinc-100 border-dashed">
                  <div className="w-24 h-24 bg-zinc-50 rounded-[40px] flex items-center justify-center mx-auto mb-6 text-zinc-200">
                    <Map size={48} />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-zinc-900 mb-2">No hay ruta activa para hoy</h3>
                  <p className="text-zinc-500 mb-8 max-w-sm mx-auto">Planifica una ruta en el módulo de Rutas para ver el checklist aquí.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-zinc-900 p-8 rounded-[40px] text-white shadow-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-wider">Checklist de Ruta</span>
                        <span className="text-white/60 text-xs font-medium">{new Date(todayRoute.date).toLocaleDateString()}</span>
                      </div>
                      <h3 className="text-3xl font-black tracking-tight">{todayRoute.name}</h3>
                    </div>
                  </div>

                  <div className="bg-white rounded-[40px] border border-zinc-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto -mx-2 px-2">
                      <table className="w-full min-w-[720px] text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50/50">
                            <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cliente</th>
                            <th className="px-4 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Visitado</th>
                            <th className="px-4 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Venta</th>
                            <th className="px-4 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Pedido</th>
                            <th className="px-4 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Cobranza</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {todayRoute.items?.map((item: any) => (
                            <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                              <td className="px-8 py-5">
                                <p className="text-sm font-bold text-zinc-900">{item.nombre_apellido}</p>
                                <p className="text-[10px] text-zinc-500">{item.localidad}</p>
                              </td>
                              <td className="px-4 py-5 text-center">
                                <button 
                                  onClick={() => handleToggleRouteItem(item.id, 'visitado', item.visitado)}
                                  className={`p-2 rounded-xl transition-all ${item.visitado ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-300 hover:text-zinc-400'}`}
                                >
                                  <CheckCircle2 size={20} />
                                </button>
                              </td>
                              <td className="px-4 py-5 text-center">
                                <button 
                                  onClick={() => handleToggleRouteItem(item.id, 'venta_registrada', item.venta_registrada)}
                                  className={`p-2 rounded-xl transition-all ${item.venta_registrada ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-300 hover:text-zinc-400'}`}
                                >
                                  <ShoppingCart size={20} />
                                </button>
                              </td>
                              <td className="px-4 py-5 text-center">
                                <button 
                                  onClick={() => handleToggleRouteItem(item.id, 'pedido_generado', item.pedido_generado)}
                                  className={`p-2 rounded-xl transition-all ${item.pedido_generado ? 'bg-amber-100 text-amber-600' : 'bg-zinc-100 text-zinc-300 hover:text-zinc-400'}`}
                                >
                                  <ClipboardList size={20} />
                                </button>
                              </td>
                              <td className="px-4 py-5 text-center">
                                <button 
                                  onClick={() => handleToggleRouteItem(item.id, 'cobranza_realizada', item.cobranza_realizada)}
                                  className={`p-2 rounded-xl transition-all ${item.cobranza_realizada ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-300 hover:text-zinc-400'}`}
                                >
                                  <DollarSign size={20} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'plantillas' && (
            <motion.div
              key="plantillas"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
                <h3 className="text-xl sm:text-2xl font-black text-zinc-900">Plantillas de Tareas</h3>
                {hasPermission('checklist', 'create') && (
                  <button
                    onClick={() => setShowNewTemplateModal(true)}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
                  >
                    <Plus size={18} />
                    Nueva Plantilla
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                {templates.map(template => (
                  <div key={template.id} className={`bg-white border rounded-3xl sm:rounded-[40px] p-5 sm:p-8 shadow-sm flex flex-col transition-all ${template.active ? 'border-zinc-100' : 'border-zinc-200 opacity-60 grayscale'}`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${template.active ? 'bg-zinc-50 text-zinc-400' : 'bg-zinc-200 text-zinc-500'}`}>
                          <Layout size={24} />
                        </div>
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                          template.type === 'Apertura' ? 'bg-emerald-50 text-emerald-600' :
                          template.type === 'Cierre' ? 'bg-amber-50 text-amber-600' :
                          template.type === 'Ruta' ? 'bg-blue-50 text-blue-600' :
                          'bg-zinc-100 text-zinc-600'
                        }`}>
                          {template.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {hasPermission('checklist', 'edit') && (
                          <button 
                            onClick={() => handleEditTemplate(template)}
                            className="p-2 text-zinc-300 hover:text-zinc-900 transition-colors"
                          >
                            <Edit3 size={18} />
                          </button>
                        )}
                        {hasPermission('checklist', 'delete') && (
                          <button 
                            onClick={() => handleDeleteTemplate(template.id)}
                            className="p-2 text-zinc-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                    <h4 className="text-lg font-black text-zinc-900 mb-2">{template.name}</h4>
                    <p className="text-sm text-zinc-500 mb-6 flex-1">{template.description || 'Sin descripción'}</p>
                    <div className="pt-6 border-t border-zinc-50 flex items-center justify-between">
                      <button
                        onClick={() => hasPermission('checklist', 'edit') && handleToggleTemplateStatus(template.id, template.active)}
                        disabled={!hasPermission('checklist', 'edit')}
                        className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full transition-all ${
                          template.active ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400'
                        } ${!hasPermission('checklist', 'edit') ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {template.active ? 'Activa' : 'Inactiva'}
                      </button>
                      {hasPermission('checklist', 'create') && (
                        <button
                          onClick={() => handleStartTodayChecklist(template.id)}
                          disabled={!template.active || startingTemplateId !== null}
                          className="inline-flex items-center gap-2 text-sm font-bold text-zinc-900 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {startingTemplateId === template.id && <Loader2 size={16} className="animate-spin" />}
                          {startingTemplateId === template.id ? 'Iniciando...' : 'Usar hoy'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'historial' && (
            <motion.div
              key="historial"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="bg-white rounded-3xl sm:rounded-[40px] border border-zinc-100 overflow-hidden shadow-sm">
                <div className="p-4 sm:p-6 lg:p-8 border-b border-zinc-50">
                  <h3 className="text-xl sm:text-2xl font-black text-zinc-900">Historial de Check Lists</h3>
                  <p className="text-zinc-500 text-sm font-medium mt-1">Registro de todas las listas ejecutadas.</p>
                </div>
                <table className="w-full min-w-[720px] text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/50">
                      <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Fecha</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Checklist</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Tareas</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Completadas</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Estado</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {history.map(item => (
                      <tr key={item.id} className="group hover:bg-zinc-50/30 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-zinc-50 rounded-xl flex items-center justify-center text-zinc-400">
                              <Calendar size={18} />
                            </div>
                            <span className="font-bold text-zinc-900">{new Date(item.date).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="text-sm font-bold text-zinc-900">{item.template_name}</span>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <span className="text-sm font-black text-zinc-400">{item.total_tasks || 0}</span>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <span className={`text-sm font-black ${item.completed_tasks === item.total_tasks ? 'text-emerald-500' : 'text-zinc-900'}`}>
                            {item.completed_tasks || 0}
                          </span>
                        </td>
                        <td className="px-8 py-6">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            item.status === 'completado' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                          }`}>
                            {item.status === 'completado' ? 'Completo' : 'Incompleto'}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button 
                            onClick={() => setSelectedChecklistForDetail(item)}
                            className="p-3 bg-zinc-50 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                          >
                            <ChevronRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Checklist Detail Modal */}
      {selectedChecklistForDetail && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 bg-zinc-900/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl sm:rounded-[40px] w-full max-w-2xl max-h-[95dvh] sm:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-4 sm:p-6 lg:p-8 pr-16 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50 relative">
              <div>
                <h2 className="text-lg sm:text-2xl font-black text-zinc-900">{selectedChecklistForDetail.template_name}</h2>
                <p className="text-sm font-medium text-zinc-500">
                  {new Date(selectedChecklistForDetail.date).toLocaleDateString()} • {selectedChecklistForDetail.status}
                </p>
              </div>
              <button
                onClick={() => setSelectedChecklistForDetail(null)}
                className="absolute top-3 right-3 sm:top-5 sm:right-5 p-3 bg-white hover:bg-zinc-100 rounded-2xl transition-all text-zinc-500 hover:text-zinc-900 shadow-sm border border-zinc-100"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
              <div className="space-y-3">
                {selectedChecklistForDetail.items?.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 p-5 rounded-3xl border transition-all ${
                      item.completed 
                        ? 'bg-emerald-50 border-emerald-100 text-emerald-900' 
                        : 'bg-zinc-50 border-zinc-100 text-zinc-400'
                    }`}
                  >
                    {item.completed ? (
                      <CheckCircle2 size={24} className="text-emerald-500 shrink-0" />
                    ) : (
                      <Circle size={24} className="text-zinc-200 shrink-0" />
                    )}
                    <span className="font-bold">
                      {item.task_name}
                    </span>
                    {item.completed && (
                      <div className="ml-auto flex flex-col items-end">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase">
                          {new Date(item.completed_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[8px] font-black text-zinc-400 uppercase tracking-tighter">
                          {item.completed_by || 'Admin'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* New Template Modal */}
      {showNewTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 bg-zinc-900/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl sm:rounded-[40px] w-full max-w-2xl max-h-[95dvh] sm:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-4 sm:p-6 lg:p-8 pr-16 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50 relative">
              <div>
                <h2 className="text-lg sm:text-2xl font-black text-zinc-900">{editingTemplateId ? 'Editar Plantilla' : 'Nueva Plantilla'}</h2>
                <p className="text-sm font-medium text-zinc-500">Define las tareas que se realizarán.</p>
              </div>
              <button
                onClick={resetTemplateForm}
                className="absolute top-3 right-3 sm:top-5 sm:right-5 p-3 bg-white hover:bg-zinc-100 rounded-2xl transition-all text-zinc-500 hover:text-zinc-900 shadow-sm border border-zinc-100"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 block">Nombre de la Plantilla</label>
                    <input
                      type="text"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      placeholder="Ej: Apertura de Local"
                      className="w-full px-4 sm:px-5 py-3 sm:py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none font-bold text-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 block">Tipo de Plantilla</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-2 gap-2">
                      {['Apertura', 'Cierre', 'Ruta', 'General'].map((type) => (
                        <button
                          key={type}
                          onClick={() => setNewTemplateType(type as any)}
                          className={`px-4 py-3 rounded-xl text-xs font-bold transition-all border ${
                            newTemplateType === type 
                              ? 'bg-zinc-900 text-white border-zinc-900' 
                              : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 block">Descripción (Opcional)</label>
                  <textarea
                    value={newTemplateDesc}
                    onChange={(e) => setNewTemplateDesc(e.target.value)}
                    placeholder="Describe brevemente el propósito de esta lista..."
                    className="w-full px-4 sm:px-5 py-3 sm:py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm text-zinc-600 h-[120px] sm:h-[148px] resize-none"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Tareas a realizar</label>
                  <button
                    onClick={() => setNewTemplateTasks([...newTemplateTasks, ''])}
                    className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest hover:underline"
                  >
                    + Agregar Tarea
                  </button>
                </div>
                <div className="space-y-2">
                  {newTemplateTasks.map((task, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={task}
                        onChange={(e) => {
                          const updated = [...newTemplateTasks];
                          updated[index] = e.target.value;
                          setNewTemplateTasks(updated);
                        }}
                        placeholder={`Tarea #${index + 1}`}
                        className="min-w-0 flex-1 px-4 sm:px-5 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-medium"
                      />
                      <button
                        onClick={() => {
                          const updated = newTemplateTasks.filter((_, i) => i !== index);
                          setNewTemplateTasks(updated.length ? updated : ['']);
                        }}
                        className="p-3 text-zinc-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6 lg:p-8 bg-zinc-50 border-t border-zinc-100 flex flex-col sm:flex-row gap-3 sm:gap-4">
              <button
                onClick={resetTemplateForm}
                className="flex-1 py-4 bg-white border border-zinc-200 text-zinc-600 rounded-2xl font-bold text-sm hover:bg-zinc-100 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateTemplate}
                disabled={!newTemplateName || newTemplateTasks.filter(t => t.trim()).length === 0}
                className="flex-1 py-4 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 disabled:opacity-50"
              >
                {editingTemplateId ? 'Actualizar Plantilla' : 'Guardar Plantilla'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
