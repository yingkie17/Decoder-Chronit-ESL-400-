// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: subida de fotos + QR / carné
//   POST /api/uploads/photo            -> subir foto de piloto (multipart)
//   GET  /api/pilotos/:id/qr           -> generar QR del piloto (data URL PNG)
//   GET  /api/pilotos/:id/carne        -> datos del carné (para imprimir)
// =============================================================================
import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { flagOf } from '../utils/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = join(__dirname, '..', '..', 'uploads');

// Configurar almacenamiento de fotos de pilotos
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `pilot-${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => cb(null, /image\/(jpeg|png|webp)/.test(file.mimetype)),
});

export const uploadsRouter = Router();

// Subir imagen y actualizar la foto del usuario
uploadsRouter.post(
  '/photo',
  requireAuth,
  requireRole('admin','cajero'),
  upload.single('photo'),
  async (req, res) => {
    try {
      const { usuario_id } = req.body;
      if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
      if (!usuario_id) return res.status(400).json({ error: 'usuario_id requerido' });
      const url = `/uploads/${req.file.filename}`;
      const { rows } = await query(
        'UPDATE usuarios SET foto = $1, actualizado_en = now() WHERE id = $2 RETURNING id, foto',
        [url, usuario_id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
      res.status(201).json({ foto: url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// Generar QR del piloto (PNG en data URL)
uploadsRouter.get('/pilotos/:id/qr', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, uuid_global, nombre, apellido, carnet FROM usuarios WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Piloto no encontrado' });
    const data = JSON.stringify({
      uuid: rows[0].uuid_global,
      carnet: rows[0].carnet,
      nombre: `${rows[0].nombre} ${rows[0].apellido}`.trim(),
    });
    const dataUrl = await QRCode.toDataURL(data, { width: 300, margin: 1 });
    res.json({ qr: dataUrl, payload: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Datos del carné del piloto (para imprimir / pantalla kiosco)
uploadsRouter.get('/pilotos/:id/carne', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, uuid_global, nombre, apellido, carnet, email, telefono, foto, nacionalidad, rol
       FROM usuarios WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Piloto no encontrado' });
    const u = rows[0];
    res.json({ ...u, flag: flagOf(u.nacionalidad) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
