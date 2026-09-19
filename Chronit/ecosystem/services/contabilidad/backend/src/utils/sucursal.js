// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: contexto de SUCURSAL
// -----------------------------------------------------------------------------
// Multi-sucursal: toda tabla transaccional lleva sucursal_id y TODOS los
// endpoints validan que la sucursal del recurso pertenezca al usuario.
//
// Resolución de la sucursal del usuario:
//   1. usuarios.sucursal_id (si la columna existe y está definida)
//   2. configuracion.sucursal_default
//   3. la primera sucursal activa
//
// Los roles globales (admin, desarrollador, contador, socio, dueno) pueden
// consultar cualquier sucursal; cajero, coordinador y supervisor quedan
// ceñidos a la suya salvo que envíen explícitamente otra y sean supervisor+.
// =============================================================================
import { num } from './helpers.js';

let _sucursalDefault = null;

/** ID de la sucursal por defecto (cacheado por proceso). */
export async function sucursalDefault(db) {
  if (_sucursalDefault) return _sucursalDefault;
  const { rows: cfg } = await db.query(
    `SELECT valor FROM conta_configuracion WHERE clave = 'sucursal_default'`
  );
  const deConfig = cfg.length ? num(cfg[0].valor, 0) : 0;
  if (deConfig) { _sucursalDefault = deConfig; return _sucursalDefault; }

  const { rows } = await db.query(
    'SELECT id FROM conta_sucursales WHERE activo = true ORDER BY id LIMIT 1'
  );
  _sucursalDefault = rows.length ? rows[0].id : null;
  return _sucursalDefault;
}

/** Sucursal asignada al usuario (o la de por defecto). */
export async function sucursalDeUsuario(db, usuario) {
  if (!usuario) return sucursalDefault(db);
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'usuarios' AND column_name = 'sucursal_id'`
  );
  if (rows.length) {
    const { rows: u } = await db.query('SELECT sucursal_id FROM usuarios WHERE id = $1', [usuario.id]);
    if (u.length && u[0].sucursal_id) return u[0].sucursal_id;
  }
  return sucursalDefault(db);
}

/** Roles que pueden operar/consultar cualquier sucursal. */
const ROLES_GLOBALES = ['admin', 'desarrollador', 'contador', 'socio', 'dueno'];

/**
 * Valida la sucursal pedida contra la del usuario.
 * Devuelve el sucursal_id efectivo a usar.
 * Lanza 403 si un rol no global intenta operar sobre otra sucursal.
 */
export async function resolverSucursal(db, usuario, solicitada = null) {
  const propia = await sucursalDeUsuario(db, usuario);
  const pedida = solicitada != null && solicitada !== '' ? num(solicitada) : null;

  if (!pedida) return propia;
  if (pedida === propia) return pedida;

  const global = usuario && ROLES_GLOBALES.includes(usuario.rol);
  const supervisor = usuario && ['supervisor'].includes(usuario.rol);
  if (global || supervisor) {
    // Se comprueba que la sucursal exista para no dejar pasar IDs basura.
    const { rows } = await db.query('SELECT id FROM conta_sucursales WHERE id = $1', [pedida]);
    if (!rows.length) { const e = new Error('Sucursal inexistente'); e.status = 400; throw e; }
    return pedida;
  }
  const e = new Error('No puedes operar sobre otra sucursal');
  e.status = 403;
  throw e;
}

/**
 * Sucursal indicada en la petición (query/body) o la del usuario.
 * Atajo usado por las rutas nuevas.
 */
export async function sucursalDePeticion(db, req) {
  const pedida = req.query?.sucursal_id ?? req.body?.sucursal_id ?? null;
  return resolverSucursal(db, req.user, pedida);
}
