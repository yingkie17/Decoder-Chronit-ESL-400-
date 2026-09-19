// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: editor de configuración (reutilizable)
// -----------------------------------------------------------------------------
//   GET /api/conta/configuracion            listar claves
//   PUT /api/conta/configuracion            actualizar varias { cambios: {...} }
//
// Solo supervisor+ (y el rol autorizado de cada clave) puede editar. Cada cambio
// queda en conta_auditoria con datos_antes y datos_despues. Los valores se leen
// en la transacción de venta, pero cada venta snapshotea lo aplicado: cambiar un
// valor aquí NO altera las ventas pasadas.
//
// Se usa tanto en /admin/configuracion como en la pestaña homónima de
// /contabilidad.
// =============================================================================
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { contaApi } from '@/lib/api';
import { fechaHora, type ConfigRow } from './comun';

type Editor = 'numero' | 'booleano' | 'opciones' | 'texto' | 'json';

interface CampoDef { etiqueta: string; editor: Editor; opciones?: string[]; ayuda?: string }

// Tipado explícito por clave: evita guardar un número como texto o un booleano
// como la cadena "false" (que sería truthy).
const CAMPOS: Record<string, CampoDef> = {
  umbral_egreso_cajero: {
    etiqueta: 'Umbral de egreso por cajero',
    editor: 'numero',
    ayuda: 'Monto máximo (BOB) que un cajero puede egresar sin autorización de supervisor.',
  },
  umbral_descuento_supervisor: {
    etiqueta: 'Umbral de descuento (supervisor)',
    editor: 'numero',
    ayuda: 'Descuento máximo (BOB) que un cajero puede aplicar sin autorización de supervisor.',
  },
  iva_modo_default: {
    etiqueta: 'Modo de IVA por defecto',
    editor: 'opciones',
    opciones: ['incluido', 'agregado', 'exento'],
    ayuda: 'Solo aplica a productos con iva_modo = "hereda".',
  },
  iva_porcentaje_default: { etiqueta: 'Porcentaje de IVA por defecto (%)', editor: 'numero' },
  tipo_factura_default: {
    etiqueta: 'Tipo de documento por defecto',
    editor: 'opciones',
    opciones: ['factura', 'recibo', 'nota_venta'],
  },
  requiere_nit_por_defecto: {
    etiqueta: 'Exigir NIT al facturar',
    editor: 'booleano',
    ayuda: 'Si está activo se exige NIT del cliente al emitir factura (eximible con autorización de supervisor). No calcula impuestos: solo exige el dato.',
  },
  propina_habilitada: { etiqueta: 'Propinas habilitadas', editor: 'booleano' },
  propina_modo: {
    etiqueta: 'Modo de propina',
    editor: 'opciones',
    opciones: ['inmediata', 'acumulada', 'mixta'],
    ayuda: 'inmediata = se paga en el mismo cierre; acumulada = el supervisor autoriza el pago; mixta = el cajero elige por venta.',
  },
  propina_porcentaje_sugerido: { etiqueta: 'Porcentaje de propina sugerido (%)', editor: 'numero' },
  propina_distribucion: {
    etiqueta: 'Distribución de propina',
    editor: 'opciones',
    opciones: ['por_cajero', 'por_kart', 'por_equipo', 'mixto'],
  },
  combo_modo_default: {
    etiqueta: 'Modo de facturación de combos',
    editor: 'opciones',
    opciones: ['unico', 'desglosado'],
    ayuda: 'unico = 1 línea en la venta; desglosado = línea padre + componentes.',
  },
  // --- Cumplimiento fiscal Bolivia (v3) ---
  facturacion_habilitada: {
    etiqueta: 'Facturación habilitada',
    editor: 'booleano',
    ayuda: 'Toggle maestro. Si está en No, el POS solo registra ventas NO facturadas (con IT interno).',
  },
  facturacion_modo_default: {
    etiqueta: 'Modo fiscal por defecto del POS',
    editor: 'opciones',
    opciones: ['no_facturado', 'facturado'],
    ayuda: 'Valor inicial del toggle "Facturar" en la caja.',
  },
  facturacion_requiere_nit: {
    etiqueta: 'Exigir NIT al facturar',
    editor: 'booleano',
    ayuda: 'Solo para ventas FACTURADAS. Un supervisor puede eximir con su PIN.',
  },
  facturacion_requiere_razon_social: {
    etiqueta: 'Exigir razón social al facturar',
    editor: 'booleano',
    ayuda: 'Solo para ventas FACTURADAS. Un supervisor puede eximir con su PIN.',
  },
  iva_pct_default: {
    etiqueta: 'IVA por defecto (%)',
    editor: 'numero',
    ayuda: 'Alícuota del IVA (Bolivia: 13%). Se snapshotea en cada venta; cambiarla NO altera los históricos.',
  },
  it_pct_default: {
    etiqueta: 'IT (%)',
    editor: 'numero',
    ayuda: 'Impuesto a las Transacciones (Bolivia: 3%). Se calcula SIEMPRE, facture o no.',
  },
  iue_pct_default: {
    etiqueta: 'IUE (%)',
    editor: 'numero',
    ayuda: 'Impuesto sobre las Utilidades (Bolivia: 25% anual). Informativo / retención.',
  },
  itf_pct_default: {
    etiqueta: 'ITF (%)',
    editor: 'numero',
    ayuda: 'Impuesto a las Transacciones Financieras (Bolivia: 0.15% sobre débitos bancarios).',
  },
  regimen: {
    etiqueta: 'Régimen tributario',
    editor: 'opciones',
    opciones: ['general', 'siete_rg'],
    ayuda: 'siete_rg = Régimen SIETE-RG: 5% bimestral unificado (IVA+IT+IUE), sin desglose. Requiere ventas anuales < límite.',
  },
  siete_rg_pct: {
    etiqueta: 'SIETE-RG unificado (%)',
    editor: 'numero',
    ayuda: 'Alícuota unificada del régimen SIETE-RG (Bolivia: 5%), se guarda en iue_retenido.',
  },
  siete_rg_limite_anual: {
    etiqueta: 'Límite anual SIETE-RG (Bs)',
    editor: 'numero',
    ayuda: 'Tope de ventas anuales para permanecer en SIETE-RG (Bolivia: Bs 400.000).',
  },
  libro_periodo_cerrado_bloquea: {
    etiqueta: 'Bloquear período fiscal cerrado',
    editor: 'booleano',
    ayuda: 'Si está activo, un período cerrado no admite ventas ni anulaciones (solo notas de crédito).',
  },
};

const ETIQUETA_ROL: Record<string, string> = {
  supervisor: 'Supervisor', contador: 'Contador', admin: 'Admin', desarrollador: 'Desarrollador',
};

function editorDe(clave: string, valor: unknown): Editor {
  const def = CAMPOS[clave];
  if (def) return def.editor;
  if (typeof valor === 'boolean') return 'booleano';
  if (typeof valor === 'number') return 'numero';
  if (typeof valor === 'string') return 'texto';
  return 'json';
}

function aValorJson(editor: Editor, crudo: string, original: unknown): unknown {
  if (editor === 'numero') {
    const n = Number(String(crudo).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  if (editor === 'booleano') return String(crudo) === 'true';
  if (editor === 'json') {
    try { return JSON.parse(crudo); } catch { return original; }
  }
  return crudo;
}

function aTexto(editor: Editor, valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (editor === 'json') return JSON.stringify(valor, null, 2);
  if (editor === 'booleano') return valor === true ? 'true' : 'false';
  return typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
}

export default function Configuracion({ rol }: { rol: string }) {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const data = await contaApi<ConfigRow[]>('/api/conta/configuracion');
      setRows(data);
      const b: Record<string, string> = {};
      for (const r of data) b[r.clave] = aTexto(editorDe(r.clave, r.valor), r.valor);
      setBorrador(b);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  // Claves con cambios pendientes respecto al valor persistido.
  const cambios = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      const editor = editorDe(r.clave, r.valor);
      const nuevo = aValorJson(editor, borrador[r.clave] ?? '', r.valor);
      if (JSON.stringify(nuevo) !== JSON.stringify(r.valor)) out[r.clave] = nuevo;
    }
    return out;
  }, [rows, borrador]);

  const puedeEditar = useCallback((r: ConfigRow) => {
    if (rol === 'desarrollador') return true;
    return (r.editable_por_rol || []).includes(rol);
  }, [rol]);

  const guardar = async () => {
    setMsg(''); setError('');
    const claves = Object.keys(cambios);
    if (!claves.length) { setMsg('No hay cambios pendientes.'); return; }
    setGuardando(true);
    try {
      await contaApi('/api/conta/configuracion', { method: 'PUT', body: { cambios } });
      setMsg(`Guardado y auditado: ${claves.join(', ')}`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const descartar = () => {
    setMsg(''); setError('');
    const b: Record<string, string> = {};
    for (const r of rows) b[r.clave] = aTexto(editorDe(r.clave, r.valor), r.valor);
    setBorrador(b);
  };

  const totalCambios = Object.keys(cambios).length;

  return (
    <>
      {msg && <p className="card" style={{ color: '#22c55e', padding: 12 }}>{msg}</p>}
      {error && <p className="card" style={{ color: '#ef4444', padding: 12 }}>{error}</p>}

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Parámetros ({rows.length})</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.8rem', margin: '4px 0 0' }}>
              Los cambios quedan en <b>conta_auditoria</b> con el valor anterior y el nuevo.
              Cada venta conserva el valor que aplicó (snapshot).
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={descartar} disabled={!totalCambios || guardando}>Descartar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={!totalCambios || guardando}>
              {guardando ? 'Guardando…' : `Guardar cambios${totalCambios ? ` (${totalCambios})` : ''}`}
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr><th>Clave</th><th>Valor</th><th>Editable por</th><th>Último cambio</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const editor = editorDe(r.clave, r.valor);
                const def = CAMPOS[r.clave];
                const habilitado = puedeEditar(r);
                const tocado = Object.prototype.hasOwnProperty.call(cambios, r.clave);
                return (
                  <tr key={r.clave}>
                    <td style={{ verticalAlign: 'top' }}>
                      <b>{def?.etiqueta || r.clave}</b>
                      <div style={{ color: '#5f7095', fontSize: '0.72rem', fontFamily: 'monospace' }}>{r.clave}</div>
                      {(def?.ayuda || r.descripcion) && (
                        <div style={{ color: '#8aa4c7', fontSize: '0.74rem', marginTop: 4, maxWidth: 320 }}>
                          {def?.ayuda || r.descripcion}
                        </div>
                      )}
                    </td>
                    <td style={{ minWidth: 190 }}>
                      {editor === 'booleano' ? (
                        <select className="input" disabled={!habilitado} value={borrador[r.clave] ?? 'false'}
                          onChange={(e) => setBorrador({ ...borrador, [r.clave]: e.target.value })}>
                          <option value="false">No</option>
                          <option value="true">Sí</option>
                        </select>
                      ) : editor === 'opciones' ? (
                        <select className="input" disabled={!habilitado} value={borrador[r.clave] ?? ''}
                          onChange={(e) => setBorrador({ ...borrador, [r.clave]: e.target.value })}>
                          {(def?.opciones || []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : editor === 'json' ? (
                        <textarea className="input" rows={3} disabled={!habilitado}
                          style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                          value={borrador[r.clave] ?? ''}
                          onChange={(e) => setBorrador({ ...borrador, [r.clave]: e.target.value })} />
                      ) : (
                        <input className="input" disabled={!habilitado}
                          type={editor === 'numero' ? 'number' : 'text'}
                          step={editor === 'numero' ? '0.01' : undefined}
                          value={borrador[r.clave] ?? ''}
                          onChange={(e) => setBorrador({ ...borrador, [r.clave]: e.target.value })} />
                      )}
                      {tocado && <div style={{ color: '#f59e0b', fontSize: '0.72rem' }}>sin guardar</div>}
                      {!habilitado && <div style={{ color: '#5f7095', fontSize: '0.72rem' }}>solo lectura</div>}
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {(r.editable_por_rol || []).map((x) => ETIQUETA_ROL[x] || x).join(', ') || '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {fechaHora(r.actualizado_en)}
                      <div style={{ color: '#8aa4c7' }}>{r.actualizado_por_nombre || '—'}</div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={4} style={{ color: '#5f7095' }}>Sin claves de configuración.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
