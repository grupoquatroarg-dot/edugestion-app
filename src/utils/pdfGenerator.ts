import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatBusinessDate, getBusinessDateInputValue, getBusinessDateKey } from './businessDate';

const formatCurrency = (value: any) => {
  const numberValue = Number(value || 0);
  return `$${numberValue.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (value: any) => formatBusinessDate(value, '-');

const safeText = (value: any) => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const sanitizeFileName = (value: any) => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '_');
};

const getReceiptFileName = (sale: any) => {
  const clientName = sanitizeFileName(sale.nombre_cliente || 'Cliente');
  const dateText = sale.fecha
    ? getBusinessDateKey(sale.fecha) || getBusinessDateInputValue()
    : getBusinessDateInputValue();

  return `${clientName}_${dateText}.pdf`;
};

const getDiscountText = (item: any) => {
  const tipo = item.bonificacion_tipo || 'none';
  const valor = Number(item.bonificacion_valor || 0);

  if (!valor || tipo === 'none') return '-';
  if (tipo === 'percentage') return `${valor}%`;
  if (tipo === 'fixed') return formatCurrency(valor);
  return '-';
};

const getOriginalUnitPrice = (item: any) => {
  return Number(item.precio_unitario_original ?? item.precio_original ?? item.precio_lista ?? item.precio_venta ?? 0);
};

const getDiscountedUnitPrice = (item: any) => {
  return Number(item.precio_unitario_bonificado ?? item.precio_venta ?? getOriginalUnitPrice(item));
};

const buildSaleReceiptDoc = (sale: any, businessSettings: Record<string, string> = {}) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;

  const businessName = businessSettings.business_name || 'EDUGESTIÓN';

  if (businessSettings.business_logo) {
    try {
      doc.addImage(businessSettings.business_logo, 'PNG', margin, 9, 24, 24);
    } catch (e) {
      console.error('Error adding logo to PDF', e);
    }
  }

  doc.setTextColor(24, 24, 27);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(businessName, 42, 15);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(82, 82, 91);
  doc.text(`Razón Social: ${safeText(businessSettings.business_razon_social)}`, 42, 20);
  doc.text(`CUIT: ${safeText(businessSettings.business_cuit)}`, 42, 24);
  doc.text(`Dirección: ${safeText(businessSettings.business_address)}, ${safeText(businessSettings.business_localidad)}`, 42, 28);
  doc.text(`Tel: ${safeText(businessSettings.business_phone)} | Email: ${safeText(businessSettings.business_email)}`, 42, 32);

  doc.setDrawColor(212, 212, 216);
  doc.line(margin, 38, pageWidth - margin, 38);

  doc.setTextColor(24, 24, 27);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('COMPROBANTE DE VENTA', pageWidth / 2, 49, { align: 'center' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Venta N°: ${safeText(sale.numero_venta || sale.id).toString().padStart(6, '0')}`, margin, 59);
  doc.text(`Fecha: ${formatDate(sale.fecha)}`, margin, 64);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL CLIENTE', margin, 76);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cliente: ${safeText(sale.nombre_cliente)}`, margin, 83);
  doc.text(`Localidad: ${safeText(sale.cliente_localidad || sale.localidad)}`, margin, 88);
  doc.text(`Domicilio: ${safeText(sale.cliente_direccion || sale.direccion)}`, 120, 83);
  doc.text(`Teléfono: ${safeText(sale.cliente_telefono || sale.telefono)}`, 120, 88);

  const items = Array.isArray(sale.items) ? sale.items : [];

  const tableRows = items.map((item: any) => {
    const cantidad = Number(item.cantidad || 0);
    const precioOriginal = getOriginalUnitPrice(item);
    const precioBonificado = getDiscountedUnitPrice(item);
    const importe = cantidad * precioBonificado;

    return [
      cantidad.toLocaleString('es-AR'),
      safeText(item.product_name || item.name || item.producto),
      formatCurrency(precioOriginal),
      getDiscountText(item),
      formatCurrency(precioBonificado),
      formatCurrency(importe),
    ];
  });

  autoTable(doc, {
    head: [[
      'Cantidad',
      'Producto',
      'Precio unitario',
      'Bonificación',
      'Precio unit. bonificado',
      'Importe',
    ]],
    body: tableRows.length > 0 ? tableRows : [['-', 'Sin productos', '-', '-', '-', '-']],
    startY: 96,
    theme: 'grid',
    headStyles: {
      fillColor: [24, 24, 27],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.4,
      valign: 'middle',
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 20 },
      1: { cellWidth: 110 },
      2: { halign: 'right', cellWidth: 34 },
      3: { halign: 'center', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 42 },
      5: { halign: 'right', cellWidth: 32 },
    },
    margin: { left: margin, right: margin },
  });

  const finalY = ((doc as any).lastAutoTable?.finalY || 120) + 8;

  const totalCalculado = items.reduce((sum: number, item: any) => {
    const cantidad = Number(item.cantidad || 0);
    return sum + cantidad * getDiscountedUnitPrice(item);
  }, 0);

  const total = Number(sale.total ?? totalCalculado);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(82, 82, 91);
  doc.text(`Forma de pago: ${safeText(sale.metodo_pago).toUpperCase()}`, margin, finalY);
  doc.text(`Pagado: ${formatCurrency(sale.monto_pagado)}`, margin, finalY + 6);

  if (Number(sale.monto_pendiente || 0) > 0) {
    doc.setTextColor(220, 38, 38);
    doc.setFont('helvetica', 'bold');
    doc.text(`Saldo pendiente: ${formatCurrency(sale.monto_pendiente)}`, margin, finalY + 12);
  }

  const boxX = pageWidth - 86;
  const boxY = finalY - 6;
  doc.setFillColor(24, 24, 27);
  doc.roundedRect(boxX, boxY, 74, 24, 3, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL OPERACIÓN', boxX + 5, boxY + 8);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(formatCurrency(total), boxX + 69, boxY + 18, { align: 'right' });

  doc.setTextColor(150);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Gracias por su compra - ${businessName}`, pageWidth / 2, 195, { align: 'center' });

  return doc;
};

export const generateSaleReceipt = (sale: any, businessSettings: Record<string, string> = {}) => {
  const doc = buildSaleReceiptDoc(sale, businessSettings);
  doc.save(getReceiptFileName(sale));
};

export const createSaleReceiptPdfFile = (sale: any, businessSettings: Record<string, string> = {}) => {
  const doc = buildSaleReceiptDoc(sale, businessSettings);
  const blob = doc.output('blob');
  return new File([blob], getReceiptFileName(sale), { type: 'application/pdf' });
};
