// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: TURNOS (agrupan sesiones de caja)
// -----------------------------------------------------------------------------
//   GET  /api/conta/turnos              -> listar turnos (filtros)
//   GET  /api/conta/turnos/actual       -> turno abierto de la sucursal
//   GET  /api/conta/turnos/:id          -> detalle + sesiones + totales
//   POST /api/conta/turnos/abrir        -> abrir turno (supervisor+)
//   POST /api/conta/turnos/:id/cerrar   -> cerrar turno (supervisor+)
//
// Reglas:
//   * Un solo turno ABIERTO por sucursal (índice único parcial en la BD).
//   * El turno lo abre y lo cierra un supervisor; agrupa varias sesiones de
//     caja (de distintos cajeros) de la misma jornada.
//   * Cerrar un turno NO cierra las sesiones de caja: solo lo marca cerrado
//     y deja un resumen consolidado.
//   * Los egresos pertenecen al turno a través de su sesión de caja
//     (conta_egresos.sesion_caja_id -> conta_sesiones_caja.turno_id).
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num } from '../utils/helpers.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const turnosRouter = Router();

const TZ = 'America/La_Paz';

/** Totales consolidados de un turno (sus sesiones de caja). */
export async function resumenTurno(conn, turnoId) {
  const { rows: t } = await conn.query('SELECT * FROM conta_turnos WHERE id = $1', [turnoId]);
  if (!t.length) return null;
  const turno = t[0];

  const { rows: sesiones } = await conn.query(
    `SELECT s.id, s.estado, s.monto_inicial, s.monto_esperado_efectivo,
            s.monto_contado_efectivo, s.diferencia, s.apertura_en, s.cierre_en,
            s.cajero_id,
            NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS cajero
       FROM conta_sesiones_caja s
       LEFT JOIN usuarios u ON u.id = s.cajero_id
      WHERE s.turno_id = $1
      ORDER BY s.apertura_en`,
    [turnoId]
  );

  const { rows: v } = await conn.query(
    `SELECT COUNT(*)::int AS n_ventas,
            COALESCE(SUM(total_final),0) AS total,
            COALESCE(SUM(descuento),0)   AS descuento,
            COALESCE(SUM(propina),0)     AS propina,
            COALESCE(SUM(iva_total),0)   AS iva
       FROM conta_ventas WHERE turno_id = $1 AND anulada = false`,
    [turnoId]
  );
  const { rows: e } = await conn.query(
    `SELECT COALESCE(SUM(eg.monto),0) AS total, COUNT(*)::int AS n
       FROM conta_egresos eg
       JOIN conta_sesiones_caja s ON s.id = eg.sesion_caja_id
      WHERE s.turno_id = $1`,
    [turnoId]
  );

  return {
    turno,
    sesiones: sesiones.map((s) => ({
      ...s,
      monto_inicial: num(s.monto_inicial),
      monto_esperado_efectivo: s.monto_esperado_efectivo == null ? null : num(s.monto_esperado_efectivo),
      monto_contado_efectivo: s.monto_contado_efectivo == null ? null : num(s.monto_contado_efectivo),
      diferencia: s.diferencia == null ? null : num(s.diferencia),
    })),
    totales: {
      n_sesiones: sesiones.length,
      n_ventas: num(v[0]?.n_ventas),
      ventas_total: num(v[0]?.total),
      descuento: num(v[0]?.descuento),
      propina: num(v[0]?.propina),
      iva: num(v[0]?.iva),
      egresos: num(e[0]?.total),
      egresos_n: num(e[0]?.n),
      diferencia_total: num(sesiones.reduce((a, s) => a + num(s.diferencia), 0)),
    },
  };
}

// ---------------------------------------------------------------------------
// Turno abierto de la sucursal
// ---------------------------------------------------------------------------
turnosRouter.get('/actual', requireAuth, async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows } = await query(
      `SELECT id FROM conta_turnos WHERE estado = 'abierto' AND sucursal_id = $1 LIMIT 1`,
      [sucursalId]
    );
    if (!rows.length) return res.json({ turno: null, resumen: null });
    res.json(await resumenTurno(db, rows[0].id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Listar
// ---------------------------------------------------------------------------
turnosRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { desde, hasta, estado } = req.query;
    const params = [];
    let sql = `
      SELECT t.*,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS supervisor,
             sc.nombre AS sucursal,
             (SELECT COUNT(*)::int FROM conta_sesiones_caja s WHERE s.turno_id = t.id) AS n_sesiones
        FROM conta_turnos t
        LEFT JOIN usuarios u ON u.id = t.supervisor_id
        LEFT JOIN conta_sucursales sc ON sc.id = t.sucursal_id
       WHERE 1=1`;
    if (estado) { params.push(estado); sql += ` AND t.estado = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND (t.apertura_en AT TIME ZONE '${TZ}')::date >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); sql += ` AND (t.apertura_en AT TIME ZONE '${TZ}')::date <= $${params.length}::date`; }
    sql += ' ORDER BY t.apertura_en DESC LIMIT 300';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------
turnosRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await resumenTurno(db, req.params.id);
    if (!r) return res.status(404).json({ error: 'Turno no encontrado' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Abrir turno (supervisor+)
// ---------------------------------------------------------------------------
turnosRouter.post('/abrir', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const sucursalId = await sucursalDePeticion(db, req);
    const { notas } = req.body || {};
    const turno = await withTx(async (client) => {
      const { rows: abiertos } = await client.query(
        `SELECT id FROM conta_turnos WHERE estado = 'abierto' AND sucursal_id = $1 LIMIT 1`,
        [sucursalId]
      );
      if (abiertos.length) {
        const e = new Error('Ya hay un turno abierto en esta sucursal. Ciérralo antes de abrir otro.');
        e.status = 409; throw e;
      }
      const { rows } = await client.query(
        `INSERT INTO conta_turnos (sucursal_id, supervisor_id, estado, notas)
         VALUES ($1,$2,'abierto',$3) RETURNING *`,
        [sucursalId, req.user.id, notas || null]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'turno', entidad_id: rows[0].id,
        datos_despues: rows[0], ip: ipDe(req),
      });
      return rows[0];
    });
    res.status(201).json(turno);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Cerrar turno (supervisor+)
// ---------------------------------------------------------------------------
turnosRouter.post('/:id/cerrar', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { notas } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_turnos WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Turno no encontrado'); e.status = 404; throw e; }
      if (rows[0].estado === 'cerrado') { const e = new Error('El turno ya está cerrado'); e.status = 409; throw e; }

      const { rows: abiertas } = await client.query(
        `SELECT COUNT(*)::int AS n FROM conta_sesiones_caja WHERE turno_id = $1 AND estado = 'abierta'`,
        [req.params.id]
      );
      if (num(abiertas[0]?.n) > 0) {
        const e = new Error(`Hay ${abiertas[0].n} sesión(es) de caja abiertas en este turno. Ciérralas antes.`);
        e.status = 409; throw e;
      }

      const { rows: upd } = await client.query(
        `UPDATE conta_turnos SET estado = 'cerrado', cierre_en = now(),
                notas = COALESCE($1, notas)
          WHERE id = $2 RETURNING *`,
        [notas || null, req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'cerrar', entidad: 'turno', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: upd[0], ip: ipDe(req),
      });
      return upd[0];
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
