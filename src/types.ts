export interface ProductFamily {
  id: number;
  name: string;
  category_id: number | null;
  category_name?: string;
  estado: 'activo' | 'inactivo';
}

export interface ProductCategory {
  id: number;
  name: string;
  description?: string;
  estado: 'activo' | 'inactivo';
}

export interface Product {
  id: number;
  code: string;
  codigo_unico: string;
  name: string;
  description: string;
  cost: number;
  sale_price: number;
  stock: number;
  stock_minimo: number;
  company: 'Edu' | 'Peti';
  family_id: number | null;
  family_name?: string;
  category_id: number | null;
  category_name?: string;
  estado: 'activo' | 'inactivo';
  eliminado: number;
  active: number;
  created_at: string;
}

export type ProductFormData = Omit<Product, 'id' | 'active' | 'eliminado' | 'codigo_unico' | 'created_at' | 'family_name' | 'category_name'>;

export interface PurchaseInvoice {
  id: number;
  numero_factura: string;
  proveedor: string;
  fecha_compra: string;
  total: number;
  created_at: string;
  items?: PurchaseInvoiceItem[];
}

export interface PurchaseInvoiceItem {
  id: number;
  purchase_invoice_id: number;
  product_id: number;
  product_name?: string;
  cantidad: number;
  costo_unitario: number;
  cantidad_restante: number;
}

export interface Cheque {
  id: number;
  banco: string;
  numero_cheque: string;
  fecha_vencimiento: string;
  importe: number;
  cliente_id: number;
  venta_id?: number;
  estado: 'en_cartera' | 'depositado' | 'entregado_proveedor' | 'cobrado' | 'rechazado';
  fecha_creacion: string;
  observaciones?: string;
}

export interface UserPermission {
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface User {
  id: number;
  name: string;
  role: 'administrador' | 'empleado';
  email: string;
  avatar?: string;
  permissions?: Record<string, UserPermission>;
}

export interface ChecklistTemplateItem {
  id?: number;
  task_name: string;
}

export interface ChecklistTemplate {
  id: number;
  name: string;
  description: string;
  type: 'Apertura' | 'Cierre' | 'Ruta' | 'General';
  active: number;
  created_at: string;
  items?: ChecklistTemplateItem[];
}

export interface ChecklistItem {
  id: number;
  checklist_id: number;
  task_name: string;
  completed: number;
  completed_at: string | null;
  completed_by?: string | null;
}

export interface Checklist {
  id: number;
  template_id: number;
  template_name?: string;
  date: string;
  status: 'pendiente' | 'completado';
  notes: string;
  created_at: string;
  completed_at: string | null;
  items?: ChecklistItem[];
  total_tasks?: number;
  completed_tasks?: number;
}
