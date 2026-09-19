// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: rutas de eventos
// -----------------------------------------------------------------------------
// Los eventos (carreras futuras) viven en Chronit (Flask, SQLite) como fuente
// de verdad para poder correrlos. Este router:
//   - Lista/crea/edita/borra eventos haciendo proxy al core (CARRERA_API).
//   - Mantiene un espejo en PostgreSQL (tabla `eventos`) para que el kiosco y
//     los tickets usen el id de PG (el mismo que referencia tickets/colas).
//   - Asigna/quita pilotos y transponders a cada evento (proxy al core).
//   - Marca el estado 'preparada' (listo para iniciar) de un evento.
//
// La resolución de ids PG <-> core se hace vía uuid_global (identidad compartida)
// y, para pilotos, mapeando uuid_global de usuarios <-> drivers.
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { broadcast } from '../notifications.js';
import { config } from 'dotenv';

config();

export const eventosRouter = Router();
const CARRERA_API = process.env.CARRERA_API || 'http://hardware:5000';

// -----------------------------------------------------------------------------
// Helpers de resolución de ids PG <-> core (Chronit)
// -----------------------------------------------------------------------------
export async function coreGet(path) {
  const r = await fetch(`${CARRERA_API}${path}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const err = new Error(body.error || `Core respondió ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

export async function corePost(path, body) {
  const r = await fetch(`${CARRERA_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const err = new Error(data.error || `Core respondió ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function corePut(path, body) {
  const r = await fetch(`${CARRERA_API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const err = new Error(data.error || `Core respondió ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function coreDelete(path) {
  const r = await fetch(`${CARRERA_API}${path}`, { method: 'DELETE' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const err = new Error(data.error || `Core respondió ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Mapa uuid_global -> core id para eventos (cacheado por llamada)
async function coreEventsByUuid() {
  const list = await coreGet('/api/events');
  const map = {};
  for (const e of Array.isArray(list) ? list : []) {
    if (e.uuid_global) map[String(e.uuid_global)] = e;
  }
  return map;
}

// Mapa uuid_global -> core id para pilotos (drivers)
async function coreDriversByUuid() {
  const list = await coreGet('/api/drivers');
  const map = {};
  for (const d of Array.isArray(list) ? list : []) {
    if (d.uuid_global) map[String(d.uuid_global)] = d;
  }
  return map;
}

// Mapea la configuración de un evento (core/frontend) a las columnas del espejo
// PG. Los modos se alinean con el core:
//   time_attack / por_tiempo -> duracion_min ; position / por_vueltas -> vueltas
//   classification / qualifying_laps -> vueltas_clasificacion ; endurance -> duracion_min
function mapEventConfig(ev) {
  const raceMode = ev.race_mode || ev.modo || 'position';
  // race_mode (core) -> modo (columna PG)
  const modo =
    raceMode === 'time_attack' ? 'por_tiempo'
    : raceMode === 'por_tiempo' ? 'por_tiempo'
    : raceMode === 'position' ? 'por_vueltas'
    : raceMode === 'por_vueltas' ? 'por_vueltas'
    : raceMode === 'classification' || raceMode === 'qualifying_laps' || raceMode === 'clasificacion' ? 'clasificacion'
    : raceMode === 'endurance' || raceMode === 'resistencia' ? 'resistencia'
    : 'por_tiempo'; // por defecto / personalizado

  const vueltas = ev.vueltas ?? ev.laps ?? ev.laps_limit ?? ev.number_of_laps ?? null;
  const vueltasClasificacion = ev.vueltas_clasificacion ?? ev.qualifying_laps ?? null;
  const duracionMin =
    ev.duracion_min ?? ev.time_limit_min ??
    (ev.time_limit_seconds ? Math.round(Number(ev.time_limit_seconds) / 60) : null);
  const pilotosPorEquipo = ev.pilotos_por_equipo ?? ev.pilots_per_team ?? ev.drivers_per_team ?? null;
  const maxPilotos = ev.max_pilotos ?? ev.max_drivers ?? null;

  return {
    modo,
    vueltas: vueltas != null ? vueltas : null,
    vueltas_clasificacion: vueltasClasificacion != null ? vueltasClasificacion : null,
    duracion_min: duracionMin != null ? duracionMin : null,
    pilotos_por_equipo: pilotosPorEquipo != null ? pilotosPorEquipo : null,
    max_pilotos: maxPilotos != null ? maxPilotos : null,
  };
}

// upsert de un evento core en PostgreSQL, devuelve fila enriquecida
async function upsertPgEvent(ev) {
  const cfg = mapEventConfig(ev);
  const { rows } = await query(
    `INSERT INTO eventos
       (uuid_global, nombre, fecha, hora, estado, tipo_carrera, tipo_pista, largo_km, responsable,
        modo, vueltas, duracion_min, vueltas_clasificacion, pilotos_por_equipo, max_pilotos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (uuid_global) DO UPDATE SET
       nombre = EXCLUDED.nombre,
       fecha = COALESCE(EXCLUDED.fecha, eventos.fecha),
       hora = COALESCE(EXCLUDED.hora, eventos.hora),
       estado = EXCLUDED.estado,
       tipo_carrera = EXCLUDED.tipo_carrera,
       tipo_pista = EXCLUDED.tipo_pista,
       largo_km = COALESCE(EXCLUDED.largo_km, eventos.largo_km),
       responsable = COALESCE(EXCLUDED.responsable, eventos.responsable),
       modo = EXCLUDED.modo,
       vueltas = EXCLUDED.vueltas,
       duracion_min = EXCLUDED.duracion_min,
       vueltas_clasificacion = EXCLUDED.vueltas_clasificacion,
       pilotos_por_equipo = EXCLUDED.pilotos_por_equipo,
       max_pilotos = EXCLUDED.max_pilotos,
       actualizado_en = now()
     RETURNING *`,
    [
      ev.uuid_global,
      ev.name || ev.nombre,
      ev.event_date ?? ev.fecha ?? null,
      ev.event_time ?? ev.hora ?? null,
      ev.status || 'pendiente',
      ev.race_mode || 'position',
      ev.track_type || 'karting',
      ev.track_length_km ?? ev.largo_km ?? 0.33,
      ev.responsible_user ?? ev.responsable ?? null,
      cfg.modo,
      cfg.vueltas,
      cfg.duracion_min,
      cfg.vueltas_clasificacion,
      cfg.pilotos_por_equipo,
      cfg.max_pilotos,
    ]
  );
  const row = rows[0];
  const cnt = await query('SELECT COUNT(*)::int AS c FROM colas WHERE evento_id = $1', [row.id]);
  return { ...row, total_drivers: cnt.rows[0].c };
}

// core id (SQLite) -> fila PG enriquecida
async function coreToPg(coreId) {
  const ev = await coreGet(`/api/events/${coreId}`);
  if (!ev || !ev.uuid_global) return null;
  const { rows } = await query('SELECT id FROM eventos WHERE uuid_global = $1', [ev.uuid_global]);
  if (rows.length) return upsertPgEvent(ev);
  const up = await upsertPgEvent(ev);
  return up;
}

// pg id -> core id (SQLite) o null si no existe en core
export async function pgToCore(pgId) {
  const { rows } = await query('SELECT uuid_global FROM eventos WHERE id = $1', [pgId]);
  if (!rows.length) return null;
  const map = await coreEventsByUuid();
  const ev = map[String(rows[0].uuid_global)];
  return ev ? ev.id : null;
}

// pg usuario_id -> core driver_id (via uuid_global)
export async function userToCoreDriver(usuarioId) {
  const { rows } = await query('SELECT uuid_global FROM usuarios WHERE id = $1', [usuarioId]);
  if (!rows.length) return null;
  const map = await coreDriversByUuid();
  const d = map[String(rows[0].uuid_global)];
  return d ? d.id : null;
}

// -----------------------------------------------------------------------------
// Listar eventos (desde PG, con el id que usan tickets/colas)
// -----------------------------------------------------------------------------
eventosRouter.get('/', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { estado, seleccionables } = req.query;
    const params = [];
    let sql = 'SELECT * FROM eventos WHERE 1=1';
    if (estado) { params.push(estado); sql += ` AND estado = $${params.length}`; }
    // ?seleccionables=true -> solo eventos que pueden recibir tickets (no
    // finalizado/cancelado/insuficiente).
    if (seleccionables === 'true') {
      sql += ` AND estado NOT IN ('finalizado','cancelado','insuficiente')`;
    }
    sql += ' ORDER BY creado_en DESC, id DESC';
    const { rows } = await query(sql, params);
    // Contar tickets (pilotos asignados) por evento
    for (const ev of rows) {
      const cnt = await query('SELECT COUNT(*)::int AS c FROM colas WHERE evento_id = $1', [ev.id]);
      ev.total_drivers = cnt.rows[0].c;
      ev.event_code = null; // PG no almacena código; se conserva campo por compatibilidad UI
      ev.seleccionable = !['finalizado', 'cancelado', 'insuficiente'].includes(ev.estado);
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ¿Hay una carrera activa en el core? (para que vestidores sepa si puede marcar 'preparada')
eventosRouter.get('/carrera-activa', requireAuth, requireRole('admin','cajero','coordinador'), async (_req, res) => {
  try {
    const s = await coreGet('/api/status');
    const ses = s && s.current_session;
    const sesStatus = ses ? String(ses.status || '').toLowerCase() : null;
    // Criterio ÚNICO (alineado con el core): sólo una sesión active/paused es
    // una carrera activa. Una sesión 'pending' (tablero reseteado o carrera
    // recién configurada, aún NO iniciada) NO lo es.
    const activa = typeof s?.race_active === 'boolean'
      ? s.race_active
      : !!sesStatus && ['active', 'paused'].includes(sesStatus);
    res.json({ activa, session: ses || null, status: sesStatus, circuit_name: ses ? ses.circuit_name : null });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Próximos eventos (pantalla pública /display). Público, sin auth. Devuelve
// eventos no finalizados/cancelados ordenados por fecha, con conteo de pilotos.
eventosRouter.get('/proximos', async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre, fecha, hora, estado, tipo_carrera, tipo_pista, largo_km, modo, vueltas, duracion_min, max_pilotos
       FROM eventos
       WHERE estado NOT IN ('finalizado','cancelado')
       ORDER BY fecha ASC NULLS LAST, hora ASC NULLS LAST, id DESC
       LIMIT 6`
    );
    for (const ev of rows) {
      const cnt = await query('SELECT COUNT(*)::int AS c FROM colas WHERE evento_id = $1', [ev.id]);
      ev.total_drivers = cnt.rows[0].c;
      ev.seleccionable = !['finalizado', 'cancelado', 'insuficiente'].includes(ev.estado);
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Detalle de un evento (id de PG)
eventosRouter.get('/:id', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM eventos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Evento no encontrado' });
    const { rows: d } = await query('SELECT id, uuid_global, usuario_id, numero, estado FROM tickets WHERE evento_id = $1 ORDER BY numero', [req.params.id]);
    const cnt = await query('SELECT COUNT(*)::int AS c FROM colas WHERE evento_id = $1', [req.params.id]);
    res.json({ ...rows[0], total_drivers: cnt.rows[0].c, tickets: d });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear evento en el core y reflejarlo en PG
eventosRouter.post('/', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const data = req.body || {};
    const created = await corePost('/api/events', data);
    if (!created.id) return res.status(502).json({ error: 'El core no devolvió id del evento' });
    const pg = await coreToPg(created.id);
    // Estado del evento: 'pendiente' porque aún no está activo (no se puede correr)
    await query("UPDATE eventos SET estado = 'pendiente' WHERE id = $1", [pg.id]);
    res.status(201).json({ ...pg, estado: 'pendiente' });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Editar evento (id de PG -> core + PG)
eventosRouter.put('/:id', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (!coreId) return res.status(404).json({ error: 'Evento no encontrado en el core' });
    await corePut(`/api/events/${coreId}`, req.body || {});
    const pg = await coreToPg(coreId);
    res.json(pg);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Borrar evento (id de PG -> core + PG) y sus tickets/colas en PG
eventosRouter.delete('/:id', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (coreId) await coreDelete(`/api/events/${coreId}`);
    // Limpiar referencias locales
    await query('DELETE FROM colas WHERE evento_id = $1', [req.params.id]);
    await query('DELETE FROM tickets WHERE evento_id = $1', [req.params.id]);
    await query('DELETE FROM eventos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Pilotos inscritos a un evento (proxy al core, espejo de future_event_drivers)
eventosRouter.get('/:id/drivers', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (!coreId) return res.status(404).json({ error: 'Evento no encontrado en el core' });
    const drivers = await coreGet(`/api/events/${coreId}/drivers`);
    res.json(Array.isArray(drivers) ? drivers : []);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Asignar pilotos a un evento (usuario_ids de PG -> driver_ids del core)
eventosRouter.post('/:id/drivers', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (!coreId) return res.status(404).json({ error: 'Evento no encontrado en el core' });
    const { usuario_ids, block } = req.body || {};
    if (!Array.isArray(usuario_ids) || !usuario_ids.length) {
      return res.status(400).json({ error: 'usuario_ids requerido' });
    }
    const driverIds = [];
    const skip = [];
    for (const uid of usuario_ids) {
      const did = await userToCoreDriver(uid);
      if (did) driverIds.push(did);
      else skip.push(uid);
    }
    if (!driverIds.length) return res.status(400).json({ error: 'Ningún usuario tiene piloto asociado en el core' });
    await corePost(`/api/events/${coreId}/drivers`, { driver_ids: driverIds, block });
    // Al agregar pilotos, un evento INCOMPLETO/INSUFICIENTE vuelve a PENDIENTE
    // (la cajera completó la lista y el coordinador ya puede llamar).
    const reset = await query(
      `UPDATE eventos SET estado = 'pendiente', actualizado_en = now()
       WHERE id = $1 AND estado IN ('incompleto','insuficiente') RETURNING id`,
      [req.params.id]
    );
    if (reset.rows.length) {
      broadcast('faltan_pilotos', { evento_id: Number(req.params.id), estado: 'pendiente', resuelto: true });
    }
    res.json({ success: true, added: driverIds.length, skipped: skip });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Quitar un piloto del evento (driver_id = id del piloto en el core)
eventosRouter.delete('/:id/drivers/:driverId', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (!coreId) return res.status(404).json({ error: 'Evento no encontrado en el core' });
    await coreDelete(`/api/events/${coreId}/drivers/${req.params.driverId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Asignar transponder a un piloto del evento (o quitarlo si transponder_id null)
eventosRouter.post('/:id/drivers/:driverId/transponder', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (!coreId) return res.status(404).json({ error: 'Evento no encontrado en el core' });
    const { transponder_id } = req.body || {};
    await corePost(`/api/events/${coreId}/drivers/${req.params.driverId}/transponder`, { transponder_id: transponder_id || null });
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// REQ 3 — Transponder PROVISIONAL por evento (copia local en tickets)
// -----------------------------------------------------------------------------
// La asignación vive SOLO dentro del evento: NO toca el core (no altera
// drivers/karts globales), NO afecta otros eventos ni la carrera activa. La
// lista de transponders disponibles se sigue leyendo del core.
// -----------------------------------------------------------------------------

// Vincular (o reemplazar) el transponder provisional de un piloto del evento.
eventosRouter.post('/:id/tickets/:ticketId/transponder', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { transponder_id } = req.body || {};
    const tpId = transponder_id == null || transponder_id === '' ? null : Number(transponder_id);
    if (tpId != null && !Number.isInteger(tpId)) {
      return res.status(400).json({ error: 'transponder_id inválido' });
    }
    // El ticket debe pertenecer a ESTE evento.
    const { rows: t } = await query('SELECT id, numero FROM tickets WHERE id = $1 AND evento_id = $2', [req.params.ticketId, req.params.id]);
    if (!t.length) return res.status(404).json({ error: 'Ticket no encontrado en este evento' });
    // Unicidad INTRA-evento (mensaje claro; el índice único es la red de seguridad).
    if (tpId != null) {
      const { rows: dup } = await query(
        'SELECT numero FROM tickets WHERE evento_id = $1 AND transponder_id = $2 AND id <> $3',
        [req.params.id, tpId, req.params.ticketId]
      );
      if (dup.length) {
        return res.status(409).json({
          error: `El transponder #${tpId} ya está asignado al ticket #${dup[0].numero} en este evento`,
          code: 'TRANSPONDER_YA_ASIGNADO_EN_EVENTO',
        });
      }
    }
    const { rows } = await query(
      'UPDATE tickets SET transponder_id = $1 WHERE id = $2 RETURNING id, evento_id, transponder_id',
      [tpId, req.params.ticketId]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'El transponder ya está asignado a otro piloto en este evento', code: 'TRANSPONDER_YA_ASIGNADO_EN_EVENTO' });
    }
    res.status(500).json({ error: e.message });
  }
});

// Desvincular el transponder de un piloto SÓLO dentro de este evento.
// No toca el core, ni otros eventos, ni la carrera activa.
eventosRouter.delete('/:id/tickets/:ticketId/transponder', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE tickets SET transponder_id = NULL WHERE id = $1 AND evento_id = $2 RETURNING id, evento_id, transponder_id',
      [req.params.ticketId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket no encontrado en este evento' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Transponders disponibles / en pista para un evento (proxy al core)
eventosRouter.get('/:id/transponders/available', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (!coreId) return res.status(404).json({ error: 'Evento no encontrado en el core' });
    const tps = await coreGet(`/api/events/${coreId}/transponders/available`);
    res.json(Array.isArray(tps) ? tps : []);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Marcar evento como 'preparada' (listo para configurar/iniciar). Sin este
// estado, el core (panel de eventos) NO habilitará "Configurar carrera".
//
// Reglas de servidor (no confiamos sólo en el frontend):
//   1. Debe existir el evento en el core.
//   2. NO debe haber una carrera activa/en curso en el core.
//   3. TODOS los tickets del evento deben estar en estado PREPARADO.
eventosRouter.post('/:id/preparada', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const coreId = await pgToCore(req.params.id);
    if (!coreId) return res.status(404).json({ error: 'Evento no encontrado en el core' });

    // 1) Sin carrera activa en el core. Se usa el flag canónico del core; sólo
    //    active/paused cuentan como carrera activa ('pending' NO bloquea).
    const s = await coreGet('/api/status');
    const ses = s && s.current_session;
    const sesStatus = ses ? String(ses.status || '').toLowerCase() : null;
    const carreraActiva = typeof s?.race_active === 'boolean'
      ? s.race_active
      : !!sesStatus && ['active', 'paused'].includes(sesStatus);
    if (carreraActiva) {
      return res.status(409).json({ error: 'Hay una carrera activa; no se puede preparar otro evento.', code: 'CARRERA_ACTIVA' });
    }

    // 2) Todos los tickets del evento deben estar PREPARADO (y debe haber al menos uno).
    const { rows: pend } = await query(
      `SELECT id, numero, estado FROM tickets
       WHERE evento_id = $1 AND estado <> 'PREPARADO'
       ORDER BY numero`,
      [req.params.id]
    );
    if (pend.length) {
      const nums = pend.map((t) => `#${t.numero} (${t.estado})`).join(', ');
      return res.status(409).json({
        error: `Todos los pilotos deben estar PREPARADO. Pendientes: ${nums}`,
        code: 'PILOTOS_NO_PREPARADOS',
        pendientes: pend,
      });
    }
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM tickets WHERE evento_id = $1', [req.params.id]);
    if (!cnt[0].c) {
      return res.status(409).json({ error: 'El evento no tiene pilotos asignados.', code: 'SIN_PILOTOS' });
    }

    // REQ 4: reforzar en servidor que TODOS tengan transponder provisional
    // (el "listo" del vestidor ya lo exige; esto evita estados inconsistentes).
    const { rows: sinTp } = await query(
      'SELECT numero FROM tickets WHERE evento_id = $1 AND transponder_id IS NULL ORDER BY numero',
      [req.params.id]
    );
    if (sinTp.length) {
      return res.status(409).json({
        error: `Estos pilotos no tienen transponder asignado: ${sinTp.map((t) => `#${t.numero}`).join(', ')}`,
        code: 'PILOTOS_SIN_TRANSPONDER',
        pendientes: sinTp,
      });
    }

    // Reflejar en el core (future_events.status = 'preparada')
    await corePost(`/api/events/${coreId}/status`, { status: 'preparada' });
    // El core exige que TODOS los pilotos del evento estén en estado Ready para
    // poder iniciar. El flujo de vestidores vive en PostgreSQL (colas), así que
    // al marcar el evento como 'preparada' ponemos en Ready a todo el grupo en
    // el core (ya validamos arriba que todos estén PREPARADO).
    await corePost(`/api/events/${coreId}/drivers/ready-all`, {}).catch(() => {});
    const { rows } = await query(
      "UPDATE eventos SET estado = 'preparada', actualizado_en = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Marcar evento como INCOMPLETO (faltan pilotos). El coordinador lo activa y se
// notifica en tiempo real a la cajera para que asigne más pilotos.
eventosRouter.post('/:id/incompleto', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE eventos SET estado = 'incompleto', actualizado_en = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Evento no encontrado' });
    broadcast('faltan_pilotos', { evento_id: Number(req.params.id), estado: 'incompleto', evento: rows[0].nombre });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar evento como INSUFICIENTE (no se pueden completar los pilotos).
eventosRouter.post('/:id/insuficiente', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE eventos SET estado = 'insuficiente', actualizado_en = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Evento no encontrado' });
    broadcast('faltan_pilotos', { evento_id: Number(req.params.id), estado: 'insuficiente', evento: rows[0].nombre });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar evento como CANCELADO.
eventosRouter.post('/:id/cancelado', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE eventos SET estado = 'cancelado', actualizado_en = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------------------
// Última carrera finalizada (pantalla pública de resultados)
// Público: la pantalla consume esto para mostrar el podio/clasificación cuando
// una carrera termina (evento en estado 'finalizado'). Devuelve el evento más
// reciente finalizado y la clasificación de sus participantes.
// -----------------------------------------------------------------------------
eventosRouter.get('/resultados/ultima-carrera', async (req, res) => {
  try {
    // Se ordena por la fecha del ÚLTIMO resultado registrado (no por
    // `eventos.actualizado_en`, que la sentinela reescribe en todos los eventos
    // en cada ciclo y dejaba la pantalla mostrando un evento arbitrario).
    const ev = await query(
      `SELECT e.id, e.uuid_global, e.nombre, e.fecha, e.hora, e.estado, e.tipo_carrera, e.actualizado_en
       FROM eventos e
       LEFT JOIN resultados_carrera r ON r.evento_id = e.id
       WHERE e.estado = 'finalizado'
       GROUP BY e.id
       ORDER BY MAX(r.fecha) DESC NULLS LAST, e.id DESC
       LIMIT 1`
    );
    if (!ev.rows.length) return res.json({ evento: null, resultados: [] });

    const evento = ev.rows[0];
    const resu = await query(
      `SELECT r.posicion, r.tiempo_total, r.mejor_vuelta, r.circuito, r.vuelta_rapida,
              u.nombre, u.apellido, u.carnet, u.nacionalidad, u.foto
       FROM resultados_carrera r
       JOIN usuarios u ON u.id = r.usuario_id
       WHERE r.evento_id = $1
       ORDER BY r.posicion ASC NULLS LAST, r.tiempo_total ASC NULLS LAST`,
      [evento.id]
    );
    res.json({ evento, resultados: resu.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
