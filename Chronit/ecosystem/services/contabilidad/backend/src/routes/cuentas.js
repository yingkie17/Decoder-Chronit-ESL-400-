// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: cuentas destino y rotación de responsables
// -----------------------------------------------------------------------------
//   GET  /api/conta/cuentas                  -> cuentas + responsable vigente
//   POST /api/conta/cuentas                  -> crear cuenta (contador+)
//   PUT  /api/conta/cuentas/:id              -> editar cuenta (contador+)
//   GET  /api/conta/cuentas/:id/historial    -> historial de responsables
//   POST /api/conta/cuentas/:id/rotar        -> rotar responsable (supervisor+)
//
// ROTACIÓN: al rotar se cierra la asignación vigente (hasta = now()) y se abre
// una nueva. Las ventas pasadas conservan su `cuenta_responsable_id_snapshot`,
// por lo que el historial de responsables NO altera los reportes ya emitidos.
// =============================================================================
import { Router } from 'express';
import { query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';

export const cuentasRouter = Router();

const GESTION = ['contador', 'supervisor', 'admin'];

const SQL_CUENTAS = `
  SELECT c.*,
         r.usuario_id AS responsable_id,
         r.desde      AS responsable_desde,
         NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS responsable_nombre,
         u.carnet     AS responsable_carnet
    FROM conta_cuentas_destino c
    LEFT JOIN conta_cuenta_responsable_historial r
           ON r.cuenta_id = c.id AND r.hasta IS NULL
    LEFT JOIN usuarios u ON u.id = r.usuario_id
   ORDER BY c.es_efectivo_caja DESC, c.nombre
`;

cuentasRouter.get('/', requireAuth, async (req, res) => {
  try {
    let sql = SQL_CUENTAS;
    if (req.query.activas !== 'false') {
      sql = sql.replace('ORDER BY', 'WHERE c.activo = true ORDER BY');
    }
    const { rows } = await query(sql);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cuentasRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { nombre, tipo, titular, banco, numero, es_efectivo_caja, activo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await query(
      `INSERT INTO conta_cuentas_destino (nombre, tipo, titular, banco, numero, es_efectivo_caja, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nombre, tipo || 'qr', titular || null, banco || null, numero || null,
       !!es_efectivo_caja, activo !== false]
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'cuenta_destino', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

cuentasRouter.put('/:id', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const campos = ['nombre', 'tipo', 'titular', 'banco', 'numero', 'es_efectivo_caja', 'activo'];
    const sets = [];
    const params = [];
    for (const c of campos) {
      if (c in req.body) { params.push(req.body[c]); sets.push(`${c} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const { rows: antes } = await query('SELECT * FROM conta_cuentas_destino WHERE id = $1', [req.params.id]);
    if (!antes.length) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const { rows } = await query(
      `UPDATE conta_cuentas_destino SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params
    );
    await auditar(null, {
      usuario_id: req.user.id, accion: 'editar', entidad: 'cuenta_destino', entidad_id: req.params.id,
      datos_antes: antes[0], datos_despues: rows[0], ip: ipDe(req),
    });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cuentasRouter.get('/:id/historial', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT h.*,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS responsable_nombre,
              u.carnet AS responsable_carnet,
              NULLIF(TRIM(COALESCE(a.nombre,'') || ' ' || COALESCE(a.apellido,'')), '') AS asignado_por_nombre
         FROM conta_cuenta_responsable_historial h
         LEFT JOIN usuarios u ON u.id = h.usuario_id
         LEFT JOIN usuarios a ON a.id = h.asignado_por
        WHERE h.cuenta_id = $1
        ORDER BY h.desde DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rotar el responsable de una cuenta (cierra la vigente y abre la nueva).
cuentasRouter.post('/:id/rotar', requireAuth, requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { usuario_id, motivo } = req.body;
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id es obligatorio' });
    const resultado = await withTx(async (client) => {
      const { rows: cuenta } = await client.query('SELECT * FROM conta_cuentas_destino WHERE id = $1', [req.params.id]);
      if (!cuenta.length) { const e = new Error('Cuenta no encontrada'); e.status = 404; throw e; }
      const { rows: usuario } = await client.query('SELECT id, nombre, apellido, rol FROM usuarios WHERE id = $1', [usuario_id]);
      if (!usuario.length) { const e = new Error('Usuario no encontrado'); e.status = 404; throw e; }

      const { rows: previa } = await client.query(
        `UPDATE conta_cuenta_responsable_historial SET hasta = now()
          WHERE cuenta_id = $1 AND hasta IS NULL RETURNING *`,
        [req.params.id]
      );
      const { rows: nueva } = await client.query(
        `INSERT INTO conta_cuenta_responsable_historial (cuenta_id, usuario_id, motivo, asignado_por)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.id, usuario_id, motivo || 'Rotación de responsable', req.user.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'rotar', entidad: 'cuenta_destino', entidad_id: req.params.id,
        datos_antes: previa[0] || null, datos_despues: nueva[0], ip: ipDe(req),
      });
      return { cerrada: previa[0] || null, vigente: nueva[0], usuario: usuario[0] };
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
