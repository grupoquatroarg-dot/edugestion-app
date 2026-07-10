import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatBusinessDate, getBusinessDateInputValue, getBusinessDateKey } from './businessDate';
import { outputPdfDocument, type PdfOutputMode } from './pdfOutput';

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

const getStatusLabel = (order: any) => {
  if (order?.estado === 'aprobado_pendiente_entrega' && order?.stock_status === 'esperando_stock') {
    return 'Esperando reposición';
  }

  if (order?.estado === 'aprobado_pendiente_entrega' && order?.stock_status === 'listo_entrega') {
    return 'Listo para entregar';
  }

  if (order?.estado === 'entregado' && order?.sale_estado === 'Pagada') {
    return 'Entregado y pagado';
  }

  switch (order?.estado) {
    case 'pendiente_aprobacion': return 'Pendiente de aprobación';
    case 'aprobado_pendiente_entrega': return 'Aprobado - pendiente de entrega';
    case 'entregado': return 'Entregado';
    case 'rechazado': return 'Rechazado';
    case 'cancelado': return 'Cancelado';
    default: return order?.estado || 'Pendiente';
  }
};

export const getCustomerOrderPdfFileName = (order: any) => {
  const clientName = sanitizeFileName(order?.cliente || order?.nombre_cliente || 'Cliente');
  const dateText = order?.fecha
    ? getBusinessDateKey(order.fecha) || getBusinessDateInputValue()
    : getBusinessDateInputValue();

  return `Pedido_${clientName}_${dateText}.pdf`;
};

const buildCustomerOrderPdf = (
  order: any,
  businessSettings: Record<string, string> = {},
  mode: PdfOutputMode = 'download'
) => {
  const isPrint = mode === 'print';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = isPrint ? 12 : 14;
  const businessName = businessSettings.business_name || businessSettings.nombre_negocio || 'Edugestión';

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isPrint ? 20 : 18);
  doc.text(String(businessName), margin, isPrint ? 18 : 18);

  doc.setFontSize(isPrint ? 17 : 14);
  doc.text(`Pedido de cliente #${order?.numero_pedido || order?.id || ''}`, margin, isPrint ? 32 : 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isPrint ? 11 : 9);
  doc.text(`Cliente: ${order?.cliente || '-'}`, margin, isPrint ? 43 : 39);
  doc.text(`Fecha: ${order?.fecha ? formatBusinessDate(order.fecha) : '-'}`, margin, isPrint ? 50 : 45);
  doc.text(`Estado: ${getStatusLabel(order)}`, margin, isPrint ? 57 : 51);

  const rows = (order?.items || []).map((item: any) => [
    item.product_name || item.name || 'Producto',
    String(Number(item.cantidad || 0)),
    formatCurrency(item.precio_unitario),
    formatCurrency(item.importe || Number(item.cantidad || 0) * Number(item.precio_unitario || 0)),
  ]);

  autoTable(doc, {
    startY: isPrint ? 68 : 62,
    head: [['Producto', 'Cantidad', 'Precio unit.', 'Importe']],
    body: rows.length ? rows : [['Sin productos', '-', '-', '-']],
    theme: 'grid',
    styles: {
      fontSize: isPrint ? 11 : 8,
      cellPadding: isPrint ? 3.5 : 2,
      textColor: [0, 0, 0],
      fillColor: [255, 255, 255],
      lineColor: isPrint ? [100, 100, 100] : [200, 200, 200],
      lineWidth: isPrint ? 0.25 : 0.1,
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    headStyles: isPrint
      ? {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          lineColor: [60, 60, 60],
          lineWidth: 0.35,
        }
      : {
          fillColor: [24, 24, 27],
          textColor: [255, 255, 255],
        },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 70;
  const boxX = pageWidth - (isPrint ? 92 : 86);
  const boxY = finalY + 8;

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isPrint ? 11 : 9);
  doc.text(`Subtotal: ${formatCurrency(order?.subtotal)}`, boxX, boxY);
  doc.text(`Descuento: -${formatCurrency(order?.descuento_monto)}`, boxX, boxY + (isPrint ? 7 : 6));

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isPrint ? 16 : 12);
  doc.text(`Total: ${formatCurrency(order?.total_final)}`, boxX, boxY + (isPrint ? 18 : 15));

  if (order?.estado === 'entregado') {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isPrint ? 11 : 9);
    doc.text(`Pagado: ${formatCurrency(order?.sale_monto_pagado)}`, margin, boxY + (isPrint ? 15 : 15));
    doc.text(`Saldo pendiente: ${formatCurrency(order?.sale_monto_pendiente)}`, margin, boxY + (isPrint ? 22 : 21));
  }

  if (order?.admin_notes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isPrint ? 11 : 9);
    doc.text(`Observación: ${order.admin_notes}`, margin, boxY + (isPrint ? 30 : 25), {
      maxWidth: pageWidth - margin * 2,
    });
  }

  if (order?.rejection_reason) {
    doc.setFontSize(isPrint ? 11 : 9);
    doc.setTextColor(isPrint ? 0 : 180, isPrint ? 0 : 40, isPrint ? 0 : 40);
    doc.text(`Motivo de rechazo: ${order.rejection_reason}`, margin, boxY + (isPrint ? 42 : 35), {
      maxWidth: pageWidth - margin * 2,
    });
    doc.setTextColor(0, 0, 0);
  }

  if (isPrint) {
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.25);
    doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Versión económica para impresión', pageWidth / 2, pageHeight - 8, { align: 'center' });
  }

  return doc;
};

export const generateCustomerOrderPdf = (order: any, businessSettings: Record<string, string> = {}) => {
  const doc = buildCustomerOrderPdf(order, businessSettings, 'download');
  outputPdfDocument(doc, getCustomerOrderPdfFileName(order), 'download');
};

export const printCustomerOrderPdf = (order: any, businessSettings: Record<string, string> = {}) => {
  const doc = buildCustomerOrderPdf(order, businessSettings, 'print');
  outputPdfDocument(doc, getCustomerOrderPdfFileName(order), 'print');
};
