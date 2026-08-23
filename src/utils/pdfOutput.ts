import type jsPDF from 'jspdf';

export type PdfOutputMode = 'download' | 'print';

export const openPrintWindowPlaceholder = () => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;

  try {
    printWindow.opener = null;
    printWindow.document.title = 'Preparando impresión...';
    printWindow.document.body.innerHTML = `
      <main style="font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;margin:0;padding:24px;text-align:center">
        <div>
          <div style="width:44px;height:44px;border:4px solid #e2e8f0;border-top-color:#0f172a;border-radius:9999px;margin:0 auto 16px;animation:spin 0.8s linear infinite"></div>
          <strong>Preparando impresión económica...</strong>
          <p style="color:#64748b;margin:8px 0 0">Enseguida se abrirá el selector de impresora.</p>
        </div>
      </main>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
  } catch {}

  return printWindow;
};

const getPrintFileName = (fileName: string) => {
  const normalized = fileName.toLowerCase().endsWith('.pdf')
    ? fileName.slice(0, -4)
    : fileName;

  return `${normalized}_impresion.pdf`;
};

export const outputPdfDocument = (
  doc: jsPDF,
  fileName: string,
  mode: PdfOutputMode = 'download',
  preparedPrintWindow: Window | null = null
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
  const printWindow = preparedPrintWindow && !preparedPrintWindow.closed
    ? preparedPrintWindow
    : window.open('', '_blank');

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
    printWindow.location.replace(blobUrl);
  } catch {}

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
};
