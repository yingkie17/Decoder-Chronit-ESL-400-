// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: NÓMINA y ADELANTOS
// -----------------------------------------------------------------------------
//   NÓMINA
//     GET  /api/conta/nomina                 -> listar (filtros)
//     GET  /api/conta/nomina/:id             -> detalle + adelantos descontados
//     GET  /api/conta/nomina/:id/recibo.pdf  -> recibo de pago (PDF)
//     POST /api/conta/nomina                 -> generar (borrador)
//     POST /api/conta/nomina/:id/aprobar     -> aprobar
//     POST /api/conta/nomina/:id/pagar       -> pagar (asiento + propinas + adelantos)
//     POST /api/conta/nomina/:id/anular      -> anular (solo borrador)
//
//   ADELANTOS
//     GET  /api/conta/nomina/adelantos
//     POST /api/conta/nomina/adelantos
//     POST /api/conta/nomina/adelantos/:id/anular
//
// REGLA: total_pagar = sueldo_base + bonos + propinas_incluidas - descuentos
//        - adelantos. Se SNAPSHOTEA en la fila: el recibo y los reportes leen
//        ese valor y no recalculan.
// =============================================================================
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, FINANZAS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2, fechaISO } from '../utils/helpers.js';
import { asientoDeNomina } from '../utils/contabilidad.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const nominaRouter = Router();

const GESTION = ['contador', 'supervisor', 'admin'];

const mapNomina = (r) => ({
  ...r,
  sueldo_base: num(r.sueldo_base),
  bonos: num(r.bonos),
  propinas_incluidas: num(r.propinas_incluidas),
  descuentos: num(r.descuentos),
  adelantos: num(r.adelantos),
  total_pagar: num(r.total_pagar),
});

const nombreCompleto = `NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '')`;

// =============================================================================
// ADELANTOS (se declaran antes de /:id para que la ruta no se confunda)
// =============================================================================
nominaRouter.get('/adelantos', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const params = [];
    let sql = `
      SELECT a.*, ${nombreCompleto} AS usuario, u.carnet,
             ${nombreCompleto.replace(/u\./g, 'au.')} AS autorizado_por_nombre
        FROM conta_adelantos a
        JOIN usuarios u ON u.id = a.usuario_id
        LEFT JOIN usuarios au ON au.id = a.autorizado_por
       WHERE 1=1`;
    if (req.query.usuario_id) { params.push(req.query.usuario_id); sql += ` AND a.usuario_id = $${params.length}`; }
    if (req.query.estado) { params.push(req.query.estado); sql += ` AND a.estado = $${params.length}`; }
    sql += ' ORDER BY a.creado_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, monto: num(r.monto) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

nominaRouter.post('/adelantos', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { usuario_id, monto, motivo } = req.body || {};
    if (!usuario_id) return res.status(400).json({ error: 'El usuario es obligatorio' });
    const m = round2(num(monto));
    if (m <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    const sucursalId = await sucursalDePeticion(db, req);
    const { rows } = await query(
      `INSERT INTO conta_adelantos (sucursal_id, usuario_id, monto, motivo, estado, autorizado_por)
       VALUES ($1,$2,$3,$4,'pendiente',$5) RETURNING *`,
      [sucursalId, usuario_id, m, motivo || null, req.user.id]
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'crear', entidad: 'adelanto', entidad_id: rows[0].id,
      datos_despues: rows[0], ip: ipDe(req),
    });
    res.status(201).json({ ...rows[0], monto: num(rows[0].monto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

nominaRouter.post('/adelantos/:id/anular', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM conta_adelantos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Adelanto no encontrado' });
    if (rows[0].estado === 'descontado') {
      return res.status(409).json({ error: 'El adelanto ya fue descontado en una nómina' });
    }
    const { rows: upd } = await query(
      `UPDATE conta_adelantos SET estado = 'anulado' WHERE id = $1 RETURNING *`, [req.params.id]
    );
    await auditar(db, {
      usuario_id: req.user.id, accion: 'anular', entidad: 'adelanto', entidad_id: req.params.id,
      datos_antes: rows[0], datos_despues: upd[0], ip: ipDe(req),
    });
    res.json({ ...upd[0], monto: num(upd[0].monto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// NÓMINA
// =============================================================================
nominaRouter.get('/', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const params = [];
    let sql = `
      SELECT n.*, ${nombreCompleto} AS usuario, u.carnet
        FROM conta_nomina n
        JOIN usuarios u ON u.id = n.usuario_id
       WHERE 1=1`;
    if (req.query.usuario_id) { params.push(req.query.usuario_id); sql += ` AND n.usuario_id = $${params.length}`; }
    if (req.query.estado) { params.push(req.query.estado); sql += ` AND n.estado = $${params.length}`; }
    if (req.query.desde) { params.push(req.query.desde); sql += ` AND n.periodo_hasta >= $${params.length}::date`; }
    if (req.query.hasta) { params.push(req.query.hasta); sql += ` AND n.periodo_desde <= $${params.length}::date`; }
    sql += ' ORDER BY n.periodo_hasta DESC, n.id DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map(mapNomina));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

nominaRouter.get('/:id', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT n.*, ${nombreCompleto} AS usuario, u.carnet, u.rol
         FROM conta_nomina n JOIN usuarios u ON u.id = n.usuario_id WHERE n.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nómina no encontrada' });
    const { rows: adelantos } = await query(
      `SELECT id, monto, motivo, estado, creado_en FROM conta_adelantos WHERE nomina_id = $1 ORDER BY id`,
      [req.params.id]
    );
    res.json({
      nomina: mapNomina(rows[0]),
      adelantos: adelantos.map((a) => ({ ...a, monto: num(a.monto) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Genera la nómina de un usuario para un período (queda en borrador). */
nominaRouter.post('/', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const {
      usuario_id, periodo_desde, periodo_hasta, sueldo_base, bonos, descuentos,
      incluir_propinas = true, incluir_adelantos = true,
    } = req.body || {};
    if (!usuario_id) return res.status(400).json({ error: 'El usuario es obligatorio' });
    if (!periodo_desde || !periodo_hasta) {
      return res.status(400).json({ error: 'El período (desde y hasta) es obligatorio' });
    }
    const sucursalId = await sucursalDePeticion(db, req);

    const resultado = await withTx(async (client) => {
      // Propinas pendientes del usuario dentro del período.
      let propinas = 0;
      if (incluir_propinas) {
        const { rows } = await client.query(
          `SELECT COALESCE(SUM(pd.monto),0) AS total
             FROM conta_propina_distribucion pd
             JOIN conta_propinas p ON p.id = pd.propina_id
            WHERE pd.usuario_id = $1 AND pd.estado = 'pendiente'
              AND (p.creado_en AT TIME ZONE 'America/La_Paz')::date >= $2::date
              AND (p.creado_en AT TIME ZONE 'America/La_Paz')::date <= $3::date`,
          [usuario_id, periodo_desde, periodo_hasta]
        );
        propinas = round2(num(rows[0].total));
      }
      // Adelantos pendientes (se descuentan en esta nómina).
      let adelantos = 0;
      let idsAdelantos = [];
      if (incluir_adelantos) {
        const { rows } = await client.query(
          `SELECT id, monto FROM conta_adelantos
            WHERE usuario_id = $1 AND estado = 'pendiente' ORDER BY creado_en`,
          [usuario_id]
        );
        idsAdelantos = rows.map((r) => r.id);
        adelantos = round2(rows.reduce((a, r) => a + num(r.monto), 0));
      }

      const base = round2(num(sueldo_base));
      const bono = round2(num(bonos));
      const desc = round2(num(descuentos));
      const total = round2(base + bono + propinas - desc - adelantos);

      const { rows } = await client.query(
        `INSERT INTO conta_nomina
           (sucursal_id, usuario_id, periodo_desde, periodo_hasta, sueldo_base, bonos,
            propinas_incluidas, descuentos, adelantos, total_pagar, estado, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'borrador',$11) RETURNING *`,
        [sucursalId, usuario_id, periodo_desde, periodo_hasta, base, bono,
         propinas, desc, adelantos, total, req.user.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'nomina', entidad_id: rows[0].id,
        datos_despues: rows[0], ip: ipDe(req),
      });
      return { nomina: mapNomina(rows[0]), adelantos_incluidos: idsAdelantos };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

nominaRouter.post('/:id/aprobar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_nomina WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Nómina no encontrada'); e.status = 404; throw e; }
      if (rows[0].estado !== 'borrador') {
        const e = new Error(`La nómina está ${rows[0].estado}: solo se aprueban borradores`); e.status = 409; throw e;
      }
      const { rows: upd } = await client.query(
        `UPDATE conta_nomina SET estado = 'aprobada' WHERE id = $1 RETURNING *`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'aprobar', entidad: 'nomina', entidad_id: req.params.id,
        datos_antes: { estado: 'borrador' }, datos_despues: upd[0], ip: ipDe(req),
      });
      return mapNomina(upd[0]);
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Pagar: asiento contable + marca propinas pagadas + descuenta adelantos. */
nominaRouter.post('/:id/pagar', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { metodo_pago_id } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_nomina WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Nómina no encontrada'); e.status = 404; throw e; }
      const nomina = rows[0];
      if (nomina.estado === 'pagada') { const e = new Error('La nómina ya está pagada'); e.status = 409; throw e; }
      if (nomina.estado === 'anulada') { const e = new Error('La nómina está anulada'); e.status = 409; throw e; }

      const asiento = await asientoDeNomina(client, { nomina, usuario_id: req.user.id });

      // Las propinas incluidas quedan pagadas con la nómina.
      if (num(nomina.propinas_incluidas) > 0) {
        await client.query(
          `UPDATE conta_propina_distribucion pd
              SET estado = 'pagada', pagado_en = now(), pagado_por = $1
             FROM conta_propinas p
            WHERE p.id = pd.propina_id AND pd.usuario_id = $2 AND pd.estado = 'pendiente'
              AND (p.creado_en AT TIME ZONE 'America/La_Paz')::date >= $3::date
              AND (p.creado_en AT TIME ZONE 'America/La_Paz')::date <= $4::date`,
          [req.user.id, nomina.usuario_id, nomina.periodo_desde, nomina.periodo_hasta]
        );
      }
      // Los adelantos quedan descontados y ligados a esta nómina.
      if (num(nomina.adelantos) > 0) {
        await client.query(
          `UPDATE conta_adelantos SET estado = 'descontado', nomina_id = $1
            WHERE usuario_id = $2 AND estado = 'pendiente'`,
          [nomina.id, nomina.usuario_id]
        );
      }

      const { rows: upd } = await client.query(
        `UPDATE conta_nomina
            SET estado = 'pagada', pagado_en = now(), pagado_por = $1, asiento_id = $2
          WHERE id = $3 RETURNING *`,
        [req.user.id, asiento ? asiento.id : null, nomina.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'pagar', entidad: 'nomina', entidad_id: nomina.id,
        datos_antes: { estado: nomina.estado },
        datos_despues: { ...upd[0], metodo_pago_id: metodo_pago_id || null }, ip: ipDe(req),
      });
      return { nomina: mapNomina(upd[0]), asiento };
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

nominaRouter.post('/:id/anular', requireAuth, requireRole(...GESTION), async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM conta_nomina WHERE id = $1', [req.params.id]);
      if (!rows.length) { const e = new Error('Nómina no encontrada'); e.status = 404; throw e; }
      if (rows[0].estado === 'pagada') {
        const e = new Error('No se puede anular una nómina ya pagada (genere un ajuste)'); e.status = 409; throw e;
      }
      const { rows: upd } = await client.query(
        `UPDATE conta_nomina SET estado = 'anulada' WHERE id = $1 RETURNING *`, [req.params.id]
      );
      await auditar(client, {
        usuario_id: req.user.id, accion: 'anular', entidad: 'nomina', entidad_id: req.params.id,
        datos_antes: rows[0], datos_despues: { ...upd[0], motivo: motivo || null }, ip: ipDe(req),
      });
      return mapNomina(upd[0]);
    });
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Recibo de pago en PDF (server-side). */
nominaRouter.get('/:id/recibo.pdf', requireAuth, requireRole(...FINANZAS), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT n.*, ${nombreCompleto} AS usuario, u.carnet, u.rol
         FROM conta_nomina n JOIN usuarios u ON u.id = n.usuario_id WHERE n.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nómina no encontrada' });
    const n = mapNomina(rows[0]);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const partes = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="recibo-nomina-${n.id}.pdf"`);
      res.send(Buffer.concat(partes));
    });
    doc.on('error', (e) => res.status(500).json({ error: e.message }));

    const m = (v) => Number(v || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const linea = (etiqueta, valor, negrita = false) => {
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(etiqueta, 50, doc.y, { continued: true, width: 300 });
      doc.text(`BOB ${m(valor)}`, { align: 'right' });
    };

    doc.font('Helvetica-Bold').fontSize(16).text('CHRONIT — Recibo de Nómina');
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(`Recibo N° ${n.id} · Emitido ${new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz', hour12: false })}`);
    doc.moveDown(1).fillColor('#000');
    doc.fontSize(11).font('Helvetica-Bold').text(n.usuario || `Usuario #${n.usuario_id}`);
    doc.font('Helvetica').fontSize(10).text(`Carnet: ${n.carnet || '—'} · Rol: ${n.rol || '—'}`);
    doc.text(`Período: ${fechaISO(n.periodo_desde)} a ${fechaISO(n.periodo_hasta)}`);
    doc.text(`Estado: ${n.estado}`);
    doc.moveDown(1);

    linea('Sueldo base', n.sueldo_base);
    linea('Bonos', n.bonos);
    linea('Propinas incluidas', n.propinas_incluidas);
    linea('Descuentos', -n.descuentos);
    linea('Adelantos descontados', -n.adelantos);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').stroke();
    doc.moveDown(0.3);
    linea('TOTAL A PAGAR', n.total_pagar, true);

    doc.moveDown(3);
    doc.font('Helvetica').fontSize(8).fillColor('#666')
      .text('Documento generado automáticamente por CHRONIT. Los valores son snapshots del período y no se recalculan.', 50, doc.y, { width: 495 });
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
