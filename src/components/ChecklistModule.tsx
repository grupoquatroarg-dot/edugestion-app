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
import { formatBusinessDate, formatBusinessTime, getBusinessDateInputValue } from '../utils/businessDate';
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
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editingTemplateLoading, setEditingTemplateLoading] = useState(false);
  const [finishingChecklistId, setFinishingChecklistId] = useState<number | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null);
  const [templateStatusId, setTemplateStatusId] = useState<number | null>(null);
  const [updatingRouteKeys, setUpdatingRouteKeys] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
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
    if (!selectedChecklistForDetail || selectedChecklistForDetail.items) return;

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    apiFetch(`/api/clientes?endpoint=checklist&id=${selectedChecklistForDetail.id}`)
      .then(async response => {
        if (!response.ok) {
          throw new Error(await readApiError(response, 'No se pudo cargar el detalle del checklist.'));
        }
        return response.json();
      })
      .then(body => {
        if (cancelled) return;
        const data = unwrapResponse<Checklist>(body);
        setSelectedChecklistForDetail(data);
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Error fetching checklist detail:', error);
        setDetailError(error?.message || 'No se pudo cargar el detalle del checklist.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChecklistForDetail?.id]);

  const fetchInitialData = async (showFullLoader: boolean = true) => {
    if (showFullLoader) {
      setLoading(true);
      setLoadError(null);
    } else {
      setRefreshing(true);
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
      else setRefreshing(false);
    }
  };

  const handleCreateTemplate = async () => {
    const validTasks = newTemplateTasks.map(task => task.trim()).filter(Boolean);
    if (!newTemplateName.trim() || validTasks.length === 0 || savingTemplate) return;

    const payload = {
      name: newTemplateName.trim(),
      description: newTemplateDesc.trim(),
      type: newTemplateType,
      items: validTasks
    };

    setSavingTemplate(true);
    try {
      const url = editingTemplateId
        ? `/api/clientes?endpoint=checklist-template&id=${editingTemplateId}`
        : '/api/clientes?endpoint=checklist-templates';

      const res = await apiFetch(url, {
        method: editingTemplateId ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo guardar la plantilla.'));
      }

      resetTemplateForm();
      showNotification('success', editingTemplateId ? 'Plantilla actualizada correctamente.' : 'Plantilla creada correctamente.');
      await fetchInitialData(false);
    } catch (error: any) {
      console.error('Error saving template:', error);
      showNotification('error', error?.message || 'No se pudo guardar la plantilla.');
    } finally {
      setSavingTemplate(false);
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
    if (editingTemplateLoading) return;
    setEditingTemplateLoading(true);
    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist-template&id=${template.id}`);
      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo cargar la plantilla.'));
      }
      const body = await res.json();
      const data = unwrapResponse<Template>(body);
      setEditingTemplateId(template.id);
      setNewTemplateName(data.name);
      setNewTemplateDesc(data.description || '');
      setNewTemplateType(data.type || 'General');
      setNewTemplateTasks(data.items?.map(item => item.task_name) || ['']);
      setShowNewTemplateModal(true);
    } catch (error: any) {
      console.error('Error fetching template for edit:', error);
      showNotification('error', error?.message || 'No se pudo cargar la plantilla.');
    } finally {
      setEditingTemplateLoading(false);
    }
  };

  const handleToggleTemplateStatus = async (id: number, currentActive: number) => {
    if (templateStatusId !== null) return;
    setTemplateStatusId(id);
    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist-template-status&id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: currentActive === 1 ? 0 : 1 })
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo cambiar el estado de la plantilla.'));
      }
      showNotification('success', currentActive === 1 ? 'Plantilla desactivada.' : 'Plantilla activada.');
      await fetchInitialData(false);
    } catch (error: any) {
      console.error('Error toggling template status:', error);
      showNotification('error', error?.message || 'No se pudo cambiar el estado de la plantilla.');
    } finally {
      setTemplateStatusId(null);
    }
  };

  const handleStartTodayChecklist = async (templateId: number) => {
    if (startingTemplateId !== null) return;

    const today = getBusinessDateInputValue();
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
    const key = `${itemId}-${field}`;
    if (updatingRouteKeys.includes(key)) return;
    setUpdatingRouteKeys(previous => [...previous, key]);

    try {
      const res = await apiFetch(`/api/clientes?endpoint=route-item&id=${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: currentValue === 0 ? 1 : 0 })
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo actualizar la ruta.'));
      }

      setTodayRoute((previous: any) => {
        if (!previous) return previous;
        return {
          ...previous,
          items: previous.items.map((item: any) =>
            item.id === itemId ? { ...item, [field]: currentValue === 0 ? 1 : 0 } : item
          )
        };
      });
    } catch (error: any) {
      console.error('Error toggling route item field:', error);
      showNotification('error', error?.message || 'No se pudo actualizar la ruta.');
    } finally {
      setUpdatingRouteKeys(previous => previous.filter(item => item !== key));
    }
  };

  const handleFinishChecklist = async (id: number) => {
    if (finishingChecklistId !== null) return;
    setFinishingChecklistId(id);
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
      console.error('Error finishing checklist:', error);
      showNotification('error', error?.message || 'No se pudo finalizar el checklist.');
    } finally {
      setFinishingChecklistId(null);
    }
  };

  const handleDeleteTemplate = async () => {
    if (deletingTemplateId === null) return;
    const id = deletingTemplateId;
    try {
      const res = await apiFetch(`/api/clientes?endpoint=checklist-template&id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(await readApiError(res, 'No se pudo eliminar la plantilla.'));
      }
      setDeletingTemplateId(null);
      showNotification('success', 'Plantilla eliminada correctamente.');
      await fetchInitialData(false);
    } catch (error: any) {
      console.error('Error deleting template:', error);
      showNotification('error', error?.message || 'No se pudo eliminar la plantilla.');
    }
  };

  const activeChecklist = todayChecklists.find(checklist => checklist.id === selectedActiveChecklistId) || null;
  const activeTemplates = templates.filter(template => Number(template.active) === 1);
  const completedToday = todayChecklists.reduce(
    (total, checklist) => total + (checklist.items || []).filter(item => Number(item.completed) === 1).length,
    0
  );
  const totalTodayTasks = todayChecklists.reduce(
    (total, checklist) => total + (checklist.items || []).length,
    0
  );

  const tabItems = [
    { id: 'hoy' as const, label: 'Checklist del día', icon: ClipboardCheck },
    { id: 'ruta' as const, label: 'Ruta del día', icon: Map },
    { id: 'plantillas' as const, label: 'Plantillas', icon: Layout },
    { id: 'historial' as const, label: 'Historial', icon: History }
  ];

  const routeActions = [
    { field: 'visitado', label: 'Visitado', icon: CheckCircle2, activeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    { field: 'venta_registrada', label: 'Venta', icon: ShoppingCart, activeClass: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    { field: 'pedido_generado', label: 'Pedido', icon: ClipboardList, activeClass: 'bg-amber-100 text-amber-700 border-amber-200' },
    { field: 'cobranza_realizada', label: 'Cobranza', icon: DollarSign, activeClass: 'bg-cyan-100 text-cyan-700 border-cyan-200' }
  ];

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 p-4 sm:p-6 lg:p-8" aria-busy="true" aria-live="polite">
        <div className="mx-auto max-w-7xl space-y-6 animate-pulse">
          <div className="rounded-[28px] bg-slate-900 p-6 sm:p-8">
            <div className="h-8 w-48 rounded-lg bg-white/15" />
            <div className="mt-3 h-4 w-72 max-w-full rounded bg-white/10" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map(item => <div key={item} className="h-20 rounded-2xl bg-white shadow-sm" />)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map(item => <div key={item} className="h-32 rounded-3xl bg-white shadow-sm" />)}
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-slate-600">
              <Loader2 className="animate-spin" size={20} />
              <span className="font-bold">Cargando controles y tareas...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-full bg-slate-50 p-4 sm:p-6 lg:p-8 flex items-center justify-center">
        <div className="w-full max-w-md rounded-[28px] border border-red-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <AlertCircle size={30} />
          </div>
          <h2 className="text-xl font-black text-slate-900">No se pudo cargar Checklist</h2>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => fetchInitialData()}
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            <RefreshCw size={18} />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      {notification && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed inset-x-4 top-4 z-[80] mx-auto flex max-w-lg items-center gap-3 rounded-2xl border p-4 shadow-2xl sm:left-auto sm:right-5 sm:mx-0 ${
            notification.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="min-w-0 flex-1 text-sm font-bold">{notification.message}</span>
        </div>
      )}

      <div className="mx-auto max-w-7xl p-3 sm:p-5 lg:p-8">
        <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-5 text-white shadow-xl sm:p-7 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100">
                <ClipboardCheck size={14} />
                Control operativo
              </div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">Checklist</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Organiza tareas diarias, controles de ruta y plantillas desde cualquier dispositivo.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <div className="flex min-h-11 items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                <Users size={18} className="text-indigo-200" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Responsable</p>
                  <p className="truncate text-sm font-bold text-white">{user?.name || 'Administrador'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void fetchInitialData(false)}
                disabled={refreshing}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-60"
              >
                <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Controles activos</p>
              <p className="mt-1 text-2xl font-black">{todayChecklists.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tareas completadas</p>
              <p className="mt-1 text-2xl font-black">{completedToday}/{totalTodayTasks}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Plantillas activas</p>
              <p className="mt-1 text-2xl font-black">{activeTemplates.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ruta de hoy</p>
              <p className="mt-1 text-lg font-black">{todayRoute ? `${todayRoute.items?.length || 0} clientes` : 'Sin ruta'}</p>
            </div>
          </div>
        </section>

        <nav className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:grid-cols-4" aria-label="Secciones de Checklist">
          {tabItems.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-bold transition sm:text-sm ${
                  selected
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                aria-current={selected ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="mt-5 pb-8">
          <AnimatePresence mode="wait">
            {activeTab === 'hoy' && (
              <motion.div key="hoy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6">
                {summary && (
                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <Layout size={18} className="text-indigo-600" />
                      <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Resumen del día</h2>
                    </div>
                    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: 'Clientes en ruta', value: summary.routeClients, detail: 'Programados para hoy', icon: Users, tone: 'text-indigo-700 bg-indigo-50' },
                        { label: 'Dinero pendiente', value: `$${(summary.pendingMoney ?? 0).toLocaleString()}`, detail: 'Cuentas por cobrar', icon: DollarSign, tone: 'text-emerald-700 bg-emerald-50' },
                        { label: 'Stock crítico', value: summary.criticalStock, detail: 'Productos bajo mínimo', icon: AlertCircle, tone: summary.criticalStock > 0 ? 'text-red-700 bg-red-50' : 'text-slate-700 bg-slate-100' },
                        { label: 'Pedidos pendientes', value: summary.pendingSupplierOrders, detail: 'A proveedores', icon: ShoppingCart, tone: 'text-amber-700 bg-amber-50' }
                      ].map(card => {
                        const Icon = card.icon;
                        return (
                          <article key={card.label} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                            <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}><Icon size={19} /></div>
                            <p className="break-words text-[10px] font-bold uppercase tracking-wider text-slate-500">{card.label}</p>
                            <p className="mt-1 break-words text-xl font-black text-slate-900 sm:text-2xl">{card.value}</p>
                            <p className="mt-1 text-xs text-slate-500">{card.detail}</p>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900 sm:text-xl">Iniciar un nuevo control</h2>
                      <p className="mt-1 text-sm text-slate-500">Elegí una plantilla activa para usarla hoy.</p>
                    </div>
                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{activeTemplates.length} disponibles</span>
                  </div>

                  <div className="mt-5 space-y-6">
                    {['Apertura', 'Cierre', 'Ruta', 'General'].map(type => {
                      const filteredTemplates = activeTemplates.filter(template => template.type === type);
                      if (filteredTemplates.length === 0) return null;
                      return (
                        <div key={type}>
                          <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                            <span className={`h-2 w-2 rounded-full ${type === 'Apertura' ? 'bg-emerald-500' : type === 'Cierre' ? 'bg-amber-500' : type === 'Ruta' ? 'bg-blue-500' : 'bg-slate-400'}`} />
                            {type === 'Apertura' ? 'Inicio del día' : type === 'Cierre' ? 'Cierre del día' : type === 'General' ? 'Control general' : 'Ruta'}
                          </h3>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {filteredTemplates.map(template => (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => hasPermission('checklist', 'create') && handleStartTodayChecklist(template.id)}
                                disabled={!hasPermission('checklist', 'create') || startingTemplateId !== null}
                                className="group min-h-28 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label={`Usar hoy la plantilla ${template.name}`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="break-words text-sm font-black text-slate-900">{template.name}</p>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{template.description || 'Sin descripción'}</p>
                                  </div>
                                  {startingTemplateId === template.id ? <Loader2 size={18} className="shrink-0 animate-spin text-indigo-600" /> : <ChevronRight size={18} className="shrink-0 text-slate-300 group-hover:text-indigo-600" />}
                                </div>
                                <span className="mt-4 inline-flex items-center rounded-lg bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{startingTemplateId === template.id ? 'Iniciando...' : 'Usar hoy'}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {activeTemplates.length === 0 && (
                      <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
                        <Layout className="mx-auto text-slate-300" size={30} />
                        <p className="mt-3 font-bold text-slate-700">No hay plantillas activas</p>
                        <p className="mt-1 text-sm text-slate-500">Creá o activá una plantilla desde la pestaña Plantillas.</p>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-black text-slate-900 sm:text-xl">Controles en curso</h2>
                      <p className="mt-1 text-sm text-slate-500">Marcá cada tarea y seguí el progreso en tiempo real.</p>
                    </div>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{todayChecklists.length} activos</span>
                  </div>

                  {todayChecklists.length === 0 ? (
                    <div className="rounded-[26px] border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                      <CheckCircle2 className="mx-auto text-slate-300" size={36} />
                      <p className="mt-3 font-black text-slate-800">No hay controles activos</p>
                      <p className="mt-1 text-sm text-slate-500">Iniciá una plantilla para comenzar el control del día.</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.75fr)_minmax(0,2fr)]">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        {todayChecklists.map(checklist => {
                          const completed = (checklist.items || []).filter(item => Number(item.completed) === 1).length;
                          const total = (checklist.items || []).length;
                          const selected = selectedActiveChecklistId === checklist.id;
                          const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
                          return (
                            <button
                              key={checklist.id}
                              type="button"
                              onClick={() => setSelectedActiveChecklistId(checklist.id)}
                              className={`min-w-0 rounded-2xl border p-4 text-left transition ${selected ? 'border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-300'}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <p className="min-w-0 break-words text-sm font-black">{checklist.template_name}</p>
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>{completed}/{total}</span>
                              </div>
                              <div className={`mt-3 h-2 overflow-hidden rounded-full ${selected ? 'bg-white/15' : 'bg-slate-100'}`}>
                                <div className={`h-full rounded-full ${selected ? 'bg-white' : 'bg-indigo-500'}`} style={{ width: `${percentage}%` }} />
                              </div>
                              <p className={`mt-2 text-xs ${selected ? 'text-indigo-100' : 'text-slate-500'}`}>{percentage}% completado</p>
                            </button>
                          );
                        })}
                      </div>

                      {activeChecklist && (
                        <article className="min-w-0 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
                          <div className="border-b border-slate-200 bg-slate-50 p-4 sm:p-6">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                              <div className="min-w-0">
                                <h3 className="break-words text-lg font-black text-slate-900 sm:text-xl">{activeChecklist.template_name}</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                  {(activeChecklist.items || []).filter(item => Number(item.completed) === 1).length}/{(activeChecklist.items || []).length} tareas completadas
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleFinishChecklist(activeChecklist.id)}
                                disabled={finishingChecklistId !== null}
                                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 lg:w-auto"
                              >
                                {finishingChecklistId === activeChecklist.id && <Loader2 size={17} className="animate-spin" />}
                                {finishingChecklistId === activeChecklist.id ? 'Finalizando...' : 'Finalizar control'}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-3 p-4 sm:p-6">
                            {(activeChecklist.items || []).map(item => {
                              const complete = Number(item.completed) === 1;
                              const updating = updatingItemIds.includes(item.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleToggleItem(activeChecklist.id, item.id, item.completed)}
                                  disabled={updatingItemIds.length > 0 || !hasPermission('checklist', 'edit')}
                                  className={`flex min-h-14 w-full min-w-0 items-start gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed ${complete ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white hover:border-indigo-300'} ${updating ? 'opacity-70' : ''}`}
                                  aria-label={`${complete ? 'Desmarcar' : 'Marcar'} tarea: ${item.task_name}`}
                                >
                                  {updating ? <Loader2 size={22} className="mt-0.5 shrink-0 animate-spin text-indigo-600" /> : complete ? <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={22} className="mt-0.5 shrink-0 text-slate-300" />}
                                  <div className="min-w-0 flex-1">
                                    <p className={`break-words text-sm font-bold ${complete ? 'line-through opacity-60' : ''}`}>{item.task_name}</p>
                                    {complete && (
                                      <p className="mt-1 break-words text-xs text-emerald-700">
                                        {item.completed_at ? formatBusinessTime(item.completed_at) : ''}
                                        {item.completed_by ? ` · ${item.completed_by}` : ''}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </article>
                      )}
                    </div>
                  )}
                </section>
              </motion.div>
            )}

            {activeTab === 'ruta' && (
              <motion.div key="ruta" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                {!todayRoute ? (
                  <div className="rounded-[28px] border-2 border-dashed border-slate-200 bg-white p-8 text-center sm:p-12">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100 text-slate-400"><Map size={38} /></div>
                    <h2 className="mt-5 text-xl font-black text-slate-900">No hay ruta activa para hoy</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Planificá una ruta desde el módulo Rutas. Cuando exista, vas a poder registrar visitas, ventas, pedidos y cobranzas desde aquí.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <section className="rounded-[26px] bg-gradient-to-r from-indigo-700 to-indigo-900 p-5 text-white shadow-lg sm:p-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-200">Ruta del día</p>
                          <h2 className="mt-1 break-words text-xl font-black sm:text-2xl">{todayRoute.name}</h2>
                          <p className="mt-1 text-sm text-indigo-100">{formatBusinessDate(todayRoute.date)}</p>
                        </div>
                        <span className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{todayRoute.items?.length || 0} clientes</span>
                      </div>
                    </section>

                    <div className="grid gap-4 lg:grid-cols-2">
                      {(todayRoute.items || []).map((item: any) => (
                        <article key={item.id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><Users size={20} /></div>
                            <div className="min-w-0 flex-1">
                              <h3 className="break-words text-base font-black text-slate-900">{item.nombre_apellido}</h3>
                              <p className="mt-1 break-words text-sm text-slate-500">{item.localidad || 'Sin localidad'}</p>
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            {routeActions.map(action => {
                              const Icon = action.icon;
                              const active = Number(item[action.field]) === 1;
                              const key = `${item.id}-${action.field}`;
                              const updating = updatingRouteKeys.includes(key);
                              return (
                                <button
                                  key={action.field}
                                  type="button"
                                  onClick={() => handleToggleRouteItem(item.id, action.field, Number(item[action.field]))}
                                  disabled={updating}
                                  className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-bold transition disabled:opacity-60 ${active ? action.activeClass : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-indigo-300 hover:text-indigo-700'}`}
                                >
                                  {updating ? <Loader2 size={17} className="animate-spin" /> : <Icon size={17} />}
                                  {action.label}
                                </button>
                              );
                            })}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'plantillas' && (
              <motion.div key="plantillas" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 sm:text-2xl">Plantillas de tareas</h2>
                    <p className="mt-1 text-sm text-slate-500">Definí controles reutilizables para apertura, cierre, ruta o tareas generales.</p>
                  </div>
                  {hasPermission('checklist', 'create') && (
                    <button type="button" onClick={() => setShowNewTemplateModal(true)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 sm:w-auto">
                      <Plus size={18} /> Nueva plantilla
                    </button>
                  )}
                </div>

                {templates.length === 0 ? (
                  <div className="rounded-[26px] border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                    <Layout className="mx-auto text-slate-300" size={36} />
                    <p className="mt-3 font-black text-slate-800">Todavía no hay plantillas</p>
                    <p className="mt-1 text-sm text-slate-500">Creá la primera plantilla para comenzar.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {templates.map(template => {
                      const active = Number(template.active) === 1;
                      return (
                        <article key={template.id} className={`min-w-0 rounded-[24px] border bg-white p-5 shadow-sm transition ${active ? 'border-slate-200' : 'border-slate-200 opacity-70'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${template.type === 'Apertura' ? 'bg-emerald-50 text-emerald-700' : template.type === 'Cierre' ? 'bg-amber-50 text-amber-700' : template.type === 'Ruta' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>{template.type}</span>
                              <h3 className="mt-3 break-words text-lg font-black text-slate-900">{template.name}</h3>
                              <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-slate-500">{template.description || 'Sin descripción'}</p>
                            </div>
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}><Layout size={21} /></div>
                          </div>

                          <div className="mt-5 grid grid-cols-2 gap-2">
                            {hasPermission('checklist', 'edit') && (
                              <button type="button" onClick={() => handleEditTemplate(template)} disabled={editingTemplateLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-60">
                                {editingTemplateLoading ? <Loader2 size={16} className="animate-spin" /> : <Edit3 size={16} />} Editar
                              </button>
                            )}
                            {hasPermission('checklist', 'delete') && (
                              <button type="button" onClick={() => setDeletingTemplateId(template.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
                                <Trash2 size={16} /> Eliminar
                              </button>
                            )}
                          </div>

                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => hasPermission('checklist', 'edit') && handleToggleTemplateStatus(template.id, template.active)}
                              disabled={!hasPermission('checklist', 'edit') || templateStatusId !== null}
                              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-60 ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                            >
                              {templateStatusId === template.id && <Loader2 size={15} className="animate-spin" />}
                              {active ? 'Plantilla activa' : 'Plantilla inactiva'}
                            </button>
                            {hasPermission('checklist', 'create') && (
                              <button type="button" onClick={() => handleStartTodayChecklist(template.id)} disabled={!active || startingTemplateId !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                                {startingTemplateId === template.id ? <Loader2 size={15} className="animate-spin" /> : <ChevronRight size={15} />}
                                {startingTemplateId === template.id ? 'Iniciando...' : 'Usar hoy'}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'historial' && (
              <motion.div key="historial" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <div className="mb-4">
                  <h2 className="text-xl font-black text-slate-900 sm:text-2xl">Historial de controles</h2>
                  <p className="mt-1 text-sm text-slate-500">Consultá los checklists ejecutados y el detalle de sus tareas.</p>
                </div>

                {history.length === 0 ? (
                  <div className="rounded-[26px] border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                    <History className="mx-auto text-slate-300" size={36} />
                    <p className="mt-3 font-black text-slate-800">No hay controles en el historial</p>
                    <p className="mt-1 text-sm text-slate-500">Los controles finalizados aparecerán aquí.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {history.map(item => {
                      const total = item.total_tasks || 0;
                      const completed = item.completed_tasks || 0;
                      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
                      const complete = item.status === 'completado';
                      return (
                        <article key={item.id} className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-xs font-bold text-slate-500"><Calendar size={15} /> {formatBusinessDate(item.date)}</p>
                              <h3 className="mt-2 break-words text-lg font-black text-slate-900">{item.template_name}</h3>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{complete ? 'Completo' : 'Incompleto'}</span>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3">
                            <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tareas</p><p className="mt-1 text-lg font-black text-slate-900">{total}</p></div>
                            <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Completadas</p><p className="mt-1 text-lg font-black text-indigo-700">{completed}</p></div>
                          </div>
                          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${percentage}%` }} /></div>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <span className="text-xs font-bold text-slate-500">{percentage}% completado</span>
                            <button type="button" onClick={() => { setDetailError(null); setSelectedChecklistForDetail(item); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                              Ver detalle <ChevronRight size={15} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {selectedChecklistForDetail && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-[28px]">
            <div className="border-b border-slate-200 bg-slate-50 p-5 pr-16 sm:p-6 sm:pr-16">
              <h2 className="break-words text-xl font-black text-slate-900">{selectedChecklistForDetail.template_name}</h2>
              <p className="mt-1 text-sm text-slate-500">{formatBusinessDate(selectedChecklistForDetail.date)} · {selectedChecklistForDetail.status}</p>
              <button type="button" onClick={() => { setSelectedChecklistForDetail(null); setDetailError(null); }} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-100" aria-label="Cerrar detalle"><X size={21} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {detailLoading ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-slate-500"><Loader2 className="animate-spin" size={28} /><p className="text-sm font-bold">Cargando detalle...</p></div>
              ) : detailError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center"><AlertCircle className="mx-auto text-red-600" size={28} /><p className="mt-3 text-sm font-bold text-red-800">{detailError}</p><button type="button" onClick={() => { const current = selectedChecklistForDetail; setSelectedChecklistForDetail(null); window.setTimeout(() => setSelectedChecklistForDetail(current), 0); }} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white"><RefreshCw size={17} /> Reintentar</button></div>
              ) : (
                <div className="space-y-3">
                  {(selectedChecklistForDetail.items || []).map(item => {
                    const complete = Number(item.completed) === 1;
                    return (
                      <div key={item.id} className={`flex min-w-0 items-start gap-3 rounded-2xl border p-4 ${complete ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                        {complete ? <CheckCircle2 size={21} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={21} className="mt-0.5 shrink-0 text-slate-300" />}
                        <div className="min-w-0 flex-1"><p className="break-words text-sm font-bold text-slate-900">{item.task_name}</p>{complete && <p className="mt-1 break-words text-xs text-emerald-700">{item.completed_at ? formatBusinessTime(item.completed_at) : ''}{item.completed_by ? ` · ${item.completed_by}` : ''}</p>}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {showNewTemplateModal && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="flex max-h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-[28px]">
            <div className="relative border-b border-slate-200 bg-slate-50 p-5 pr-16 sm:p-6 sm:pr-16">
              <h2 className="text-xl font-black text-slate-900">{editingTemplateId ? 'Editar plantilla' : 'Nueva plantilla'}</h2>
              <p className="mt-1 text-sm text-slate-500">Definí el nombre, tipo y las tareas que se deben realizar.</p>
              <button type="button" onClick={resetTemplateForm} disabled={savingTemplate} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Cerrar formulario de plantilla de checklist"><X size={21} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                  <div><label className="mb-2 block text-xs font-bold text-slate-600">Nombre de la plantilla</label><input type="text" value={newTemplateName} onChange={event => setNewTemplateName(event.target.value)} placeholder="Ej.: Apertura de local" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></div>
                  <div>
                    <label className="mb-2 block text-xs font-bold text-slate-600">Tipo</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
                      {['Apertura', 'Cierre', 'Ruta', 'General'].map(type => <button key={type} type="button" onClick={() => setNewTemplateType(type as any)} className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-bold ${newTemplateType === type ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'}`}>{type}</button>)}
                    </div>
                  </div>
                </div>
                <div><label className="mb-2 block text-xs font-bold text-slate-600">Descripción</label><textarea value={newTemplateDesc} onChange={event => setNewTemplateDesc(event.target.value)} placeholder="Describe brevemente el objetivo del control..." className="min-h-36 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-black text-slate-900">Tareas</h3><p className="text-xs text-slate-500">Agregá al menos una tarea.</p></div><button type="button" onClick={() => setNewTemplateTasks(previous => [...previous, ''])} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-indigo-700 shadow-sm ring-1 ring-slate-200"><Plus size={16} /> Agregar tarea</button></div>
                <div className="mt-4 space-y-3">
                  {newTemplateTasks.map((task, index) => (
                    <div key={index} className="flex min-w-0 items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-xs font-black text-indigo-700">{index + 1}</span>
                      <input type="text" value={task} onChange={event => { const updated = [...newTemplateTasks]; updated[index] = event.target.value; setNewTemplateTasks(updated); }} placeholder={`Tarea ${index + 1}`} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                      <button type="button" onClick={() => { const updated = newTemplateTasks.filter((_, itemIndex) => itemIndex !== index); setNewTemplateTasks(updated.length ? updated : ['']); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100" aria-label={`Eliminar tarea ${index + 1}`}><Trash2 size={17} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 sm:p-5">
              <button type="button" onClick={resetTemplateForm} disabled={savingTemplate} className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleCreateTemplate} disabled={!newTemplateName.trim() || newTemplateTasks.every(task => !task.trim()) || savingTemplate} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{savingTemplate && <Loader2 size={17} className="animate-spin" />}{savingTemplate ? 'Guardando...' : editingTemplateId ? 'Actualizar plantilla' : 'Guardar plantilla'}</button>
            </div>
          </motion.div>
        </div>
      )}

      {deletingTemplateId !== null && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700"><Trash2 size={25} /></div>
            <h2 className="mt-4 text-xl font-black text-slate-900">Eliminar plantilla</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">La plantilla dejará de estar disponible para iniciar nuevos controles. Esta acción no afecta los controles históricos.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setDeletingTemplateId(null)} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">Cancelar</button><button type="button" onClick={handleDeleteTemplate} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700"><Trash2 size={17} /> Eliminar</button></div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
