// =============================================================================
// CHRONIT ECOSYSTEM — Caja (POS) — /caja
// -----------------------------------------------------------------------------
// Punto de venta del módulo de contabilidad:
//   * Banner de apertura/cierre de caja (bloquea la venta si no hay caja).
//   * Grilla de productos y combos con precios de la lista vigente.
//   * Carrito con desglose de IVA (por modo de cada producto), descuento y propina.
//   * Modal de pago: método + CUENTA DESTINO OBLIGATORIA si es QR/transferencia.
//   * Campo NIT opcional (obligatorio según configuración, eximible por supervisor).
//   * Tickets por piloto/evento + impresión del ticket con QR firmado.
//   * Advertencias de umbral (descuento / egreso) con autorización de supervisor.
//   * Registro de egresos de caja.
// =============================================================================
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { api, CONTA_FRONTEND_URL, contaApi, imprimirTicket } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';

// --- Tipos -----------------------------------------------------------------
interface Producto {
  id: number; nombre: string; categoria: string; vueltas: number | null;
  duracion_min: number | null; precio: number | null; moneda: string;
  iva_modo_efectivo: string; iva_porcentaje_efectivo: number;
}
interface Combo {
  id: number; nombre: string; precio: number; modo_facturacion: string;
  iva_modo_efectivo: string;
}
interface MetodoPago { id: number; nombre: string; tipo: string }
interface CuentaDestino { id: number; nombre: string; tipo: string; es_efectivo_caja: boolean }
interface PosData {
  lista_vigente: { id: number; nombre: string } | null;
  config: {
    iva_modo_default: string; iva_porcentaje_default: number;
    umbral_descuento_supervisor: number; umbral_egreso_cajero: number;
    propina_habilitada: boolean; propina_modo: string; propina_porcentaje_sugerido: number;
    propina_distribucion: string; combo_modo_default: string;
    requiere_nit_por_defecto: boolean; tipo_factura_default: string;
    // Cumplimiento fiscal Bolivia (v3)
    facturacion_habilitada?: boolean; facturacion_modo_default?: string;
    facturacion_requiere_nit?: boolean; facturacion_requiere_razon_social?: boolean;
    regimen?: string; iva_pct_default?: number; it_pct_default?: number;
    siete_rg_pct?: number;
  };
  productos: Producto[]; combos: Combo[]; metodos_pago: MetodoPago[];
  cuentas_destino: CuentaDestino[];
}
interface SesionCaja {
  id: number; monto_inicial: number; apertura_en: string; estado: string;
}
interface ResumenCaja {
  ventas_total: number; ventas_efectivo: number; egresos_total: number;
  propinas_total: number; monto_esperado_efectivo: number; retiros: number; ingresos: number;
  por_metodo: { tipo: string; total: number; ventas: number }[];
}
interface ItemCarrito {
  key: string; tipo: 'producto' | 'combo'; id: number; nombre: string;
  precio: number; cantidad: number; iva_modo: string; iva_pct: number;
}
interface PagoForm {
  metodo_pago_id: number | ''; cuenta_destino_id: number | ''; monto: number; referencia_qr: string;
}
interface TicketForm {
  usuario_id: number; nombre: string; carnet: string; evento_id: number | ''; producto_id: number | '';
}
interface Piloto { id: number; nombre: string; apellido: string; carnet: string; rol: string }
interface Evento { id: number; nombre: string; fecha: string; hora: string; modo: string; estado: string }

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: number) => (Number(n) || 0).toLocaleString('es-BO', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * Misma fórmula que el backend (utils/finanzas.js `calcularLineaFiscal`).
 * `tipoOperacion` decide el tratamiento fiscal de la línea (v3 Bolivia):
 *   - facturado    -> desglosa IVA según el modo (incluido|agregado|exento).
 *   - no_facturado -> NO desglosa IVA; el precio es la base (el backend igual
 *                     calcula el IT internamente y lo snapshotea).
 *   - exento       -> como no_facturado, marca explícita para reportes.
 *   - cortesia     -> importe 0 (solo auditoría, sin impuestos).
 */
function calcularLinea(
  bruto: number, descuento: number, modo: string, pct: number,
  tipoOperacion = 'facturado'
) {
  const b = r2(bruto);
  const desc = r2(Math.min(Math.max(descuento, 0), b));
  const neto = r2(b - desc);
  if (tipoOperacion === 'cortesia') return { base: 0, iva: 0, total: 0 };
  if (tipoOperacion !== 'facturado') return { base: neto, iva: 0, total: neto };
  const tasa = (Number(pct) || 0) / 100;
  if (modo === 'exento' || tasa === 0) return { base: neto, iva: 0, total: neto };
  if (modo === 'agregado') {
    const iva = r2(neto * tasa);
    return { base: neto, iva, total: r2(neto + iva) };
  }
  const base = r2(neto / (1 + tasa));
  return { base, iva: r2(neto - base), total: neto };
}

export default function CajaPage() {
  const { ready } = useAuthGuard(['cajero', 'supervisor', 'admin']);
  const [pos, setPos] = useState<PosData | null>(null);
  const [sesion, setSesion] = useState<SesionCaja | null>(null);
  const [resumen, setResumen] = useState<ResumenCaja | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Carrito y datos de la venta
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [descuentoGlobal, setDescuentoGlobal] = useState(0);
  const [nit, setNit] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [tipoFactura, setTipoFactura] = useState('factura');
  // (v3) Tipo de operación fiscal de la venta: facturado | no_facturado |
  // exento | cortesia. Arranca desde config.facturacion_modo_default.
  const [tipoOperacion, setTipoOperacion] = useState('no_facturado');
  const [propinaMonto, setPropinaMonto] = useState(0);
  const [propinaModo, setPropinaModo] = useState('acumulada');
  const [propinaMetodo, setPropinaMetodo] = useState('efectivo');
  const [pagos, setPagos] = useState<PagoForm[]>([]);
  const [tickets, setTickets] = useState<TicketForm[]>([]);
  const [pilotos, setPilotos] = useState<Piloto[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [buscarPiloto, setBuscarPiloto] = useState('');
  const [eventoGlobal, setEventoGlobal] = useState<number | ''>('');

  // Modales
  const [modalPago, setModalPago] = useState(false);
  const [modalCierre, setModalCierre] = useState(false);
  const [modalEgreso, setModalEgreso] = useState(false);
  const [modalAuth, setModalAuth] = useState<{ accion: () => void; texto: string } | null>(null);
  const [authCarnet, setAuthCarnet] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPin, setAuthPin] = useState('');
  const [autorizacion, setAutorizacion] = useState<{ carnet?: string; password?: string; pin?: string } | null>(null);
  const [resultado, setResultado] = useState<null | {
    venta: { id: number; numero_factura: string | null; total_final: number };
    tickets: { id: number; numero: number | null; estado: string }[];
    // (v3) Desglose fiscal devuelto por el backend tras registrar la venta.
    fiscal?: {
      tipo_operacion: string; regimen: string; base_imponible_iva: number;
      base_imponible_it: number; iva_total: number; it_total: number;
      iue_retenido: number; numero_factura: string | null; cuf: string | null;
    };
  }>(null);
  const [enviando, setEnviando] = useState(false);

  // --- Carga inicial -------------------------------------------------------
  const cargarPos = useCallback(async () => {
    const data = await contaApi<PosData>('/api/conta/catalogo/pos');
    setPos(data);
    setPropinaModo(data.config.propina_modo === 'mixta' ? 'acumulada' : data.config.propina_modo);
    setTipoFactura(data.config.tipo_factura_default || 'factura');
    // (v3) Modo fiscal por defecto: si la facturación está deshabilitada se
    // fuerza 'no_facturado' (aunque la config diga otra cosa).
    const modoFiscal = data.config.facturacion_habilitada
      ? (data.config.facturacion_modo_default || 'no_facturado')
      : 'no_facturado';
    setTipoOperacion(modoFiscal === 'facturado' ? 'facturado' : 'no_facturado');
  }, []);

  const cargarCaja = useCallback(async () => {
    const data = await contaApi<{ sesion: SesionCaja | null; resumen: ResumenCaja | null }>(
      '/api/conta/cajas/actual'
    );
    setSesion(data.sesion);
    setResumen(data.resumen);
  }, []);

  useEffect(() => {
    if (!ready) return;
    Promise.all([cargarPos(), cargarCaja()]).catch((e) => setError(e.message));
    // Pilotos y eventos viven en el backend de tickets (mismo dominio de datos).
    api<Piloto[]>('/api/pilotos')
      .then((rows) => setPilotos(rows.filter((p) => p.rol === 'piloto')))
      .catch(() => setPilotos([]));
    api<Evento[]>('/api/eventos?seleccionables=true')
      .then((rows) => setEventos(rows))
      .catch(() => setEventos([]));
  }, [ready, cargarPos, cargarCaja]);

  // --- Totales -------------------------------------------------------------
  // El desglose depende del tipo de operación: facturado muestra Base + IVA;
  // no_facturado/exento muestran solo el total (el IT se calcula en backend).
  const esFacturado = tipoOperacion === 'facturado';
  const totales = useMemo(() => {
    const brutoTotal = r2(carrito.reduce((a, i) => a + i.precio * i.cantidad, 0));
    const descGlobal = Math.min(Math.max(descuentoGlobal, 0), brutoTotal);
    let acumulado = 0;
    const lineas = carrito.map((i, idx) => {
      const bruto = r2(i.precio * i.cantidad);
      const esUltima = idx === carrito.length - 1;
      const parte = brutoTotal > 0 && descGlobal > 0
        ? (esUltima ? r2(descGlobal - acumulado) : r2(descGlobal * (bruto / brutoTotal)))
        : 0;
      acumulado = r2(acumulado + parte);
      const calc = calcularLinea(bruto, parte, i.iva_modo, i.iva_pct, tipoOperacion);
      return { ...i, bruto, descuento: parte, ...calc };
    });
    const subtotal = brutoTotal;
    const descuento = r2(lineas.reduce((a, l) => a + l.descuento, 0));
    const base = r2(lineas.reduce((a, l) => a + l.base, 0));
    const iva = r2(lineas.reduce((a, l) => a + l.iva, 0));
    const propina = r2(Math.max(propinaMonto, 0));
    // En cortesía el importe a cobrar es 0 (aunque se listen los productos).
    const neto = tipoOperacion === 'cortesia'
      ? 0
      : r2(lineas.reduce((a, l) => a + l.total, 0));
    return { lineas, subtotal, descuento, base, iva, propina, total: r2(neto + propina) };
  }, [carrito, descuentoGlobal, propinaMonto, tipoOperacion]);

  const sumaPagos = r2(pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0));
  const restante = r2(totales.total - sumaPagos);

  // Mantiene el monto del único pago igual al total (pago simple).
  useEffect(() => {
    if (pagos.length === 1) {
      setPagos((prev) => (prev[0].monto === totales.total ? prev : [{ ...prev[0], monto: totales.total }]));
    }
  }, [totales.total, pagos.length]);

  const superaUmbralDescuento = !!pos && totales.descuento > pos.config.umbral_descuento_supervisor;

  // --- Carrito -------------------------------------------------------------
  const agregar = (item: Omit<ItemCarrito, 'key' | 'cantidad'>) => {
    setCarrito((prev) => {
      const existente = prev.find((i) => i.tipo === item.tipo && i.id === item.id);
      if (existente) {
        return prev.map((i) => (i.key === existente.key ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [...prev, { ...item, key: `${item.tipo}-${item.id}-${Date.now()}`, cantidad: 1 }];
    });
  };
  const cambiarCantidad = (key: string, delta: number) => {
    setCarrito((prev) => prev
      .map((i) => (i.key === key ? { ...i, cantidad: i.cantidad + delta } : i))
      .filter((i) => i.cantidad > 0));
  };
  const quitar = (key: string) => setCarrito((prev) => prev.filter((i) => i.key !== key));

  // Autorización rápida por PIN: el cajero no cierra sesión; el supervisor
  // teclea su PIN y la venta/egreso se reintenta con `autorizacion: { pin }`.
  const autorizarConPin = () => {
    if (!/^\d{4,6}$/.test(authPin)) { setError('El PIN debe tener entre 4 y 6 dígitos.'); return; }
    const aut = { pin: authPin };
    setAutorizacion(aut);
    const accion = modalAuth?.accion;
    setModalAuth(null);
    setAuthPin('');
    if (accion) setTimeout(() => { void accion(); }, 0);
  };

  const limpiarVenta = () => {
    setCarrito([]); setDescuentoGlobal(0); setNit(''); setRazonSocial('');
    setPropinaMonto(0); setPagos([]); setTickets([]);
    if (pos) {
      setTipoFactura(pos.config.tipo_factura_default || 'factura');
      setTipoOperacion(
        pos.config.facturacion_habilitada && pos.config.facturacion_modo_default === 'facturado'
          ? 'facturado' : 'no_facturado'
      );
    }
  };

  // --- Caja ----------------------------------------------------------------
  const abrirCaja = async (monto: number) => {
    setError(null);
    try {
      await contaApi('/api/conta/cajas/abrir', { method: 'POST', body: { monto_inicial: monto } });
      await cargarCaja();
      setMsg('Caja abierta correctamente.');
    } catch (e) { setError((e as Error).message); }
  };

  const cerrarCaja = async (contado: number, notas: string) => {
    if (!sesion) return;
    setError(null);
    try {
      const r = await contaApi<{ sesion: { diferencia: number } }>(
        `/api/conta/cajas/${sesion.id}/cerrar`,
        { method: 'POST', body: { monto_contado_efectivo: contado, notas_cierre: notas } }
      );
      setModalCierre(false);
      setMsg(`Caja cerrada. Diferencia: ${money(r.sesion.diferencia)} BOB`);
      await cargarCaja();
    } catch (e) { setError((e as Error).message); }
  };

  // --- Venta ---------------------------------------------------------------
  const registrarVenta = async () => {
    if (!carrito.length) { setError('Agrega al menos un producto o combo.'); return; }
    if (Math.abs(restante) > 0.02) {
      setError(`Los pagos (${money(sumaPagos)}) no cuadran con el total (${money(totales.total)}).`);
      return;
    }
    const sinCuenta = pagos.some((p) => {
      const m = pos?.metodos_pago.find((x) => x.id === Number(p.metodo_pago_id));
      return m && (m.tipo === 'qr' || m.tipo === 'transferencia') && !p.cuenta_destino_id;
    });
    if (sinCuenta) { setError('El método QR/transferencia exige seleccionar una cuenta destino.'); return; }

    const body = {
      // (v3) Tipo de operación fiscal: gobierna IVA/IT y el libro de ventas SIN.
      tipo_operacion: tipoOperacion,
      items: carrito.map((i) => (i.tipo === 'combo'
        ? { combo_id: i.id, cantidad: i.cantidad }
        : { producto_id: i.id, cantidad: i.cantidad })),
      descuento_global: totales.descuento,
      propina: totales.propina > 0
        ? { monto: totales.propina, modo: propinaModo, metodo: propinaMetodo }
        : undefined,
      nit_cliente: nit || undefined,
      razon_social_cliente: razonSocial || undefined,
      // El tipo de comprobante solo aplica a ventas facturadas; en el resto el
      // backend fuerza tipo_factura_snapshot = 'sin_factura'.
      tipo_factura: esFacturado ? tipoFactura : undefined,
      sesion_caja_id: sesion?.id,
      pagos: pagos.map((p) => ({
        metodo_pago_id: Number(p.metodo_pago_id),
        cuenta_destino_id: p.cuenta_destino_id ? Number(p.cuenta_destino_id) : undefined,
        monto: Number(p.monto),
        referencia_qr: p.referencia_qr || undefined,
      })),
      tickets: tickets.map((t) => ({
        usuario_id: t.usuario_id,
        evento_id: t.evento_id ? Number(t.evento_id) : undefined,
        producto_id: t.producto_id ? Number(t.producto_id) : undefined,
      })),
      autorizacion: autorizacion || undefined,
    };

    setEnviando(true); setError(null);
    try {
      const r = await contaApi<{
        venta: { id: number; numero_factura: string | null; total_final: number };
        tickets: { id: number; numero: number | null; estado: string }[];
        fiscal?: {
          tipo_operacion: string; regimen: string; base_imponible_iva: number;
          base_imponible_it: number; iva_total: number; it_total: number;
          iue_retenido: number; numero_factura: string | null; cuf: string | null;
        };
      }>('/api/conta/ventas', { method: 'POST', body });
      setResultado(r);
      setModalPago(false);
      setAutorizacion(null);
      limpiarVenta();
      await cargarCaja();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'REQUIERE_AUTORIZACION' || err.code === 'REQUIERE_NIT'
        || err.code === 'REQUIERE_DATOS_FISCALES') {
        setModalPago(false);
        setModalAuth({
          texto: `${err.message} Pide a un supervisor que autorice con su PIN.`,
          accion: () => { void registrarVenta(); },
        });
      } else {
        setError(err.message);
      }
    } finally {
      setEnviando(false);
    }
  };

  // --- Egreso --------------------------------------------------------------
  const registrarEgreso = async (categoria: string, monto: number, descripcion: string) => {
    setError(null);
    try {
      const body: Record<string, unknown> = { categoria, monto, descripcion };
      if (autorizacion) body.autorizacion = autorizacion;
      await contaApi('/api/conta/egresos', { method: 'POST', body });
      setModalEgreso(false);
      setAutorizacion(null);
      setMsg('Egreso registrado.');
      await cargarCaja();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'REQUIERE_AUTORIZACION') {
        setModalEgreso(false);
        setModalAuth({
          texto: `${err.message} Ingresa las credenciales de un supervisor.`,
          accion: () => { void registrarEgreso(categoria, monto, descripcion); },
        });
      } else setError(err.message);
    }
  };

  if (!ready) {
    return (<><Navbar /><div className="card" style={{ margin: 20 }}>Cargando…</div></>);
  }

  const pilotosFiltrados = pilotos
    .filter((p) => {
      const q = buscarPiloto.trim().toLowerCase();
      if (!q) return true;
      return `${p.nombre} ${p.apellido}`.toLowerCase().includes(q) || (p.carnet || '').toLowerCase().includes(q);
    })
    .slice(0, 8);

  return (
    <>
      <Navbar />
      <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
        <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Caja / Punto de venta</h2>
          <span className="badge">{pos?.lista_vigente ? `Lista: ${pos.lista_vigente.nombre}` : 'Sin lista vigente'}</span>
          <a href={`${CONTA_FRONTEND_URL}/contabilidad`} className="btn btn-sm">Contabilidad</a>
        </div>

        {error && (
          <div className="card" style={{ borderColor: '#dc2626', marginBottom: 10 }}>
            <b style={{ color: '#fca5a5' }}>Error:</b> {error}{' '}
            <button className="btn btn-sm" onClick={() => setError(null)}>Cerrar</button>
          </div>
        )}
        {msg && (
          <div className="card" style={{ borderColor: '#16a34a', marginBottom: 10 }}>
            {msg} <button className="btn btn-sm" onClick={() => setMsg(null)}>Cerrar</button>
          </div>
        )}

        {/* Banner de caja */}
        {!sesion ? (
          <FormularioApertura onAbrir={abrirCaja} />
        ) : (
          <div className="card" style={{ marginBottom: 12, borderColor: '#16a34a' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>CAJA ABIERTA</b> desde {new Date(sesion.apertura_en).toLocaleString('es-BO')}
                <div style={{ fontSize: '0.85rem', color: '#8aa4c7', marginTop: 4 }}>
                  Inicial {money(sesion.monto_inicial)} · Ventas {money(resumen?.ventas_total || 0)} ·
                  Efectivo {money(resumen?.ventas_efectivo || 0)} · Egresos {money(resumen?.egresos_total || 0)} ·
                  Propinas {money(resumen?.propinas_total || 0)}
                </div>
                <div style={{ fontSize: '1rem', marginTop: 4 }}>
                  <b>Esperado en efectivo: {money(resumen?.monto_esperado_efectivo || 0)} BOB</b>
                </div>
              </div>
              <div className="row">
                <button className="btn btn-warn" onClick={() => setModalEgreso(true)}>Egreso</button>
                <button className="btn btn-danger" onClick={() => setModalCierre(true)}>Cerrar caja</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, alignItems: 'start' }}>
          {/* POS */}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Productos</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {(pos?.productos || []).map((p) => (
                <button
                  key={`prod-${p.id}`}
                  className="kiosk-btn"
                  disabled={!sesion}
                  onClick={() => agregar({
                    tipo: 'producto', id: p.id, nombre: p.nombre,
                    precio: Number(p.precio || 0), iva_modo: p.iva_modo_efectivo,
                    iva_pct: p.iva_porcentaje_efectivo,
                  })}
                >
                  <b>{p.nombre}</b>
                  <div style={{ fontSize: '0.8rem', color: '#8aa4c7' }}>{p.categoria}</div>
                  <div>{p.precio == null ? 'sin precio' : `${money(Number(p.precio))} BOB`}</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    IVA {p.iva_modo_efectivo} {p.iva_porcentaje_efectivo}%
                  </div>
                </button>
              ))}
              {(pos?.combos || []).map((c) => (
                <button
                  key={`combo-${c.id}`}
                  className="kiosk-btn kiosk-btn-accent"
                  disabled={!sesion}
                  onClick={() => agregar({
                    tipo: 'combo', id: c.id, nombre: c.nombre, precio: Number(c.precio || 0),
                    iva_modo: c.iva_modo_efectivo,
                    iva_pct: pos?.config.iva_pct_default
                      ?? pos?.config.iva_porcentaje_default ?? 13,
                  })}
                >
                  <b>{c.nombre}</b>
                  <div style={{ fontSize: '0.8rem' }}>{c.modo_facturacion}</div>
                  <div>{money(Number(c.precio))} BOB</div>
                </button>
              ))}
            </div>

            <h3>Tickets (pilotos)</h3>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div>
                <label className="label">Evento por defecto</label>
                <select className="input" value={eventoGlobal}
                  onChange={(e) => setEventoGlobal(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">— sin evento —</option>
                  {eventos.map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.nombre} · {ev.fecha} {ev.hora}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">Buscar piloto (nombre o carnet)</label>
                <input className="input" value={buscarPiloto}
                  onChange={(e) => setBuscarPiloto(e.target.value)} placeholder="Ej: 1234567" />
              </div>
            </div>
            {buscarPiloto && (
              <div className="row" style={{ marginTop: 6 }}>
                {pilotosFiltrados.map((p) => (
                  <button key={p.id} className="btn btn-sm" onClick={() => {
                    setTickets((prev) => [...prev, {
                      usuario_id: p.id, nombre: `${p.nombre} ${p.apellido}`.trim(),
                      carnet: p.carnet, evento_id: eventoGlobal, producto_id: '',
                    }]);
                    setBuscarPiloto('');
                  }}>
                    + {p.nombre} {p.apellido} ({p.carnet})
                  </button>
                ))}
                {!pilotosFiltrados.length && <span style={{ color: '#8aa4c7' }}>Sin resultados</span>}
              </div>
            )}
            {!!tickets.length && (
              <table className="tbl" style={{ marginTop: 8 }}>
                <thead><tr><th>Piloto</th><th>Carnet</th><th>Evento</th><th>Producto</th><th /></tr></thead>
                <tbody>
                  {tickets.map((t, idx) => (
                    <tr key={`${t.usuario_id}-${idx}`}>
                      <td>{t.nombre}</td>
                      <td>{t.carnet}</td>
                      <td>
                        <select className="input" value={t.evento_id}
                          onChange={(e) => setTickets((prev) => prev.map((x, i) => i === idx
                            ? { ...x, evento_id: e.target.value ? Number(e.target.value) : '' } : x))}>
                          <option value="">—</option>
                          {eventos.map((ev) => <option key={ev.id} value={ev.id}>{ev.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="input" value={t.producto_id}
                          onChange={(e) => setTickets((prev) => prev.map((x, i) => i === idx
                            ? { ...x, producto_id: e.target.value ? Number(e.target.value) : '' } : x))}>
                          <option value="">—</option>
                          {(pos?.productos || []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger"
                          onClick={() => setTickets((prev) => prev.filter((_, i) => i !== idx))}>Quitar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Carrito */}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Venta</h3>
            {!carrito.length && <p style={{ color: '#8aa4c7' }}>Sin ítems. Toca un producto para agregarlo.</p>}
            {!!carrito.length && (
              <table className="tbl">
                <thead><tr><th>Ítem</th><th>Cant.</th><th>Precio</th><th>Importe</th><th /></tr></thead>
                <tbody>
                  {carrito.map((i) => (
                    <tr key={i.key}>
                      <td>{i.nombre}<div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        IVA {i.iva_modo} {i.iva_pct}%</div></td>
                      <td>
                        <button className="btn btn-sm" onClick={() => cambiarCantidad(i.key, -1)}>−</button>{' '}
                        {i.cantidad}{' '}
                        <button className="btn btn-sm" onClick={() => cambiarCantidad(i.key, +1)}>+</button>
                      </td>
                      <td>{money(i.precio)}</td>
                      <td>{money(i.precio * i.cantidad)}</td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => quitar(i.key)}>Quitar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 130 }}>
                <label className="label">Descuento (BOB)</label>
                <input className="input" type="number" min={0} step="0.01" value={descuentoGlobal}
                  onChange={(e) => setDescuentoGlobal(Number(e.target.value))} />
              </div>
              {pos?.config.propina_habilitada && (
                <>
                  <div style={{ width: 130 }}>
                    <label className="label">Propina (BOB)</label>
                    <input className="input" type="number" min={0} step="0.01" value={propinaMonto}
                      onChange={(e) => setPropinaMonto(Number(e.target.value))} />
                  </div>
                  <div style={{ width: 110 }}>
                    <label className="label">Sugerido</label>
                    <button className="btn btn-sm" onClick={() => setPropinaMonto(r2(totales.base * ((pos?.config.propina_porcentaje_sugerido || 0) / 100)))}>
                      {pos?.config.propina_porcentaje_sugerido}%
                    </button>
                  </div>
                  {pos?.config.propina_modo === 'mixta' && (
                    <div style={{ width: 150 }}>
                      <label className="label">Modo propina</label>
                      <select className="input" value={propinaModo} onChange={(e) => setPropinaModo(e.target.value)}>
                        <option value="inmediata">inmediata</option>
                        <option value="acumulada">acumulada</option>
                      </select>
                    </div>
                  )}
                  <div style={{ width: 150 }}>
                    <label className="label">Propina en</label>
                    <select className="input" value={propinaMetodo} onChange={(e) => setPropinaMetodo(e.target.value)}>
                      <option value="efectivo">efectivo</option>
                      <option value="qr">qr</option>
                      <option value="transferencia">transferencia</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {superaUmbralDescuento && (
              <div className="card" style={{ borderColor: '#d97706', marginTop: 8 }}>
                El descuento ({money(totales.descuento)}) supera el umbral permitido
                ({money(pos?.config.umbral_descuento_supervisor || 0)}). Se pedirá autorización de supervisor.
              </div>
            )}

            {/* (v3) Toggle fiscal: Facturar / No facturar */}
            {pos?.config.facturacion_habilitada && (
              <div className="card" style={{ marginTop: 10, borderColor: esFacturado ? '#16a34a' : '#263042' }}>
                <div className="row" style={{ alignItems: 'center' }}>
                  <label className="row" style={{ alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                    <input type="checkbox" checked={esFacturado}
                      onChange={(e) => setTipoOperacion(e.target.checked ? 'facturado' : 'no_facturado')} />
                    <b>Facturar</b>
                  </label>
                  <span className="badge">
                    {esFacturado ? 'con IVA desglosado' : 'sin desglose de IVA'}
                  </span>
                  {!esFacturado && (
                    <div style={{ width: 170 }}>
                      <label className="label">Tipo de operación</label>
                      <select className="input" value={tipoOperacion}
                        onChange={(e) => setTipoOperacion(e.target.value)}>
                        <option value="no_facturado">no facturado</option>
                        <option value="exento">exento</option>
                        <option value="cortesia">cortesía</option>
                      </select>
                    </div>
                  )}
                </div>
                {pos.config.regimen === 'siete_rg' && (
                  <div style={{ fontSize: '0.8rem', color: '#f5b60a', marginTop: 6 }}>
                    Régimen SIETE-RG activo: se aplica el 5% unificado (sin desglose de IVA/IT).
                  </div>
                )}
              </div>
            )}

            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 150 }}>
                <label className="label">
                  NIT cliente {esFacturado
                    ? (pos?.config.facturacion_requiere_nit ? '(obligatorio)' : '(opcional)')
                    : (pos?.config.requiere_nit_por_defecto ? '(obligatorio)' : '(opcional)')}
                </label>
                <input className="input" value={nit} onChange={(e) => setNit(e.target.value)} />
              </div>
              {esFacturado && (
                <>
                  <div style={{ flex: 1 }}>
                    <label className="label">
                      Razón social {pos?.config.facturacion_requiere_razon_social ? '(obligatorio)' : ''}
                    </label>
                    <input className="input" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
                  </div>
                  <div style={{ width: 130 }}>
                    <label className="label">Tipo factura</label>
                    <select className="input" value={tipoFactura} onChange={(e) => setTipoFactura(e.target.value)}>
                      <option value="factura">factura</option>
                      <option value="recibo">recibo</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <hr style={{ border: 0, borderTop: '1px solid #263042', margin: '12px 0' }} />
            <table className="tbl">
              <tbody>
                <tr><td>Subtotal</td><td style={{ textAlign: 'right' }}>{money(totales.subtotal)}</td></tr>
                <tr><td>Descuento</td><td style={{ textAlign: 'right' }}>-{money(totales.descuento)}</td></tr>
                {esFacturado && (
                  <>
                    <tr><td>Base imponible IVA</td><td style={{ textAlign: 'right' }}>{money(totales.base)}</td></tr>
                    <tr><td>IVA</td><td style={{ textAlign: 'right' }}>{money(totales.iva)}</td></tr>
                  </>
                )}
                {esFacturado && (
                  <tr>
                    <td style={{ color: '#8aa4c7' }}>IT {pos?.config.it_pct_default ?? 3}% (informativo)</td>
                    <td style={{ textAlign: 'right', color: '#8aa4c7' }}>
                      {money(r2(totales.base * ((pos?.config.it_pct_default ?? 3) / 100)))}
                    </td>
                  </tr>
                )}
                <tr><td>Propina</td><td style={{ textAlign: 'right' }}>{money(totales.propina)}</td></tr>
                <tr><td><b>TOTAL</b></td><td style={{ textAlign: 'right' }}><b>{money(totales.total)} BOB</b></td></tr>
              </tbody>
            </table>
            {!esFacturado && tipoOperacion !== 'cortesia' && (
              <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
                Venta no facturada: no se desglosa IVA. El IT se calcula y se guarda internamente.
              </p>
            )}
            {tipoOperacion === 'cortesia' && (
              <p style={{ fontSize: '0.75rem', color: '#f5b60a', marginTop: 4 }}>
                Cortesía: el importe a cobrar es 0. Se registran los ítems para auditoría.
              </p>
            )}

            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={!sesion || !carrito.length}
                onClick={() => {
                  setDescuentoGlobal(totales.descuento);
                  setPagos([{
                    metodo_pago_id: pos?.metodos_pago[0]?.id ?? '', cuenta_destino_id: '',
                    monto: totales.total, referencia_qr: '',
                  }]);
                  setAutorizacion(null);
                  setModalPago(true);
                }}>
                Cobrar
              </button>
              <button className="btn" onClick={limpiarVenta} disabled={!carrito.length}>Limpiar</button>
            </div>
            {!sesion && <p style={{ color: '#f5b60a' }}>Debes abrir caja para poder cobrar.</p>}
          </div>
        </div>
      </div>

      {modalPago && pos && (
        <ModalPago
          pos={pos}
          total={totales.total}
          pagos={pagos}
          setPagos={setPagos}
          sumaPagos={sumaPagos}
          restante={restante}
          enviando={enviando}
          onCerrar={() => setModalPago(false)}
          onConfirmar={registrarVenta}
        />
      )}

      {modalCierre && sesion && (
        <ModalCierre
          esperado={resumen?.monto_esperado_efectivo || 0}
          onCerrar={() => setModalCierre(false)}
          onConfirmar={cerrarCaja}
        />
      )}

      {modalEgreso && pos && (
        <ModalEgreso
          umbral={pos.config.umbral_egreso_cajero}
          onCerrar={() => setModalEgreso(false)}
          onConfirmar={registrarEgreso}
        />
      )}

      {modalAuth && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 style={{ marginTop: 0 }}>Autorización de supervisor</h3>
            <p style={{ color: '#8aa4c7' }}>{modalAuth.texto}</p>
            <p style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>
              Lo más rápido: que el supervisor teclee su <b>PIN</b> (4-6 dígitos). También puede
              autorizar con su carnet y contraseña.
            </p>
            <label className="label">PIN del supervisor</label>
            <input className="input" type="password" inputMode="numeric" maxLength={6}
              autoComplete="off" value={authPin} placeholder="••••"
              onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') autorizarConPin(); }} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={autorizarConPin}>Autorizar con PIN</button>
              <button className="btn" onClick={() => { setModalAuth(null); setAuthPin(''); setAuthCarnet(''); setAuthPassword(''); }}>
                Cancelar
              </button>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: '#8aa4c7' }}>
                Usar carnet y contraseña
              </summary>
              <label className="label" style={{ marginTop: 8 }}>Carnet del supervisor</label>
              <input className="input" value={authCarnet} onChange={(e) => setAuthCarnet(e.target.value)} />
              <label className="label" style={{ marginTop: 8 }}>Contraseña</label>
              <input className="input" type="password" value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)} />
              <button className="btn" style={{ marginTop: 10 }} onClick={() => {
                if (!authCarnet || !authPassword) { setError('Ingresa carnet y contraseña del supervisor.'); return; }
                const aut = { carnet: authCarnet, password: authPassword };
                setAutorizacion(aut);
                setModalAuth(null);
                setAuthCarnet(''); setAuthPassword('');
                setTimeout(() => { void modalAuth.accion(); }, 0);
              }}>Autorizar con credenciales</button>
            </details>
          </div>
        </div>
      )}

      {resultado && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 style={{ marginTop: 0 }}>Venta registrada</h3>
            {resultado.venta.numero_factura ? (
              <p>
                Factura <b>{resultado.venta.numero_factura}</b> · Total{' '}
                <b>{money(resultado.venta.total_final)} BOB</b>
              </p>
            ) : (
              <p>
                Ticket interno <b>#{resultado.venta.id}</b> · Total{' '}
                <b>{money(resultado.venta.total_final)} BOB</b>
                <span style={{ fontSize: '0.78rem', color: '#8aa4c7' }}>
                  {' '}(sin factura)
                </span>
              </p>
            )}
            {resultado.fiscal && (
              <table className="tbl" style={{ marginBottom: 8 }}>
                <tbody>
                  <tr><td>Operación</td><td style={{ textAlign: 'right' }}>
                    {resultado.fiscal.tipo_operacion}</td></tr>
                  <tr><td>Régimen</td><td style={{ textAlign: 'right' }}>
                    {resultado.fiscal.regimen}</td></tr>
                  {resultado.fiscal.tipo_operacion === 'facturado' && (
                    <>
                      <tr><td>Base imponible IVA</td><td style={{ textAlign: 'right' }}>
                        {money(resultado.fiscal.base_imponible_iva)}</td></tr>
                      <tr><td>IVA</td><td style={{ textAlign: 'right' }}>
                        {money(resultado.fiscal.iva_total)}</td></tr>
                    </>
                  )}
                  <tr><td>IT (interno)</td><td style={{ textAlign: 'right' }}>
                    {money(resultado.fiscal.it_total)}</td></tr>
                  {resultado.fiscal.iue_retenido > 0 && (
                    <tr><td>SIETE-RG / IUE</td><td style={{ textAlign: 'right' }}>
                      {money(resultado.fiscal.iue_retenido)}</td></tr>
                  )}
                  {resultado.fiscal.cuf && (
                    <tr><td>CUF</td><td style={{ textAlign: 'right', fontSize: '0.72rem' }}>
                      {resultado.fiscal.cuf}</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {!!resultado.tickets.length && (
              <table className="tbl">
                <thead><tr><th>Ticket</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {resultado.tickets.map((t) => (
                    <tr key={t.id}>
                      <td>#{t.numero ?? t.id}</td>
                      <td>{t.estado}</td>
                      <td><button className="btn btn-sm" onClick={() => imprimirTicket(t.id)}>Imprimir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => setResultado(null)}>Nueva venta</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Sub-componentes
// ============================================================================
function FormularioApertura({ onAbrir }: { onAbrir: (monto: number) => void }) {
  const [monto, setMonto] = useState(0);
  return (
    <div className="card" style={{ marginBottom: 12, borderColor: '#d97706' }}>
      <h3 style={{ marginTop: 0 }}>Abrir caja</h3>
      <p style={{ color: '#8aa4c7' }}>
        Ingresa el monto inicial en efectivo. Mientras la caja esté cerrada no se pueden registrar ventas.
      </p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <label className="label">Monto inicial (BOB)</label>
          <input className="input" type="number" min={0} step="0.01"
            value={monto} onChange={(e) => setMonto(Number(e.target.value))} />
        </div>
        <button className="btn btn-success" onClick={() => onAbrir(monto)}>Abrir caja</button>
      </div>
    </div>
  );
}

function ModalPago({
  pos, total, pagos, setPagos, sumaPagos, restante, enviando, onCerrar, onConfirmar,
}: {
  pos: PosData; total: number; pagos: PagoForm[];
  setPagos: React.Dispatch<React.SetStateAction<PagoForm[]>>;
  sumaPagos: number; restante: number; enviando: boolean;
  onCerrar: () => void; onConfirmar: () => void;
}) {
  const actualizar = (idx: number, cambios: Partial<PagoForm>) => {
    setPagos((prev) => prev.map((p, i) => (i === idx ? { ...p, ...cambios } : p)));
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3 style={{ marginTop: 0 }}>Cobrar {money(total)} BOB</h3>
        {pagos.map((p, idx) => {
          const metodo = pos.metodos_pago.find((m) => m.id === Number(p.metodo_pago_id));
          const exigeCuenta = metodo?.tipo === 'qr' || metodo?.tipo === 'transferencia';
          return (
            <div key={idx} className="card" style={{ marginBottom: 8 }}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div style={{ width: 150 }}>
                  <label className="label">Método</label>
                  <select className="input" value={p.metodo_pago_id}
                    onChange={(e) => actualizar(idx, {
                      metodo_pago_id: Number(e.target.value), cuenta_destino_id: '',
                    })}>
                    {pos.metodos_pago.map((m) => (
                      <option key={m.id} value={m.id}>{m.nombre} ({m.tipo})</option>
                    ))}
                  </select>
                </div>
                {exigeCuenta && (
                  <div style={{ flex: 1 }}>
                    <label className="label">Cuenta destino (obligatoria)</label>
                    <select className="input" value={p.cuenta_destino_id}
                      onChange={(e) => actualizar(idx, {
                        cuenta_destino_id: e.target.value ? Number(e.target.value) : '',
                      })}>
                      <option value="">— seleccionar —</option>
                      {pos.cuentas_destino.map((c) => (
                        <option key={c.id} value={c.id}>{c.nombre} ({c.tipo})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={{ width: 130 }}>
                  <label className="label">Monto</label>
                  <input className="input" type="number" step="0.01" value={p.monto}
                    onChange={(e) => actualizar(idx, { monto: Number(e.target.value) })} />
                </div>
                {exigeCuenta && (
                  <div style={{ width: 150 }}>
                    <label className="label">Referencia</label>
                    <input className="input" value={p.referencia_qr}
                      onChange={(e) => actualizar(idx, { referencia_qr: e.target.value })} />
                  </div>
                )}
                {pagos.length > 1 && (
                  <button className="btn btn-sm btn-danger"
                    onClick={() => setPagos((prev) => prev.filter((_, i) => i !== idx))}>Quitar</button>
                )}
              </div>
            </div>
          );
        })}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-sm" onClick={() => setPagos((prev) => [...prev, {
            metodo_pago_id: pos.metodos_pago[0]?.id ?? '', cuenta_destino_id: '',
            monto: restante, referencia_qr: '',
          }])}>+ Pago mixto</button>
          <span style={{ color: Math.abs(restante) > 0.02 ? '#f5b60a' : '#4ade80' }}>
            Suma {money(sumaPagos)} · Restante {money(restante)}
          </span>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-success" disabled={enviando} onClick={onConfirmar}>
            {enviando ? 'Registrando…' : 'Confirmar venta'}
          </button>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalCierre({
  esperado, onCerrar, onConfirmar,
}: { esperado: number; onCerrar: () => void; onConfirmar: (contado: number, notas: string) => void }) {
  const [contado, setContado] = useState(esperado);
  const [notas, setNotas] = useState('');
  const diferencia = r2(contado - esperado);
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3 style={{ marginTop: 0 }}>Cerrar caja</h3>
        <p style={{ color: '#8aa4c7' }}>Monto esperado en efectivo: <b>{money(esperado)} BOB</b></p>
        <label className="label">Efectivo contado (BOB)</label>
        <input className="input" type="number" step="0.01" value={contado}
          onChange={(e) => setContado(Number(e.target.value))} />
        <p style={{ color: diferencia === 0 ? '#4ade80' : '#fca5a5' }}>
          Diferencia: <b>{money(diferencia)} BOB</b>
        </p>
        <label className="label">Notas de cierre</label>
        <textarea className="input" rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-danger" onClick={() => onConfirmar(contado, notas)}>Confirmar cierre</button>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalEgreso({
  umbral, onCerrar, onConfirmar,
}: { umbral: number; onCerrar: () => void; onConfirmar: (c: string, m: number, d: string) => void }) {
  const [categoria, setCategoria] = useState('insumos');
  const [monto, setMonto] = useState(0);
  const [descripcion, setDescripcion] = useState('');
  const categorias = ['insumos', 'mantenimiento', 'combustible', 'personal', 'servicios',
    'publicidad', 'impuestos', 'viaticos', 'otros'];
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3 style={{ marginTop: 0 }}>Registrar egreso</h3>
        <label className="label">Categoría</label>
        <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="label" style={{ marginTop: 8 }}>Monto (BOB)</label>
        <input className="input" type="number" step="0.01" value={monto}
          onChange={(e) => setMonto(Number(e.target.value))} />
        {monto > umbral && (
          <p style={{ color: '#f5b60a' }}>
            Supera el umbral de {money(umbral)}: se pedirá autorización de supervisor.
          </p>
        )}
        <label className="label">Descripción</label>
        <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-warn" onClick={() => onConfirmar(categoria, monto, descripcion)}>Registrar</button>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
