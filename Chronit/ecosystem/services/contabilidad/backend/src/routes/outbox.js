// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: estado y control del outbox OFFLINE
// -----------------------------------------------------------------------------
//   GET  /api/conta/outbox              -> estado de la cola SQLite
//   POST /api/conta/outbox/reconciliar  -> forzar un ciclo de reconciliación
//
// La cola guarda las operaciones (ventas) que no pudieron llegar a PostgreSQL
// y se vacía automáticamente con el worker periódico.
// =============================================================================
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { estado } from '../db/outbox.js';
import { reconciliar } from '../utils/outbox-worker.js';

export const outboxRouter = Router();

outboxRouter.get('/', requireAuth, requireRole('supervisor', 'contador', 'admin'), (_req, res) => {
  try {
    res.json(estado());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

outboxRouter.post('/reconciliar', requireAuth, requireRole('supervisor', 'contador', 'admin'), async (_req, res) => {
  try {
    const r = await reconciliar();
    res.json({ ...r, estado: estado() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
