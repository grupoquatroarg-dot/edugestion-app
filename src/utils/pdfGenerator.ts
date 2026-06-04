import jsPDF from 'jspdf';
import 'jspdf-autotable';

const formatCurrency = (value: any) => {
  const numberValue = Number(value || 0);
  return `$${numberValue.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (value: any) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-AR');
};

const getDiscountText = (item: any) => {
  const tipo = item.bonificacion_tipo || 'none';
  const valor = Number(item.bonificacion_valor || 0);

  if (!valor || tipo === 'none') return '-';
  if (tipo === 'percentage') return `${valor}%`;
  if (tipo === 'fixed') return formatCurrency(valor);
  return '-';
};

export const generateSaleReceipt = (sale: any, businessSettings: Record<string, string> = {}) => {
  const doc = new jsPDF({ orientation: 'landscape' });

  const pageWidth = doc.internal.pageSize.getWidth();

  if (businessSettings.business_logo) {
    try {
      doc.addImage(businessSettings.business_logo, 'PNG', 14, 10, 24, 24);
    } catch (e) {
      console.error('Error adding logo to PDF', e);
    }
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(businessSettings.business_name || 'EDUGESTIÓN', 42, 16);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`Razón Social: ${businessSettings.business_razon_social || '-'}`, 42, 21);
  doc.text(`CUIT: ${businessSettings.business_cuit || '-'}`, 42, 25);
  doc.text(`Dirección: ${businessSettings.business_address || '-'}, ${businessSettings.business_localidad || '-'}`, 42, 29);
  doc.text(`Tel: ${businessSettings.business_phone || '-'} | Email: ${businessSettings.business_email || '-'}`, 42, 33);

  doc.setTextColor(0);
  doc.setDrawColor(200);
  doc.line(14, 39, pageWidth - 14, 39);

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('COMPROBANTE DE VENTA', pageWidth / 2, 49, { align: 'center' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Venta N°: ${(sale.numero_venta || sale.id || '').toString().padStart(6, '0')}`, 14, 59);
  doc.text(`Fecha: ${formatDate(sale.fecha)}`, 14, 64);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL CLIENTE', 14, 76);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cliente: ${sale.nombre_cliente || '-'}`, 14, 83);
  doc.text(`Localidad: ${sale.cliente_localidad || sale.localidad || '-'}`, 14, 88);
  doc.text(`Domicilio: ${sale.cliente_direccion || sale.direccion || '-'}`, 110, 83);
  doc.text(`Teléfono: ${sale.cliente_telefono || sale.telefono || '-'}`, 110, 88);

  const tableColumn = [
    'Cant.',
    'Producto',
    'Precio Unit.',
    'Bonificación',
    'Unit. Bonificado',
    'Importe',
  ];

  const tableRows = (sale.items || []).map((item: any) => {
    const cantidad = Number(item.cantidad || 0);
    const precioOriginal = Number(item.precio_unitario_original ?? item.precio_venta ?? 0);
    const precioBonificado = Number(item.precio_unitario_bonificado ?? item.precio_venta ?? precioOriginal);
    const importe = cantidad * precioBonificado;

    return [
      cantidad.toLocaleString('es-AR'),
      item.product_name || item.name || '-',
      formatCurrency(precioOriginal),
      getDiscountText(item),
      formatCurrency(precioBonificado),
      formatCurrency(importe),
    ];
  });

  (doc as any).autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 96,
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 27], textColor: [255, 255, 255] },
    styles: { fontSize: 8, cellPadding: 2.5, valign: 'middle' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 18 },
      1: { cellWidth: 105 },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'center', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 34 },
      5: { halign: 'right', cellWidth: 34 },
    },
  });

  const finalY = ((doc as any).lastAutoTable?.finalY || 120) + 8;

  const subtotal = (sale.items || []).reduce((sum: number, item: any) => {
    const cantidad = Number(item.cantidad || 0);
    const precioBonificado = Number(item.precio_unitario_bonificado ?? item.precio_venta ?? 0);
    return sum + cantidad * precioBonificado;
  }, 0);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Forma de Pago: ${String(sale.metodo_pago || '-').toUpperCase()}`, 14, finalY);
  doc.text(`Pagado: ${formatCurrency(sale.monto_pagado)}`, 14, finalY + 6);

  if (Number(sale.monto_pendiente || 0) > 0) {
    doc.setTextColor(220, 38, 38);
    doc.text(`SALDO PENDIENTE: ${formatCurrency(sale.monto_pendiente)}`, 14, finalY + 12);
    doc.setTextColor(0);
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL: ${formatCurrency(sale.total ?? subtotal)}`, pageWidth - 14, finalY, { align: 'right' });

  doc.setTextColor(150);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Gracias por su compra - ${businessSettings.business_name || 'EDUGESTIÓN'}`, pageWidth / 2, 195, { align: 'center' });

  doc.save(`Comprobante_Venta_${sale.numero_venta || sale.id}.pdf`);
};
