// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: gestión de Karts / Transponders
// -----------------------------------------------------------------------------
// PROMPT FINAL: el cajero asigna karts a los pilotos al inscribirlos, valida que
// un kart NO se asigne a dos pilotos en el mismo evento y ve qué karts están
// disponibles.
//
// Rutas:
//   GET    /api/karts                 -> listar (con piloto/kart asignado)
//   POST   /api/karts                 -> crear kart
//   PUT    /api/karts/:id             -> editar kart
//   DELETE /api/karts/:id             -> eliminar kart (si no está en uso)
//   POST   /api/karts/:id/asignar     -> asignar a un ticket (piloto en evento)
//   POST   /api/karts/:id/desasignar  -> desasignar de cualquier ticket
//
// La unicidad de kart por evento se impone en la BD (migración 0006) y además
// se comprueba aquí para devolver un mensaje claro.
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { coreGet, corePost } from './eventos.js';

export const kartsRouter = Router();

const STAFF = ['admin', 'cajero', 'coordinador', 'desarrollador'];

// Estados terminales del ticket: un kart no puede asignarse a tickets en estos
// estados (no pueden competir).
const ESTADOS_TERMINALES = new Set(['FINALIZADO', 'USADO', 'REVOCADO']);

// -----------------------------------------------------------------------------
// Sincronización karts/transponders del core (control de carrera) -> PostgreSQL
// -----------------------------------------------------------------------------
// El core (Flask + SQLite) es la fuente de verdad del hardware: qué karts
// existen y qué transponder está montado en cada uno. PG guarda el espejo en la
// tabla `karts` para que el kiosco/vestidor/admin puedan listarlos y asignar
// pilotos (el vínculo piloto-kart se persiste en tickets.kart_id).
// Esta función vuelca los karts del core a PG sin pisar el estado de asignación
// de tickets (karts.estado), que lo gestiona el flujo asignar/desasignar.
async function syncCoreKartsToPg() {
  let coreKarts = [];
  try { coreKarts = await coreGet('/api/karts'); } catch { return 0; }
  if (!Array.isArray(coreKarts)) return 0;
  let n = 0;
  for (const k of coreKarts) {
    const numero = Number(k.kart_number);
    if (!Number.isFinite(numero)) continue;
    const transponder = k.transponder_id ? String(k.transponder_id) : null;
    // El transponder vive montado en un único kart: si el core lo movió a otro
    // kart, liberarlo del kart anterior en el espejo PG (la columna es UNIQUE).
    if (transponder) {
      await query('UPDATE karts SET transponder = NULL WHERE transponder = $1 AND numero <> $2', [transponder, numero]);
    }
    const { rowCount } = await query(
      `INSERT INTO karts (numero, transponder, estado, activo)
       VALUES ($1, $2, 'disponible', true)
       ON CONFLICT (numero) DO UPDATE SET
         transponder = EXCLUDED.transponder,
         actualizado_en = now()`,
      [numero, transponder]
    );
    if (rowCount) n += 1;
  }
  return n;
}

// Listar karts (desde el core, enriquecidos con la asignación piloto-kart)
kartsRouter.get('/', requireAuth, requireRole(...STAFF), async (_req, res) => {
  try {
    // Volcar los karts reales del core (control de carrera) al espejo PG.
    await syncCoreKartsToPg();
    // Descripciones de transponders del core para mostrarlas junto al id.
    const coreTp = new Map();
    try {
      const tps = await coreGet('/api/transponders/all');
      for (const t of Array.isArray(tps) ? tps : []) coreTp.set(String(t.id), t);
    } catch { /* core caído: seguimos con el espejo PG */ }

    const { rows } = await query(
      `SELECT
         k.id, k.numero, k.transponder, k.activo, k.estado, k.creado_en,
         t.id                                   AS ticket_asignado,
         t.evento_id                            AS evento_id,
         u.id                                   AS piloto_id,
         u.nombre                               AS piloto_nombre,
         u.apellido                             AS piloto_apellido,
         u.carnet                               AS piloto_carnet,
         e.nombre                               AS evento_nombre
       FROM karts k
       LEFT JOIN tickets t ON t.id = (
         SELECT t2.id FROM tickets t2
         WHERE t2.kart_id = k.id AND t2.evento_id IS NOT NULL
         ORDER BY CASE t2.estado WHEN 'ACTIVO' THEN 0 WHEN 'PREPARADO' THEN 1
                  WHEN 'LLAMANDO' THEN 2 WHEN 'ASIGNADO' THEN 3 ELSE 4 END,
           t2.creado_en DESC
         LIMIT 1
       )
       LEFT JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN eventos e  ON e.id = t.evento_id
       ORDER BY k.numero`
    );
    const result = rows.map((r) => {
      const tp = r.transponder != null ? coreTp.get(String(r.transponder)) : null;
      return { ...r, transponder_descripcion: tp ? tp.description : null };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Listar transponders (del core, con el kart y estado en que están montados).
// Reproduce la lista que se ve en "Registrar piloto" del control de carrera.
kartsRouter.get('/transponders', requireAuth, requireRole(...STAFF), async (_req, res) => {
  try {
    const [tps, karts] = await Promise.all([
      coreGet('/api/transponders/all'),
      coreGet('/api/karts'),
    ]);
    const kartByTp = {};      // transponder_id (karts) -> kart
    const kartByNumber = {};  // kart_number -> kart
    for (const k of Array.isArray(karts) ? karts : []) {
      kartByNumber[String(k.kart_number)] = k;
      if (k.transponder_id) kartByTp[String(k.transponder_id)] = k;
    }
    const list = (Array.isArray(tps) ? tps : []).map((t) => {
      // El kart se resuelve por dos vías: la columna karts.transponder_id
      // (la que usan los módulos de tickets) y el kart_id que el propio panel
      // de control de carrera guarda en transponders. Así la lista queda
      // sincronizada aunque una de las dos vías aún no se haya actualizado.
      const kart = kartByTp[String(t.id)] || (t.kart_id ? kartByNumber[String(t.kart_id)] : null);
      const kart_status = kart ? kart.status : null;
      const estado = !kart ? 'disponible' : kart_status === 'en_pista' ? 'en_pista' : kart_status === 'mantenimiento' ? 'mantenimiento' : 'montado';
      return {
        id: t.id,
        description: t.description || null,
        is_active: t.is_active !== 0,
        in_active_race: !!t.in_active_race,
        kart_id: kart ? String(kart.kart_number) : (t.kart_id ? String(t.kart_id) : null),
        kart_status,
        estado,
      };
    }).sort((a, b) => a.id - b.id);
    res.json(list);
  } catch (e) {
    // El core es la fuente de verdad del hardware: si no responde no se puede
    // devolver una lista fiable. Se informa el error en lugar de una lista
    // vacía silenciosa (que confundía con "no hay transponders").
    res.status(502).json({ error: `No se pudo leer los transponders del control de carrera: ${e.message}`, code: 'CORE_NO_DISPONIBLE' });
  }
});

// Vincular (montar) un transponder a un kart en el core (control de carrera).
kartsRouter.post('/:numero/vincular-transponder', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const { transponder_id } = req.body;
    if (transponder_id === undefined || transponder_id === null) {
      return res.status(400).json({ error: 'transponder_id es obligatorio' });
    }
    await corePost(`/api/karts/${req.params.numero}/mount-transponder`, { transponder_id });
    // Reflejar en el espejo PG: liberar el transponder de cualquier otro kart
    // (columna UNIQUE) y montarlo en el kart destino.
    await query(`UPDATE karts SET transponder = NULL WHERE transponder = $1 AND numero <> $2`, [String(transponder_id), Number(req.params.numero)]);
    await query(
      `INSERT INTO karts (numero, transponder, estado, activo)
       VALUES ($1, $2, 'disponible', true)
       ON CONFLICT (numero) DO UPDATE SET transponder = EXCLUDED.transponder, actualizado_en = now()`,
      [Number(req.params.numero), String(transponder_id)]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Desvincular (desmontar) el transponder de un kart en el core.
kartsRouter.post('/:numero/desvincular-transponder', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    await corePost(`/api/karts/${req.params.numero}/remove-transponder`, {});
    await query(`UPDATE karts SET transponder = NULL, actualizado_en = now() WHERE numero = $1`, [Number(req.params.numero)]);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Crear kart
kartsRouter.post('/', requireAuth, requireRole('admin', 'cajero'), async (req, res) => {
  try {
    const { numero, transponder } = req.body;
    if (numero === undefined || numero === null) {
      return res.status(400).json({ error: 'numero es obligatorio' });
    }
    const { rows } = await query(
      `INSERT INTO karts (numero, transponder) VALUES ($1, $2)
       ON CONFLICT (numero) DO NOTHING
       RETURNING *`,
      [numero, transponder || null]
    );
    if (!rows.length) {
      return res.status(409).json({ error: `El kart #${numero} ya existe` });
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Editar kart
kartsRouter.put('/:id', requireAuth, requireRole('admin', 'cajero'), async (req, res) => {
  try {
    const { numero, transponder, activo } = req.body;
    const { rows } = await query(
      `UPDATE karts
       SET numero = COALESCE($1, numero),
           transponder = COALESCE($2, transponder),
           activo = COALESCE($3, activo),
           actualizado_en = now()
       WHERE id = $4
       RETURNING *`,
      [numero, transponder, activo, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kart no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar kart (si no está asignado a un ticket)
kartsRouter.delete('/:id', requireAuth, requireRole('admin', 'cajero'), async (req, res) => {
  try {
    const { rows: usar } = await query('SELECT 1 FROM tickets WHERE kart_id = $1', [req.params.id]);
    if (usar.length) {
      return res.status(409).json({ error: 'No se puede eliminar: el kart está asignado a un piloto' });
    }
    const { rows } = await query('DELETE FROM karts WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Kart no encontrado' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Asignar kart a un ticket (piloto en evento). Si el ticket ya tiene kart
// asignado, se reemplaza (y se libera el anterior); pero jamás si otro ticket
// del mismo evento lo usa, ni si el kart ya está en otro evento no finalizado.
kartsRouter.post('/:id/asignar', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const { ticket_id } = req.body;
    if (!ticket_id) return res.status(400).json({ error: 'ticket_id es obligatorio' });

    const { rows: k } = await query('SELECT * FROM karts WHERE id = $1', [req.params.id]);
    if (!k.length) return res.status(404).json({ error: 'Kart no encontrado' });

    const { rows: tk } = await query('SELECT id, usuario_id, evento_id, kart_id, estado FROM tickets WHERE id = $1', [ticket_id]);
    if (!tk.length) return res.status(404).json({ error: 'Ticket no encontrado' });

    // Un kart no se asigna a tickets en estado terminal (no pueden competir).
    if (ESTADOS_TERMINALES.has(tk[0].estado)) {
      return res.status(400).json({ error: 'No se puede asignar kart a un ticket terminado (FINALIZADO/USADO/REVOCADO)' });
    }

    const eventoId = tk[0].evento_id;

    // Unicidad: el mismo kart no puede estar en otro ticket del mismo evento.
    const { rows: dup } = await query(
      `SELECT t.id, u.nombre FROM tickets t JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.kart_id = $1 AND t.evento_id IS NOT DISTINCT FROM $2 AND t.id <> $3`,
      [req.params.id, eventoId, ticket_id]
    );
    if (dup.length) {
      return res.status(409).json({
        error: `El kart #${k[0].numero} ya está asignado a ${dup[0].nombre} en este evento`,
        code: 'KART_YA_ASIGNADO_EN_EVENTO',
      });
    }

    // Ocupación cross-event: el kart no puede estar ya en un ticket de OTRO
    // evento que no esté finalizado/cancelado/insuficiente.
    const { rows: act } = await query(
      `SELECT t.id, e.nombre AS evento FROM tickets t
       JOIN eventos e ON e.id = t.evento_id
       WHERE t.kart_id = $1 AND t.id <> $2 AND t.evento_id IS NOT NULL
         AND e.estado NOT IN ('finalizado','cancelado','insuficiente')`,
      [req.params.id, ticket_id]
    );
    if (act.length) {
      return res.status(409).json({
        error: `El kart #${k[0].numero} ya está asignado en el evento "${act[0].evento}"`,
        code: 'KART_YA_ASIGNADO_OTRO_EVENTO',
      });
    }

    // Al reasignar, liberar el kart anterior del ticket (si era distinto).
    if (tk[0].kart_id && tk[0].kart_id !== Number(req.params.id)) {
      const { rows: uso } = await query('SELECT 1 FROM tickets WHERE kart_id = $1', [tk[0].kart_id]);
      if (!uso.length) {
        await query(`UPDATE karts SET estado = 'disponible', actualizado_en = now() WHERE id = $1`, [tk[0].kart_id]);
      }
    }

    // El transponder del piloto es el que trae montado el kart: al asignar el
    // kart se vincula automáticamente (un kart ya tiene su transponder).
    const tpRaw = k[0].transponder;
    const tpNum = tpRaw != null && tpRaw !== '' ? Number(tpRaw) : null;
    const { rows } = await query(
      `UPDATE tickets SET kart_id = $1, transponder_id = $2 WHERE id = $3 RETURNING id, evento_id, kart_id, transponder_id`,
      [req.params.id, Number.isInteger(tpNum) ? tpNum : null, ticket_id]
    );
    // Reflejar el estado del kart
    await query(`UPDATE karts SET estado = 'asignado', actualizado_en = now() WHERE id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Desasignar kart de cualquier ticket en el que esté en uso.
kartsRouter.post('/:id/desasignar', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const { rows } = await query('SELECT id FROM karts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Kart no encontrado' });

    await query('UPDATE tickets SET kart_id = NULL, transponder_id = NULL WHERE kart_id = $1', [req.params.id]);
    await query(`UPDATE karts SET estado = 'disponible', actualizado_en = now() WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
