// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: autenticación y control de roles
// -----------------------------------------------------------------------------
// Reutiliza la sesión de tickets: cookie httpOnly (Valkey) con fallback a JWT
// Bearer firmado con el MISMO JWT_SECRET.
//
// Jerarquía práctica:
//   * 'desarrollador' se trata como 'admin' cuando la ruta permite 'admin'.
//   * 'dueno' NO hereda permisos de admin (es solo lectura ejecutiva).
// =============================================================================
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { getSession, readCookie, SESSION_COOKIE } from '../session.js';

config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_env';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

// Roles del ecosistema (los 4 últimos son nuevos del módulo contable)
export const ROLES = [
  'piloto', 'cajero', 'coordinador', 'supervisor',
  'contador', 'socio', 'admin', 'desarrollador', 'dueno',
];

// Roles con capacidad de autorización operativa/administrativa.
export const SUPERVISOR_PLUS = ['supervisor', 'admin', 'desarrollador'];
// Roles con acceso a información financiera (lectura o gestión).
export const FINANZAS = ['contador', 'socio', 'dueno', 'supervisor', 'admin', 'desarrollador'];
// Roles de gestión de usuarios del sistema.
export const GESTORES_USUARIOS = ['admin', 'desarrollador'];
// Roles que NO pueden gestionar nada (solo consulta).
export const SOLO_LECTURA = ['socio', 'dueno'];

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
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    const rol = req.user.rol;
    const permitido = roles.includes(rol) || (roles.includes('admin') && rol === 'desarrollador');
    if (!permitido) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    next();
  };
}

/** ¿El rol puede autorizar operaciones (descuentos, egresos, anulaciones)? */
export const esSupervisorPlus = (rol) => SUPERVISOR_PLUS.includes(rol);

/** ¿El rol puede editar la configuración del sistema? */
export const puedeEditarConfiguracion = (rol) => SUPERVISOR_PLUS.includes(rol);

/** ¿El rol puede gestionar usuarios y asignar roles? */
export const puedeGestionarUsuarios = (rol) => GESTORES_USUARIOS.includes(rol);
