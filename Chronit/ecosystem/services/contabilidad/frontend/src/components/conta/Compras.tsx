// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: pestaña Compras (proveedores + compras + kardex)
// -----------------------------------------------------------------------------
//   PROVEEDORES  GET/POST /api/conta/proveedores, PUT/DELETE /:id (baja lógica)
//   COMPRAS      GET/POST /api/conta/compras, GET /:id,
//                POST /:id/confirmar (kardex + CxP + asiento), /:id/pagar, /:id/anular
//   KARDEX       GET /api/conta/kardex, GET /api/conta/kardex/valorizacion
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { contaApi } from '@/lib/api';
import { Cuenta, fecha, fechaHora, haceISO, hoyISO, money } from './comun';

interface Proveedor {
  id: number; nombre: string; nit: string | null; contacto: string | null; telefono: string | null;
  email: string | null; condiciones_pago: string | null; activo: boolean;
}

interface Compra {
  id: number; proveedor_id: number | null; proveedor?: string | null; numero_factura_prov: string | null;
  fecha: string; subtotal: number; iva: number; total: number; estado: string; n_items?: number;
}

interface Producto { id: number; nombre: string; categoria: string | null; activo: boolean }

interface MovKardex {
  id: number; producto_id: number; producto_nombre: string; tipo: string; cantidad: number;
  costo_unitario: number; saldo_cantidad: number; saldo_valor: number;
  referencia_tipo: string | null; referencia_id: number | null; creado_en: string; usuario?: string | null;
}

interface Valorizacion {
  productos: { id: number; nombre: string; categoria: string | null; stock_actual: number;
    stock_minimo: number; costo_unitario: number; valor_total: number }[];
  total_valorizado: number;
}

interface MetodoPago { id: number; nombre: string; tipo: string }

interface ItemCompra { producto_id: string; cantidad: string; costo_unitario: string }

const COLOR_COMPRA: Record<string, string> = {
  borrador: '#f59e0b', confirmada: '#3b82f6', pagada: '#22c55e', anulada: '#ef4444',
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const ITEM_VACIO: ItemCompra = { producto_id: '', cantidad: '', costo_unitario: '' };

export default function Compras({ ok, soloLectura, puedeGestion }: {
  ok: (m: string) => void; soloLectura: boolean; puedeGestion: boolean;
}) {
  const puedeGestionar = !soloLectura && puedeGestion;
  const [seccion, setSeccion] = useState<'proveedores' | 'compras' | 'kardex'>('proveedores');
  const [error, setError] = useState('');

  // Catálogos
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);

  // Proveedores
  const [nuevoProv, setNuevoProv] = useState({
    nombre: '', nit: '', contacto: '', telefono: '', email: '', condiciones_pago: '',
  });
  const [editProv, setEditProv] = useState<Proveedor | null>(null);

  // Compras
  const [filtros, setFiltros] = useState({ desde: haceISO(60), hasta: hoyISO(), estado: '', proveedor_id: '' });
  const [compras, setCompras] = useState<Compra[]>([]);
  const [nuevaCompra, setNuevaCompra] = useState({
    proveedor_id: '', numero_factura_prov: '', fecha: hoyISO(), comprobante_url: '', iva: '',
  });
  const [items, setItems] = useState<ItemCompra[]>([{ ...ITEM_VACIO }]);
  const [pagar, setPagar] = useState<{
    compra: Compra; monto: string; metodo_pago_id: string; cuenta_destino_id: string; observacion: string;
  } | null>(null);

  // Kardex
  const [kFiltros, setKFiltros] = useState({ producto_id: '', tipo: '', desde: '', hasta: '' });
  const [movs, setMovs] = useState<MovKardex[]>([]);
  const [valor, setValor] = useState<Valorizacion | null>(null);

  const cargarProveedores = useCallback(async () => {
    try { setProveedores(await contaApi<Proveedor[]>('/api/conta/proveedores')); }
    catch (e) { setError(errMsg(e)); }
  }, []);

  const cargarCompras = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setCompras(await contaApi<Compra[]>(`/api/conta/compras?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [filtros]);

  useEffect(() => { void cargarProveedores(); }, [cargarProveedores]);
  useEffect(() => { void cargarCompras(); }, [cargarCompras]);

  useEffect(() => {
    (async () => {
      try {
        const cat = await contaApi<{ productos: Producto[] }>('/api/conta/catalogo');
        setProductos(cat.productos.filter((p) => p.activo));
      } catch { /* catálogo opcional */ }
      try { setMetodos(await contaApi<MetodoPago[]>('/api/conta/metodos-pago')); } catch { /* opcional */ }
      try {
        const cd = await contaApi<Cuenta[]>('/api/conta/cuentas?activas=false');
        setCuentas(cd.filter((c) => c.activo));
      } catch { /* opcional */ }
    })();
  }, []);

  const cargarKardex = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      Object.entries(kFiltros).forEach(([k, v]) => { if (v) qs.set(k, v); });
      setMovs(await contaApi<MovKardex[]>(`/api/conta/kardex?${qs.toString()}`));
    } catch (e) { setError(errMsg(e)); }
  }, [kFiltros]);

  const cargarValorizacion = async () => {
    try { setValor(await contaApi<Valorizacion>('/api/conta/kardex/valorizacion')); }
    catch (e) { setError(errMsg(e)); }
  };

  // --- Proveedores ---
  const crearProveedor = async () => {
    setError('');
    if (!nuevoProv.nombre.trim()) { setError('El nombre del proveedor es obligatorio.'); return; }
    try {
      await contaApi('/api/conta/proveedores', { method: 'POST', body: nuevoProv });
      ok(`Proveedor «${nuevoProv.nombre}» creado.`);
      setNuevoProv({ nombre: '', nit: '', contacto: '', telefono: '', email: '', condiciones_pago: '' });
      await cargarProveedores();
    } catch (e) { setError(errMsg(e)); }
  };

  const guardarProveedor = async () => {
    if (!editProv) return;
    try {
      await contaApi(`/api/conta/proveedores/${editProv.id}`, { method: 'PUT', body: editProv });
      ok('Proveedor actualizado.');
      setEditProv(null);
      await cargarProveedores();
    } catch (e) { setError(errMsg(e)); }
  };

  const bajaProveedor = async (p: Proveedor) => {
    if (!window.confirm(`¿Dar de baja lógica al proveedor «${p.nombre}»?`)) return;
    try {
      await contaApi(`/api/conta/proveedores/${p.id}`, { method: 'DELETE' });
      ok('Proveedor dado de baja.');
      await cargarProveedores();
    } catch (e) { setError(errMsg(e)); }
  };

  // --- Compras ---
  const crearCompra = async () => {
    setError('');
    const lineas = items
      .map((i) => ({
        producto_id: i.producto_id ? Number(i.producto_id) : null,
        cantidad: Number(i.cantidad),
        costo_unitario: Number(i.costo_unitario),
      }))
      .filter((i) => i.producto_id && i.cantidad > 0);
    if (!lineas.length) { setError('La compra debe tener al menos un ítem con producto y cantidad.'); return; }
    try {
      await contaApi('/api/conta/compras', {
        method: 'POST',
        body: {
          proveedor_id: nuevaCompra.proveedor_id ? Number(nuevaCompra.proveedor_id) : null,
          numero_factura_prov: nuevaCompra.numero_factura_prov || null,
          fecha: nuevaCompra.fecha,
          comprobante_url: nuevaCompra.comprobante_url || null,
          iva: Number(nuevaCompra.iva) || 0,
          items: lineas,
        },
      });
      ok('Compra creada en borrador. Confírmala para mover inventario y generar la CxP.');
      setNuevaCompra({ proveedor_id: '', numero_factura_prov: '', fecha: hoyISO(), comprobante_url: '', iva: '' });
      setItems([{ ...ITEM_VACIO }]);
      await cargarCompras();
    } catch (e) { setError(errMsg(e)); }
  };

  const confirmarCompra = async (c: Compra) => {
    if (!window.confirm(`¿Confirmar la compra #${c.id}? Se generará kardex, cuenta por pagar y asiento.`)) return;
    try {
      await contaApi(`/api/conta/compras/${c.id}/confirmar`, { method: 'POST' });
      ok(`Compra #${c.id} confirmada.`);
      await cargarCompras();
    } catch (e) { setError(errMsg(e)); }
  };

  const anularCompra = async (c: Compra) => {
    const motivo = window.prompt(`Motivo de anulación de la compra #${c.id} (obligatorio):`);
    if (!motivo) return;
    try {
      await contaApi(`/api/conta/compras/${c.id}/anular`, { method: 'POST', body: { motivo } });
      ok(`Compra #${c.id} anulada.`);
      await cargarCompras();
    } catch (e) { setError(errMsg(e)); }
  };

  const confirmarPago = async () => {
    if (!pagar) return;
    try {
      await contaApi(`/api/conta/compras/${pagar.compra.id}/pagar`, {
        method: 'POST',
        body: {
          monto: Number(pagar.monto) > 0 ? Number(pagar.monto) : undefined,
          metodo_pago_id: pagar.metodo_pago_id ? Number(pagar.metodo_pago_id) : null,
          cuenta_destino_id: pagar.cuenta_destino_id ? Number(pagar.cuenta_destino_id) : null,
          observacion: pagar.observacion || null,
        },
      });
      ok(`Pago registrado para la compra #${pagar.compra.id}.`);
      setPagar(null);
      await cargarCompras();
    } catch (e) { setError(errMsg(e)); }
  };

  const subtotalNueva = items.reduce(
    (a, i) => a + (Number(i.cantidad) || 0) * (Number(i.costo_unitario) || 0), 0);

  return (
    <>
      {error && <p className="card" style={{ color: '#ef4444', padding: 12, marginBottom: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {([['proveedores', 'Proveedores'], ['compras', 'Compras'], ['kardex', 'Kardex']] as const)
          .map(([k, etiqueta]) => (
            <button key={k} className={`btn ${seccion === k ? 'btn-primary' : ''}`}
              onClick={() => setSeccion(k)}>{etiqueta}</button>
          ))}
      </div>

      {seccion === 'proveedores' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Nuevo proveedor</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Nombre *" style={{ flex: '1 1 190px' }}
                  value={nuevoProv.nombre} onChange={(e) => setNuevoProv({ ...nuevoProv, nombre: e.target.value })} />
                <input className="input" placeholder="NIT" style={{ flex: '0 0 150px' }}
                  value={nuevoProv.nit} onChange={(e) => setNuevoProv({ ...nuevoProv, nit: e.target.value })} />
                <input className="input" placeholder="Contacto" style={{ flex: '0 0 160px' }}
                  value={nuevoProv.contacto} onChange={(e) => setNuevoProv({ ...nuevoProv, contacto: e.target.value })} />
                <input className="input" placeholder="Teléfono" style={{ flex: '0 0 140px' }}
                  value={nuevoProv.telefono} onChange={(e) => setNuevoProv({ ...nuevoProv, telefono: e.target.value })} />
                <input className="input" placeholder="Email" style={{ flex: '1 1 180px' }}
                  value={nuevoProv.email} onChange={(e) => setNuevoProv({ ...nuevoProv, email: e.target.value })} />
                <input className="input" placeholder="Condiciones de pago" style={{ flex: '1 1 170px' }}
                  value={nuevoProv.condiciones_pago}
                  onChange={(e) => setNuevoProv({ ...nuevoProv, condiciones_pago: e.target.value })} />
                <button className="btn btn-primary" onClick={() => void crearProveedor()}>Crear</button>
              </div>
            </section>
          )}
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Proveedores ({proveedores.length})</h3>
            <table className="tbl">
              <thead>
                <tr><th>Nombre</th><th>NIT</th><th>Contacto</th><th>Teléfono</th><th>Email</th>
                  <th>Condiciones</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {proveedores.map((p) => (
                  <tr key={p.id} style={p.activo ? undefined : { opacity: 0.55 }}>
                    <td>{p.nombre}</td>
                    <td>{p.nit || '—'}</td>
                    <td>{p.contacto || '—'}</td>
                    <td>{p.telefono || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{p.email || '—'}</td>
                    <td>{p.condiciones_pago || '—'}</td>
                    <td>{p.activo ? 'Sí' : 'No'}</td>
                    <td>
                      {puedeGestionar && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" onClick={() => setEditProv({ ...p })}>Editar</button>
                          {p.activo && (
                            <button className="btn btn-sm btn-danger" onClick={() => void bajaProveedor(p)}>
                              Baja
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!proveedores.length && <tr><td colSpan={8} style={{ color: '#5f7095' }}>Sin proveedores.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}

      {seccion === 'compras' && (
        <>
          {puedeGestionar && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Nueva compra (borrador)</h3>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: '1 1 220px' }} value={nuevaCompra.proveedor_id}
                  onChange={(e) => setNuevaCompra({ ...nuevaCompra, proveedor_id: e.target.value })}>
                  <option value="">Proveedor</option>
                  {proveedores.filter((p) => p.activo).map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
                <input className="input" placeholder="N° factura proveedor" style={{ flex: '0 0 190px' }}
                  value={nuevaCompra.numero_factura_prov}
                  onChange={(e) => setNuevaCompra({ ...nuevaCompra, numero_factura_prov: e.target.value })} />
                <input className="input" type="date" style={{ maxWidth: 160 }} value={nuevaCompra.fecha}
                  onChange={(e) => setNuevaCompra({ ...nuevaCompra, fecha: e.target.value })} />
                <input className="input" placeholder="URL comprobante" style={{ flex: '1 1 170px' }}
                  value={nuevaCompra.comprobante_url}
                  onChange={(e) => setNuevaCompra({ ...nuevaCompra, comprobante_url: e.target.value })} />
                <input className="input" type="number" step="0.01" placeholder="IVA" style={{ flex: '0 0 120px' }}
                  value={nuevaCompra.iva} onChange={(e) => setNuevaCompra({ ...nuevaCompra, iva: e.target.value })} />
              </div>
              <table className="tbl" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <select className="input" value={it.producto_id}
                          onChange={(e) => setItems(items.map((x, i) =>
                            i === idx ? { ...x, producto_id: e.target.value } : x))}>
                          <option value="">Selecciona producto</option>
                          {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="input" type="number" step="0.01" style={{ maxWidth: 120 }}
                          value={it.cantidad} onChange={(e) => setItems(items.map((x, i) =>
                            i === idx ? { ...x, cantidad: e.target.value } : x))} />
                      </td>
                      <td>
                        <input className="input" type="number" step="0.01" style={{ maxWidth: 140 }}
                          value={it.costo_unitario} onChange={(e) => setItems(items.map((x, i) =>
                            i === idx ? { ...x, costo_unitario: e.target.value } : x))} />
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger"
                          onClick={() => setItems(items.filter((_, i) => i !== idx))}>Quitar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
                <button className="btn btn-sm" onClick={() => setItems([...items, { ...ITEM_VACIO }])}>
                  Añadir ítem
                </button>
                <span style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
                  Subtotal: <b>{money(subtotalNueva)}</b> · Total con IVA:{' '}
                  <b>{money(subtotalNueva + (Number(nuevaCompra.iva) || 0))}</b>
                </span>
                <button className="btn btn-primary" onClick={() => void crearCompra()}>Crear borrador</button>
              </div>
            </section>
          )}

          <section className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.desde}
                onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
              <input className="input" type="date" style={{ maxWidth: 160 }} value={filtros.hasta}
                onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
              <select className="input" style={{ maxWidth: 170 }} value={filtros.estado}
                onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
                <option value="">Todos los estados</option>
                <option value="borrador">Borradores</option>
                <option value="confirmada">Confirmadas</option>
                <option value="pagada">Pagadas</option>
                <option value="anulada">Anuladas</option>
              </select>
              <select className="input" style={{ maxWidth: 200 }} value={filtros.proveedor_id}
                onChange={(e) => setFiltros({ ...filtros, proveedor_id: e.target.value })}>
                <option value="">Todos los proveedores</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <button className="btn btn-primary" onClick={() => void cargarCompras()}>Buscar</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>#</th><th>Fecha</th><th>Proveedor</th><th>Factura prov.</th><th>Ítems</th>
                    <th>Subtotal</th><th>IVA</th><th>Total</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {compras.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{fecha(c.fecha)}</td>
                      <td>{c.proveedor || '—'}</td>
                      <td>{c.numero_factura_prov || '—'}</td>
                      <td>{c.n_items ?? '—'}</td>
                      <td>{money(c.subtotal)}</td>
                      <td>{money(c.iva)}</td>
                      <td><b>{money(c.total)}</b></td>
                      <td>
                        <span className="pill" style={{
                          background: `${COLOR_COMPRA[c.estado] || '#8aa4c7'}22`,
                          color: COLOR_COMPRA[c.estado] || '#8aa4c7',
                        }}>{c.estado}</span>
                      </td>
                      <td>
                        {puedeGestionar && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {c.estado === 'borrador' && (
                              <>
                                <button className="btn btn-sm btn-success"
                                  onClick={() => void confirmarCompra(c)}>Confirmar</button>
                                <button className="btn btn-sm btn-danger"
                                  onClick={() => void anularCompra(c)}>Anular</button>
                              </>
                            )}
                            {['confirmada', 'pagada'].includes(c.estado) && (
                              <button className="btn btn-sm btn-warn"
                                onClick={() => setPagar({
                                  compra: c, monto: '', metodo_pago_id: '', cuenta_destino_id: '', observacion: '',
                                })}>Pagar</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!compras.length && <tr><td colSpan={10} style={{ color: '#5f7095' }}>Sin compras.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {seccion === 'kardex' && (
        <>
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ flex: '1 1 220px' }} value={kFiltros.producto_id}
                onChange={(e) => setKFiltros({ ...kFiltros, producto_id: e.target.value })}>
                <option value="">Todos los productos</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <select className="input" style={{ maxWidth: 150 }} value={kFiltros.tipo}
                onChange={(e) => setKFiltros({ ...kFiltros, tipo: e.target.value })}>
                <option value="">Todos los tipos</option>
                <option value="entrada">Entradas</option>
                <option value="salida">Salidas</option>
                <option value="ajuste">Ajustes</option>
              </select>
              <input className="input" type="date" style={{ maxWidth: 160 }} value={kFiltros.desde}
                onChange={(e) => setKFiltros({ ...kFiltros, desde: e.target.value })} />
              <input className="input" type="date" style={{ maxWidth: 160 }} value={kFiltros.hasta}
                onChange={(e) => setKFiltros({ ...kFiltros, hasta: e.target.value })} />
              <button className="btn btn-primary" onClick={() => void cargarKardex()}>Buscar</button>
              <button className="btn" onClick={() => void cargarValorizacion()}>Valorización</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Costo unit.</th>
                    <th>Saldo cant.</th><th>Saldo valor</th><th>Referencia</th><th>Usuario</th></tr>
                </thead>
                <tbody>
                  {movs.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontSize: '0.76rem' }}>{fechaHora(m.creado_en)}</td>
                      <td>{m.producto_nombre}</td>
                      <td>{m.tipo}</td>
                      <td>{money(m.cantidad)}</td>
                      <td>{money(m.costo_unitario)}</td>
                      <td>{money(m.saldo_cantidad)}</td>
                      <td>{money(m.saldo_valor)}</td>
                      <td style={{ fontSize: '0.76rem' }}>
                        {m.referencia_id ? `${m.referencia_tipo || '—'}#${m.referencia_id}` : (m.referencia_tipo || '—')}
                      </td>
                      <td style={{ fontSize: '0.76rem' }}>{m.usuario || '—'}</td>
                    </tr>
                  ))}
                  {!movs.length && (
                    <tr><td colSpan={9} style={{ color: '#5f7095' }}>
                      Sin movimientos (usa Buscar para consultar el kardex).
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {valor && (
            <section className="card">
              <h3 style={{ marginTop: 0 }}>
                Valorización del inventario — {money(valor.total_valorizado)}
              </h3>
              <table className="tbl">
                <thead>
                  <tr><th>Producto</th><th>Categoría</th><th>Stock</th><th>Stock mínimo</th>
                    <th>Costo unit.</th><th>Valor total</th></tr>
                </thead>
                <tbody>
                  {valor.productos.map((p) => (
                    <tr key={p.id} style={p.stock_actual <= p.stock_minimo ? { color: '#f59e0b' } : undefined}>
                      <td>{p.nombre}</td>
                      <td>{p.categoria || '—'}</td>
                      <td>{money(p.stock_actual)}</td>
                      <td>{money(p.stock_minimo)}</td>
                      <td>{money(p.costo_unitario)}</td>
                      <td><b>{money(p.valor_total)}</b></td>
                    </tr>
                  ))}
                  {!valor.productos.length && (
                    <tr><td colSpan={6} style={{ color: '#5f7095' }}>Sin productos en inventario.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {editProv && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>Editar proveedor</h3>
            <input className="input" placeholder="Nombre" value={editProv.nombre}
              onChange={(e) => setEditProv({ ...editProv, nombre: e.target.value })} />
            <input className="input" placeholder="NIT" style={{ marginTop: 8 }} value={editProv.nit || ''}
              onChange={(e) => setEditProv({ ...editProv, nit: e.target.value })} />
            <input className="input" placeholder="Contacto" style={{ marginTop: 8 }} value={editProv.contacto || ''}
              onChange={(e) => setEditProv({ ...editProv, contacto: e.target.value })} />
            <input className="input" placeholder="Teléfono" style={{ marginTop: 8 }} value={editProv.telefono || ''}
              onChange={(e) => setEditProv({ ...editProv, telefono: e.target.value })} />
            <input className="input" placeholder="Email" style={{ marginTop: 8 }} value={editProv.email || ''}
              onChange={(e) => setEditProv({ ...editProv, email: e.target.value })} />
            <input className="input" placeholder="Condiciones de pago" style={{ marginTop: 8 }}
              value={editProv.condiciones_pago || ''}
              onChange={(e) => setEditProv({ ...editProv, condiciones_pago: e.target.value })} />
            <label style={{ color: '#8aa4c7', fontSize: '0.82rem', display: 'flex', gap: 6, marginTop: 10 }}>
              <input type="checkbox" checked={editProv.activo}
                onChange={(e) => setEditProv({ ...editProv, activo: e.target.checked })} />
              Activo
            </label>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void guardarProveedor()}>Guardar</button>
              <button className="btn" onClick={() => setEditProv(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {pagar && (
        <div className="modal-overlay">
          <div className="card modal" style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>Pagar compra #{pagar.compra.id}</h3>
            <p style={{ color: '#8aa4c7', fontSize: '0.82rem' }}>
              Total de la compra: <b>{money(pagar.compra.total)}</b>. Deja el monto vacío para pagar
              el saldo completo.
            </p>
            <input className="input" type="number" step="0.01" placeholder="Monto (opcional)"
              value={pagar.monto} onChange={(e) => setPagar({ ...pagar, monto: e.target.value })} />
            <select className="input" style={{ marginTop: 8 }} value={pagar.metodo_pago_id}
              onChange={(e) => setPagar({ ...pagar, metodo_pago_id: e.target.value })}>
              <option value="">Método de pago</option>
              {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.tipo})</option>)}
            </select>
            <select className="input" style={{ marginTop: 8 }} value={pagar.cuenta_destino_id}
              onChange={(e) => setPagar({ ...pagar, cuenta_destino_id: e.target.value })}>
              <option value="">Cuenta destino (opcional)</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="input" placeholder="Observación" style={{ marginTop: 8 }} value={pagar.observacion}
              onChange={(e) => setPagar({ ...pagar, observacion: e.target.value })} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => void confirmarPago()}>Pagar</button>
              <button className="btn" onClick={() => setPagar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
