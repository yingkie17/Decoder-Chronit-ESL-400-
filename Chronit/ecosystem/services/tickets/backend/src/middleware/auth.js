// =============================================================================
// CHRONIT ECOSYSTEM — Backend de Tickets: middleware de autenticación y roles
// -----------------------------------------------------------------------------
// Sesión de servidor (cookie httpOnly + Valkey) con fallback a JWT Bearer.
// La sesión de servidor es la vía principal (sobrevive a recargas); el JWT se
// mantiene para compatibilidad con clientes que aún envíen Authorization.
// =============================================================================
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { getSession, readCookie, SESSION_COOKIE } from '../session.js';

config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_env';

// Firmar un token de sesión (compatibilidad con clientes Bearer)
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

// Middleware: requiere sesión válida.
// 1) Sesión de servidor: cookie httpOnly -> se lee de Valkey.
// 2) Fallback: Authorization: Bearer <JWT>.
export async function requireAuth(req, res, next) {
  const cookieToken = readCookie(req, SESSION_COOKIE);
  if (cookieToken) {
    const session = await getSession(cookieToken);
    if (session) {
      req.user = session;
      return next();
    }
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

// Middleware: requiere uno de los roles permitidos.
// 'desarrollador' (soporte técnico) es tratado como 'admin': si la ruta permite
// 'admin', también la puede usar un desarrollador, sin duplicar el rol en cada ruta.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    const rol = req.user.rol;
    const permitido = roles.includes(rol) || (roles.includes('admin') && rol === 'desarrollador');
    if (!permitido) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}
