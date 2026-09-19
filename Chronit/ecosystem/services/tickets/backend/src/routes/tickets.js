// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: rutas de tickets
//   POST /api/tickets                 -> generar ticket (estado PENDIENTE)
//   GET  /api/tickets                 -> listar (con filtro por evento/estado)
//   GET  /api/tickets/:id             -> detalle de un ticket
//   POST /api/tickets/:id/pagar       -> cambiar a ASIGNADO (taquilla)
//   POST /api/tickets/:id/asignar     -> asignar a un evento (solo ASIGNADO)
//   POST /api/tickets/asignar-bloque  -> asignar en bloque tickets ASIGNADOS
//
// Máquina de estados unificada del ticket (PROMPT MAESTRO):
//   PENDIENTE -> ASIGNADO -> LLAMANDO -> PREPARADO -> ACTIVO -> FINALIZADO
// El estado FINALIZADO es terminal: no se puede reasignar ni volver a operar.
// =============================================================================
import { Router } from 'express';
import QRCode from 'qrcode';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uuid } from '../utils/helpers.js';
import { auditar } from '../utils/audit.js';
import { corePost, coreDelete, pgToCore, userToCoreDriver } from './eventos.js';

export const ticketsRouter = Router();

// Estados terminales del ticket: una vez alcanzado, NO puede reasignarse ni
// operarse. FINALIZADO, USADO y REVOCADO son irreversibles.
const ESTADOS_TERMINALES = new Set(['FINALIZADO', 'USADO', 'REVOCADO']);
// Eventos que NO pueden recibir tickets (no seleccionables).
const ESTADOS_EVENTO_NO_SELECCIONABLES = new Set(['finalizado', 'cancelado', 'insuficiente']);

/** ¿El evento tiene un estado que admite asignación de tickets? */
async function eventoSeleccionable(eventoId) {
  const { rows } = await query('SELECT estado FROM eventos WHERE id = $1', [eventoId]);
  if (!rows.length) return false;
  return !ESTADOS_EVENTO_NO_SELECCIONABLES.has(rows[0].estado);
}

/**
 * Inscribe al piloto en el evento dentro del core (Chronit/SQLite) cuando la
 * taquilla asigna el ticket a un evento. Sin esto, el piloto sólo queda en
 * PostgreSQL (tickets + colas) y NUNCA aparece en la lista del control de
 * carrera, porque ese panel lee los pilotos del core (/api/events/<id>/drivers).
 *
 * Es idempotente y de mejor esfuerzo: si el core no está disponible se ignora
 * (el Sentinela reintenta el equilibrado en su próximo ciclo).
 */
export async function inscribirEnCore(eventoIdPg, usuarioId) {
  try {
    const coreId = await pgToCore(eventoIdPg);
    if (!coreId) return { coreId: null };
    const driverId = await userToCoreDriver(usuarioId);
    if (!driverId) {
      console.warn(`[tickets] El usuario ${usuarioId} no tiene driver en el core.`);
      return { coreId, driverId: null };
    }
    await corePost(`/api/events/${coreId}/drivers`, { driver_ids: [driverId] });
    return { coreId, driverId };
  } catch (e) {
    console.warn('[tickets] No se pudo inscribir al piloto en el core:', e.message);
    return { error: e.message };
  }
}

/**
 * Desinscribe al piloto del evento dentro del core cuando la taquilla quita o
 * reactiva su ticket. Evita que quede "fantasma" en la card del control de
 * carrera. De mejor esfuerzo: si el core falla, se ignora.
 */
export async function quitarDelCore(eventoIdPg, usuarioId) {
  try {
    const coreId = await pgToCore(eventoIdPg);
    if (!coreId) return { coreId: null };
    const driverId = await userToCoreDriver(usuarioId);
    if (!driverId) return { coreId, driverId: null };
    await coreDelete(`/api/events/${coreId}/drivers/${driverId}`);
    return { coreId, driverId };
  } catch (e) {
    console.warn('[tickets] No se pudo desinscribir al piloto del core:', e.message);
    return { error: e.message };
  }
}

// Generar un ticket para un piloto (opcionalmente enlazado a un evento)
ticketsRouter.post('/', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { usuario_id, evento_id } = req.body;
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id requerido' });

    // Evitar duplicados: un mismo piloto no puede tener dos tickets en el mismo
    // evento (Hallazgo C). Si el kiosco crea con evento, se valida aquí.
    if (evento_id) {
      const { rows: dup } = await query(
        'SELECT id, numero FROM tickets WHERE usuario_id = $1 AND evento_id = $2',
        [usuario_id, evento_id]
      );
      if (dup.length) {
        return res.status(409).json({
          error: `El piloto ya tiene el ticket #${dup[0].numero} en este evento`,
          code: 'TICKET_DUPLICADO_EN_EVENTO',
        });
      }
    }

    // Número de ticket GLOBAL: lo asigna la secuencia de la BD (único entre
    // todos los eventos). Antes se calculaba MAX(numero)+1 por evento, lo que
    // permitía que un mismo número se repitiera en eventos distintos.
    const { rows } = await query(
      `INSERT INTO tickets (uuid_global, usuario_id, evento_id, estado)
       VALUES ($1, $2, $3, 'PENDIENTE')
       RETURNING id, uuid_global, usuario_id, evento_id, numero, estado, creado_en`,
      [uuid(), usuario_id, evento_id || null]
    );
    await auditar({
      req, accion: 'crear', entidad: 'ticket', entidad_id: rows[0].id,
      datos_despues: { numero: rows[0].numero, usuario_id, evento_id: evento_id || null },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Generar ticket PENDIENTE desde el kiosco de CLIENTE (self-service, sin
// sesión de taquilla/admin). Flujo: el piloto ya existe (buscado o registrado
// por /api/auth/*publico) y el kiosco emite su ticket. El ticket nace PENDIENTE
// y SIN evento: pagar y asignar a un evento siguen siendo operaciones de staff.
// ---------------------------------------------------------------------------
ticketsRouter.post('/publico', async (req, res) => {
  try {
    const usuarioId = Number(req.body && req.body.usuario_id);
    if (!usuarioId) return res.status(400).json({ error: 'usuario_id requerido' });

    // El piloto debe existir (y no ser bloqueado). No se permite fijar evento
    // aquí: la asignación es exclusiva de la taquilla (/asignar).
    const { rows: u } = await query('SELECT id, nombre, apellido, carnet FROM usuarios WHERE id = $1', [usuarioId]);
    if (!u.length) return res.status(404).json({ error: 'Piloto no encontrado' });

    // Número de ticket GLOBAL (secuencia de la BD): único entre todos los eventos.
    const { rows } = await query(
      `INSERT INTO tickets (uuid_global, usuario_id, evento_id, estado)
       VALUES ($1, $2, NULL, 'PENDIENTE')
       RETURNING id, uuid_global, usuario_id, evento_id, numero, estado, creado_en`,
      [uuid(), usuarioId]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar un ticket y su cola asociada (por si la taquilla se equivoca)
ticketsRouter.delete('/:id', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, evento_id, usuario_id, numero, estado FROM tickets WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    await query('DELETE FROM colas WHERE ticket_id = $1', [req.params.id]);
    await query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
    // Si el ticket estaba en un evento, desinscribir al piloto del core.
    if (rows[0].evento_id) {
      await quitarDelCore(rows[0].evento_id, rows[0].usuario_id);
    }
    await auditar({
      req, accion: 'eliminar', entidad: 'ticket', entidad_id: req.params.id,
      datos_antes: rows[0],
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Listar tickets (filtros opcionales: evento, estado, búsqueda)
ticketsRouter.get('/', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { evento_id, estado } = req.query;
    const params = [];
    let sql = `SELECT t.id, t.uuid_global, t.usuario_id, t.evento_id, t.numero, t.estado, t.creado_en, t.pagado_en,
                      t.kart_id, t.transponder_id,
                      u.nombre, u.apellido, u.carnet, u.email, u.telefono, u.foto, u.nacionalidad
               FROM tickets t JOIN usuarios u ON u.id = t.usuario_id WHERE 1=1`;
    if (evento_id) { params.push(evento_id); sql += ` AND t.evento_id = $${params.length}`; }
    if (estado) { params.push(estado); sql += ` AND t.estado = $${params.length}`; }
    sql += ' ORDER BY t.numero ASC';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ticketsRouter.get('/:id', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.numero, t.estado, t.evento_id, t.pagado_en, t.kart_id, t.transponder_id,
              u.id as usuario_id, u.nombre, u.apellido, u.carnet, u.email, u.telefono, u.foto, u.nacionalidad
       FROM tickets t JOIN usuarios u ON u.id = t.usuario_id WHERE t.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generar el QR de un ticket (para imprimir). Incluye datos del ticket,
// piloto y evento. Disponible para cualquier rol autenticado que consulte.
ticketsRouter.get('/:id/qr', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.numero, t.estado,
              u.uuid_global, u.nombre, u.apellido, u.carnet,
              e.nombre AS evento_nombre, e.fecha, e.hora, e.modo, e.tipo_carrera
       FROM tickets t
       JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN eventos e ON e.id = t.evento_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    const t = rows[0];
    const payload = JSON.stringify({
      ticket: t.numero,
      estado: t.estado,
      carnet: t.carnet,
      piloto: `${t.nombre} ${t.apellido}`.trim(),
      evento: t.evento_nombre || null,
      fecha: t.fecha || null,
      hora: t.hora || null,
    });
    const dataUrl = await QRCode.toDataURL(payload, { width: 300, margin: 1 });
    res.json({ qr: dataUrl, payload });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// QR del ticket público (kiosco de cliente self-service). Expone los datos del
// ticket (número, piloto, evento, fecha/hora) y su código QR para imprimir.
ticketsRouter.get('/:id/qr-publico', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.numero, t.estado,
              u.uuid_global, u.nombre, u.apellido, u.carnet,
              e.nombre AS evento_nombre, e.fecha, e.hora, e.modo, e.tipo_carrera
       FROM tickets t
       JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN eventos e ON e.id = t.evento_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    const t = rows[0];
    const payload = JSON.stringify({
      ticket: t.numero,
      estado: t.estado,
      carnet: t.carnet,
      piloto: `${t.nombre} ${t.apellido}`.trim(),
      evento: t.evento_nombre || null,
      fecha: t.fecha || null,
      hora: t.hora || null,
    });
    const dataUrl = await QRCode.toDataURL(payload, { width: 300, margin: 1 });
    res.json({ qr: dataUrl, payload, ticket: t });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cambiar a ASIGNADO (pagado) — sólo taquilla/admin. Un ticket FINALIZADO no
// puede volver a operarse (es terminal).
ticketsRouter.post('/:id/pagar', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { rows: t } = await query('SELECT estado FROM tickets WHERE id = $1', [req.params.id]);
    if (!t.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (ESTADOS_TERMINALES.has(t[0].estado)) {
      return res.status(400).json({ error: 'No se puede pagar un ticket terminado (FINALIZADO/USADO/REVOCADO)' });
    }
    // Máquina de estados: solo PENDIENTE -> ASIGNADO (taquilla cobra)
    if (t[0].estado !== 'PENDIENTE') {
      return res.status(400).json({ error: 'El ticket debe estar PENDIENTE para pagarse' });
    }
    const { rows } = await query(
      `UPDATE tickets SET estado = 'ASIGNADO', pagado_en = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    await auditar({
      req, accion: 'pagar', entidad: 'ticket', entidad_id: req.params.id,
      datos_antes: { estado: t[0].estado }, datos_despues: { estado: 'ASIGNADO' },
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Asignar a un evento — SOLO si está ASIGNADO (pagado). Un ticket FINALIZADO
// (terminal) no se puede reasignar a ningún evento.
ticketsRouter.post('/:id/asignar', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { evento_id } = req.body;
    if (!evento_id) return res.status(400).json({ error: 'evento_id requerido' });
    // Un evento FINALIZADO/CANCELADO/INSUFICIENTE no puede recibir tickets
    if (!(await eventoSeleccionable(evento_id))) {
      return res.status(400).json({ error: 'El evento no está disponible para asignar tickets (finalizado/cancelado/insuficiente)' });
    }
    const { rows: t } = await query('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
    if (!t.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (ESTADOS_TERMINALES.has(t[0].estado)) {
      return res.status(400).json({ error: 'No se puede reasignar un ticket terminado' });
    }
    // Estados que admiten asignación a un evento: ASIGNADO (pagado) o los que
    // volvieron a la lista de pendientes (AUSENTE / REZAGADO).
    if (!['ASIGNADO', 'AUSENTE', 'REZAGADO'].includes(t[0].estado)) {
      return res.status(400).json({ error: 'El ticket debe estar ASIGNADO, AUSENTE o REZAGADO para asignarse a un evento' });
    }
    // Evitar duplicados: el piloto ya tiene OTRO ticket en este evento.
    const { rows: dup } = await query(
      `SELECT id, numero FROM tickets
       WHERE usuario_id = (SELECT usuario_id FROM tickets WHERE id = $1)
         AND evento_id = $2 AND id <> $1`,
      [req.params.id, evento_id]
    );
    if (dup.length) {
      return res.status(409).json({
        error: `El piloto ya tiene el ticket #${dup[0].numero} asignado a este evento`,
        code: 'TICKET_DUPLICADO_EN_EVENTO',
      });
    }
    const { rows } = await query(
      `UPDATE tickets SET evento_id = $1, estado = 'ASIGNADO', asignado_en = now() WHERE id = $2 RETURNING *`,
      [evento_id, req.params.id]
    );
    // Crear la fila en `colas` (estado 'espera') para que el ticket entre a la
    // lista de carrera de vestidores. Sin esto, el piloto nunca aparece en el
    // flujo vestidor -> llamando -> preparado -> pista.
    await query(
      `INSERT INTO colas (ticket_id, evento_id, estado) VALUES ($1, $2, 'espera')
       ON CONFLICT (ticket_id) DO UPDATE SET evento_id = $2, estado = 'espera'`,
      [req.params.id, evento_id]
    );
    // Inscribir al piloto en el evento dentro del core para que el control de
    // carrera lo vea (de lo contrario no aparece en la card del evento).
    await inscribirEnCore(evento_id, t[0].usuario_id);
    await auditar({
      req, accion: 'asignar', entidad: 'ticket', entidad_id: req.params.id,
      datos_antes: { evento_id: t[0].evento_id, estado: t[0].estado },
      datos_despues: { evento_id: Number(evento_id), estado: 'ASIGNADO' },
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Asignar en bloque tickets ASIGNADOS (pagados) a un evento. Los no pagados y
// los FINALIZADOS se saltan para no romper la máquina de estados.
ticketsRouter.post('/asignar-bloque', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { evento_id, ticket_ids } = req.body;
    if (!evento_id) return res.status(400).json({ error: 'evento_id requerido' });
    if (!Array.isArray(ticket_ids) || !ticket_ids.length) {
      return res.status(400).json({ error: 'ticket_ids requerido' });
    }
    if (!(await eventoSeleccionable(evento_id))) {
      return res.status(400).json({ error: 'El evento no está disponible para asignar tickets (finalizado/cancelado/insuficiente)' });
    }
    const asignados = [];
    const omitidos = [];
    for (const id of ticket_ids) {
      const { rows: t } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
      // Se saltan tickets inexistentes, no pagados (PENDIENTE) y terminales
      // (FINALIZADO/USADO/REVOCADO) para no romper la máquina de estados.
      if (!t.length || ESTADOS_TERMINALES.has(t[0].estado) || t[0].estado !== 'ASIGNADO') {
        omitidos.push(id);
        continue;
      }
      await query(
        `UPDATE tickets SET evento_id = $1, estado = 'ASIGNADO', asignado_en = now() WHERE id = $2`,
        [evento_id, id]
      );
      await query(
        `INSERT INTO colas (ticket_id, evento_id, estado) VALUES ($1, $2, 'espera')
         ON CONFLICT (ticket_id) DO UPDATE SET evento_id = $2, estado = 'espera'`,
        [id, evento_id]
      );
      // Inscribir al piloto en el evento dentro del core (control de carrera).
      await inscribirEnCore(evento_id, t[0].usuario_id);
      asignados.push(id);
    }
    await auditar({
      req, accion: 'asignar_bloque', entidad: 'ticket', entidad_id: evento_id,
      datos_despues: { evento_id: Number(evento_id), asignados, omitidos },
    });
    res.json({ asignados: asignados.length, omitidos: omitidos.length, ticket_ids_asignados: asignados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reactivar un ticket AUSENTE o REZAGADO -> PENDIENTE (coordinador/admin/cajero).
// Permite reasignar a un piloto que no se presentó a otro evento.
ticketsRouter.post('/:id/reactivar', requireAuth, requireRole('admin', 'coordinador', 'cajero'), async (req, res) => {
  try {
    const { rows: t } = await query('SELECT id, estado, evento_id, kart_id, usuario_id FROM tickets WHERE id = $1', [req.params.id]);
    if (!t.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (!['AUSENTE', 'REZAGADO'].includes(t[0].estado)) {
      return res.status(400).json({ error: 'Solo un ticket AUSENTE o REZAGADO puede reactivarse a PENDIENTE' });
    }
    // Liberar kart, desvincular del evento anterior y dejar el ticket listo
    // para pagarse/asignarse de nuevo.
    if (t[0].kart_id) {
      await query(`UPDATE karts SET estado = 'disponible', actualizado_en = now() WHERE id = $1`, [t[0].kart_id]);
    }
    await query(
      `UPDATE tickets SET estado = 'PENDIENTE', evento_id = NULL, kart_id = NULL, asignado_en = NULL WHERE id = $1`,
      [req.params.id]
    );
    await query('DELETE FROM colas WHERE ticket_id = $1', [req.params.id]);
    // Desinscribir al piloto del evento dentro del core (card de carrera).
    await quitarDelCore(t[0].evento_id, t[0].usuario_id);
    res.json({ success: true, estado: 'PENDIENTE' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Quitar un ticket del evento al que estaba asignado (mantiene su estado de pago).
// Devuelve el ticket a "ASIGNADO sin evento" (o PENDIENTE si no estaba pagado),
// libera el kart y elimina su fila de colas para que no siga en la lista de carrera.
ticketsRouter.post('/:id/quitar', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { rows: t } = await query('SELECT id, estado, evento_id, kart_id, usuario_id FROM tickets WHERE id = $1', [req.params.id]);
    if (!t.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (!t[0].evento_id) return res.status(400).json({ error: 'El ticket no está asignado a ningún evento' });

    // Liberar el kart del ticket.
    if (t[0].kart_id) {
      await query(`UPDATE karts SET estado = 'disponible', actualizado_en = now() WHERE id = $1`, [t[0].kart_id]);
    }

    // Estado resultante: el que ya estaba pagado vuelve a ASIGNADO (sin evento);
    // si aún no se pagó, queda PENDIENTE.
    const nuevoEstado = t[0].estado === 'PENDIENTE' ? 'PENDIENTE' : 'ASIGNADO';
    await query(
      `UPDATE tickets SET estado = $1, evento_id = NULL, kart_id = NULL, asignado_en = NULL WHERE id = $2`,
      [nuevoEstado, req.params.id]
    );
    await query('DELETE FROM colas WHERE ticket_id = $1', [req.params.id]);
    // Desinscribir al piloto del evento dentro del core (card de carrera).
    await quitarDelCore(t[0].evento_id, t[0].usuario_id);
    await auditar({
      req, accion: 'quitar', entidad: 'ticket', entidad_id: req.params.id,
      datos_antes: { estado: t[0].estado, evento_id: t[0].evento_id },
      datos_despues: { estado: nuevoEstado, evento_id: null },
    });
    res.json({ success: true, estado: nuevoEstado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
