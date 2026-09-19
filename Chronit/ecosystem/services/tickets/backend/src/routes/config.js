// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: rutas de configuración de pantalla
//   GET  /api/config/pantalla          -> listar items del carrusel (activos)
//   POST /api/config/pantalla          -> crear item (imagen|video), solo admin
//   PUT  /api/config/pantalla/:id      -> editar (url, duración, activo, orden)
//   DELETE /api/config/pantalla/:id    -> eliminar
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const configRouter = Router();

// Listar (admin ve todos; la pantalla pública usa ?activos=true sin auth)
configRouter.get('/', async (req, res) => {
  try {
    const { activos } = req.query;
    let sql = 'SELECT * FROM config_pantalla';
    const params = [];
    if (activos === 'true') {
      sql += " WHERE activo = true";
    }
    sql += ' ORDER BY orden ASC';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

configRouter.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { tipo, url, duracion_seg, activo, orden } = req.body;
    if (!['imagen', 'video'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo debe ser imagen o video' });
    }
    const { rows } = await query(
      `INSERT INTO config_pantalla (tipo, url, duracion_seg, activo, orden)
       VALUES ($1, $2, $3, COALESCE($4, true), COALESCE($5, 0))
       RETURNING *`,
      [tipo, url, duracion_seg ?? 5, activo, orden]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

configRouter.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { tipo, url, duracion_seg, activo, orden } = req.body;
    const { rows } = await query(
      `UPDATE config_pantalla
       SET tipo = COALESCE($1, tipo), url = COALESCE($2, url),
           duracion_seg = COALESCE($3, duracion_seg),
           activo = COALESCE($4, activo), orden = COALESCE($5, orden)
       WHERE id = $6 RETURNING *`,
      [tipo, url, duracion_seg, activo, orden, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

configRouter.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM config_pantalla WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
