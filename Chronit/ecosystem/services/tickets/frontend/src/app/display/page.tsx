'use client';

import { useEffect, useState } from 'react';
import { api, cacheGet, cacheSet, connectLive } from '@/lib/api';
import { flagOf, eventoLabel, eventoColor } from '@/lib/constants';

// Del backend de tickets -> carrusel configurado + llamadas a vestidores (colas llamadas/recientes)
interface PantallaItem { id: number; tipo: string; url: string; duracion_seg: number; activo: boolean; orden: number; }
interface Llamada {
  ticket_numero: number; vestidor: number; nombre: string; apellido: string;
  carnet: string; foto: string | null; nacionalidad: string | null; estado: string;
}
interface UltimaCarreraResultado {
  posicion: number | null; tiempo_total: string | null; mejor_vuelta: string | null;
  circuito: string | null; vuelta_rapida: boolean; nombre: string; apellido: string;
  carnet: string; nacionalidad: string | null; foto: string | null;
}
interface UltimaCarrera { evento: { id: number; nombre: string; actualizado_en: string } | null; resultados: UltimaCarreraResultado[]; }
interface ProximoEvento {
  id: number; nombre: string; fecha: string | null; hora: string | null; estado: string;
  tipo_carrera: string | null; tipo_pista: string | null; largo_km: number | null;
  modo: string | null; vueltas: number | null; duracion_min: number | null;
  total_drivers: number; max_pilotos: number | null;
}

const POLL = 5000;
const IDLE_MS = 300000; // 5 min sin llamadas -> modo carrusel
const RESULT_MS = 600000; // 10 min mostrando el resultado de la última carrera

// Etiqueta legible del modo de carrera (mapa de config del evento).
function modoLabel(m?: string | null, vueltas?: number | null, duracion_min?: number | null): string | null {
  if (!m) return null;
  if (m === 'por_tiempo') return duracion_min ? `Time Attack · ${duracion_min} min` : 'Time Attack';
  if (m === 'por_vueltas') return vueltas ? `Race Position · ${vueltas} vueltas` : 'Race Position';
  if (m === 'clasificacion') return vueltas ? `Clasificatorio · ${vueltas} vueltas` : 'Clasificatorio';
  if (m === 'resistencia') return duracion_min ? `Endurance · ${duracion_min} min` : 'Endurance';
  return 'Personalizado';
}

function fmtFecha(fecha?: string | null, hora?: string | null): string {
  if (!fecha) return hora || '';
  const d = new Date(fecha.includes('T') ? fecha : fecha + 'T00:00:00');
  const s = isNaN(d.getTime()) ? fecha : `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return hora ? `${s} ${hora}` : s;
}

export default function DisplayPage() {
  const [items, setItems] = useState<PantallaItem[]>([]);
  const [llamadas, setLlamadas] = useState<Llamada[]>([]);
  const [idx, setIdx] = useState(0);
  const [lastCall, setLastCall] = useState(0);
  const [ultima, setUltima] = useState<UltimaCarrera>({ evento: null, resultados: [] });
  const [proximos, setProximos] = useState<ProximoEvento[]>([]);

  useEffect(() => {
    const cargar = async () => {
      try {
        const itemsData = await api<PantallaItem[]>('/api/config/pantalla?activos=true');
        setItems(itemsData);
        cacheSet('pantalla', itemsData);
      } catch {
        const c = cacheGet<PantallaItem[]>('pantalla');
        if (c) setItems(c);
      }
      try {
        // Llamadas activas: colas llamadas o ready
        const colas = await api<Llamada[]>('/api/colas?estado=llamado');
        setLlamadas(colas);
        if (colas.length) setLastCall(Date.now());
      } catch {
        /* offline: conservar */
      }
      try {
        // Resultado de la última carrera finalizada (pantalla de resultados)
        const resu = await api<UltimaCarrera>('/api/eventos/resultados/ultima-carrera');
        setUltima(resu);
      } catch {
        /* offline: conservar */
      }
      try {
        // Próximos eventos (pantalla pública, sin auth)
        const prox = await api<ProximoEvento[]>('/api/eventos/proximos');
        setProximos(prox);
      } catch {
        /* offline: conservar */
      }
    };
    cargar();
    const t = setInterval(cargar, POLL);

    // Suscripción en tiempo real: cuando el responsable llama a un grupo,
    // la pantalla pública se actualiza al instante (con fallback a poll).
    let live: Awaited<ReturnType<typeof connectLive>> = null;
    (async () => {
      live = await connectLive();
      if (!live) return;
      live.emit('join-display');
      live.on('colas', (payload) => {
        if (payload && Array.isArray(payload)) {
          setLlamadas(payload as unknown as Llamada[]);
          setLastCall(Date.now());
        } else {
          // Actualización puntual (vestidor/ready) -> refrescar por iframe
          cargar();
        }
      });
    })();

    return () => {
      clearInterval(t);
      live?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), items[idx]?.duracion_seg || 5);
    return () => clearInterval(t);
  }, [items, idx]);

  const enLlamada = llamadas.length > 0;
  // Una carrera recién finalizada muestra la pantalla de resultados durante
  // RESULT_MS (10 min) o hasta que se llame a otro grupo / vuelva el carrusel.
  const terminadoEn = ultima.evento ? new Date(ultima.evento.actualizado_en).getTime() : 0;
  const verResultados = !enLlamada && terminadoEn && Date.now() - terminadoEn < RESULT_MS;
  const modoCarrusel = !enLlamada && !verResultados;

  return (
    <main
      style={{
        minHeight: '100vh',
        color: '#e1ecff',
        padding: 24,
        position: 'relative',
        backgroundImage:
          "linear-gradient(rgba(11,15,25,0.72), rgba(11,15,25,0.86)), url('/images/backgroundjpeg.jpeg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
    >
      <header style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: '2rem' }}>GO KART</h1>
        <p style={{ color: '#8aa4c7' }}>Pantalla pública de eventos</p>
      </header>

      {/* Próximos eventos — franja superior siempre visible */}
      {proximos.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: '1.1rem', color: '#8aa4c7', marginBottom: 12 }}>PRÓXIMOS EVENTOS</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
            {proximos.map((ev) => {
              const label = modoLabel(ev.modo, ev.vueltas, ev.duracion_min);
              const color = eventoColor(ev.estado);
              return (
                <div key={ev.id} className="card" style={{ borderLeft: `4px solid ${color}`, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: '1.02rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.nombre}
                    </span>
                    <span className="badge" style={{ borderColor: color, color, flexShrink: 0 }}>{eventoLabel(ev.estado)}</span>
                  </div>
                  {label && <div style={{ color: '#8aa4c7', fontSize: '0.82rem', marginBottom: 10 }}>{label}</div>}
                  <div style={{ fontSize: '0.82rem', color: '#8aa4c7' }}>
                    {fmtFecha(ev.fecha, ev.hora)}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#8aa4c7', marginTop: 2 }}>
                    {ev.total_drivers}{ev.max_pilotos ? ` / ${ev.max_pilotos}` : ''} pilotos · {ev.tipo_pista || 'karting'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {enLlamada ? (
        <div>
          <h2 style={{ textAlign: 'center', color: '#ffffffff', fontSize: '1.6rem', marginBottom: 20 }}>
            LLAMADO A VESTIDORES
          </h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
            {llamadas.map((l, i) => (
              <div key={i} className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.9rem' }}>Ticket {l.ticket_numero}</div>
                <div style={{ fontSize: '2.2rem', margin: '8px 0' }}>{flagOf(l.nacionalidad)}</div>
                <div style={{ fontWeight: 700 }}>{l.nombre} {l.apellido}</div>
                <div style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Carnet: {l.carnet}</div>
                <div className="badge" style={{
                  marginTop: 12, borderColor: '#16a34a', color: '#16a34a' }}>
                  Vestidor {l.vestidor}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : verResultados ? (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', color: '#f5b60a', fontSize: '1.8rem', marginBottom: 6 }}>
            RESULTADOS
          </h2>
          <p style={{ textAlign: 'center', color: '#8aa4c7', marginBottom: 20 }}>
            {ultima.evento?.nombre || 'Carrera'}
            {ultima.resultados.length ? ` · ${ultima.resultados.length} participantes` : ''}
          </p>
          {ultima.resultados.length ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Piloto</th>
                    <th>Circuito</th>
                    <th>Total</th>
                    <th>Mejor vuelta</th>
                  </tr>
                </thead>
                <tbody>
                  {ultima.resultados.map((r, i) => {
                    const pos = r.posicion;
                    const esPodium = pos != null && pos <= 3;
                    const podioColors = ['#f5b60a', '#c0c6d0', '#b06b3a'];
                    const podioColor = esPodium ? podioColors[(pos as number) - 1] : '#8aa4c7';
                    return (
                      <tr key={i} style={{ background: esPodium ? `${podioColor}18` : undefined }}>
                        <td style={{ fontSize: '1.4rem', fontWeight: 700, color: podioColor }}>
                          {pos ?? '—'}
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>
                            {flagOf(r.nacionalidad)} {r.nombre} {r.apellido}
                          </div>
                          <div style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Carnet: {r.carnet}</div>
                        </td>
                        <td>{r.circuito || '—'}</td>
                        <td>{r.tiempo_total || '—'}</td>
                        <td>{r.mejor_vuelta || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ textAlign: 'center', color: '#8aa4c7' }}>Sin datos de clasificación.</p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', minHeight: '60vh' }}>
          {items.length ? (
            <div className="card" style={{ width: '100%', height: '60vh', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {items[idx]?.tipo === 'video' ? (
                <video src={items[idx].url} autoPlay muted loop style={{ maxWidth: '100%', maxHeight: '100%' }} />
              ) : (
                <img src={items[idx]?.url} alt="carrusel"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              )}
            </div>
          ) : (
            <div className="card" style={{ width: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center' }}>
              <h2 style={{ fontSize: '2.2rem' }}>Bienvenidos</h2>
              <p style={{ color: '#8aa4c7', marginTop: 10 }}>El próximo bloque será llamado a vestidores.</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
