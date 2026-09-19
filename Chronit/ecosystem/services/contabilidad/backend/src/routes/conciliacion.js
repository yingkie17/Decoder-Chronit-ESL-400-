// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: conciliación bancaria de QR / transferencias
// -----------------------------------------------------------------------------
//   GET  /api/conta/conciliacion        -> grilla cuenta x día (sistema vs banco)
//   POST /api/conta/conciliacion        -> registrar monto reportado por el banco
//   GET  /api/conta/conciliacion/resumen-> saldo del sistema por cuenta (rango)
//
// REGLA: el "monto del sistema" se calcula SIEMPRE desde conta_pagos usando el
// snapshot de cuenta destino; nunca desde el catálogo vivo, para que rotar el
// responsable o renombrar una cuenta no altere periodos pasados.
//
// La fecha de negocio se resuelve en la zona horaria America/La_Paz.
// =============================================================================
import { Router } from 'express';
import { query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, fechaISO } from '../utils/helpers.js';

export const conciliacionRouter = Router();

const PUEDE_CONCILIAR = ['contador', 'supervisor', 'admin', 'desarrollador'];

/** Monto que el SISTEMA registró para una cuenta en una fecha (zona La Paz). */
export async function montoSistemaCuenta(db, cuentaId, fecha) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(pg.monto),0) AS total
       FROM conta_pagos pg
       JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
      WHERE pg.cuenta_destino_id = $1
        AND (pg.creado_en AT TIME ZONE 'America/La_Paz')::date = $2::date`,
    [cuentaId, fecha]
  );
  return num(rows[0]?.total);
}

// ---------------------------------------------------------------------------
// GET /api/conta/conciliacion — grilla cuenta x día
//   Muestra tanto los días con movimientos del sistema como los días ya
//   conciliados (aunque el sistema no tenga movimientos, p.ej. correcciones).
// ---------------------------------------------------------------------------
conciliacionRouter.get('/', requireAuth, async (req, res) => {
  try {
    const hasta = req.query.hasta || fechaISO();
    const desde = req.query.desde || hasta;
    const cuentaId = req.query.cuenta_id ? Number(req.query.cuenta_id) : null;

    const { rows } = await query(
      `WITH sistema AS (
         SELECT pg.cuenta_destino_id,
                (pg.creado_en AT TIME ZONE 'America/La_Paz')::date AS fecha,
                COALESCE(SUM(pg.monto),0) AS monto_sistema
           FROM conta_pagos pg
           JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
          WHERE pg.cuenta_destino_id IS NOT NULL
            AND (pg.creado_en AT TIME ZONE 'America/La_Paz')::date >= $1::date
            AND (pg.creado_en AT TIME ZONE 'America/La_Paz')::date <= $2::date
          GROUP BY 1,2
       )
       SELECT COALESCE(s.cuenta_destino_id, c.cuenta_destino_id) AS cuenta_destino_id,
              COALESCE(s.fecha, c.fecha)                          AS fecha,
              cd.nombre                                           AS cuenta_nombre,
              cd.tipo                                             AS cuenta_tipo,
              cd.titular                                          AS cuenta_titular,
              COALESCE(s.monto_sistema,0)                         AS monto_sistema,
              c.id                                                AS conciliacion_id,
              c.monto_reportado_banco,
              c.diferencia,
              c.observaciones,
              c.conciliado_en,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS conciliado_por_nombre
         FROM sistema s
         FULL OUTER JOIN conta_qr_conciliacion c
           ON c.cuenta_destino_id = s.cuenta_destino_id AND c.fecha = s.fecha
         LEFT JOIN conta_cuentas_destino cd ON cd.id = COALESCE(s.cuenta_destino_id, c.cuenta_destino_id)
         LEFT JOIN usuarios u ON u.id = c.conciliado_por
        WHERE ($3::int IS NULL OR COALESCE(s.cuenta_destino_id, c.cuenta_destino_id) = $3::int)
        ORDER BY COALESCE(s.fecha, c.fecha) DESC, cd.nombre`,
      [desde, hasta, cuentaId]
    );

    res.json({
      desde,
      hasta,
      filas: rows.map((r) => ({
        ...r,
        monto_sistema: num(r.monto_sistema),
        monto_reportado_banco: r.monto_reportado_banco == null ? null : num(r.monto_reportado_banco),
        diferencia: r.diferencia == null ? null : num(r.diferencia),
        conciliado: r.conciliacion_id != null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/conta/conciliacion/resumen — total del sistema por cuenta (rango)
// ---------------------------------------------------------------------------
conciliacionRouter.get('/resumen', requireAuth, async (req, res) => {
  try {
    const hasta = req.query.hasta || fechaISO();
    const desde = req.query.desde || hasta;
    const { rows } = await query(
      `SELECT cd.id, cd.nombre, cd.tipo,
              COALESCE(s.monto_sistema,0) AS monto_sistema,
              COALESCE(s.n_pagos,0)       AS n_pagos,
              h.usuario_id                AS responsable_id,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS responsable_nombre
         FROM conta_cuentas_destino cd
         LEFT JOIN (
           SELECT pg.cuenta_destino_id, SUM(pg.monto) AS monto_sistema, COUNT(*)::int AS n_pagos
             FROM conta_pagos pg
             JOIN conta_ventas v ON v.id = pg.venta_id AND v.anulada = false
            WHERE (pg.creado_en AT TIME ZONE 'America/La_Paz')::date >= $1::date
              AND (pg.creado_en AT TIME ZONE 'America/La_Paz')::date <= $2::date
            GROUP BY 1
         ) s ON s.cuenta_destino_id = cd.id
         LEFT JOIN conta_cuenta_responsable_historial h ON h.cuenta_id = cd.id AND h.hasta IS NULL
         LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE cd.activo = true
        ORDER BY cd.nombre`,
      [desde, hasta]
    );
    res.json({
      desde,
      hasta,
      cuentas: rows.map((r) => ({
        ...r,
        monto_sistema: num(r.monto_sistema),
        n_pagos: num(r.n_pagos),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/conta/conciliacion — registrar monto reportado por el banco
// ---------------------------------------------------------------------------
conciliacionRouter.post('/', requireAuth, requireRole(...PUEDE_CONCILIAR), async (req, res) => {
  try {
    const { cuenta_destino_id, fecha, monto_reportado_banco, observaciones } = req.body || {};
    if (!cuenta_destino_id) return res.status(400).json({ error: 'La cuenta destino es obligatoria' });
    if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });
    const reportado = num(monto_reportado_banco);

    const resultado = await withTx(async (client) => {
      const { rows: cta } = await client.query(
        'SELECT * FROM conta_cuentas_destino WHERE id = $1', [cuenta_destino_id]
      );
      if (!cta.length) { const e = new Error('Cuenta destino no encontrada'); e.status = 404; throw e; }

      const sistema = await montoSistemaCuenta(client, cuenta_destino_id, fecha);
      const diferencia = num(reportado - sistema);

      const { rows } = await client.query(
        `INSERT INTO conta_qr_conciliacion
           (cuenta_destino_id, fecha, monto_reportado_banco, monto_sistema, diferencia,
            observaciones, conciliado_por, conciliado_en)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7, now())
         ON CONFLICT (cuenta_destino_id, fecha) DO UPDATE
            SET monto_reportado_banco = EXCLUDED.monto_reportado_banco,
                monto_sistema         = EXCLUDED.monto_sistema,
                diferencia            = EXCLUDED.diferencia,
                observaciones         = EXCLUDED.observaciones,
                conciliado_por        = EXCLUDED.conciliado_por,
                conciliado_en         = now()
         RETURNING *`,
        [cuenta_destino_id, fecha, reportado, sistema, diferencia, observaciones || null, req.user.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'conciliar', entidad: 'qr_conciliacion', entidad_id: rows[0].id,
        datos_despues: rows[0], ip: ipDe(req),
      });
      return rows[0];
    });

    res.status(201).json({
      ...resultado,
      monto_reportado_banco: num(resultado.monto_reportado_banco),
      monto_sistema: num(resultado.monto_sistema),
      diferencia: num(resultado.diferencia),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
