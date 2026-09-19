// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: rutas de colas (llamada a vestidores)
//   GET  /api/colas?evento_id=&estado=   -> listar colas de un evento
//   POST /api/colas/llamar               -> llamar grupo de tickets a un vestidor
//   POST /api/colas/:id/ready            -> marcar ticket como Ready (PREPARADO)
//   POST /api/colas/:id/vestidor         -> asignar vestidor (1|2)
//   POST /api/colas/:id/ausente          -> AUSENTE temporal (sigue en el evento)
//   POST /api/colas/:id/rezagado         -> REZAGADO (fuera del evento, a pendientes)
//
// La `colas` lleva el estado operativo de vestidor (espera|llamado|ready|ausente)
// y refleja a la vez el ciclo de vida del ticket (fuente de verdad):
//   llamado -> ticket LLAMANDO / ready -> ticket PREPARADO
// Un ticket FINALIZADO es terminal y no puede operarse desde aquí.
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notifyPilot, broadcastDisplay } from '../notifications.js';
import { quitarDelCore } from './tickets.js';

export const colasRouter = Router();

// REQ 4: el vestidor es quien mueve el estado del EVENTO. Al llamar al primer
// grupo de un evento en 'pendiente', el evento pasa a 'llamando' (siguiente
// paso de la cadena pendiente -> llamando -> preparada -> activo -> finalizado).
// No pisa estados ya avanzados (preparada/activo/finalizado).
async function marcarEventoLlamando(eventoIds) {
  const ids = [...new Set((eventoIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return;
  await query(
    `UPDATE eventos SET estado = 'llamando', actualizado_en = now()
     WHERE id = ANY($1::int[]) AND estado = 'pendiente'`,
    [ids]
  );
}

// Listar colas de un evento (con datos de ticket y piloto)
colasRouter.get('/', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { evento_id, estado } = req.query;
    const params = [];
    let sql = `SELECT c.id, c.ticket_id, c.evento_id, c.estado, c.vestidor, c.llamada_en, c.ready_en,
                      t.numero AS ticket_numero, t.estado AS ticket_estado, t.kart_id, t.transponder_id,
                      u.nombre, u.apellido, u.carnet, u.foto, u.nacionalidad
               FROM colas c
               JOIN tickets t ON t.id = c.ticket_id
               JOIN usuarios u ON u.id = t.usuario_id
               WHERE 1=1`;
    if (evento_id) { params.push(evento_id); sql += ` AND c.evento_id = $${params.length}`; }
    if (estado) { params.push(estado); sql += ` AND c.estado = $${params.length}`; }
    sql += ` ORDER BY t.numero ASC`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear/actualizar cola para un ticket (cuando se asigna a un evento)
colasRouter.post('/', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { ticket_id, evento_id } = req.body;
    const { rows } = await query(
      `INSERT INTO colas (ticket_id, evento_id, estado)
       VALUES ($1, $2, 'espera')
       ON CONFLICT (ticket_id) DO UPDATE SET evento_id = $2
       RETURNING *`,
      [ticket_id, evento_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Llamar un grupo de tickets a un vestidor (manual, con pausas)
colasRouter.post('/llamar', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { ticket_ids, vestidor } = req.body;
    if (!Array.isArray(ticket_ids) || !ticket_ids.length) {
      return res.status(400).json({ error: 'ticket_ids requerido' });
    }
    if (![1, 2].includes(Number(vestidor))) {
      return res.status(400).json({ error: 'vestidor debe ser 1 o 2' });
    }
    const llamados = [];
    const eventoIds = [];
    for (const id of ticket_ids) {
      // Obtener datos de ticket+piloto para notificar y mostrar en pantalla
      // Se omite cualquier ticket en estado terminal (FINALIZADO).
      const { rows } = await query(
        `UPDATE colas SET estado = 'llamado', vestidor = $1, llamada_en = now()
         WHERE ticket_id = $2
           AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = $2 AND t.estado <> 'FINALIZADO')
         RETURNING id, ticket_id, vestidor`,
        [vestidor, id]
      );
      if (!rows.length) continue;
      // Reflejar la llamada en el ciclo de vida del ticket
      await query(`UPDATE tickets SET estado = 'LLAMANDO' WHERE id = $1`, [id]);
      const det = await query(
        `SELECT t.numero AS ticket_numero, t.uuid_global, t.evento_id, u.nombre, u.apellido, u.carnet,
                u.foto, u.nacionalidad, u.uuid_global AS usuario_uuid
         FROM tickets t JOIN usuarios u ON u.id = t.usuario_id
         WHERE t.id = $1`,
        [id]
      );
      if (det.rows.length) {
        const d = det.rows[0];
        eventoIds.push(d.evento_id);
        llamados.push({
          ticket_numero: d.ticket_numero, vestidor, nombre: d.nombre,
          apellido: d.apellido, carnet: d.carnet, foto: d.foto,
          nacionalidad: d.nacionalidad, estado: 'llamado',
        });
        // Notificar en tiempo real al piloto
        notifyPilot(d.usuario_uuid, 'llamado', {
          vestidor, ticket: d.ticket_numero, nombre: `${d.nombre} ${d.apellido}`,
        });
      }
    }
    // REQ 4: mover el/los eventos de 'pendiente' a 'llamando'.
    await marcarEventoLlamando(eventoIds).catch(() => {});
    // Difundir a la pantalla pública
    broadcastDisplay('colas', llamados);
    res.json({ success: true, llamados: llamados.length, vestidor, lista: llamados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Llamar automáticamente al SIGUIENTE grupo de tickets en 'espera' (vestidores)
// Toma los próximos N tickets (en orden por número) de un evento y los llama.
colasRouter.post('/siguiente', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { evento_id, vestidor, grupo } = req.body;
    if (!evento_id) return res.status(400).json({ error: 'evento_id requerido' });
    if (![1, 2].includes(Number(vestidor))) {
      return res.status(400).json({ error: 'vestidor debe ser 1 o 2' });
    }
    const tam = Number(grupo) || 5;
    // Próximos tickets NO llamados, en orden de número (excluye terminales)
    const { rows } = await query(
      `SELECT t.id AS ticket_id FROM colas c
       JOIN tickets t ON t.id = c.ticket_id
       WHERE c.evento_id = $1 AND c.estado = 'espera' AND t.estado <> 'FINALIZADO'
       ORDER BY t.numero ASC
       LIMIT $2`,
      [Number(evento_id), tam]
    );
    if (!rows.length) return res.json({ success: true, llamados: 0, lista: [] });

    const llamados = [];
    for (const r of rows) {
      const upd = await query(
        `UPDATE colas SET estado = 'llamado', vestidor = $1, llamada_en = now()
         WHERE ticket_id = $2 RETURNING id`,
        [Number(vestidor), r.ticket_id]
      );
      if (!upd.rows.length) continue;
      // Reflejar la llamada en el ciclo de vida del ticket
      await query(`UPDATE tickets SET estado = 'LLAMANDO' WHERE id = $1`, [r.ticket_id]);
      const det = await query(
        `SELECT t.numero AS ticket_numero, t.uuid_global, u.nombre, u.apellido, u.carnet,
                u.foto, u.nacionalidad, u.uuid_global AS usuario_uuid
         FROM tickets t JOIN usuarios u ON u.id = t.usuario_id
         WHERE t.id = $1`,
        [r.ticket_id]
      );
      if (det.rows.length) {
        const d = det.rows[0];
        llamados.push({
          ticket_numero: d.ticket_numero, vestidor: Number(vestidor), nombre: d.nombre,
          apellido: d.apellido, carnet: d.carnet, foto: d.foto,
          nacionalidad: d.nacionalidad, estado: 'llamado',
        });
        notifyPilot(d.usuario_uuid, 'llamado', {
          vestidor: Number(vestidor), ticket: d.ticket_numero, nombre: `${d.nombre} ${d.apellido}`,
        });
      }
    }
    // REQ 4: el evento llamado pasa de 'pendiente' a 'llamando'.
    await marcarEventoLlamando([evento_id]).catch(() => {});
    broadcastDisplay('colas', llamados);
    res.json({ success: true, llamados: llamados.length, vestidor: Number(vestidor), lista: llamados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar un ticket de la lista de carrera (cola + ticket)
colasRouter.delete('/:id', requireAuth, requireRole('admin','coordinador','cajero'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id FROM tickets WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    await query('DELETE FROM colas WHERE ticket_id = $1', [req.params.id]);
    await query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
    broadcastDisplay('colas', { tipo: 'eliminado', ticket_id: Number(req.params.id) });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Registrar un nuevo competidor en lugar de otro (reemplazo en la misma posición)
colasRouter.post('/:id/reemplazar', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { usuario_id } = req.body;
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id requerido' });
    const { rows: c } = await query(
      `SELECT col.ticket_id, col.evento_id, t.estado, t.kart_id FROM colas col JOIN tickets t ON t.id = col.ticket_id WHERE col.ticket_id = $1`,
      [req.params.id]
    );
    if (!c.length) return res.status(404).json({ error: 'Cola no encontrada' });
    if (['FINALIZADO', 'USADO', 'REVOCADO'].includes(c[0].estado)) {
      return res.status(400).json({ error: 'No se puede reemplazar un ticket terminado' });
    }
    // El nuevo piloto no puede tener ya un ticket en el mismo evento.
    const { rows: dup } = await query(
      'SELECT id, numero FROM tickets WHERE usuario_id = $1 AND evento_id = $2 AND id <> $3',
      [Number(usuario_id), c[0].evento_id, req.params.id]
    );
    if (dup.length) {
      return res.status(409).json({
        error: `El nuevo piloto ya tiene el ticket #${dup[0].numero} en este evento`,
        code: 'TICKET_DUPLICADO_EN_EVENTO',
      });
    }
    // Liberar el kart que tenía el piloto reemplazado.
    if (c[0].kart_id) {
      await query(`UPDATE karts SET estado = 'disponible', actualizado_en = now() WHERE id = $1`, [c[0].kart_id]);
    }
    // Reasignar el ticket al nuevo competidor (mantiene número y evento).
    const upd = await query(
      `UPDATE tickets SET usuario_id = $1, estado = 'ASIGNADO', kart_id = NULL, transponder_id = NULL WHERE id = $2 RETURNING id, numero`,
      [Number(usuario_id), req.params.id]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    // Resetear cola a espera: el nuevo competidor debe ser llamado
    await query(
      `UPDATE colas SET estado = 'espera', vestidor = NULL, llamada_en = NULL, ready_en = NULL WHERE ticket_id = $1`,
      [req.params.id]
    );
    broadcastDisplay('colas', { tipo: 'reemplazo', ticket_id: Number(req.params.id) });
    res.json({ success: true, ticket_id: Number(req.params.id), numero: upd.rows[0].numero });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar un piloto como AUSENTE (temporal): no se presentó pero PUEDE volver a
// ser llamado. El ticket queda en 'AUSENTE', conserva su vínculo al evento y su
// fila en `colas` (estado 'ausente'), y se libera el kart. No se elimina del
// evento (para eso está /rezagado).
colasRouter.post('/:id/ausente', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { rows: t } = await query('SELECT id, evento_id, kart_id, usuario_id FROM tickets WHERE id = $1', [req.params.id]);
    if (!t.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (t[0].kart_id) {
      await query('UPDATE karts SET estado = \'disponible\', actualizado_en = now() WHERE id = $1', [t[0].kart_id]);
    }
    // AUSENTE temporal: conserva evento y cola (puede rellamarse con /llamar).
    await query(`UPDATE tickets SET estado = 'AUSENTE', kart_id = NULL, transponder_id = NULL WHERE id = $1`, [req.params.id]);
    await query(`UPDATE colas SET estado = 'ausente', ready_en = NULL WHERE ticket_id = $1`, [req.params.id]);
    broadcastDisplay('colas', { tipo: 'ausente', ticket_id: Number(req.params.id) });
    res.json({ success: true, estado: 'AUSENTE' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar un piloto como REZAGADO: nunca se presentó, por lo que se ELIMINA del
// evento (y de la lista de carrera). Su ticket vuelve a la lista de tickets
// pendientes con estado terminal-operativo 'REZAGADO', listo para reasignarse a
// otro evento. Se libera el kart y se desinscribe del core.
colasRouter.post('/:id/rezagado', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { rows: t } = await query('SELECT id, evento_id, kart_id, usuario_id FROM tickets WHERE id = $1', [req.params.id]);
    if (!t.length) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (t[0].kart_id) {
      await query('UPDATE karts SET estado = \'disponible\', actualizado_en = now() WHERE id = $1', [t[0].kart_id]);
    }
    // Fuera del evento y de la lista de carrera; vuelve a la lista de pendientes.
    await query(
      `UPDATE tickets SET estado = 'REZAGADO', evento_id = NULL, kart_id = NULL, transponder_id = NULL, asignado_en = NULL WHERE id = $1`,
      [req.params.id]
    );
    await query('DELETE FROM colas WHERE ticket_id = $1', [req.params.id]);
    // Desinscribir al piloto del evento dentro del core (card de carrera).
    if (t[0].evento_id) {
      await quitarDelCore(t[0].evento_id, t[0].usuario_id);
    }
    broadcastDisplay('colas', { tipo: 'rezagado', ticket_id: Number(req.params.id) });
    res.json({ success: true, estado: 'REZAGADO' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Asignar vestidor a un ticket
colasRouter.post('/:id/vestidor', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { vestidor } = req.body;
    const { rows } = await query(
      `UPDATE colas c SET vestidor = $1
       FROM tickets t
       WHERE c.ticket_id = $2 AND t.id = c.ticket_id AND t.estado <> 'FINALIZADO'
       RETURNING c.id, c.ticket_id, c.vestidor`,
      [vestidor || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cola no encontrada o ticket finalizado' });
    broadcastDisplay('colas', { tipo: 'vestidor', ticket_id: rows[0].ticket_id, vestidor });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar/desmarcar Ready (listo para competir). Si ready=false, vuelve a 'llamado'.
// Acepta `kart_id` opcional para asignar el kart al piloto en el momento del Ready.
colasRouter.post('/:id/ready', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const ready = (req.body || {}).ready !== false;
    const kartId = (req.body || {}).kart_id ?? null;
    const { rows } = await query(
      'SELECT c.*, t.estado AS ticket_estado, t.evento_id, t.kart_id, t.transponder_id FROM colas c JOIN tickets t ON t.id = c.ticket_id WHERE c.ticket_id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cola no encontrada' });
    const ticketEstado = rows[0].ticket_estado;
    if (['FINALIZADO', 'USADO', 'REVOCADO'].includes(ticketEstado)) {
      return res.status(400).json({ error: 'No se puede modificar un ticket terminado' });
    }
    // Máquina de estados: para marcar listo, el ticket debe estar asignado y
    // llamado o, si se marca "todos listos", al menos ya asignado al evento.
    if (ready && !['LLAMANDO', 'ASIGNADO'].includes(ticketEstado)) {
      return res.status(400).json({ error: 'El ticket debe estar ASIGNADO o LLAMANDO antes de marcarse listo' });
    }
    // El KART es la ÚNICA fuente del transponder: al asignar el kart se vincula
    // automáticamente el transponder que trae montado (no se pide dos veces).
    if (ready) {
      const kartEfectivo = kartId != null ? Number(kartId) : rows[0].kart_id;
      if (!kartEfectivo) {
        return res.status(409).json({
          error: 'El piloto no tiene kart asignado. Selecciona un kart antes de marcarlo listo.',
          code: 'SIN_KART',
        });
      }
      const { rows: k } = await query('SELECT id, numero, transponder FROM karts WHERE id = $1', [kartEfectivo]);
      if (!k.length) return res.status(404).json({ error: 'Kart no encontrado' });
      // El kart no puede estar en otro ticket del mismo evento ni en otro evento activo.
      const { rows: dup } = await query(
        `SELECT t.id FROM tickets t WHERE t.kart_id = $1 AND t.evento_id IS NOT DISTINCT FROM $2 AND t.id <> $3`,
        [kartEfectivo, rows[0].evento_id, req.params.id]
      );
      if (dup.length) {
        return res.status(409).json({ error: `El kart #${k[0].numero} ya está asignado en este evento`, code: 'KART_YA_ASIGNADO_EN_EVENTO' });
      }
      const { rows: act } = await query(
        `SELECT 1 FROM tickets t JOIN eventos e ON e.id = t.evento_id
         WHERE t.kart_id = $1 AND t.id <> $2 AND t.evento_id IS NOT NULL
           AND e.estado NOT IN ('finalizado','cancelado','insuficiente')`,
        [kartEfectivo, req.params.id]
      );
      if (act.length) {
        return res.status(409).json({ error: `El kart #${k[0].numero} ya está asignado en otro evento activo`, code: 'KART_YA_ASIGNADO_OTRO_EVENTO' });
      }
      // El transponder del piloto es el que trae montado el kart (código del core).
      const tpNum = k[0].transponder != null && k[0].transponder !== '' ? Number(k[0].transponder) : null;
      if (!Number.isInteger(tpNum)) {
        return res.status(409).json({
          error: `El kart #${k[0].numero} no tiene transponder vinculado en control de carrera.`,
          code: 'KART_SIN_TRANSPONDER',
        });
      }
      // Liberar el kart anterior del ticket (si era distinto)
      if (rows[0].kart_id && rows[0].kart_id !== kartEfectivo) {
        const { rows: uso } = await query('SELECT 1 FROM tickets WHERE kart_id = $1', [rows[0].kart_id]);
        if (!uso.length) {
          await query(`UPDATE karts SET estado = 'disponible', actualizado_en = now() WHERE id = $1`, [rows[0].kart_id]);
        }
      }
      await query(`UPDATE tickets SET kart_id = $1, transponder_id = $2 WHERE id = $3`, [kartEfectivo, tpNum, req.params.id]);
      await query(`UPDATE karts SET estado = 'asignado', actualizado_en = now() WHERE id = $1`, [kartEfectivo]);
    }
    let estado = 'ready';
    // El ticket refleja el nuevo estado de su ciclo de vida
    let ticketEstado2 = 'PREPARADO';
    if (!ready) {
      // Si se desmarca, vuelve a 'llamado' si ya tenía vestidor; si no, a 'espera'
      estado = rows[0].vestidor ? 'llamado' : 'espera';
      ticketEstado2 = rows[0].vestidor ? 'LLAMANDO' : 'ASIGNADO';
    }
    const upd = await query(
      `UPDATE colas SET estado = $1, ready_en = CASE WHEN $1 = 'ready' THEN now() ELSE NULL END WHERE ticket_id = $2 RETURNING id, ticket_id, vestidor, estado`,
      [estado, req.params.id]
    );
    await query(`UPDATE tickets SET estado = $1 WHERE id = $2`, [ticketEstado2, req.params.id]);
    broadcastDisplay('colas', { tipo: ready ? 'ready' : 'unready', ticket_id: upd.rows[0].ticket_id });
    res.json(upd.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
