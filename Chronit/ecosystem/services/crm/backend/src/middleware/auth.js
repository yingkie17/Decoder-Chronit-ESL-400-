// =============================================================================
// CHRONIT ECOSYSTEM — CRM: autenticación y control de roles (SOLO LECTURA)
// -----------------------------------------------------------------------------
// Reutiliza la sesión del sistema de tickets (cookie httpOnly en Valkey con
// fallback a JWT Bearer firmado con el MISMO JWT_SECRET).
//
// El CRM es la vista 360° del negocio: lo consultan los roles de dirección,
// supervisión, contabilidad y administración. NO participan roles operativos
// (piloto, cajero) ni invitados.
//
// Todo rol con acceso al CRM es de SOLO LECTURA: no existe ninguna ruta de
// escritura de negocio (únicamente se registra la auditoría del propio CRM).
// =============================================================================
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { getSession, readCookie, SESSION_COOKIE } from '../session.js';

config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_env';

/** Roles con acceso al CRM centralizado (todos de solo lectura). */
export const CRM_ROLES = [
  'admin', 'desarrollador', 'dueno', 'socio', 'supervisor', 'contador', 'coordinador',
];

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

/** Exige un rol del CRM. 'desarrollador' se acepta siempre que se permita 'admin'. */
export function requireCrmRole(...roles) {
  const permitidos = roles.length ? roles : CRM_ROLES;
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    const rol = req.user.rol;
    const ok = permitidos.includes(rol) || (permitidos.includes('admin') && rol === 'desarrollador');
    if (!ok) return res.status(403).json({ error: 'No tienes permiso para acceder al CRM' });
    next();
  };
}
