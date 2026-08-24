import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatBusinessDate, getBusinessDateInputValue, getBusinessDateKey } from './businessDate';
import { outputPdfDocument, type PdfOutputMode } from './pdfOutput';
import { buildEconomicSalePrintDocument, getEconomicSalePrintFileName } from './saleReceiptPrint';
import { formatMeasurementQuantity } from '../../shared/productMeasurement';

const formatCurrency = (value: any) => {
  const numberValue = Number(value || 0);
  return `$${numberValue.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatUnitCurrency = (value: any, item: any) => {
  const numberValue = Number(value || 0);
  const isMeasured = item?.quantity_mode === 'measure';
  return `$${numberValue.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: isMeasured ? 4 : 2,
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

  const statusSuffix = String(sale.estado || '').toLowerCase() === 'anulada' ? '_ANULADA' : '';
  return `${clientName}_${dateText}${statusSuffix}.pdf`;
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

const buildSaleReceiptDoc = (
  sale: any,
  businessSettings: Record<string, string> = {},
  mode: PdfOutputMode = 'download'
) => {
  const isPrint = mode === 'print';
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = isPrint ? 10 : 12;
  const businessName = businessSettings.business_name || 'EDUGESTIÓN';
  const isCancelled = String(sale.estado || '').toLowerCase() === 'anulada';
  const cancellation = sale.cancellation || {};
  const receiptPaidAmount = Number(cancellation.monto_pagado_original ?? sale.monto_pagado_original ?? sale.monto_pagado ?? 0);
  const receiptPendingAmount = Number(cancellation.monto_pendiente_original ?? sale.monto_pendiente_original ?? sale.monto_pendiente ?? 0);

  if (!isPrint && businessSettings.business_logo) {
    try {
      doc.addImage(businessSettings.business_logo, 'PNG', margin, 9, 24, 24);
    } catch (error) {
      console.error('Error adding logo to PDF', error);
    }
  }

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isPrint ? 18 : 15);
  doc.text(businessName, isPrint ? margin : 42, isPrint ? 13 : 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isPrint ? 10 : 8);
  doc.setTextColor(isPrint ? 0 : 82, isPrint ? 0 : 82, isPrint ? 0 : 91);
  const headerX = isPrint ? margin : 42;
  const headerStartY = isPrint ? 19 : 20;
  const headerStep = isPrint ? 5 : 4;
  doc.text(`Razón Social: ${safeText(businessSettings.business_razon_social)}`, headerX, headerStartY);
  doc.text(`CUIT: ${safeText(businessSettings.business_cuit)}`, headerX, headerStartY + headerStep);
  doc.text(`Dirección: ${safeText(businessSettings.business_address)}, ${safeText(businessSettings.business_localidad)}`, headerX, headerStartY + headerStep * 2);
  doc.text(`Tel: ${safeText(businessSettings.business_phone)} | Email: ${safeText(businessSettings.business_email)}`, headerX, headerStartY + headerStep * 3);

  const dividerY = isPrint ? 37 : 38;
  doc.setDrawColor(isPrint ? 80 : 212, isPrint ? 80 : 212, isPrint ? 80 : 216);
  doc.setLineWidth(isPrint ? 0.35 : 0.2);
  doc.line(margin, dividerY, pageWidth - margin, dividerY);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isPrint ? 20 : 16);
  doc.text(isCancelled ? 'COMPROBANTE DE VENTA - ANULADO' : 'COMPROBANTE DE VENTA', pageWidth / 2, isPrint ? 48 : 49, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isPrint ? 11 : 9);
  doc.text(`Venta N°: ${safeText(sale.numero_venta || sale.id).toString().padStart(6, '0')}`, margin, isPrint ? 58 : 59);
  doc.text(`Fecha: ${formatDate(sale.fecha)}`, margin, isPrint ? 64 : 64);

  if (isCancelled) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(isPrint ? 0 : 185, isPrint ? 0 : 28, isPrint ? 0 : 28);
    doc.text(`ANULADA: ${safeText(sale.anulacion_motivo || cancellation.motivo)}`, 105, isPrint ? 58 : 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isPrint ? 9 : 8);
    doc.text(
      `${formatDate(sale.anulada_at || cancellation.anulada_at)} · ${safeText(sale.anulada_por || cancellation.anulada_por)}`,
      105,
      isPrint ? 64 : 64
    );
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isPrint ? 13 : 11);
  doc.text('DATOS DEL CLIENTE', margin, isPrint ? 76 : 76);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isPrint ? 11 : 9);
  doc.text(`Cliente: ${safeText(sale.nombre_cliente)}`, margin, isPrint ? 84 : 83);
  doc.text(`Localidad: ${safeText(sale.cliente_localidad || sale.localidad)}`, margin, isPrint ? 91 : 88);
  doc.text(`Domicilio: ${safeText(sale.cliente_direccion || sale.direccion)}`, isPrint ? 118 : 120, isPrint ? 84 : 83);
  doc.text(`Teléfono: ${safeText(sale.cliente_telefono || sale.telefono)}`, isPrint ? 118 : 120, isPrint ? 91 : 88);

  const items = Array.isArray(sale.items) ? sale.items : [];
  const tableRows = items.map((item: any) => {
    const cantidad = Number(item.cantidad || 0);
    const precioOriginal = getOriginalUnitPrice(item);
    const precioBonificado = getDiscountedUnitPrice(item);
    const importe = cantidad * precioBonificado;

    return [
      formatMeasurementQuantity(cantidad, item.measurement_unit, { includeUnit: item.quantity_mode === 'measure' }),
      safeText(item.product_name || item.name || item.producto),
      formatUnitCurrency(precioOriginal, item),
      getDiscountText(item),
      formatUnitCurrency(precioBonificado, item),
      formatCurrency(importe),
    ];
  });

  const hasPendingBalance = !isCancelled && receiptPendingAmount > 0;
  const summaryReservedHeight = isPrint
    ? (hasPendingBalance ? 43 : 38)
    : (hasPendingBalance ? 39 : 35);

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
    startY: isPrint ? 99 : 96,
    theme: 'grid',
    headStyles: isPrint
      ? {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          fontSize: 9.5,
          cellPadding: 2.2,
          halign: 'center',
          lineColor: [70, 70, 70],
          lineWidth: 0.35,
        }
      : {
          fillColor: [24, 24, 27],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
          cellPadding: 2,
          halign: 'center',
        },
    styles: {
      fontSize: isPrint ? 10.5 : 8,
      cellPadding: isPrint ? 3.2 : 2.4,
      valign: 'middle',
      overflow: 'linebreak',
      textColor: [0, 0, 0],
      lineColor: isPrint ? [110, 110, 110] : [200, 200, 200],
      lineWidth: isPrint ? 0.25 : 0.1,
      fillColor: [255, 255, 255],
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    pageBreak: 'auto',
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    columnStyles: {
      0: { halign: 'center', cellWidth: 20 },
      1: { cellWidth: isPrint ? 104 : 110 },
      2: { halign: 'right', cellWidth: 34 },
      3: { halign: 'center', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 42 },
      5: { halign: 'right', cellWidth: 32 },
    },
    margin: {
      top: 16,
      right: margin,
      bottom: summaryReservedHeight,
      left: margin,
    },
  });

  const summaryGap = isPrint ? 7 : 8;
  let finalY = ((doc as any).lastAutoTable?.finalY || 120) + summaryGap;
  const summaryBoxHeight = isPrint ? 28 : 24;
  const pendingLineOffset = hasPendingBalance ? (isPrint ? 14 : 12) : 0;
  const summaryBottomY = Math.max(
    finalY + pendingLineOffset,
    finalY - 6 + summaryBoxHeight
  );
  const lastUsableY = pageHeight - 14;

  // Safety net: autoTable already reserves room for the summary on every page.
  // If an unusually tall row still consumes that space, move the complete
  // payment/total block to a new page instead of clipping it.
  if (summaryBottomY > lastUsableY) {
    doc.addPage();
    finalY = isPrint ? 25 : 23;
  }
  const totalCalculado = items.reduce((sum: number, item: any) => {
    const cantidad = Number(item.cantidad || 0);
    return sum + cantidad * getDiscountedUnitPrice(item);
  }, 0);
  const total = Number(sale.total ?? totalCalculado);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isPrint ? 11 : 9);
  doc.text(`Forma de pago: ${safeText(sale.metodo_pago).toUpperCase()}`, margin, finalY);
  doc.text(`Pagado: ${formatCurrency(receiptPaidAmount)}`, margin, finalY + (isPrint ? 7 : 6));

  if (hasPendingBalance) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(isPrint ? 0 : 220, isPrint ? 0 : 38, isPrint ? 0 : 38);
    doc.text(`Saldo pendiente: ${formatCurrency(receiptPendingAmount)}`, margin, finalY + (isPrint ? 14 : 12));
  }

  const boxX = pageWidth - (isPrint ? 90 : 86);
  const boxY = finalY - 6;
  const boxWidth = isPrint ? 80 : 74;
  const boxHeight = summaryBoxHeight;

  if (isPrint) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(boxX, boxY, boxWidth, boxHeight, 'S');
    doc.setTextColor(0, 0, 0);
  } else {
    doc.setFillColor(24, 24, 27);
    doc.roundedRect(boxX, boxY, boxWidth, boxHeight, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isPrint ? 11 : 8);
  doc.text('TOTAL OPERACIÓN', boxX + 5, boxY + (isPrint ? 9 : 8));
  doc.setFontSize(isPrint ? 17 : 14);
  doc.text(formatCurrency(total), boxX + boxWidth - 5, boxY + (isPrint ? 21 : 18), { align: 'right' });

  const totalPages = doc.getNumberOfPages();
  const saleNumber = safeText(sale.numero_venta || sale.id).toString().padStart(6, '0');

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    doc.setPage(pageNumber);

    if (pageNumber > 1) {
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(isPrint ? 10 : 8);
      doc.text(isCancelled ? 'COMPROBANTE ANULADO - CONTINUACIÓN' : 'COMPROBANTE DE VENTA - CONTINUACIÓN', margin, 9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Venta N° ${saleNumber} | Fecha ${formatDate(sale.fecha)}`, pageWidth - margin, 9, {
        align: 'right',
      });
      doc.setDrawColor(isPrint ? 80 : 212, isPrint ? 80 : 212, isPrint ? 80 : 216);
      doc.setLineWidth(isPrint ? 0.35 : 0.2);
      doc.line(margin, 12, pageWidth - margin, 12);
    }

    doc.setTextColor(isPrint ? 0 : 150, isPrint ? 0 : 150, isPrint ? 0 : 150);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isPrint ? 9 : 8);
    doc.text(isCancelled ? `Comprobante anulado - ${businessName}` : `Gracias por su compra - ${businessName}`, pageWidth / 2, pageHeight - 7, {
      align: 'center',
    });
    doc.text(`Página ${pageNumber} de ${totalPages}`, pageWidth - margin, pageHeight - 7, {
      align: 'right',
    });
  }

  return doc;
};

export const generateSaleReceipt = (sale: any, businessSettings: Record<string, string> = {}) => {
  const doc = buildSaleReceiptDoc(sale, businessSettings, 'download');
  outputPdfDocument(doc, getReceiptFileName(sale), 'download');
};

export const printSaleReceipts = (
  sales: any[],
  businessSettings: Record<string, string> = {},
  preparedPrintWindow: Window | null = null
) => {
  const doc = buildEconomicSalePrintDocument(sales, businessSettings);
  outputPdfDocument(doc, getEconomicSalePrintFileName(sales), 'print', preparedPrintWindow);
};

export const printSaleReceipt = (
  sale: any,
  businessSettings: Record<string, string> = {},
  preparedPrintWindow: Window | null = null
) => {
  printSaleReceipts([sale], businessSettings, preparedPrintWindow);
};

export const createSaleReceiptPdfFile = (sale: any, businessSettings: Record<string, string> = {}) => {
  const doc = buildSaleReceiptDoc(sale, businessSettings, 'download');
  const blob = doc.output('blob');
  return new File([blob], getReceiptFileName(sale), { type: 'application/pdf' });
};
