// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: rutas de pilotos / perfil
//   GET  /api/pilotos                -> listar (admin/taquilla)
//   GET  /api/pilotos/:id            -> detalle de un piloto
//   GET  /api/pilotos/:id/historial  -> carrera a carrera (historial)
//   GET  /api/pilotos/:id/palmares   -> premios y logros (separado)
//   PUT  /api/pilotos/:id            -> editar perfil
// =============================================================================
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { flagOf, uuid } from '../utils/helpers.js';

export const pilotosRouter = Router();

pilotosRouter.get('/', requireAuth, requireRole('admin','cajero','coordinador'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, rol, creado_en
       FROM usuarios ORDER BY creado_en DESC`
    );
    res.json(rows.map((r) => ({ ...r, flag: flagOf(r.nacionalidad) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

pilotosRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, rol, creado_en
       FROM usuarios WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Piloto no encontrado' });
    res.json({ ...rows[0], flag: flagOf(rows[0].nacionalidad) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Historial de carreras (resultados)
pilotosRouter.get('/:id/historial', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, fecha, posicion, tiempo_total, mejor_vuelta, circuito, vuelta_rapida
       FROM resultados_carrera WHERE usuario_id = $1
       ORDER BY fecha DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Palmarés / premios / logros (separado del historial)
pilotosRouter.get('/:id/palmares', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, tipo, descripcion, evento_id_ref, fecha, imagen
       FROM logros WHERE usuario_id = $1
       ORDER BY fecha DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear un premio/logro para un piloto (solo admin/taquilla)
pilotosRouter.post('/:id/palmares', requireAuth, requireRole('admin','cajero'), async (req, res) => {
  try {
    const { tipo, descripcion, evento_id_ref, fecha, imagen } = req.body;
    if (!tipo || !descripcion) {
      return res.status(400).json({ error: 'tipo y descripcion son obligatorios' });
    }
    const { rows } = await query(
      `INSERT INTO logros (uuid_global, usuario_id, tipo, descripcion, evento_id_ref, fecha, imagen)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tipo, descripcion, evento_id_ref, fecha, imagen`,
      [uuid(), req.params.id, tipo, descripcion, evento_id_ref || null, fecha || null, imagen || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

pilotosRouter.put('/:id', requireAuth, async (req, res) => {
  try {
    // El personal (admin/cajero/coordinador) o el propio piloto puede editar.
    if (!['admin', 'cajero', 'coordinador', 'desarrollador'].includes(req.user.rol) &&
        Number(req.user.id) !== Number(req.params.id)) {
      return res.status(403).json({ error: 'No tienes permiso para editar este perfil' });
    }
    const { nombre, apellido, email, telefono, foto, nacionalidad, carnet } = req.body;
    // Si cambia el carnet, garantizar que no colisione con otro usuario.
    if (carnet) {
      const { rows: dup } = await query('SELECT id FROM usuarios WHERE carnet = $1 AND id <> $2', [carnet, req.params.id]);
      if (dup.length) return res.status(409).json({ error: 'Carnet ya registrado' });
    }
    const { rows } = await query(
      `UPDATE usuarios
       SET nombre = COALESCE($1, nombre),
           apellido = COALESCE($2, apellido),
           email = COALESCE($3, email),
           telefono = COALESCE($4, telefono),
           foto = COALESCE($5, foto),
           nacionalidad = COALESCE($6, nacionalidad),
           carnet = COALESCE($7, carnet),
           actualizado_en = now()
       WHERE id = $8
       RETURNING id, uuid_global, nombre, apellido, email, telefono, carnet, foto, nacionalidad, rol`,
      [nombre, apellido, email, telefono, foto, nacionalidad, carnet, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Piloto no encontrado' });
    res.json({ ...rows[0], flag: flagOf(rows[0].nacionalidad) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
