// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad: utilidades generales
// =============================================================================
import { randomUUID } from 'crypto';

export const uuid = () => randomUUID();

/** Redondeo monetario a 2 decimales (evita el arrastre binario de los float). */
export function round2(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Convierte a número de forma segura (los NUMERIC llegan como string de pg). */
export function num(n, def = 0) {
  const v = Number(n);
  return isFinite(v) ? v : def;
}

/** Fecha ISO (YYYY-MM-DD) en zona America/La_Paz a partir de un Date/string. */
export function fechaISO(d = new Date()) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
}

/** Fecha+hora legible (HH:MM:SS) en zona America/La_Paz. */
export function horaLocal(d = new Date()) {
  return new Date(d).toLocaleTimeString('es-BO', {
    timeZone: 'America/La_Paz', hour12: false,
  });
}

export function fechaHoraLocal(d = new Date()) {
  return new Date(d).toLocaleString('es-BO', { timeZone: 'America/La_Paz', hour12: false });
}

/** Normaliza el valor de un query param booleano. */
export function boolParam(v) {
  if (v === undefined || v === null || v === '') return undefined;
  return v === true || v === 'true' || v === '1';
}
