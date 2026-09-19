// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: servidor Express
// -----------------------------------------------------------------------------
// Monta los routers de cada dominio del sistema de tickets/colas.
// =============================================================================

import http from 'http';
import { mkdirSync } from 'fs';
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

import { authRouter } from './routes/auth.js';
import { pilotosRouter } from './routes/pilotos.js';
import { usuariosRouter } from './routes/usuarios.js';
import { personalRouter } from './routes/personal.js';
import { kartsRouter } from './routes/karts.js';
import { eventosRouter } from './routes/eventos.js';
import { ticketsRouter } from './routes/tickets.js';
import { colasRouter } from './routes/colas.js';
import { configRouter } from './routes/config.js';
import { reportesRouter } from './routes/reportes.js';
import { auditoriaRouter } from './routes/auditoria.js';
import { uploadsRouter, UPLOADS_DIR } from './routes/uploads.js';
import { initSocket } from './notifications.js';

config();

const app = express();
// CORS: permite orígenes especificados en CORS_ORIGINS (lista separada por comas).
// Si CORS_ORIGINS está vacío/ausente, se refleja el origen del navegador (dev),
// de modo que cualquier puerto/dominio pueda consumir la API. En producción,
// define CORS_ORIGINS=http://kiosco.tudominio.com,http://web.tudominio.com
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());

// --- Seguridad de transporte -------------------------------------------------
// Detrás del proxy TLS (perfil "tls" de docker-compose) hay que confiar en las
// cabeceras X-Forwarded-* para resolver la IP real del cliente (auditoría) y el
// esquema original (cookies Secure). TRUST_PROXY=false lo desactiva.
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);
// Cabeceras de seguridad en todas las respuestas (defensa en profundidad).
// HSTS se añade en el borde TLS (services/edge), junto al certificado.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Servir imágenes subidas (fotos de pilotos)
mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

const server = http.createServer(app);
// Notificaciones en tiempo real (Socket.io)
initSocket(server);

const PORT = process.env.PORT || 4000;

// Healthcheck para docker-compose y diagnóstico
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tickets-backend', version: '0.1.0' });
});

// Raíz informativa
app.get('/', (_req, res) => {
  res.json({
    name: 'CHRONIT Tickets Backend',
    version: '0.1.0',
    status: 'en desarrollo — módulos de auth, pilotos, eventos, tickets, colas, pantalla',
    endpoints: [
      '/api/auth/*',
      '/api/pilotos*',
      '/api/eventos*',
      '/api/tickets*',
      '/api/colas*',
      '/api/config/pantalla*',
    ],
  });
});

// Rutas de cada dominio
app.use('/api/auth', authRouter);
app.use('/api/pilotos', pilotosRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/personal', personalRouter);
app.use('/api/karts', kartsRouter);
app.use('/api/eventos', eventosRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/colas', colasRouter);
app.use('/api/config/pantalla', configRouter);
app.use('/api/reportes', reportesRouter);
app.use('/api/auditoria', auditoriaRouter);
app.use('/api/uploads', uploadsRouter);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[tickets-backend] escuchando en http://0.0.0.0:${PORT}`);
});
