import jsPDF from 'jspdf';

const formatCurrency = (value: any) => {
  const amount = Number(value || 0);
  return `$${amount.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const sanitizeFileName = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '_');

export const generatePaymentReceiptPdf = (
  movement: any,
  customerName: string
) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const receiptNumber = movement?.numero_pago || movement?.id || '';
  const date = movement?.fecha ? new Date(movement.fecha) : new Date();
  const dateText = Number.isNaN(date.getTime())
    ? new Date().toLocaleDateString('es-AR')
    : date.toLocaleDateString('es-AR');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('COMPROBANTE DE PAGO', 105, 24, { align: 'center' });

  doc.setDrawColor(212, 212, 216);
  doc.line(18, 32, 192, 32);

  doc.setFontSize(11);
  doc.text(`Recibo N°: ${receiptNumber || '-'}`, 18, 45);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Fecha: ${dateText}`, 18, 55);
  doc.text(`Cliente: ${customerName || '-'}`, 18, 64);
  doc.text(`Medio de pago: ${movement?.forma_pago || '-'}`, 18, 73);
  doc.text(`Concepto: ${movement?.descripcion || 'Cobranza de cuenta corriente'}`, 18, 82, {
    maxWidth: 174,
  });

  doc.setFillColor(24, 24, 27);
  doc.roundedRect(18, 98, 174, 34, 4, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('IMPORTE RECIBIDO', 28, 111);

  doc.setFontSize(22);
  doc.text(formatCurrency(movement?.monto), 182, 121, { align: 'right' });

  doc.setTextColor(82, 82, 91);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    'Este comprobante refleja el pago registrado en la cuenta corriente del cliente.',
    105,
    150,
    { align: 'center' }
  );

  const clientFile = sanitizeFileName(customerName || 'Cliente');
  const isoDate = Number.isNaN(date.getTime())
    ? new Date().toISOString().split('T')[0]
    : date.toISOString().split('T')[0];

  doc.save(`Pago_${clientFile}_${isoDate}_${receiptNumber || 'sin_numero'}.pdf`);
};
