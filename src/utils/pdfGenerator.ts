import jsPDF from 'jspdf';
import 'jspdf-autotable';

export const generateSaleReceipt = (sale: any, businessSettings: Record<string, string> = {}) => {
  const doc = new jsPDF();
  
  // Business Logo
  if (businessSettings.business_logo) {
    try {
      doc.addImage(businessSettings.business_logo, 'PNG', 20, 10, 30, 30);
    } catch (e) {
      console.error("Error adding logo to PDF", e);
    }
  }

  // Business Header Info
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(businessSettings.business_name || 'EDUGESTIÓN', 60, 20);
  
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`Razón Social: ${businessSettings.business_razon_social || '-'}`, 60, 25);
  doc.text(`CUIT: ${businessSettings.business_cuit || '-'}`, 60, 29);
  doc.text(`Dirección: ${businessSettings.business_address || '-'}, ${businessSettings.business_localidad || '-'}`, 60, 33);
  doc.text(`Tel: ${businessSettings.business_phone || '-'} | Email: ${businessSettings.business_email || '-'}`, 60, 37);

  doc.setTextColor(0);
  doc.setDrawColor(200);
  doc.line(20, 45, 190, 45);

  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('COMPROBANTE DE VENTA', 105, 55, { align: 'center' });
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Venta N°: ${(sale.numero_venta || sale.id).toString().padStart(6, '0')}`, 20, 65);
  doc.text(`Fecha: ${sale.fecha ? new Date(sale.fecha).toLocaleString() : ''}`, 20, 70);
  
  // Customer Info
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL CLIENTE', 20, 85);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cliente: ${sale.nombre_cliente}`, 20, 92);
  
  // Table
  const tableColumn = ["Producto", "Empresa", "Cant.", "Precio", "Subtotal"];
  const tableRows = sale.items.map((item: any) => [
    item.product_name,
    item.company,
    item.cantidad,
    `$${item.precio_venta.toFixed(2)}`,
    `$${(item.cantidad * item.precio_venta).toFixed(2)}`
  ]);

  (doc as any).autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 100,
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 27] }, // zinc-900
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;

  // Totals
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL: $${sale.total.toFixed(2)}`, 140, finalY);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Forma de Pago: ${sale.metodo_pago.toUpperCase()}`, 20, finalY);
  doc.text(`Pagado: $${sale.monto_pagado.toFixed(2)}`, 20, finalY + 5);
  
  if (sale.monto_pendiente > 0) {
    doc.setTextColor(220, 38, 38); // red-600
    doc.text(`SALDO PENDIENTE: $${sale.monto_pendiente.toFixed(2)}`, 20, finalY + 10);
  }

  // Footer
  doc.setTextColor(150);
  doc.setFontSize(8);
  doc.text(`Gracias por su compra - ${businessSettings.business_name || 'EDUGESTIÓN'}`, 105, 280, { align: 'center' });

  doc.save(`Comprobante_Venta_${sale.id}.pdf`);
};
