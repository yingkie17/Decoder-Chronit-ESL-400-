// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: BACKUP FISCAL
// -----------------------------------------------------------------------------
//   POST /api/conta/backup/ejecutar    -> respaldo manual (pg_dump + GPG + rclone)
//   GET  /api/conta/backup/estado      -> último respaldo OK, lista y retención
//   GET  /api/conta/backup/config      -> configuración de respaldo
//   PUT  /api/conta/backup/config      -> actualizar (solo admin/desarrollador)
//   POST /api/conta/backup/verificar   -> prueba de restauración del último OK
//
// CÓMO FUNCIONA
//   1. `pg_dump --format=custom` vuelca la base a un archivo temporal.
//   2. Si `backup_gpg_habilitado` y hay passphrase (BACKUP_GPG_PASSPHRASE), se
//      cifra simétricamente (AES256) con GPG y se borra el temporal.
//   3. Si hay destino externo (`backup_destino`, ej. `b2:chronit-backups`), se
//      copia con rclone.
//   4. Se registra en el manifiesto (JSON) y en la auditoría.
//
// RETENCIÓN: se eliminan los respaldos más antiguos que
// `backup_retention_years` (por defecto 8 años, normativa boliviana).
//
// REQUISITOS: `postgresql-client`, `gnupg` y `rclone` están instalados en la
// imagen (ver Dockerfile). Si falta alguna herramienta, el endpoint devuelve un
// error explicativo en vez de fallar en silencio.
// =============================================================================
import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { db, query, withTx } from '../db/pool.js';
import { requireAuth, requireRole, GESTORES_USUARIOS } from '../middleware/auth.js';
import { auditar, ipDe } from '../utils/audit.js';
import { num, fechaISO } from '../utils/helpers.js';
import { getConfigMap, valorConfig } from '../utils/finanzas.js';

export const backupRouter = Router();

const DIR = process.env.BACKUP_DIR || '/app/backups';
const MANIFIESTO = path.join(DIR, 'manifest.json');
const PASSPHRASE = process.env.BACKUP_GPG_PASSPHRASE || '';
const TZ = 'America/La_Paz';

// =============================================================================
// Utilidades de proceso / archivo
// =============================================================================
/** Ejecuta un comando y devuelve { code, stdout, stderr }. */
function ejecutar(cmd, args, { stdin = null } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e.message, noExiste: true });
      return;
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => resolve({ code: -1, stdout: out, stderr: e.message, noExiste: e.code === 'ENOENT' }));
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
    if (stdin != null) { child.stdin.write(stdin); child.stdin.end(); } else { child.stdin.end(); }
  });
}

/** ¿Está disponible el binario? */
async function existeBinario(bin) {
  const r = await ejecutar(bin, ['--version']);
  return r.code === 0;
}

function leerManifiesto() {
  try {
    return JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'));
  } catch {
    return { respaldos: [] };
  }
}

function guardarManifiesto(m) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(MANIFIESTO, JSON.stringify(m, null, 2));
}

async function configBackup(conn) {
  const cfg = await getConfigMap(conn);
  return {
    retencion_anios: num(valorConfig(cfg, 'backup_retention_years', 8)),
    hora: String(valorConfig(cfg, 'backup_hora', '02:00')),
    destino: valorConfig(cfg, 'backup_destino', null) || process.env.BACKUP_RCLONE_REMOTE || null,
    gpg: valorConfig(cfg, 'backup_gpg_habilitado', true) !== false,
  };
}

// =============================================================================
// RESPALDO
// =============================================================================
/**
 * Ejecuta el respaldo. Devuelve el registro del manifiesto.
 * `manual` solo distingue el origen en la auditoría.
 */
export async function ejecutarBackup(db, { usuario_id = null, manual = true, ip = null } = {}) {
  const cfg = await configBackup(db);
  fs.mkdirSync(DIR, { recursive: true });

  const url = process.env.DATABASE_URL;
  if (!url) { const e = new Error('Falta DATABASE_URL: no se puede volcar la base'); e.status = 500; throw e; }

  const tienePgDump = await existeBinario('pg_dump');
  if (!tienePgDump) {
    const e = new Error('pg_dump no está disponible en el contenedor (instale postgresql-client)');
    e.status = 503; e.code = 'PG_DUMP_AUSENTE';
    throw e;
  }

  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `chronit_${fechaISO()}_${sello}`;
  const tmp = path.join(DIR, `.${base}.dump`);
  const cifrar = cfg.gpg && !!PASSPHRASE;
  const destino = path.join(DIR, cifrar ? `${base}.dump.gpg` : `${base}.dump`);

  // 1) pg_dump
  const dump = await ejecutar('pg_dump', ['-d', url, '--format=custom', '--no-owner', '--file', tmp]);
  if (dump.code !== 0) {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    const e = new Error(`pg_dump falló: ${dump.stderr.trim() || dump.stdout.trim() || 'error desconocido'}`);
    e.status = 500; throw e;
  }

  // 2) GPG (simétrico, AES256) — la passphrase va por stdin, nunca por argv
  if (cifrar) {
    const gpg = await ejecutar('gpg', [
      '--batch', '--yes', '--quiet', '--symmetric', '--cipher-algo', 'AES256',
      '--passphrase-fd', '0', '--output', destino, tmp,
    ], { stdin: PASSPHRASE });
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    if (gpg.code !== 0) {
      const e = new Error(`gpg falló al cifrar: ${gpg.stderr.trim() || 'error desconocido'}`);
      e.status = 500; throw e;
    }
  } else {
    fs.renameSync(tmp, destino);
  }

  const stat = fs.statSync(destino);
  const sha256 = createHash('sha256').update(fs.readFileSync(destino)).digest('hex');
  const registro = {
    archivo: path.basename(destino),
    ruta: destino,
    fecha: new Date().toISOString(),
    fecha_local: fechaISO(),
    bytes: stat.size,
    cifrado: cifrar,
    sha256,
    destino_externo: cfg.destino,
    subido_externo: false,
    manual,
    usuario_id,
  };

  // 3) Copia externa (rclone)
  if (cfg.destino) {
    const tieneRclone = await existeBinario('rclone');
    if (tieneRclone) {
      const r = await ejecutar('rclone', ['copy', destino, cfg.destino, '--no-traverse']);
      registro.subido_externo = r.code === 0;
      if (r.code !== 0) registro.error_externo = r.stderr.trim().slice(0, 500);
    } else {
      registro.error_externo = 'rclone no está disponible en el contenedor';
    }
  }

  // 4) Manifiesto + retención
  const m = leerManifiesto();
  m.respaldos = m.respaldos || [];
  m.respaldos.unshift(registro);
  const limite = Date.now() - cfg.retencion_anios * 365 * 86400000;
  const vigentes = [];
  for (const r of m.respaldos) {
    if (new Date(r.fecha).getTime() < limite) {
      try { fs.unlinkSync(r.ruta); } catch { /* ya no está */ }
    } else {
      vigentes.push(r);
    }
  }
  m.respaldos = vigentes.slice(0, 400);
  m.ultimo_ok = registro;
  guardarManifiesto(m);

  await auditar(db, {
    usuario_id, accion: 'backup', entidad: 'sistema', entidad_id: registro.archivo,
    datos_despues: { ...registro, ruta: undefined }, ip,
  });

  return registro;
}

// =============================================================================
// RUTAS
// =============================================================================
backupRouter.post('/ejecutar', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const registro = await ejecutarBackup(db, { usuario_id: req.user.id, manual: true, ip: ipDe(req) });
    res.status(201).json({ ok: true, respaldo: registro });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

backupRouter.get('/estado', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const cfg = await configBackup(db);
    const m = leerManifiesto();
    const respaldos = (m.respaldos || []).map((r) => {
      let existe = false;
      let bytes = r.bytes;
      try { const s = fs.statSync(r.ruta); existe = true; bytes = s.size; } catch { /* borrado */ }
      return { ...r, ruta: undefined, existe, bytes };
    });
    const ultimo = respaldos[0] || null;
    const hoy = fechaISO();
    res.json({
      directorio: DIR,
      cifrado_disponible: !!PASSPHRASE,
      config: cfg,
      ultimo_ok: m.ultimo_ok ? { ...m.ultimo_ok, ruta: undefined } : null,
      ultimo_ok_hoy: !!ultimo && ultimo.fecha_local === hoy,
      total: respaldos.length,
      respaldos,
      verificacion_mensual: m.ultima_verificacion || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

backupRouter.get('/config', requireAuth, requireRole(...GESTORES_USUARIOS), async (_req, res) => {
  try {
    res.json(await configBackup(db));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

backupRouter.put('/config', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    await withTx(async (client) => {
      const antes = await configBackup(client);
      const mapa = {
        backup_retention_years: 'retencion_anios',
        backup_hora: 'hora',
        backup_destino: 'destino',
        backup_gpg_habilitado: 'gpg',
      };
      for (const [clave, campo] of Object.entries(mapa)) {
        if (!(campo in (req.body || {}))) continue;
        await client.query(
          `INSERT INTO conta_configuracion (clave, valor, actualizado_por, actualizado_en)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor,
                  actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
          [clave, JSON.stringify(req.body[campo]), req.user.id]
        );
      }
      const despues = await configBackup(client);
      await auditar(client, {
        usuario_id: req.user.id, accion: 'editar', entidad: 'configuracion', entidad_id: 'backup',
        datos_antes: antes, datos_despues: despues, ip: ipDe(req),
      });
    });
    res.json(await configBackup(db));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Prueba de restauración: descifra (si aplica) el último respaldo y valida que
 * `pg_restore --list` lo reconozca. No toca la base de datos en uso.
 */
backupRouter.post('/verificar', requireAuth, requireRole(...GESTORES_USUARIOS), async (req, res) => {
  try {
    const m = leerManifiesto();
    const ultimo = m.respaldos && m.respaldos[0];
    if (!ultimo) return res.status(404).json({ error: 'No hay respaldos para verificar' });
    if (!fs.existsSync(ultimo.ruta)) return res.status(410).json({ error: 'El archivo del respaldo ya no existe' });

    if (!(await existeBinario('pg_restore'))) {
      return res.status(503).json({ error: 'pg_restore no está disponible en el contenedor', code: 'PG_RESTORE_AUSENTE' });
    }

    let archivo = ultimo.ruta;
    let temporal = null;
    if (ultimo.cifrado) {
      if (!PASSPHRASE) return res.status(409).json({ error: 'El respaldo está cifrado pero no hay BACKUP_GPG_PASSPHRASE' });
      temporal = path.join(DIR, `.verif-${Date.now()}.dump`);
      const gpg = await ejecutar('gpg', [
        '--batch', '--yes', '--quiet', '--decrypt', '--passphrase-fd', '0', '--output', temporal, ultimo.ruta,
      ], { stdin: PASSPHRASE });
      if (gpg.code !== 0) {
        return res.status(500).json({ error: `No se pudo descifrar el respaldo: ${gpg.stderr.trim()}` });
      }
      archivo = temporal;
    }

    const listado = await ejecutar('pg_restore', ['--list', archivo]);
    if (temporal) { try { fs.unlinkSync(temporal); } catch { /* noop */ } }
    if (listado.code !== 0) {
      return res.status(500).json({ error: `El respaldo no es restaurable: ${listado.stderr.trim()}` });
    }
    const tablas = (listado.stdout.match(/TABLE DATA/g) || []).length;
    const resultado = {
      ok: true, archivo: ultimo.archivo, tablas_detectadas: tablas,
      verificado_en: new Date().toISOString(), sha256: ultimo.sha256,
    };
    const mm = leerManifiesto();
    mm.ultima_verificacion = resultado;
    guardarManifiesto(mm);
    await auditar(db, {
      usuario_id: req.user.id, accion: 'verificar_backup', entidad: 'sistema', entidad_id: ultimo.archivo,
      datos_despues: resultado, ip: ipDe(req),
    });
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================================================
// PROGRAMADOR (respaldo diario + verificación mensual)
// =============================================================================
let _corriendo = false;

async function cicloProgramado(db) {
  if (_corriendo) return;
  _corriendo = true;
  try {
    const cfg = await configBackup(db);
    const m = leerManifiesto();
    const ahora = new Date();
    const horaLocal = ahora.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    const hoy = fechaISO();
    const ultimo = m.respaldos && m.respaldos[0];

    // Respaldo diario (una vez pasada la hora configurada y sin respaldo de hoy).
    if (horaLocal >= cfg.hora && (!ultimo || ultimo.fecha_local !== hoy)) {
      const r = await ejecutarBackup(db, { usuario_id: null, manual: false });
      console.log(`[conta:backup] respaldo diario OK: ${r.archivo} (${r.bytes} bytes)`);
    }

    // Verificación de restauración el día 1 de cada mes.
    const diaLocal = Number(ahora.toLocaleDateString('en-CA', { timeZone: TZ }).slice(8, 10));
    if (diaLocal === 1 && (!m.ultima_verificacion || String(m.ultima_verificacion.verificado_en).slice(0, 10) !== hoy)) {
      if (m.respaldos && m.respaldos[0]) {
        const archivo = m.respaldos[0].ruta;
        if (fs.existsSync(archivo) && (await existeBinario('pg_restore'))) {
          let objetivo = archivo;
          let temporal = null;
          if (m.respaldos[0].cifrado) {
            temporal = path.join(DIR, `.verif-${Date.now()}.dump`);
            const gpg = await ejecutar('gpg', ['--batch', '--yes', '--quiet', '--decrypt',
              '--passphrase-fd', '0', '--output', temporal, archivo], { stdin: PASSPHRASE });
            objetivo = gpg.code === 0 ? temporal : null;
          }
          if (objetivo) {
            const l = await ejecutar('pg_restore', ['--list', objetivo]);
            if (temporal) { try { fs.unlinkSync(temporal); } catch { /* noop */ } }
            m.ultima_verificacion = {
              ok: l.code === 0,
              archivo: m.respaldos[0].archivo,
              tablas_detectadas: (l.stdout.match(/TABLE DATA/g) || []).length,
              verificado_en: new Date().toISOString(),
            };
            guardarManifiesto(m);
            console.log(`[conta:backup] verificación mensual: ${m.ultima_verificacion.ok ? 'OK' : 'FALLÓ'}`);
          }
        }
      }
    }
  } catch (e) {
    console.error('[conta:backup] error en el ciclo:', e.message);
  } finally {
    _corriendo = false;
  }
}

/** Arranca el programador de respaldos (idempotente). */
export function iniciarProgramadorBackup(db) {
  if (process.env.BACKUP_WORKER === 'false') {
    console.log('[conta:backup] programador desactivado (BACKUP_WORKER=false)');
    return null;
  }
  const intervalo = Number(process.env.BACKUP_INTERVAL_MS || 1800000);   // 30 min
  console.log(`[conta:backup] programador activo cada ${intervalo} ms (dir ${DIR})`);
  const t = setInterval(() => cicloProgramado(db), intervalo);
  t.unref?.();
  setTimeout(() => cicloProgramado(db), 45000).unref?.();
  return t;
}
