// =============================================================================
// CHRONIT WEB CLIENT — Constantes compartidas (nacionalidades con bandera)
// =============================================================================

export const NATIONALITIES: { code: string; name: string; flag: string }[] = [
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'CU', name: 'Cuba', flag: '🇨🇺' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { code: 'US', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳' },
  { code: 'MX', name: 'México', flag: '🇲🇽' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮' },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦' },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾' },
  { code: 'PE', name: 'Perú', flag: '🇵🇪' },
  { code: 'DO', name: 'República Dominicana', flag: '🇩🇴' },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
];

export function flagOf(code?: string | null): string {
  const n = NATIONALITIES.find((c) => c.code === code);
  return n ? n.flag : '🏁';
}

// Mapa de estados de cola → etiqueta + color (para la cuenta del piloto)
export const ESTADO_COLA: Record<string, { label: string; color: string }> = {
  espera: { label: 'En espera', color: '#d97706' },
  llamado: { label: '¡Llamado a vestidores!', color: '#3b82f6' },
  vestidor1: { label: 'En vestidor 1', color: '#3b82f6' },
  vestidor2: { label: 'En vestidor 2', color: '#3b82f6' },
  ready: { label: 'Listo para correr', color: '#16a34a' },
  en_pista: { label: 'En pista', color: '#16a34a' },
};

// Mapa de estados de evento → etiqueta + color
export const ESTADO_EVENTO: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: '#d97706' },
  asignado: { label: 'Programado', color: '#8aa4c7' },
  preparada: { label: 'Preparado', color: '#3b82f6' },
  activo: { label: 'En curso', color: '#16a34a' },
  finalizado: { label: 'Finalizado', color: '#5f7095' },
};

// Máquina de estados unificada del ticket (PROMPT MAESTRO):
//   PENDIENTE -> ASIGNADO -> LLAMANDO -> PREPARADO -> ACTIVO -> FINALIZADO
export const ESTADO_TICKET: Record<string, { label: string; color: string }> = {
  PENDIENTE: { label: 'Pendiente de pago', color: '#d97706' },
  ASIGNADO: { label: 'Asignado', color: '#3b82f6' },
  LLAMANDO: { label: 'Llamando a vestidores', color: '#3b82f6' },
  PREPARADO: { label: 'Listo para correr', color: '#16a34a' },
  ACTIVO: { label: 'En pista', color: '#16a34a' },
  FINALIZADO: { label: 'Finalizado', color: '#5f7095' },
};
