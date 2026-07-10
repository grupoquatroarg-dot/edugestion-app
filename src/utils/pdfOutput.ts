import type jsPDF from 'jspdf';

export type PdfOutputMode = 'download' | 'print';

const getPrintFileName = (fileName: string) => {
  const normalized = fileName.toLowerCase().endsWith('.pdf')
    ? fileName.slice(0, -4)
    : fileName;

  return `${normalized}_impresion.pdf`;
};

export const outputPdfDocument = (
  doc: jsPDF,
  fileName: string,
  mode: PdfOutputMode = 'download'
) => {
  if (mode === 'download') {
    doc.save(fileName);
    return;
  }

  try {
    doc.autoPrint({ variant: 'non-conform' });
  } catch (error) {
    console.warn('No se pudo activar la impresión automática del PDF:', error);
  }

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const printWindow = window.open(blobUrl, '_blank');

  if (!printWindow) {
    URL.revokeObjectURL(blobUrl);
    doc.save(getPrintFileName(fileName));
    window.alert(
      'El navegador bloqueó la ventana de impresión. Se descargó la versión económica para que puedas imprimirla manualmente.'
    );
    return;
  }

  try {
    printWindow.opener = null;
  } catch {}

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
};
