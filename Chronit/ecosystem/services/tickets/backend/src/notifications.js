// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: servicio de notificaciones (Socket.io)
// -----------------------------------------------------------------------------
// Permite difundir en tiempo real:
//   - "llamado"     a un piloto concreto cuando su ticket es llamado a vestidor.
//   - "colas"       a la pantalla pública (nuevo grupo llamado / estados).
//   - "ready"       cuando un bloque queda listo.
//   - "pantalla"    actualización de la configuración del carrusel.
//
// Los clientes se conectan al namespace '/live'. Un piloto puede unirse a su
// propia sala con el uuid_global para recibir notificaciones dirigidas.
// =============================================================================
import { Server } from 'socket.io';

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    // Un piloto se suscribe a su canal personal usando su uuid/identidad
    socket.on('subscribe', (payload) => {
      const { uuid_global } = payload || {};
      if (uuid_global) socket.join(`pilot:${uuid_global}`);
    });

    // Un operador/vestidor se une a la sala de la pantalla pública
    socket.on('join-display', () => socket.join('display'));

    socket.on('disconnect', () => {});
  });

  console.log('[socket.io] servidor de notificaciones listo');
  return io;
}

// Emitir a un piloto concreto (por uuid_global)
export function notifyPilot(uuidGlobal, event, data) {
  if (!io) return;
  io.to(`pilot:${uuidGlobal}`).emit(event, data);
}

// Difundir a la pantalla pública
export function broadcastDisplay(event, data) {
  if (!io) return;
  io.to('display').emit(event, data);
}

// Difundir a todos los clientes
export function broadcast(event, data) {
  if (!io) return;
  io.emit(event, data);
}
