// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: ANTICIPOS de clientes
// -----------------------------------------------------------------------------
//   GET  /api/conta/anticipos                 -> listar (filtros)
//   GET  /api/conta/anticipos/:id             -> detalle + aplicaciones
//   POST /api/conta/anticipos                 -> registrar (sin venta)
//   POST /api/conta/anticipos/:id/aplicar     -> aplicar a una venta (total/parcial)
//   POST /api/conta/anticipos/:id/devolver    -> devolver con nota de crédito
//
// Reglas:
//   * Se registra SIN venta: entra el dinero (efectivo/QR) y nace el pasivo
//     "Anticipos de Clientes" (asiento contable automático).
//   * Se aplica total o parcialmente a una venta futura: la venta acumula
//     monto_anticipo_aplicado (snapshot) y se cancela el pasivo.
//   * La devolución emite una NOTA DE CRÉDITO con reembolso efectivo/cortesía.
//   * estado: pendiente | aplicado | devuelto | vencido (el worker de alertas
//     marca 'vencido' automáticamente al pasar la fecha).
// =============================================================================
import { Router } from 'express';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, round2 } from '../utils/helpers.js';
import { registrarAsiento, asientoDeAnticipo, asientoDeAnticipoAplicado, CUENTAS, cuentaDeMetodo } from '../utils/contabilidad.js';
import { getConfigMap, valorConfig } from '../utils/finanzas.js';
import { sucursalDePeticion } from '../utils/sucursal.js';

export const anticiposRouter = Router();

const PUEDE_REGISTRAR = ['cajero', 'supervisor', 'contador', 'admin'];

const numeroNC = (id) => `NC-${String(id).padStart(6, '0')}`;

// ---------------------------------------------------------------------------
// Listar
// ---------------------------------------------------------------------------
anticiposRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { estado, cliente_id, q } = req.query;
    const params = [];
    let sql = `
      SELECT a.*, mp.nombre AS metodo_nombre, mp.tipo AS metodo_tipo,
             cd.nombre AS cuenta_nombre,
             NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre
        FROM conta_anticipos a
        LEFT JOIN conta_metodos_pago mp ON mp.id = a.metodo_pago_id
        LEFT JOIN conta_cuentas_destino cd ON cd.id = a.cuenta_destino_id
        LEFT JOIN usuarios u ON u.id = a.creado_por
       WHERE 1=1`;
    if (estado) { params.push(estado); sql += ` AND a.estado = $${params.length}`; }
    if (cliente_id) { params.push(cliente_id); sql += ` AND a.cliente_id = $${params.length}`; }
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (a.cliente_nombre ILIKE $${params.length} OR a.cliente_nit ILIKE $${params.length}
                    OR a.referencia_qr ILIKE $${params.length})`;
    }
    sql += ' ORDER BY a.creado_en DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json(rows.map((r) => ({
      ...r, monto: num(r.monto), monto_aplicado: num(r.monto_aplicado), saldo: num(r.saldo),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------
anticiposRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, mp.nombre AS metodo_nombre, mp.tipo AS metodo_tipo, cd.nombre AS cuenta_nombre,
              NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS creado_por_nombre
         FROM conta_anticipos a
         LEFT JOIN conta_metodos_pago mp ON mp.id = a.metodo_pago_id
         LEFT JOIN conta_cuentas_destino cd ON cd.id = a.cuenta_destino_id
         LEFT JOIN usuarios u ON u.id = a.creado_por
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Anticipo no encontrado' });
    const { rows: aplicaciones } = await query(
      `SELECT ap.*, v.numero_factura, v.total_final
         FROM conta_anticipo_aplicaciones ap
         LEFT JOIN conta_ventas v ON v.id = ap.venta_id
        WHERE ap.anticipo_id = $1 ORDER BY ap.id`,
      [req.params.id]
    );
    const { rows: ncs } = await query(
      `SELECT id, numero, monto, reembolso, estado, creado_en
         FROM conta_notas_credito WHERE anticipo_id = $1 ORDER BY id`,
      [req.params.id]
    );
    const a = rows[0];
    res.json({
      anticipo: { ...a, monto: num(a.monto), monto_aplicado: num(a.monto_aplicado), saldo: num(a.saldo) },
      aplicaciones: aplicaciones.map((x) => ({ ...x, monto_aplicado: num(x.monto_aplicado), total_final: num(x.total_final) })),
      notas_credito: ncs.map((n) => ({ ...n, monto: num(n.monto) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Registrar anticipo (sin venta)
// ---------------------------------------------------------------------------
anticiposRouter.post('/', requireAuth, requireRole(...PUEDE_REGISTRAR), async (req, res) => {
  try {
    const {
      cliente_id, cliente_nombre, cliente_nit, monto, metodo_pago_id,
      cuenta_destino_id, referencia_qr, vencimiento, moneda,
    } = req.body || {};
    const m = round2(num(monto));
    if (m <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    if (!metodo_pago_id) return res.status(400).json({ error: 'El método de pago es obligatorio' });
    const sucursalId = await sucursalDePeticion(db, req);

    const resultado = await withTx(async (client) => {
      const configMap = await getConfigMap(client);
      const { rows: mp } = await client.query('SELECT * FROM conta_metodos_pago WHERE id = $1', [metodo_pago_id]);
      if (!mp.length) { const e = new Error('Método de pago inválido'); e.status = 400; throw e; }
      const metodo = mp[0];
      const exigeCuenta = metodo.tipo === 'qr' || metodo.tipo === 'transferencia';
      if (exigeCuenta && !cuenta_destino_id) {
        const e = new Error(`El método ${metodo.nombre} exige seleccionar una cuenta destino.`);
        e.status = 400; e.code = 'CUENTA_REQUERIDA'; throw e;
      }

      const dias = num(valorConfig(configMap, 'anticipo_dias_vencimiento', 30));
      const venc = vencimiento || new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

      const { rows } = await client.query(
        `INSERT INTO conta_anticipos
           (sucursal_id, cliente_id, cliente_nombre, cliente_nit, monto, monto_aplicado, saldo,
            moneda, metodo_pago_id, cuenta_destino_id, referencia_qr, estado, vencimiento, creado_por)
         VALUES ($1,$2,$3,$4,$5,0,$5,$6,$7,$8,$9,'pendiente',$10,$11) RETURNING *`,
        [sucursalId, cliente_id || null, cliente_nombre || null, cliente_nit || null, m, moneda || 'BOB',
         metodo.id, cuenta_destino_id || null, referencia_qr || null, venc, req.user.id]
      );
      const anticipo = rows[0];

      const asiento = await asientoDeAnticipo(client, {
        anticipo: { ...anticipo, sucursal_id: sucursalId },
        tipoMetodo: metodo.tipo, usuario_id: req.user.id,
      });

      // Si entra efectivo a la caja abierta del usuario, se refleja en caja.
      let movimiento = null;
      if (metodo.tipo === 'efectivo') {
        const { rows: abierta } = await client.query(
          `SELECT id FROM conta_sesiones_caja WHERE cajero_id = $1 AND estado = 'abierta' LIMIT 1`,
          [req.user.id]
        );
        if (abierta.length) {
          const { rows: mv } = await client.query(
            `INSERT INTO conta_movimientos_caja
               (sesion_caja_id, tipo, monto, motivo, anticipo_id, creado_por, sucursal_id)
             VALUES ($1,'ingreso',$2,$3,$4,$5,$6) RETURNING *`,
            [abierta[0].id, m, `Anticipo de ${cliente_nombre || 'cliente'}`, anticipo.id, req.user.id, sucursalId]
          );
          movimiento = mv[0];
        }
      }

      await auditar(client, {
        usuario_id: req.user.id, accion: 'crear', entidad: 'anticipo', entidad_id: anticipo.id,
        datos_despues: anticipo, ip: ipDe(req),
      });

      return { anticipo, asiento, movimiento };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// ---------------------------------------------------------------------------
// Aplicar anticipo a una venta
// ---------------------------------------------------------------------------
anticiposRouter.post('/:id/aplicar', requireAuth, requireRole(...PUEDE_REGISTRAR), async (req, res) => {
  try {
    const { venta_id, monto } = req.body || {};
    if (!venta_id) return res.status(400).json({ error: 'La venta es obligatoria' });

    const resultado = await withTx(async (client) => {
      const { rows: a } = await client.query('SELECT * FROM conta_anticipos WHERE id = $1', [req.params.id]);
      if (!a.length) { const e = new Error('Anticipo no encontrado'); e.status = 404; throw e; }
      const anticipo = a[0];
      if (!['pendiente', 'vencido'].includes(anticipo.estado)) {
        const e = new Error(`El anticipo está ${anticipo.estado}: no se puede aplicar`); e.status = 409; throw e;
      }
      const saldo = round2(num(anticipo.saldo));
      if (saldo <= 0) { const e = new Error('El anticipo no tiene saldo disponible'); e.status = 409; throw e; }

      const { rows: v } = await client.query('SELECT * FROM conta_ventas WHERE id = $1', [venta_id]);
      if (!v.length) { const e = new Error('Venta no encontrada'); e.status = 404; throw e; }
      const venta = v[0];
      if (venta.anulada) { const e = new Error('La venta está anulada'); e.status = 409; throw e; }

      const yaAplicado = round2(num(venta.monto_anticipo_aplicado));
      const margen = round2(num(venta.total_final) - yaAplicado);
      if (margen <= 0) { const e = new Error('La venta ya está cubierta por anticipos'); e.status = 409; throw e; }

      let montoAplicar = round2(num(monto));
      if (montoAplicar <= 0) montoAplicar = Math.min(saldo, margen);
      if (montoAplicar > saldo + 0.02) {
        const e = new Error(`El monto (${montoAplicar}) supera el saldo del anticipo (${saldo})`);
        e.status = 400; throw e;
      }
      if (montoAplicar > margen + 0.02) {
        const e = new Error(`El monto (${montoAplicar}) supera lo que falta cobrar de la venta (${margen})`);
        e.status = 400; throw e;
      }

      const nuevoSaldo = round2(saldo - montoAplicar);
      const nuevoAplicado = round2(num(anticipo.monto_aplicado) + montoAplicar);
      await client.query(
        `UPDATE conta_anticipos SET monto_aplicado = $1, saldo = $2, estado = $3 WHERE id = $4`,
        [nuevoAplicado, nuevoSaldo, nuevoSaldo <= 0.009 ? 'aplicado' : 'pendiente', anticipo.id]
      );
      const { rows: ap } = await client.query(
        `INSERT INTO conta_anticipo_aplicaciones (anticipo_id, venta_id, monto_aplicado, creado_por)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [anticipo.id, venta.id, montoAplicar, req.user.id]
      );
      await client.query(
        `UPDATE conta_ventas SET monto_anticipo_aplicado = monto_anticipo_aplicado + $1 WHERE id = $2`,
        [montoAplicar, venta.id]
      );

      const { rows: mp } = await client.query(
        'SELECT tipo FROM conta_metodos_pago WHERE id = $1', [anticipo.metodo_pago_id]
      );
      const asiento = await asientoDeAnticipoAplicado(client, {
        anticipo, venta, monto: montoAplicar,
        tipoMetodo: mp[0]?.tipo || 'efectivo', usuario_id: req.user.id,
      });

      await auditar(client, {
        usuario_id: req.user.id, accion: 'aplicar', entidad: 'anticipo', entidad_id: anticipo.id,
        datos_antes: { saldo }, datos_despues: { saldo: nuevoSaldo, venta_id: venta.id, monto_aplicado: montoAplicar },
        ip: ipDe(req),
      });

      return {
        anticipo_id: anticipo.id, venta_id: venta.id,
        monto_aplicado: montoAplicar, saldo: nuevoSaldo,
        aplicacion: ap[0], asiento,
      };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Devolver anticipo (emite nota de crédito)
// ---------------------------------------------------------------------------
anticiposRouter.post('/:id/devolver', requireAuth, requireRole('supervisor', 'contador', 'admin'), async (req, res) => {
  try {
    const { motivo, reembolso, monto } = req.body || {};
    if (!motivo) return res.status(400).json({ error: 'El motivo de la devolución es obligatorio' });
    const reembolsoFinal = ['efectivo', 'cortesia', 'saldo_favor'].includes(reembolso) ? reembolso : 'efectivo';

    const resultado = await withTx(async (client) => {
      const { rows: a } = await client.query('SELECT * FROM conta_anticipos WHERE id = $1', [req.params.id]);
      if (!a.length) { const e = new Error('Anticipo no encontrado'); e.status = 404; throw e; }
      const anticipo = a[0];
      const saldo = round2(num(anticipo.saldo));
      if (saldo <= 0) { const e = new Error('El anticipo no tiene saldo por devolver'); e.status = 409; throw e; }

      let montoDevolver = round2(num(monto));
      if (montoDevolver <= 0) montoDevolver = saldo;
      if (montoDevolver > saldo + 0.02) {
        const e = new Error(`El monto (${montoDevolver}) supera el saldo del anticipo (${saldo})`);
        e.status = 400; throw e;
      }

      const { rows: nc } = await client.query(
        `INSERT INTO conta_notas_credito
           (sucursal_id, anticipo_id, motivo, tipo, reembolso, monto, moneda, estado, creado_por, autorizado_por)
         VALUES ($1,$2,$3,'parcial',$4,$5,$6,'emitida',$7,$7) RETURNING *`,
        [anticipo.sucursal_id, anticipo.id, motivo, reembolsoFinal, montoDevolver,
         anticipo.moneda || 'BOB', req.user.id]
      );
      const nota = nc[0];
      nota.numero = numeroNC(nota.id);
      await client.query('UPDATE conta_notas_credito SET numero = $1 WHERE id = $2', [nota.numero, nota.id]);

      const nuevoSaldo = round2(saldo - montoDevolver);
      await client.query(
        `UPDATE conta_anticipos SET saldo = $1, estado = $2 WHERE id = $3`,
        [nuevoSaldo, nuevoSaldo <= 0.009 ? 'devuelto' : 'pendiente', anticipo.id]
      );

      // Asiento: se cancela el pasivo contra la salida de dinero.
      const asiento = await registrarAsiento(client, {
        descripcion: `Devolución de anticipo ${nota.numero}`,
        referencia_tipo: 'nota_credito', referencia_id: nota.id,
        lineas: [
          { cuenta: CUENTAS.ANTICIPOS_CLIENTES, debe: montoDevolver, haber: 0, descripcion: 'Devolución de anticipo' },
          { cuenta: reembolsoFinal === 'saldo_favor' ? CUENTAS.ANTICIPOS_CLIENTES : CUENTAS.CAJA,
            debe: 0, haber: montoDevolver,
            descripcion: reembolsoFinal === 'saldo_favor' ? 'Saldo a favor' : 'Reembolso al cliente' },
        ],
        usuario_id: req.user.id, sucursal_id: anticipo.sucursal_id,
      });
      if (asiento) {
        await client.query('UPDATE conta_notas_credito SET asiento_id = $1 WHERE id = $2', [asiento.id, nota.id]);
      }

      await auditar(client, {
        usuario_id: req.user.id, accion: 'devolver', entidad: 'anticipo', entidad_id: anticipo.id,
        datos_antes: { saldo }, datos_despues: { saldo: nuevoSaldo, nota_id: nota.id, monto: montoDevolver },
        ip: ipDe(req),
      });

      return { anticipo_id: anticipo.id, nota, saldo: nuevoSaldo, asiento };
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
