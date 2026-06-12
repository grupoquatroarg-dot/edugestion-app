import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const formatCurrency = (value: any) => {
  const numberValue = Number(value || 0);
  return `$${numberValue.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const sanitizeFileName = (value: any) => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '_');
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pendiente_aprobacion': return 'Pendiente de aprobación';
    case 'aprobado_pendiente_entrega': return 'Aprobado - pendiente de entrega';
    case 'entregado': return 'Entregado';
    case 'rechazado': return 'Rechazado';
    case 'cancelado': return 'Cancelado';
    default: return status || 'Pendiente';
  }
};

export const getCustomerOrderPdfFileName = (order: any) => {
  const clientName = sanitizeFileName(order?.cliente || order?.nombre_cliente || 'Cliente');
  const rawDate = order?.fecha ? new Date(order.fecha) : new Date();
  const dateText = Number.isNaN(rawDate.getTime())
    ? new Date().toISOString().split('T')[0]
    : rawDate.toISOString().split('T')[0];

  return `Pedido_${clientName}_${dateText}.pdf`;
};

export const generateCustomerOrderPdf = (order: any, businessSettings: Record<string, string> = {}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const businessName = businessSettings.business_name || businessSettings.nombre_negocio || 'Edugestión';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(String(businessName), margin, 18);

  doc.setFontSize(14);
  doc.text(`Pedido de cliente #${order?.numero_pedido || order?.id || ''}`, margin, 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Cliente: ${order?.cliente || '-'}`, margin, 39);
  doc.text(`Fecha: ${order?.fecha ? new Date(order.fecha).toLocaleDateString('es-AR') : '-'}`, margin, 45);
  doc.text(`Estado: ${getStatusLabel(order?.estado)}`, margin, 51);

  const rows = (order?.items || []).map((item: any) => [
    item.product_name || item.name || 'Producto',
    String(Number(item.cantidad || 0)),
    formatCurrency(item.precio_unitario),
    formatCurrency(item.importe || Number(item.cantidad || 0) * Number(item.precio_unitario || 0)),
  ]);

  autoTable(doc, {
    startY: 62,
    head: [['Producto', 'Cantidad', 'Precio unit.', 'Importe']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [24, 24, 27], textColor: [255, 255, 255] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 70;
  const boxX = pageWidth - 86;
  const boxY = finalY + 8;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Subtotal: ${formatCurrency(order?.subtotal)}`, boxX, boxY);
  doc.text(`Descuento: -${formatCurrency(order?.descuento_monto)}`, boxX, boxY + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Total: ${formatCurrency(order?.total_final)}`, boxX, boxY + 15);

  if (order?.admin_notes) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Observación: ${order.admin_notes}`, margin, boxY + 25, { maxWidth: pageWidth - margin * 2 });
  }

  if (order?.rejection_reason) {
    doc.setFontSize(9);
    doc.setTextColor(180, 40, 40);
    doc.text(`Motivo de rechazo: ${order.rejection_reason}`, margin, boxY + 35, { maxWidth: pageWidth - margin * 2 });
    doc.setTextColor(0, 0, 0);
  }

  doc.save(getCustomerOrderPdfFileName(order));
};
