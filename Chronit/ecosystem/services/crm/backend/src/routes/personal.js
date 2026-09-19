// =============================================================================
// CHRONIT ECOSYSTEM — CRM: PERSONAL / MÓDULO BIOMÉTRICO (arquitectura lista)
// -----------------------------------------------------------------------------
// Esta sección deja PREPARADO el módulo biométrico de empleados: registra las
// horas de entrada y salida, los días trabajados y el resto de la gestión de
// personal. La arquitectura (tablas y endpoints) ya existe y es consultable;
// el dispositivo biométrico se conectará en el futuro escribiendo en
// `crm_asistencia` (origen = 'biometrico').
//
//   GET /api/crm/personal/estado         -> diagnóstico del módulo
//   GET /api/crm/personal/empleados      -> fichas laborales + días trabajados
//   GET /api/crm/personal/asistencia     -> marcaciones de entrada/salida
// =============================================================================
import { Router } from 'express';
import { requireAuth, requireCrmRole } from '../middleware/auth.js';
import { soloLectura } from '../db/pool.js';
import { Where } from '../utils/sql.js';
import { listar } from '../utils/listado.js';

export const personalRouter = Router();
personalRouter.use(requireAuth, requireCrmRole());

const COLUMNAS_EMPLEADOS = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'codigo_empleado', titulo: 'Código' },
  { clave: 'empleado', titulo: 'Empleado' },
  { clave: 'carnet', titulo: 'Carnet' },
  { clave: 'cargo', titulo: 'Cargo' },
  { clave: 'departamento', titulo: 'Departamento' },
  { clave: 'fecha_ingreso', titulo: 'Ingreso' },
  { clave: 'horas_contrato', titulo: 'Horas contrato' },
  { clave: 'activo', titulo: 'Activo' },
  { clave: 'dias_trabajados', titulo: 'Días trabajados' },
  { clave: 'ultima_marcacion', titulo: 'Última marcación' },
];

const COLUMNAS_ASISTENCIA = [
  { clave: 'id', titulo: 'ID' },
  { clave: 'empleado', titulo: 'Empleado' },
  { clave: 'carnet', titulo: 'Carnet' },
  { clave: 'tipo', titulo: 'Tipo' },
  { clave: 'ocurrido_en', titulo: 'Fecha y hora' },
  { clave: 'origen', titulo: 'Origen' },
  { clave: 'dispositivo', titulo: 'Dispositivo' },
  { clave: 'verificado', titulo: 'Verificado' },
  { clave: 'observacion', titulo: 'Observación' },
];

// ---------------------------------------------------------------------------
// Estado / readiness del módulo biométrico
// ---------------------------------------------------------------------------
personalRouter.get('/estado', async (_req, res) => {
  try {
    const { rows } = await soloLectura(`
      SELECT
        (SELECT COUNT(*)::int FROM crm_empleados)              AS empleados,
        (SELECT COUNT(*)::int FROM crm_empleados WHERE activo)  AS empleados_activos,
        (SELECT COUNT(*)::int FROM crm_biometrico_dispositivos) AS dispositivos,
        (SELECT COUNT(*)::int FROM crm_biometrico_dispositivos WHERE activo) AS dispositivos_activos,
        (SELECT COUNT(*)::int FROM crm_asistencia)              AS marcaciones,
        (SELECT MAX(ocurrido_en) FROM crm_asistencia)           AS ultima_marcacion
    `);
    const s = rows[0] || {};
    res.json({
      modulo: 'biometrico',
      // La arquitectura está lista; aún no hay hardware biométrico conectado.
      habilitado: Number(s.marcaciones) > 0,
      arquitectura_lista: true,
      tablas: ['crm_empleados', 'crm_biometrico_dispositivos', 'crm_asistencia', 'crm_asistencia_diaria'],
      resumen: {
        empleados: s.empleados ?? 0,
        empleados_activos: s.empleados_activos ?? 0,
        dispositivos: s.dispositivos ?? 0,
        dispositivos_activos: s.dispositivos_activos ?? 0,
        marcaciones: s.marcaciones ?? 0,
        ultima_marcacion: s.ultima_marcacion ?? null,
      },
    });
  } catch (e) {
    console.error('[crm:personal/estado]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Fichas laborales (con días trabajados y última marcación)
// ---------------------------------------------------------------------------
function construirEmpleados(q) {
  const w = new Where();
  w.bool('e.activo', q.activo)
    .eq('e.departamento', q.departamento)
    .eq('e.cargo', q.cargo)
    .texto(['u.nombre', 'u.apellido', 'u.carnet', 'e.codigo_empleado', 'e.cargo', 'e.departamento'], q.q);

  return {
    select: `e.id, e.codigo_empleado, e.cargo, e.departamento, e.fecha_ingreso, e.fecha_baja,
             e.horas_contrato, e.activo, e.usuario_id,
             u.nombre || ' ' || u.apellido AS empleado,
             u.carnet AS carnet,
             (SELECT COUNT(*)::int FROM crm_asistencia_diaria d WHERE d.empleado_id = e.id) AS dias_trabajados,
             (SELECT MAX(a.ocurrido_en) FROM crm_asistencia a WHERE a.empleado_id = e.id) AS ultima_marcacion`,
    from: `FROM crm_empleados e
           LEFT JOIN usuarios u ON u.id = e.usuario_id`,
    where: w,
    order: 'e.activo DESC, e.id DESC',
  };
}

personalRouter.get('/empleados', (req, res) =>
  listar(req, res, { recurso: 'personal_empleados', columnas: COLUMNAS_EMPLEADOS, construir: construirEmpleados })
);

// ---------------------------------------------------------------------------
// Marcaciones de asistencia (entradas y salidas)
// ---------------------------------------------------------------------------
function construirAsistencia(q) {
  const w = new Where();
  w.eq('a.empleado_id', q.empleado_id)
    .eq('a.dispositivo_id', q.dispositivo_id)
    .eq('a.tipo', q.tipo)
    .eq('a.origen', q.origen)
    .bool('a.verificado', q.verificado)
    .desde('a.ocurrido_en', q.desde, 'timestamptz')
    .hasta('a.ocurrido_en', q.hasta, 'timestamptz')
    .texto(['u.nombre', 'u.apellido', 'u.carnet', 'e.codigo_empleado', 'd.nombre'], q.q);

  return {
    select: `a.id, a.empleado_id, a.dispositivo_id, a.tipo, a.ocurrido_en, a.origen,
             a.verificado, a.observacion,
             u.nombre || ' ' || u.apellido AS empleado,
             u.carnet AS carnet,
             e.codigo_empleado,
             d.nombre AS dispositivo`,
    from: `FROM crm_asistencia a
           LEFT JOIN crm_empleados e ON e.id = a.empleado_id
           LEFT JOIN usuarios u ON u.id = e.usuario_id
           LEFT JOIN crm_biometrico_dispositivos d ON d.id = a.dispositivo_id`,
    where: w,
    order: 'a.ocurrido_en DESC, a.id DESC',
  };
}

personalRouter.get('/asistencia', (req, res) =>
  listar(req, res, { recurso: 'personal_asistencia', columnas: COLUMNAS_ASISTENCIA, construir: construirAsistencia })
);
