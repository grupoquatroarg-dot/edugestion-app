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
  ClipboardList
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

  useEffect(() => {
    if (selectedChecklistForDetail && !selectedChecklistForDetail.items) {
      apiFetch(`/api/checklists/${selectedChecklistForDetail.id}`)
        .then(res => res.json())
        .then(body => {
          const data = unwrapResponse(body);
          setSelectedChecklistForDetail(data);
        })
        .catch(err => console.error("Error fetching checklist detail:", err));
    }
  }, [selectedChecklistForDetail]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [templatesRes, todayRes, historyRes, routeRes, summaryRes] = await Promise.all([
        apiFetch('/api/checklist-templates'),
        apiFetch('/api/checklists/today'),
        apiFetch('/api/checklists'),
        apiFetch('/api/routes/today'),
        apiFetch('/api/checklist/summary')
      ]);

      const templatesBody = await templatesRes.json();
      const todayBody = await todayRes.json();
      const historyBody = await historyRes.json();
      const routeBody = await routeRes.json();
      const summaryBody = await summaryRes.json();

      const templatesData = unwrapResponse(templatesBody);
      const todayData = unwrapResponse(todayBody);
      const historyData = unwrapResponse(historyBody);
      const routeData = unwrapResponse(routeBody);
      const summaryData = unwrapResponse(summaryBody);

      setTemplates(templatesData);
      setTodayChecklists(todayData);
      setHistory(historyData);
      setTodayRoute(routeData);
      setSummary(summaryData);

      if (todayData.length > 0 && !selectedActiveChecklistId) {
        setSelectedActiveChecklistId(todayData[0].id);
      }
    } catch (error) {
      console.error("Error fetching checklist data:", error);
    } finally {
      setLoading(false);
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
        ? `/api/checklist-templates/${editingTemplateId}`
        : '/api/checklist-templates';
      
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
      const res = await apiFetch(`/api/checklist-templates/${template.id}`);
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
      const res = await apiFetch(`/api/checklist-templates/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: currentActive === 1 ? 0 : 1 })
      });
      if (res.ok) fetchInitialData();
    } catch (error) {
      console.error("Error toggling template status:", error);
    }
  };

  const handleStartTodayChecklist = async (templateId: number) => {
    const today = new Date().toISOString().split('T')[0];
    try {
      const res = await apiFetch('/api/checklists', {
        method: 'POST',
        body: JSON.stringify({
          template_id: templateId,
          date: today,
          notes: ''
        })
      });
      const body = await res.json();

      if (res.ok) {
        const newChecklist = unwrapResponse(body);
        await fetchInitialData();
        setSelectedActiveChecklistId(newChecklist.id);
        setActiveTab('hoy');
      }
    } catch (error) {
      console.error("Error starting checklist:", error);
    }
  };

  const handleToggleItem = async (checklistId: number, itemId: number, currentStatus: number) => {
    try {
      const res = await apiFetch(`/api/checklist-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ 
          completed: currentStatus === 0 ? 1 : 0,
          completed_by: currentStatus === 0 ? user?.name : null
        })
      });

      if (res.ok) {
        setTodayChecklists(prev => prev.map(cl => {
          if (cl.id === checklistId) {
            const updatedItems = cl.items?.map(item => 
              item.id === itemId ? { 
                ...item, 
                completed: currentStatus === 0 ? 1 : 0, 
                completed_at: currentStatus === 0 ? new Date().toISOString() : null,
                completed_by: currentStatus === 0 ? user?.name : null
              } : item
            );
            
            // Check if all items are now completed
            const allCompleted = updatedItems?.every(i => i.completed === 1);
            
            return {
              ...cl,
              items: updatedItems,
              status: allCompleted ? 'completado' : 'pendiente'
            };
          }
          return cl;
        }));

        // If the checklist was completed, we might want to refresh history and today's list
        const updatedCl = todayChecklists.find(c => c.id === checklistId);
        if (updatedCl) {
          const updatedItems = updatedCl.items?.map(item => 
            item.id === itemId ? { ...item, completed: currentStatus === 0 ? 1 : 0 } : item
          );
          if (updatedItems?.every(i => i.completed === 1)) {
            // Give it a small delay to show the last check before it disappears from "Hoy"
            setTimeout(() => {
              fetchInitialData();
              setSelectedActiveChecklistId(null);
            }, 1000);
          }
        }
      }
    } catch (error) {
      console.error("Error toggling item:", error);
    }
  };

  const handleToggleRouteItem = async (itemId: number, field: string, currentValue: number) => {
    try {
      const res = await apiFetch(`/api/routes/items/${itemId}`, {
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
      const res = await apiFetch(`/api/checklists/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completado' })
      });

      if (res.ok) {
        setSelectedActiveChecklistId(null);
        fetchInitialData();
      }
    } catch (error) {
      console.error("Error finishing checklist:", error);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm("¿Estás seguro de eliminar esta plantilla?")) return;
    try {
      const res = await apiFetch(`/api/checklist-templates/${id}`, { method: 'DELETE' });
      if (res.ok) fetchInitialData();
    } catch (error) {
      console.error("Error deleting template:", error);
    }
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
      <header className="bg-white border-b border-zinc-200 px-8 py-6 shrink-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-black text-zinc-900 tracking-tight flex items-center gap-3">
              <ClipboardCheck className="text-zinc-400" size={32} />
              CHECK LIST
            </h2>
            <p className="text-zinc-500 text-sm font-medium mt-1">Control de tareas diarias y procesos.</p>
          </div>
          <div className="flex items-center gap-3 bg-zinc-100 p-2 rounded-2xl px-4">
            <Users size={18} className="text-zinc-400" />
            <span className="text-sm font-bold text-zinc-900">
              {user?.name || 'Admin'}
            </span>
          </div>
        </div>

        <div className="flex gap-1 bg-zinc-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('hoy')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'hoy' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Check List del Día
          </button>
          <button
            onClick={() => setActiveTab('ruta')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'ruta' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Ruta del Día
          </button>
          <button
            onClick={() => setActiveTab('plantillas')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'plantillas' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Plantillas
          </button>
          <button
            onClick={() => setActiveTab('historial')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'historial' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Historial
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'hoy' && (
            <motion.div
              key="hoy"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl mx-auto space-y-8"
            >
              {/* Resumen del día Section */}
              {summary && (
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <Layout size={20} className="text-zinc-400" />
                    <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Resumen del día</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-6 bg-white border border-zinc-100 rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <Users size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Clientes en Ruta</span>
                      </div>
                      <p className="text-3xl font-black text-zinc-900">{summary.routeClients}</p>
                      <p className="text-[10px] text-zinc-400">Programados para hoy</p>
                    </div>

                    <div className="p-6 bg-white border border-zinc-100 rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <DollarSign size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Dinero Pendiente</span>
                      </div>
                      <p className="text-3xl font-black text-zinc-900">${(summary.pendingMoney ?? 0).toLocaleString()}</p>
                      <p className="text-[10px] text-zinc-400">Cuentas por cobrar</p>
                    </div>

                    <div className="p-6 bg-white border border-zinc-100 rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <AlertCircle size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Stock Crítico</span>
                      </div>
                      <p className={`text-3xl font-black ${summary.criticalStock > 0 ? 'text-red-600' : 'text-zinc-900'}`}>{summary.criticalStock}</p>
                      <p className="text-[10px] text-zinc-400">Productos bajo el mínimo</p>
                    </div>

                    <div className="p-6 bg-white border border-zinc-100 rounded-[32px] shadow-sm flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-zinc-400 mb-1">
                        <ShoppingCart size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Pedidos Pendientes</span>
                      </div>
                      <p className="text-3xl font-black text-zinc-900">{summary.pendingSupplierOrders}</p>
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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {filteredTemplates.map(template => (
                            <button
                              key={template.id}
                              onClick={() => hasPermission('checklist', 'create') && handleStartTodayChecklist(template.id)}
                              disabled={!hasPermission('checklist', 'create')}
                              className={`p-5 bg-white border border-zinc-100 rounded-3xl hover:border-zinc-900 transition-all group shadow-sm text-left ${!hasPermission('checklist', 'create') ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <ChevronRight size={14} className="text-zinc-300 group-hover:text-zinc-900 ml-auto" />
                              </div>
                              <h4 className="font-bold text-zinc-900 text-sm line-clamp-1">{template.name}</h4>
                              <p className="text-[10px] text-zinc-400 mt-1 line-clamp-1">{template.description}</p>
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
                <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="md:col-span-1 space-y-4">
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
                          <div className="flex items-center justify-between">
                            <h4 className="font-black text-sm">{cl.template_name}</h4>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              selectedActiveChecklistId === cl.id ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500'
                            }`}>
                              {cl.items?.filter(i => i.completed).length}/{cl.items?.length}
                            </span>
                          </div>
                          <p className={`text-[10px] font-medium ${selectedActiveChecklistId === cl.id ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            Iniciado {new Date(cl.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    {selectedActiveChecklistId && todayChecklists.find(cl => cl.id === selectedActiveChecklistId) && (
                      <div className="bg-white rounded-[40px] shadow-sm border border-zinc-100 overflow-hidden">
                        {(() => {
                          const cl = todayChecklists.find(c => c.id === selectedActiveChecklistId)!;
                          return (
                            <>
                              <div className="p-8 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
                                <div>
                                  <h3 className="text-xl font-black text-zinc-900">{cl.template_name}</h3>
                                  <p className="text-sm text-zinc-500 font-medium">Control activo del día</p>
                                </div>
                                <button
                                  onClick={() => handleFinishChecklist(cl.id)}
                                  className="px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
                                >
                                  Finalizar Control
                                </button>
                              </div>
                              <div className="p-8 space-y-3">
                                {cl.items?.map((item) => (
                                  <button
                                    key={item.id}
                                    onClick={() => handleToggleItem(cl.id, item.id, item.completed)}
                                    className={`w-full flex items-center gap-4 p-5 rounded-3xl border transition-all text-left ${
                                      item.completed 
                                        ? 'bg-emerald-50 border-emerald-100 text-emerald-900' 
                                        : 'bg-white border-zinc-100 hover:border-zinc-300 text-zinc-900'
                                    }`}
                                  >
                                    {item.completed ? (
                                      <CheckCircle2 size={24} className="text-emerald-500 shrink-0" />
                                    ) : (
                                      <Circle size={24} className="text-zinc-200 shrink-0" />
                                    )}
                                    <span className={`font-bold ${item.completed ? 'line-through opacity-50' : ''}`}>
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
                <div className="text-center py-20 bg-white rounded-[40px] border border-zinc-100 border-dashed">
                  <div className="w-24 h-24 bg-zinc-50 rounded-[40px] flex items-center justify-center mx-auto mb-6">
                    <ClipboardCheck size={48} className="text-zinc-200" />
                  </div>
                  <h3 className="text-2xl font-black text-zinc-900 mb-2">No hay controles activos</h3>
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
              className="max-w-5xl mx-auto space-y-8"
            >
              {!todayRoute ? (
                <div className="text-center py-20 bg-white rounded-[40px] border border-zinc-100 border-dashed">
                  <div className="w-24 h-24 bg-zinc-50 rounded-[40px] flex items-center justify-center mx-auto mb-6 text-zinc-200">
                    <Map size={48} />
                  </div>
                  <h3 className="text-2xl font-black text-zinc-900 mb-2">No hay ruta activa para hoy</h3>
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
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
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black text-zinc-900">Plantillas de Tareas</h3>
                {hasPermission('checklist', 'create') && (
                  <button
                    onClick={() => setShowNewTemplateModal(true)}
                    className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
                  >
                    <Plus size={18} />
                    Nueva Plantilla
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {templates.map(template => (
                  <div key={template.id} className={`bg-white border rounded-[40px] p-8 shadow-sm flex flex-col transition-all ${template.active ? 'border-zinc-100' : 'border-zinc-200 opacity-60 grayscale'}`}>
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
                          disabled={!template.active}
                          className="text-sm font-bold text-zinc-900 hover:underline disabled:opacity-30"
                        >
                          Usar hoy
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
              <div className="bg-white rounded-[40px] border border-zinc-100 overflow-hidden shadow-sm">
                <div className="p-8 border-b border-zinc-50">
                  <h3 className="text-2xl font-black text-zinc-900">Historial de Check Lists</h3>
                  <p className="text-zinc-500 text-sm font-medium mt-1">Registro de todas las listas ejecutadas.</p>
                </div>
                <table className="w-full text-left border-collapse">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[40px] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div>
                <h2 className="text-2xl font-black text-zinc-900">{selectedChecklistForDetail.template_name}</h2>
                <p className="text-sm font-medium text-zinc-500">
                  {new Date(selectedChecklistForDetail.date).toLocaleDateString()} • {selectedChecklistForDetail.status}
                </p>
              </div>
              <button
                onClick={() => setSelectedChecklistForDetail(null)}
                className="p-3 hover:bg-white rounded-2xl transition-all text-zinc-400 hover:text-zinc-900 shadow-sm"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[40px] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div>
                <h2 className="text-2xl font-black text-zinc-900">{editingTemplateId ? 'Editar Plantilla' : 'Nueva Plantilla'}</h2>
                <p className="text-sm font-medium text-zinc-500">Define las tareas que se realizarán.</p>
              </div>
              <button
                onClick={resetTemplateForm}
                className="p-3 hover:bg-white rounded-2xl transition-all text-zinc-400 hover:text-zinc-900 shadow-sm"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 block">Nombre de la Plantilla</label>
                    <input
                      type="text"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      placeholder="Ej: Apertura de Local"
                      className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none font-bold text-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 block">Tipo de Plantilla</label>
                    <div className="grid grid-cols-2 gap-2">
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
                    className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm text-zinc-600 h-[148px] resize-none"
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
                        className="flex-1 px-5 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-medium"
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

            <div className="p-8 bg-zinc-50 border-t border-zinc-100 flex gap-4">
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
