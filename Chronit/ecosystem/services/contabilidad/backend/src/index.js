// =============================================================================
// CHRONIT ECOSYSTEM — Backend de CONTABILIDAD: servidor Express (puerto 4100)
// -----------------------------------------------------------------------------
// Monta todos los routers del módulo contable. Comparte la MISMA base de datos
// PostgreSQL y la MISMA sesión (cookie httpOnly en Valkey + JWT) que el backend
// de tickets: un usuario inicia sesión una sola vez y ambos servicios lo
// reconocen.
//
// Prefijo de API: /api/conta/*
// Impresión:      /imprimir/ticket/:id
// =============================================================================
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

import { requireAuth } from './middleware/auth.js';
import { db } from './db/pool.js';
import { configuracionRouter } from './routes/configuracion.js';
import { catalogoRouter } from './routes/catalogo.js';
import { combosRouter, promocionesRouter, metodosPagoRouter } from './routes/combos.js';
import { cuentasRouter } from './routes/cuentas.js';
import { impuestosRouter } from './routes/impuestos.js';
import { cajasRouter } from './routes/cajas.js';
import { egresosRouter } from './routes/egresos.js';
import { ventasRouter } from './routes/ventas.js';
import { propinasRouter } from './routes/propinas.js';
import { usuariosRouter } from './routes/usuarios.js';
import { conciliacionRouter } from './routes/conciliacion.js';
import { reportesRouter } from './routes/reportes.js';
import { dashboardRouter } from './routes/dashboard.js';
import { auditoriaRouter } from './routes/auditoria.js';
import { imprimirRouter } from './routes/imprimir.js';
import { outboxRouter } from './routes/outbox.js';
import { iniciarWorker } from './utils/outbox-worker.js';
// --- v2: operación (PIN, turnos, devoluciones, anticipos, compras) ---
import { autorizarRouter } from './routes/autorizar.js';
import { pinsRouter } from './routes/pins.js';
import { turnosRouter } from './routes/turnos.js';
import { notasCreditoRouter } from './routes/notas_credito.js';
import { anticiposRouter } from './routes/anticipos.js';
import { proveedoresRouter, comprasRouter, kardexRouter } from './routes/compras.js';
import { empresasRouter, conveniosRouter, cxcRouter, cxpRouter } from './routes/cxc_cxp.js';
import { nominaRouter } from './routes/nomina.js';
import { activosRouter } from './routes/activos.js';
import { contabilidadRouter } from './routes/contabilidad.js';
import { alertasRouter } from './routes/alertas.js';
import { backupRouter, iniciarProgramadorBackup } from './routes/backup.js';
import { siatRouter } from './routes/siat.js';
// --- v3: cumplimiento fiscal Bolivia (libros SIN, periodos, SIETE-RG, config fiscal) ---
import { fiscalRouter } from './routes/fiscal.js';
import { dashboardEjecutivoRouter } from './routes/dashboard_ejecutivo.js';
import { iniciarWorkerAlertas } from './utils/alertas.js';

config();

const app = express();

// CORS: igual criterio que el backend de tickets. Sin CORS_ORIGINS se refleja el
// origen del navegador (útil en desarrollo con varios puertos).
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '2mb' }));

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

const PORT = process.env.PORT || 4100;

// Healthcheck para docker-compose y diagnóstico
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'contabilidad-backend', version: '0.1.0', puerto: Number(PORT) });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'CHRONIT Contabilidad Backend',
    version: '0.1.0',
    status: 'módulo de caja, ventas, propinas, conciliación, reportes y usuarios',
    endpoints: [
      '/api/conta/configuracion*',
      '/api/conta/catalogo*',
      '/api/conta/combos*',
      '/api/conta/promociones*',
      '/api/conta/metodos-pago*',
      '/api/conta/cuentas*',
      '/api/conta/impuestos*',
      '/api/conta/cajas*',
      '/api/conta/egresos*',
      '/api/conta/ventas*',
      '/api/conta/propinas*',
      '/api/conta/usuarios*',
      '/api/conta/conciliacion*',
      '/api/conta/reportes*',
      '/api/conta/dashboard',
      '/api/conta/dashboard-ejecutivo',
      '/api/conta/auditoria*',
      '/api/conta/autorizar',
      '/api/conta/pins*',
      '/api/conta/turnos*',
      '/api/conta/notas-credito*',
      '/api/conta/anticipos*',
      '/api/conta/proveedores*',
      '/api/conta/compras*',
      '/api/conta/kardex*',
      '/api/conta/empresas*',
      '/api/conta/convenios*',
      '/api/conta/cxc*',
      '/api/conta/cxp*',
      '/api/conta/nomina*',
      '/api/conta/activos*',
      '/api/conta/contabilidad*',
      '/api/conta/alertas*',
      '/api/conta/backup*',
      '/api/conta/siat*',
      '/api/conta/dosificaciones*',
      '/api/conta/libro-ventas*',
      '/api/conta/libro-compras*',
      '/api/conta/periodos*',
      '/api/conta/siete-rg/estado',
      '/api/conta/tasas*',
      '/api/conta/configuracion/facturacion',
      '/imprimir/ticket/:id',
      '/imprimir/factura/:id',
    ],
  });
});

// Sesión actual (misma sesión que tickets, sin segundo login)
app.get('/api/conta/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- Dominios del módulo contable ---
app.use('/api/conta/configuracion', configuracionRouter);
app.use('/api/conta/catalogo', catalogoRouter);
app.use('/api/conta/combos', combosRouter);
app.use('/api/conta/promociones', promocionesRouter);
app.use('/api/conta/metodos-pago', metodosPagoRouter);
app.use('/api/conta/cuentas', cuentasRouter);
app.use('/api/conta/impuestos', impuestosRouter);
app.use('/api/conta/cajas', cajasRouter);
app.use('/api/conta/egresos', egresosRouter);
app.use('/api/conta/ventas', ventasRouter);
app.use('/api/conta/propinas', propinasRouter);
app.use('/api/conta/usuarios', usuariosRouter);
app.use('/api/conta/conciliacion', conciliacionRouter);
app.use('/api/conta/reportes', reportesRouter);
app.use('/api/conta/dashboard', dashboardRouter);
app.use('/api/conta/auditoria', auditoriaRouter);
// Cola offline (ventas encoladas cuando PostgreSQL no está disponible)
app.use('/api/conta/outbox', outboxRouter);

// --- v2: operación ---
app.use('/api/conta/autorizar', autorizarRouter);
app.use('/api/conta/pins', pinsRouter);
app.use('/api/conta/turnos', turnosRouter);
app.use('/api/conta/notas-credito', notasCreditoRouter);
app.use('/api/conta/anticipos', anticiposRouter);
app.use('/api/conta/proveedores', proveedoresRouter);
app.use('/api/conta/compras', comprasRouter);
app.use('/api/conta/kardex', kardexRouter);
// --- v2: finanzas ---
app.use('/api/conta/empresas', empresasRouter);
app.use('/api/conta/convenios', conveniosRouter);
app.use('/api/conta/cxc', cxcRouter);
app.use('/api/conta/cxp', cxpRouter);
app.use('/api/conta/nomina', nominaRouter);
app.use('/api/conta/activos', activosRouter);
app.use('/api/conta/contabilidad', contabilidadRouter);
// --- v2: administración y cumplimiento ---
app.use('/api/conta/alertas', alertasRouter);
app.use('/api/conta/backup', backupRouter);
app.use('/api/conta/siat', siatRouter);
app.use('/api/conta/dashboard-ejecutivo', dashboardEjecutivoRouter);

// --- v3: cumplimiento fiscal Bolivia ---
// fiscalRouter aporta las rutas "de primer nivel" que pide la especificación:
//   /api/conta/libro-ventas, /libro-compras, /periodos, /siete-rg/estado,
//   /configuracion/facturacion.
app.use('/api/conta', fiscalRouter);
// El router del SIAT se monta ADEMÁS en la raíz /api/conta para exponer las
// DOSIFICACIONES en su ruta canónica (/api/conta/dosificaciones*) sin duplicar
// la lógica de CRUD ya implementada y auditada en routes/siat.js.
app.use('/api/conta', siatRouter);

// --- Impresión de tickets ---
app.use('/imprimir', imprimirRouter);
app.use('/api/conta/imprimir', imprimirRouter);

// 404 JSON para /api/* (el frontend siempre espera JSON)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Recurso no encontrado' }));

// Manejador de errores (mantiene la respuesta en JSON)
app.use((err, _req, res, _next) => {
  console.error('[contabilidad-backend] error no controlado:', err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[contabilidad-backend] escuchando en http://0.0.0.0:${PORT}`);
  // Reconciliación offline: reenvía a PostgreSQL lo que quedó encolado en SQLite.
  iniciarWorker();
  // Alertas: evalúa los umbrales y notifica por los canales configurados.
  iniciarWorkerAlertas(db);
  // Respaldo fiscal: pg_dump diario + verificación mensual de restauración.
  iniciarProgramadorBackup(db);
});
