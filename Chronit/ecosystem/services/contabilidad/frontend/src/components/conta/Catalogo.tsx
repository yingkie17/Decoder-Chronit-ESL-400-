// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Catálogo (productos, precios, combos)
// -----------------------------------------------------------------------------
//   GET    /api/conta/catalogo?inactivos=true      productos + precio vigente
//   POST   /api/conta/catalogo                     crear producto
//   PUT    /api/conta/catalogo/:id                 editar producto
//   DELETE /api/conta/catalogo/:id                 desactivar (las ventas son inmutables)
//   POST   /api/conta/catalogo/listas/:id/precios  upsert de precios de la lista vigente
//   GET/POST /api/conta/combos                     combos
//
// El precio se guarda en una LISTA DE PRECIOS: cada venta snapshotea el precio
// aplicado, por lo que cambiar un precio no altera las ventas ya emitidas.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { money } from './comun';

interface Producto {
  id: number; nombre: string; tipo: string; vueltas: number | null; duracion_min: number | null;
  categoria: string; activo: boolean; iva_modo: string; iva_porcentaje: number | null;
  precio: number | null; moneda: string;
}
interface Combo {
  id: number; nombre: string; precio: number; modo_facturacion: string;
  iva_modo_hereda: boolean; iva_modo: string; activo: boolean;
  items: { producto_id?: number; cantidad?: number; nombre?: string }[] | null;
}
interface CatalogoResp {
  lista_vigente: { id: number; nombre: string } | null;
  productos: Producto[];
}

const CATEGORIAS = ['carrera', 'comida', 'bebida', 'combo', 'servicio', 'otro'];
const IVA_MODOS = ['hereda', 'incluido', 'agregado', 'exento'];

const NUEVO_PRODUCTO = {
  nombre: '', tipo: 'producto', vueltas: '', duracion_min: '',
  categoria: 'otro', iva_modo: 'hereda', iva_porcentaje: '', precio: '',
};

export default function Catalogo({ puedeGestion, ok, ko }: {
  puedeGestion: boolean; ok: (m: string) => void; ko: (e: unknown) => void;
}) {
  const [data, setData] = useState<CatalogoResp | null>(null);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [nuevo, setNuevo] = useState({ ...NUEVO_PRODUCTO });
  const [precios, setPrecios] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    try {
      setData(await contaApi<CatalogoResp>(`/api/conta/catalogo?inactivos=${incluirInactivos}`));
      setCombos(await contaApi<Combo[]>('/api/conta/combos?inactivos=true'));
    } catch (e) { ko(e); }
  }, [incluirInactivos, ko]);

  useEffect(() => { void cargar(); }, [cargar]);

  const crear = async () => {
    if (!nuevo.nombre) { ko(new Error('El nombre es obligatorio.')); return; }
    try {
      await contaApi('/api/conta/catalogo', {
        method: 'POST',
        body: {
          nombre: nuevo.nombre,
          tipo: nuevo.tipo,
          vueltas: nuevo.vueltas ? Number(nuevo.vueltas) : null,
          duracion_min: nuevo.duracion_min ? Number(nuevo.duracion_min) : null,
          categoria: nuevo.categoria,
          iva_modo: nuevo.iva_modo,
          iva_porcentaje: nuevo.iva_porcentaje ? Number(nuevo.iva_porcentaje) : null,
        },
      });
      ok(`Producto «${nuevo.nombre}» creado.`);
      setNuevo({ ...NUEVO_PRODUCTO });
      await cargar();
    } catch (e) { ko(e); }
  };

  const guardarProducto = async (id: number, patch: Partial<Producto>) => {
    try {
      await contaApi(`/api/conta/catalogo/${id}`, { method: 'PUT', body: patch });
      await cargar();
    } catch (e) { ko(e); }
  };

  const alternarActivo = async (p: Producto) => {
    try {
      if (p.activo) await contaApi(`/api/conta/catalogo/${p.id}`, { method: 'PUT', body: { activo: false } });
      else await contaApi(`/api/conta/catalogo/${p.id}`, { method: 'PUT', body: { activo: true } });
      ok(p.activo ? `«${p.nombre}» desactivado.` : `«${p.nombre}» reactivado.`);
      await cargar();
    } catch (e) { ko(e); }
  };

  /** Upsert del precio del producto en la lista vigente. */
  const guardarPrecio = async (p: Producto) => {
    const lista = data?.lista_vigente;
    if (!lista) { ko(new Error('No hay una lista de precios vigente.')); return; }
    const crudo = precios[p.id];
    if (crudo === undefined || crudo === '') return;
    try {
      await contaApi(`/api/conta/catalogo/listas/${lista.id}/precios`, {
        method: 'POST',
        body: { precios: [{ producto_id: p.id, precio: Number(crudo), moneda: p.moneda || 'BOB' }] },
      });
      ok(`Precio de «${p.nombre}» actualizado en la lista ${lista.nombre}.`);
      await cargar();
    } catch (e) { ko(e); }
  };

  return (
    <>
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Productos</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Lista vigente: <b>{data?.lista_vigente?.nombre || '—'}</b>
            </span>
            <label style={{ color: '#8aa4c7', fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={incluirInactivos}
                onChange={(e) => setIncluirInactivos(e.target.checked)} />
              Ver inactivos
            </label>
          </div>
        </div>

        {puedeGestion && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <input className="input" placeholder="Nombre *" style={{ flex: '1 1 170px' }}
              value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            <select className="input" style={{ flex: '0 0 130px' }} value={nuevo.categoria}
              onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="input" placeholder="Vueltas" type="number" style={{ flex: '0 0 100px' }}
              value={nuevo.vueltas} onChange={(e) => setNuevo({ ...nuevo, vueltas: e.target.value })} />
            <input className="input" placeholder="Duración (min)" type="number" style={{ flex: '0 0 130px' }}
              value={nuevo.duracion_min} onChange={(e) => setNuevo({ ...nuevo, duracion_min: e.target.value })} />
            <select className="input" style={{ flex: '0 0 140px' }} value={nuevo.iva_modo}
              onChange={(e) => setNuevo({ ...nuevo, iva_modo: e.target.value })}>
              {IVA_MODOS.map((m) => <option key={m} value={m}>IVA {m}</option>)}
            </select>
            <input className="input" placeholder="IVA %" type="number" step="0.01" style={{ flex: '0 0 100px' }}
              value={nuevo.iva_porcentaje} onChange={(e) => setNuevo({ ...nuevo, iva_porcentaje: e.target.value })} />
            <input className="input" placeholder="Precio" type="number" step="0.01" style={{ flex: '0 0 110px' }}
              value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
            <button className="btn btn-primary" onClick={crear}>Crear producto</button>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Producto</th><th>Categoría</th><th>Vueltas</th><th>IVA modo</th><th>IVA %</th>
                <th>Precio</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.productos || []).map((p) => (
                <tr key={p.id} style={p.activo ? undefined : { opacity: 0.55 }}>
                  <td>{p.nombre}<div style={{ color: '#5f7095', fontSize: '0.72rem' }}>{p.tipo}</div></td>
                  <td>
                    {puedeGestion ? (
                      <select className="input" style={{ minWidth: 120 }} value={p.categoria}
                        onChange={(e) => void guardarProducto(p.id, { categoria: e.target.value })}>
                        {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : p.categoria}
                  </td>
                  <td>{p.vueltas ?? '—'}</td>
                  <td>
                    {puedeGestion ? (
                      <select className="input" style={{ minWidth: 130 }} value={p.iva_modo}
                        onChange={(e) => void guardarProducto(p.id, { iva_modo: e.target.value })}>
                        {IVA_MODOS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : p.iva_modo}
                  </td>
                  <td>{p.iva_porcentaje == null ? 'hereda' : `${p.iva_porcentaje}%`}</td>
                  <td>
                    {p.precio == null ? '—' : money(p.precio)}
                    {puedeGestion && (
                      <div className="row" style={{ gap: 4, marginTop: 4 }}>
                        <input className="input" type="number" step="0.01" placeholder="nuevo"
                          style={{ width: 90 }} value={precios[p.id] ?? ''}
                          onChange={(e) => setPrecios({ ...precios, [p.id]: e.target.value })} />
                        <button className="btn btn-sm" onClick={() => void guardarPrecio(p)}>Guardar</button>
                      </div>
                    )}
                  </td>
                  <td>
                    {p.activo
                      ? <span className="pill" style={{ background: '#22c55e22', color: '#22c55e' }}>Activo</span>
                      : <span className="pill" style={{ background: '#ef444422', color: '#ef4444' }}>Inactivo</span>}
                  </td>
                  <td>
                    {puedeGestion && (
                      <button className="btn btn-sm" onClick={() => void alternarActivo(p)}>
                        {p.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!data?.productos?.length && (
                <tr><td colSpan={8} style={{ color: '#5f7095' }}>Sin productos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Combos ({combos.length})</h3>
        <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginTop: 0 }}>
          <b>modo_facturacion</b>: <b>unico</b> genera 1 línea en la venta;{' '}
          <b>desglosado</b> genera la línea padre + una línea por componente
          (<i>es_componente_combo=true</i> con <i>combo_padre_id</i>).
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr><th>Combo</th><th>Precio</th><th>Modo facturación</th><th>Hereda IVA</th><th>Componentes</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {combos.map((c) => (
                <tr key={c.id} style={c.activo ? undefined : { opacity: 0.55 }}>
                  <td>{c.nombre}</td>
                  <td>{money(c.precio)}</td>
                  <td>{c.modo_facturacion}</td>
                  <td>{c.iva_modo_hereda ? 'sí' : 'no'}</td>
                  <td style={{ fontSize: '0.78rem' }}>
                    {Array.isArray(c.items) && c.items.length
                      ? c.items.map((it) => it.nombre || `#${it.producto_id}×${it.cantidad ?? 1}`).join(', ')
                      : '—'}
                  </td>
                  <td>{c.activo ? 'Sí' : 'No'}</td>
                </tr>
              ))}
              {!combos.length && <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin combos.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
