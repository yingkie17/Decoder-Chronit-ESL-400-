// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Reportes (los 11 reportes)
// -----------------------------------------------------------------------------
//   GET /api/conta/reportes                        catálogo
//   GET /api/conta/reportes/:tipo?desde&hasta&...  datos JSON
//   GET /api/conta/reportes/:tipo/export?formato=pdf|xlsx
//
// Los reportes NUNCA recalculan precios/IVA/descuentos: leen los snapshots.
// Por eso cambiar iva_modo_default o rotar un responsable no altera el pasado.
// =============================================================================
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { contaApi, contaDescargar } from '@/lib/api';
import { haceISO, hoyISO, TablaReporte, TarjetasResumen, type Reporte } from './comun';

export default function Reportes({ ko }: { ko: (e: unknown) => void }) {
  const [catalogo, setCatalogo] = useState<{ clave: string; titulo: string }[]>([]);
  const [tipo, setTipo] = useState('cierre-caja');
  const [desde, setDesde] = useState(haceISO(30));
  const [hasta, setHasta] = useState(hoyISO());
  const [periodo, setPeriodo] = useState('dia');
  const [fechaDia, setFechaDia] = useState(hoyISO());
  const [rep, setRep] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await contaApi<{ reportes: { clave: string; titulo: string }[] }>('/api/conta/reportes');
        setCatalogo(r.reportes);
      } catch (e) { ko(e); }
    })();
  }, [ko]);

  // Parámetros según el reporte seleccionado.
  const params = useMemo(() => {
    const qs = new URLSearchParams();
    if (tipo === 'cierre-diario') qs.set('fecha', fechaDia);
    else { qs.set('desde', desde); qs.set('hasta', hasta); }
    if (tipo === 'comparativo') qs.set('periodo', periodo);
    return qs;
  }, [tipo, desde, hasta, periodo, fechaDia]);

  const generar = useCallback(async () => {
    setCargando(true);
    try {
      setRep(await contaApi<Reporte>(`/api/conta/reportes/${tipo}?${params.toString()}`));
    } catch (e) { ko(e); } finally { setCargando(false); }
  }, [tipo, params, ko]);

  useEffect(() => { void generar(); }, [generar]);

  const exportar = async (formato: 'pdf' | 'xlsx') => {
    try {
      await contaDescargar(
        `/api/conta/reportes/${tipo}/export?formato=${formato}&${params.toString()}`,
        `${tipo}.${formato === 'xlsx' ? 'xlsx' : 'pdf'}`,
      );
    } catch (e) { ko(e); }
  };

  return (
    <section className="card">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" style={{ flex: '1 1 280px' }} value={tipo}
          onChange={(e) => setTipo(e.target.value)}>
          {catalogo.map((c) => <option key={c.clave} value={c.clave}>{c.titulo}</option>)}
        </select>

        {tipo === 'cierre-diario' ? (
          <input className="input" type="date" style={{ maxWidth: 160 }} value={fechaDia}
            onChange={(e) => setFechaDia(e.target.value)} />
        ) : (
          <>
            <input className="input" type="date" style={{ maxWidth: 160 }} value={desde}
              onChange={(e) => setDesde(e.target.value)} />
            <input className="input" type="date" style={{ maxWidth: 160 }} value={hasta}
              onChange={(e) => setHasta(e.target.value)} />
          </>
        )}

        {tipo === 'comparativo' && (
          <select className="input" style={{ maxWidth: 150 }} value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}>
            <option value="dia">Por día</option>
            <option value="semana">Por semana</option>
            <option value="mes">Por mes</option>
          </select>
        )}

        <button className="btn btn-primary" onClick={() => void generar()} disabled={cargando}>
          {cargando ? 'Generando…' : 'Generar'}
        </button>
        <button className="btn" onClick={() => void exportar('pdf')}>PDF</button>
        <button className="btn" onClick={() => void exportar('xlsx')}>Excel</button>
      </div>

      {rep && (
        <>
          <h3 style={{ marginBottom: 2, marginTop: 18 }}>{rep.titulo}</h3>
          {rep.subtitulo && (
            <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>{rep.subtitulo}</p>
          )}
          {rep.resumen && <TarjetasResumen resumen={rep.resumen} />}
          <TablaReporte columnas={rep.columnas} filas={rep.filas} />
        </>
      )}
    </section>
  );
}
