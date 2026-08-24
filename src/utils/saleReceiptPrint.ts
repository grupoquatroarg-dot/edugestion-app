import { jsPDF } from 'jspdf';
import { formatBusinessDate, getBusinessDateInputValue } from './businessDate';
import { formatMeasurementQuantity } from '../../shared/productMeasurement';

export const ECONOMIC_HALF_PAGE_MAX_ITEMS = 8;

export type EconomicSalePrintLayout = 'half' | 'full';

interface EconomicPrintRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EconomicPrintPage {
  layout: EconomicSalePrintLayout;
  sales: any[];
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const PAGE_MARGIN_X = 6;
const FULL_REGION: EconomicPrintRegion = {
  x: PAGE_MARGIN_X,
  y: 5,
  width: PAGE_WIDTH - PAGE_MARGIN_X * 2,
  height: PAGE_HEIGHT - 10,
};
const HALF_REGIONS: EconomicPrintRegion[] = [
  { x: PAGE_MARGIN_X, y: 5, width: PAGE_WIDTH - PAGE_MARGIN_X * 2, height: 139 },
  { x: PAGE_MARGIN_X, y: 153, width: PAGE_WIDTH - PAGE_MARGIN_X * 2, height: 139 },
];

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

const safeText = (value: any) => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const getOriginalUnitPrice = (item: any) => {
  return Number(item.precio_unitario_original ?? item.precio_original ?? item.precio_lista ?? item.precio_venta ?? 0);
};

const getDiscountedUnitPrice = (item: any) => {
  return Number(item.precio_unitario_bonificado ?? item.precio_venta ?? getOriginalUnitPrice(item));
};

const getDiscountText = (item: any) => {
  const type = item.bonificacion_tipo || 'none';
  const value = Number(item.bonificacion_valor || 0);

  if (!value || type === 'none') return '-';
  if (type === 'percentage') return `${value}%`;
  if (type === 'fixed') return formatCurrency(value);
  return '-';
};

const getSaleItems = (sale: any) => Array.isArray(sale?.items) ? sale.items : [];

export const getEconomicSalePrintLayout = (sale: any): EconomicSalePrintLayout => {
  return getSaleItems(sale).length <= ECONOMIC_HALF_PAGE_MAX_ITEMS ? 'half' : 'full';
};

export const planEconomicSalePrintPages = (sales: any[]): EconomicPrintPage[] => {
  const pages: EconomicPrintPage[] = [];
  let pendingHalfPage: EconomicPrintPage | null = null;

  for (const sale of sales) {
    if (getEconomicSalePrintLayout(sale) === 'full') {
      if (pendingHalfPage) {
        pages.push(pendingHalfPage);
        pendingHalfPage = null;
      }
      pages.push({ layout: 'full', sales: [sale] });
      continue;
    }

    if (!pendingHalfPage) {
      pendingHalfPage = { layout: 'half', sales: [sale] };
      continue;
    }

    pendingHalfPage.sales.push(sale);
    pages.push(pendingHalfPage);
    pendingHalfPage = null;
  }

  if (pendingHalfPage) pages.push(pendingHalfPage);
  return pages;
};

const trimTextToWidth = (
  doc: jsPDF,
  value: string,
  maxWidth: number,
  fontSize: number
) => {
  doc.setFontSize(fontSize);
  if (doc.getTextWidth(value) <= maxWidth) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${value.slice(0, middle)}…`;
    if (doc.getTextWidth(candidate) <= maxWidth) low = middle;
    else high = middle - 1;
  }

  return `${value.slice(0, low)}…`;
};

const drawFittedText = (
  doc: jsPDF,
  value: any,
  x: number,
  y: number,
  maxWidth: number,
  baseFontSize: number,
  options: { align?: 'left' | 'center' | 'right'; minFontSize?: number } = {}
) => {
  const text = safeText(value);
  const align = options.align || 'left';
  const minFontSize = options.minFontSize ?? 2.2;
  doc.setFontSize(baseFontSize);
  const measuredWidth = Math.max(doc.getTextWidth(text), 0.01);
  const fittedFontSize = Math.max(minFontSize, Math.min(baseFontSize, baseFontSize * maxWidth / measuredWidth));
  const fittedText = trimTextToWidth(doc, text, maxWidth, fittedFontSize);
  doc.setFontSize(fittedFontSize);
  doc.text(fittedText, x, y, { align });
};

const drawEconomicReceipt = (
  doc: jsPDF,
  sale: any,
  businessSettings: Record<string, string>,
  region: EconomicPrintRegion,
  layout: EconomicSalePrintLayout
) => {
  const businessName = businessSettings.business_name || 'EDUGESTIÓN';
  const items = getSaleItems(sale);
  const rows = items.length > 0 ? items : [{ product_name: 'Sin productos' }];
  const isCancelled = String(sale?.estado || '').toLowerCase() === 'anulada';
  const cancellation = sale?.cancellation || {};
  const paidAmount = Number(cancellation.monto_pagado_original ?? sale?.monto_pagado_original ?? sale?.monto_pagado ?? 0);
  const pendingAmount = Number(cancellation.monto_pendiente_original ?? sale?.monto_pendiente_original ?? sale?.monto_pendiente ?? 0);
  const hasPendingBalance = !isCancelled && pendingAmount > 0;
  const contentX = region.x + 2.5;
  const contentWidth = region.width - 5;
  const saleNumber = safeText(sale?.numero_venta || sale?.id).padStart(6, '0');
  const compactScale = layout === 'half' ? 0.94 : 1;

  doc.setDrawColor(55, 55, 55);
  doc.setTextColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.rect(region.x, region.y, region.width, region.height, 'S');

  doc.setFont('helvetica', 'bold');
  drawFittedText(doc, businessName, contentX, region.y + 7, 58, 11 * compactScale, { minFontSize: 5 });
  drawFittedText(
    doc,
    isCancelled ? 'COMPROBANTE DE VENTA - ANULADO' : 'COMPROBANTE DE VENTA',
    region.x + region.width / 2,
    region.y + 7,
    77,
    9.5 * compactScale,
    { align: 'center', minFontSize: 5 }
  );
  drawFittedText(doc, `Venta N° ${saleNumber}`, region.x + region.width - 2.5, region.y + 6.1, 48, 7.5 * compactScale, {
    align: 'right',
    minFontSize: 4,
  });
  drawFittedText(doc, formatBusinessDate(sale?.fecha, '-'), region.x + region.width - 2.5, region.y + 10.2, 48, 6 * compactScale, {
    align: 'right',
    minFontSize: 3.5,
  });

  doc.setFont('helvetica', 'normal');
  const businessDetails = [
    businessSettings.business_razon_social && `Razón Social: ${businessSettings.business_razon_social}`,
    businessSettings.business_cuit && `CUIT: ${businessSettings.business_cuit}`,
    businessSettings.business_address && `Dirección: ${businessSettings.business_address}${businessSettings.business_localidad ? `, ${businessSettings.business_localidad}` : ''}`,
    businessSettings.business_phone && `Tel: ${businessSettings.business_phone}`,
  ].filter(Boolean).join(' · ') || 'Comprobante de venta';
  drawFittedText(doc, businessDetails, contentX, region.y + 13.4, contentWidth, 5.4 * compactScale, { minFontSize: 2.8 });

  doc.setLineWidth(0.2);
  doc.line(contentX, region.y + 16.2, contentX + contentWidth, region.y + 16.2);

  doc.setFont('helvetica', 'bold');
  drawFittedText(doc, `Cliente: ${safeText(sale?.nombre_cliente)}`, contentX, region.y + 21.3, 96, 7.2 * compactScale, { minFontSize: 3.5 });
  doc.setFont('helvetica', 'normal');
  drawFittedText(
    doc,
    `Teléfono: ${safeText(sale?.cliente_telefono || sale?.telefono)}`,
    contentX + contentWidth,
    region.y + 21.3,
    70,
    6.2 * compactScale,
    { align: 'right', minFontSize: 3.2 }
  );
  drawFittedText(
    doc,
    `Domicilio: ${safeText(sale?.cliente_direccion || sale?.direccion)} · Localidad: ${safeText(sale?.cliente_localidad || sale?.localidad)}`,
    contentX,
    region.y + 26,
    contentWidth,
    5.8 * compactScale,
    { minFontSize: 2.8 }
  );

  if (isCancelled) {
    doc.setFont('helvetica', 'bold');
    drawFittedText(
      doc,
      `ANULADA: ${safeText(sale?.anulacion_motivo || cancellation.motivo)}`,
      contentX,
      region.y + 30.2,
      contentWidth,
      5.6 * compactScale,
      { minFontSize: 2.8 }
    );
  }

  const tableY = region.y + (isCancelled ? 33 : 29);
  const tableHeaderHeight = 6.5;
  const summaryTop = region.y + region.height - 22;
  const tableBodyY = tableY + tableHeaderHeight;
  const availableBodyHeight = Math.max(4, summaryTop - tableBodyY - 3);
  const rowHeight = Math.min(layout === 'half' ? 7.2 : 7.4, availableBodyHeight / rows.length);
  const bodyFontSize = Math.max(1.8, Math.min(layout === 'half' ? 7.2 : 7.8, rowHeight * 1.28));
  const headerFontSize = Math.max(3.2, Math.min(6.4, bodyFontSize));
  const columnRatios = [0.07, 0.38, 0.145, 0.115, 0.145, 0.145];
  const columnWidths = columnRatios.map(ratio => contentWidth * ratio);
  const columnStarts: number[] = [];
  let currentX = contentX;
  for (const width of columnWidths) {
    columnStarts.push(currentX);
    currentX += width;
  }

  doc.setFillColor(245, 245, 245);
  doc.rect(contentX, tableY, contentWidth, tableHeaderHeight, 'FD');
  doc.setLineWidth(0.18);
  for (let index = 1; index < columnStarts.length; index += 1) {
    doc.line(columnStarts[index], tableY, columnStarts[index], tableBodyY + rowHeight * rows.length);
  }

  const headers = ['Cant.', 'Producto', 'P. unit.', 'Bonif.', 'P. final', 'Importe'];
  doc.setFont('helvetica', 'bold');
  headers.forEach((header, index) => {
    const cellX = columnStarts[index];
    const cellWidth = columnWidths[index];
    drawFittedText(doc, header, cellX + cellWidth / 2, tableY + 4.25, cellWidth - 1.5, headerFontSize, {
      align: 'center',
      minFontSize: 2.6,
    });
  });

  doc.setFont('helvetica', 'normal');
  rows.forEach((item: any, rowIndex: number) => {
    const quantity = Number(item?.cantidad || 0);
    const originalPrice = getOriginalUnitPrice(item);
    const finalPrice = getDiscountedUnitPrice(item);
    const amount = quantity * finalPrice;
    const values = items.length > 0
      ? [
          formatMeasurementQuantity(quantity, item.measurement_unit, { includeUnit: item.quantity_mode === 'measure' }),
          safeText(item.product_name || item.name || item.producto),
          formatUnitCurrency(originalPrice, item),
          getDiscountText(item),
          formatUnitCurrency(finalPrice, item),
          formatCurrency(amount),
        ]
      : ['-', 'Sin productos', '-', '-', '-', '-'];
    const rowTop = tableBodyY + rowHeight * rowIndex;
    const textY = rowTop + rowHeight / 2 + bodyFontSize * 0.11;

    values.forEach((value, columnIndex) => {
      const cellX = columnStarts[columnIndex];
      const cellWidth = columnWidths[columnIndex];
      const align = columnIndex === 1 ? 'left' : columnIndex === 0 || columnIndex === 3 ? 'center' : 'right';
      const textX = align === 'left'
        ? cellX + 1
        : align === 'right'
          ? cellX + cellWidth - 1
          : cellX + cellWidth / 2;
      drawFittedText(doc, value, textX, textY, cellWidth - 2, bodyFontSize, {
        align,
        minFontSize: 1.6,
      });
    });

    doc.line(contentX, rowTop + rowHeight, contentX + contentWidth, rowTop + rowHeight);
  });

  doc.rect(contentX, tableY, contentWidth, tableHeaderHeight + rowHeight * rows.length, 'S');

  const calculatedTotal = items.reduce((sum: number, item: any) => {
    return sum + Number(item?.cantidad || 0) * getDiscountedUnitPrice(item);
  }, 0);
  const total = Number(sale?.total ?? calculatedTotal);
  const totalBoxWidth = 58;
  const totalBoxX = contentX + contentWidth - totalBoxWidth;
  const totalBoxY = summaryTop + 1;

  doc.setFont('helvetica', 'normal');
  drawFittedText(doc, `Forma de pago: ${safeText(sale?.metodo_pago).toUpperCase()}`, contentX, summaryTop + 5, contentWidth - totalBoxWidth - 4, 6.3 * compactScale, { minFontSize: 3 });
  drawFittedText(doc, `Pagado: ${formatCurrency(paidAmount)}`, contentX, summaryTop + 10.3, contentWidth - totalBoxWidth - 4, 6.1 * compactScale, { minFontSize: 3 });
  if (hasPendingBalance) {
    doc.setFont('helvetica', 'bold');
    drawFittedText(doc, `Saldo pendiente: ${formatCurrency(pendingAmount)}`, contentX, summaryTop + 15.6, contentWidth - totalBoxWidth - 4, 6.2 * compactScale, { minFontSize: 3 });
  }

  doc.setLineWidth(0.35);
  doc.rect(totalBoxX, totalBoxY, totalBoxWidth, 15, 'S');
  doc.setFont('helvetica', 'bold');
  drawFittedText(doc, 'TOTAL OPERACIÓN', totalBoxX + 3, totalBoxY + 5.2, totalBoxWidth - 6, 6.2 * compactScale, { minFontSize: 3.2 });
  drawFittedText(doc, formatCurrency(total), totalBoxX + totalBoxWidth - 3, totalBoxY + 11.8, totalBoxWidth - 6, 10.5 * compactScale, {
    align: 'right',
    minFontSize: 4,
  });

  doc.setFont('helvetica', 'normal');
  drawFittedText(
    doc,
    isCancelled ? `Comprobante anulado · Venta N° ${saleNumber}` : `Impresión económica · Venta N° ${saleNumber}`,
    region.x + region.width / 2,
    region.y + region.height - 2.8,
    contentWidth,
    4.6 * compactScale,
    { align: 'center', minFontSize: 2.8 }
  );
};

export const buildEconomicSalePrintDocument = (
  sales: any[],
  businessSettings: Record<string, string> = {}
) => {
  if (!Array.isArray(sales) || sales.length === 0) {
    throw new Error('No hay ventas seleccionadas para imprimir.');
  }

  const pages = planEconomicSalePrintPages(sales);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) doc.addPage('a4', 'portrait');
    doc.setPage(pageIndex + 1);

    if (page.layout === 'full') {
      drawEconomicReceipt(doc, page.sales[0], businessSettings, FULL_REGION, 'full');
      return;
    }

    page.sales.forEach((sale, saleIndex) => {
      drawEconomicReceipt(doc, sale, businessSettings, HALF_REGIONS[saleIndex], 'half');
    });

    doc.setDrawColor(135, 135, 135);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(4, PAGE_HEIGHT / 2, PAGE_WIDTH - 4, PAGE_HEIGHT / 2);
    doc.setLineDashPattern([], 0);
  });

  doc.setProperties({
    title: sales.length === 1 ? `Venta ${safeText(sales[0]?.numero_venta || sales[0]?.id)}` : 'Ventas seleccionadas',
    subject: 'Versión económica para impresión',
    creator: 'EduGestión',
  });

  return doc;
};

export const getEconomicSalePrintFileName = (sales: any[]) => {
  if (sales.length === 1) {
    const saleNumber = safeText(sales[0]?.numero_venta || sales[0]?.id);
    return `Venta_${saleNumber}_impresion_economica.pdf`;
  }

  return `Ventas_seleccionadas_${getBusinessDateInputValue()}_impresion_economica.pdf`;
};
