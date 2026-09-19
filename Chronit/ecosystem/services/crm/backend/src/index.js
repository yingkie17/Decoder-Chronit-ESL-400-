// =============================================================================
// CHRONIT ECOSYSTEM — Backend del CRM centralizado: servidor Express (:4200)
// -----------------------------------------------------------------------------
// El CRM es la vista 360° del negocio: reúne en un solo lugar la información de
// los sistemas de carreras, tickets, caja/contabilidad, usuarios y página web.
//
// Reglas de diseño:
//   * SOLO LECTURA sobre los datos de los demás sistemas (READ ONLY + roles).
//   * Comparte la MISMA base de datos y la MISMA sesión (cookie httpOnly en
//     Valkey + JWT) que el resto del ecosistema: un usuario inicia sesión una
//     sola vez.
//   * Toda consulta filtrada y toda exportación quedan auditadas en
//     `crm_auditoria`.
//   * La arquitectura del módulo biométrico de empleados ya está preparada
//     (ver /api/crm/personal/*).
//
// Prefijo de API: /api/crm/*
// =============================================================================
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

import { requireAuth, requireCrmRole, CRM_ROLES } from './middleware/auth.js';
import { soloLectura } from './db/pool.js';
import { Where, paginacion } from './utils/sql.js';
import { auditar } from './utils/audit.js';
import { personasRouter } from './routes/personas.js';
import { ticketsRouter } from './routes/tickets.js';
import { carrerasRouter } from './routes/carreras.js';
import { cajaRouter } from './routes/caja.js';
import { comunidadRouter } from './routes/comunidad.js';
import { personalRouter } from './routes/personal.js';

config();

const app = express();

// CORS: mismo criterio que los demás backends. Sin CORS_ORIGINS se refleja el
// origen del navegador (útil en desarrollo con varios puertos).
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// --- Seguridad de transporte -------------------------------------------------
// Detrás del proxy TLS (perfil "tls") confiamos en X-Forwarded-* para la IP real
// (auditoría) y el esquema original. TRUST_PROXY=false lo desactiva.
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const PORT = process.env.PORT || 4200;

// Healthcheck para docker-compose y diagnóstico
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'crm-backend', version: '0.1.0', puerto: Number(PORT) });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'CHRONIT CRM Backend',
    version: '0.1.0',
    modo: 'solo lectura',
    roles: CRM_ROLES,
    endpoints: [
      '/api/crm/resumen',
      '/api/crm/personas*',
      '/api/crm/tickets*',
      '/api/crm/carreras*',
      '/api/crm/caja*',
      '/api/crm/comunidad*',
      '/api/crm/personal/estado',
      '/api/crm/personal/empleados*',
      '/api/crm/personal/asistencia*',
      '/api/crm/auditoria*',
    ],
  });
});

// Sesión actual (misma sesión que el resto del ecosistema, sin segundo login)
app.get('/api/crm/me', requireAuth, (req, res) => {
  res.json({ user: req.user, roles_crm: CRM_ROLES });
});

// ---------------------------------------------------------------------------
// Resumen del CRM: foto global de todos los sistemas integrados.
// ---------------------------------------------------------------------------
app.get('/api/crm/resumen', requireAuth, requireCrmRole(), async (_req, res) => {
  try {
    const { rows } = await soloLectura(`
      SELECT
        (SELECT COUNT(*)::int FROM usuarios)                                    AS usuarios,
        (SELECT COUNT(*)::int FROM usuarios WHERE NOT es_invitado)              AS usuarios_registrados,
        (SELECT COUNT(*)::int FROM tickets)                                     AS tickets,
        (SELECT COUNT(*)::int FROM tickets WHERE impreso_en IS NOT NULL)        AS tickets_impresos,
        (SELECT COUNT(*)::int FROM resultados_carrera)                          AS carreras,
        (SELECT COUNT(*)::int FROM eventos)                                      AS eventos,
        (SELECT COUNT(*)::int FROM posts)                                        AS publicaciones,
        (SELECT COUNT(*)::int FROM conta_sesiones_caja)                          AS sesiones_caja,
        (SELECT COUNT(*)::int FROM conta_sesiones_caja WHERE cierre_en IS NULL)  AS cajas_abiertas,
        (SELECT COUNT(*)::int FROM conta_ventas WHERE estado <> 'anulada')       AS ventas,
        (SELECT COALESCE(SUM(total_final), 0) FROM conta_ventas
          WHERE estado <> 'anulada')                                             AS ventas_total
    `);
    const r = rows[0] || {};
    res.json({
      sistemas: {
        usuarios: { usuarios: r.usuarios ?? 0, registrados: r.usuarios_registrados ?? 0 },
        tickets: { tickets: r.tickets ?? 0, impresos: r.tickets_impresos ?? 0 },
        carreras: { carreras: r.carreras ?? 0, eventos: r.eventos ?? 0 },
        parte_web: { publicaciones: r.publicaciones ?? 0 },
        caja: {
          sesiones: r.sesiones_caja ?? 0,
          abiertas: r.cajas_abiertas ?? 0,
          ventas: r.ventas ?? 0,
          total: r.ventas_total ?? 0,
        },
      },
      biometrico: { arquitectura_lista: true, habilitado: false },
    });
  } catch (e) {
    console.error('[crm:resumen]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Auditoría del CRM: quién consultó/exportó qué y cuándo.
// ---------------------------------------------------------------------------
app.get('/api/crm/auditoria', requireAuth, requireCrmRole(), async (req, res) => {
  try {
    const w = new Where();
    w.eq('a.usuario_id', req.query.usuario_id)
      .eq('a.accion', req.query.accion)
      .eq('a.recurso', req.query.recurso)
      .eq('a.formato', req.query.formato)
      .desde('a.creado_en', req.query.desde, 'timestamptz')
      .hasta('a.creado_en', req.query.hasta, 'timestamptz')
      .texto(['a.recurso', 'a.accion', 'u.nombre', 'u.apellido', 'u.carnet'], req.query.q);

    const { page, limit, sql: pagSql } = paginacion(req.query);
    const totalRes = await soloLectura(
      `SELECT COUNT(*)::int AS total FROM crm_auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id ${w.sql()}`,
      w.valores
    );
    const { rows } = await soloLectura(
      `SELECT a.id, a.accion, a.recurso, a.filtros, a.filas, a.formato, a.ip, a.creado_en,
              u.nombre || ' ' || u.apellido AS usuario,
              u.carnet AS usuario_carnet
         FROM crm_auditoria a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         ${w.sql()} ORDER BY a.id DESC ${pagSql}`,
      w.valores
    );

    const total = totalRes.rows[0]?.total ?? 0;
    await auditar({ req, accion: 'consultar', recurso: 'auditoria', filas: rows.length });
    res.json({
      datos: rows,
      paginacion: { total, page, limit, paginas: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (e) {
    console.error('[crm:auditoria]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Dominios centralizados del CRM ---
app.use('/api/crm/personas', personasRouter);
app.use('/api/crm/tickets', ticketsRouter);
app.use('/api/crm/carreras', carrerasRouter);
app.use('/api/crm/caja', cajaRouter);
app.use('/api/crm/comunidad', comunidadRouter);
app.use('/api/crm/personal', personalRouter);

// 404 JSON para /api/* (el frontend siempre espera JSON)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Recurso no encontrado' }));

// Manejador de errores (mantiene la respuesta en JSON)
app.use((err, _req, res, _next) => {
  console.error('[crm-backend] error no controlado:', err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[crm-backend] escuchando en http://0.0.0.0:${PORT}`);
});
