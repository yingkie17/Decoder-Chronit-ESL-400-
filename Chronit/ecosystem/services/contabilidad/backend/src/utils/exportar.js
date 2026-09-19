// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: exportación de reportes (PDF / Excel)
// -----------------------------------------------------------------------------
// Un único punto de formateo para que lo que se ve en pantalla, lo que se
// imprime en PDF y lo que se abre en Excel tengan EXACTAMENTE los mismos
// números. Las columnas se describen con:
//   { clave, titulo, tipo: 'texto'|'entero'|'moneda'|'fecha'|'hora'|'fecha_hora', ancho }
// `ancho` es un peso relativo para el reparto del ancho útil del PDF.
// =============================================================================
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';

const TZ = 'America/La_Paz';

export function formatearMoneda(v) {
  const n = Number(v || 0);
  return n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function textoCelda(col, fila) {
  const v = fila[col.clave];
  if (v == null || v === '') return col.tipo === 'moneda' ? '0,00' : '';
  switch (col.tipo) {
    case 'moneda':
      return formatearMoneda(v);
    case 'entero':
      return String(Math.round(Number(v)));
    case 'fecha':
      return new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
    case 'hora':
      return new Date(v).toLocaleTimeString('es-BO', { timeZone: TZ, hour12: false });
    case 'fecha_hora':
      return new Date(v).toLocaleString('es-BO', { timeZone: TZ, hour12: false });
    default:
      return String(v);
  }
}

export function valorCelda(col, fila) {
  const v = fila[col.clave];
  if (v == null || v === '') return col.tipo === 'moneda' || col.tipo === 'entero' ? 0 : '';
  if (col.tipo === 'moneda' || col.tipo === 'entero') return Number(v);
  if (col.tipo === 'fecha' || col.tipo === 'hora' || col.tipo === 'fecha_hora') return textoCelda(col, fila);
  return String(v);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
export function generarPdf({ titulo, subtitulo, columnas, filas, resumen }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const partes = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const izquierda = doc.page.margins.left;
    const util = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const sumaPesos = columnas.reduce((a, c) => a + (c.ancho || 1), 0);
    const anchos = columnas.map((c) => (util * (c.ancho || 1)) / sumaPesos);
    const xCol = [];
    let x = izquierda;
    for (const a of anchos) { xCol.push(x); x += a; }

    const dibujarCabeceraTabla = (y) => {
      doc.rect(izquierda, y, util, 16).fill('#e9edf2');
      doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(7.5);
      columnas.forEach((c, i) => {
        const alineado = c.tipo === 'moneda' || c.tipo === 'entero' ? 'right' : 'left';
        doc.text(c.titulo, xCol[i] + 3, y + 5, {
          width: anchos[i] - 6, align: alineado, lineBreak: false, ellipsis: true,
        });
      });
      return y + 16;
    };

    // Encabezado del documento
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(15)
      .text(titulo, izquierda, doc.page.margins.top);
    doc.font('Helvetica').fontSize(8.5).fillColor('#4b5563')
      .text(subtitulo || '', izquierda, doc.y + 2);
    doc.text(`Generado: ${new Date().toLocaleString('es-BO', { timeZone: TZ, hour12: false })}`,
      izquierda, doc.y + 1);

    let y = dibujarCabeceraTabla(doc.y + 10);
    doc.font('Helvetica').fontSize(7.5);

    for (const fila of filas) {
      const alturas = columnas.map((c, i) => doc.heightOfString(textoCelda(c, fila), {
        width: anchos[i] - 6, align: c.tipo === 'moneda' || c.tipo === 'entero' ? 'right' : 'left',
      }));
      const alto = Math.max(11, Math.max(...alturas) + 4);
      if (y + alto > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        y = dibujarCabeceraTabla(doc.page.margins.top);
        doc.font('Helvetica').fontSize(7.5);
      }
      columnas.forEach((c, i) => {
        doc.fillColor('#111827').text(textoCelda(c, fila), xCol[i] + 3, y + 2, {
          width: anchos[i] - 6,
          align: c.tipo === 'moneda' || c.tipo === 'entero' ? 'right' : 'left',
        });
      });
      y += alto;
      doc.moveTo(izquierda, y).lineTo(izquierda + util, y).lineWidth(0.3).strokeColor('#e5e7eb').stroke();
    }

    if (!filas.length) {
      doc.fillColor('#6b7280').text('Sin datos para el período seleccionado.', izquierda, y + 6);
      y += 18;
    }

    // Bloque de resumen
    const lineasResumen = Object.entries(resumen || {});
    if (lineasResumen.length) {
      if (y + 16 + lineasResumen.length * 12 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      } else {
        y += 14;
      }
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text('Resumen', izquierda, y);
      y += 14;
      doc.font('Helvetica').fontSize(8.5);
      for (const [k, v] of lineasResumen) {
        doc.fillColor('#374151').text(`${k}:`, izquierda, y, { continued: true, width: 200 });
        doc.fillColor('#111827').text(` ${v}`, { width: util - 200 });
        y += 12;
      }
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------------
export function generarExcel({ titulo, subtitulo, columnas, filas, resumen }) {
  const encabezado = columnas.map((c) => c.titulo);
  const cuerpo = filas.map((f) => columnas.map((c) => valorCelda(c, f)));
  const ws = XLSX.utils.aoa_to_sheet([[titulo], [subtitulo || ''], [], encabezado, ...cuerpo]);
  ws['!cols'] = columnas.map((c) => ({
    wch: Math.max(12, Math.min(38, Math.round((c.ancho || 1) * 9) + 4)),
  }));
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, columnas.length - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, columnas.length - 1) } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');

  const lineasResumen = Object.entries(resumen || {});
  if (lineasResumen.length) {
    const wsRes = XLSX.utils.aoa_to_sheet([['Resumen'], [], ...lineasResumen]);
    wsRes['!cols'] = [{ wch: 34 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen');
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Envía el archivo generado con las cabeceras correctas. */
export function enviarArchivo(res, { formato, nombre, contenido }) {
  if (formato === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
  } else {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
  }
  res.send(contenido);
}
