// =============================================================================
// CHRONIT ECOSYSTEM — Constantes compartidas (nacionalidades con bandera)
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

// La bandera es un DATO del piloto (identifica su nacionalidad), no un icono
// decorativo: se conserva. El resto de la interfaz es sobria y sin pictogramas.
export function flagOf(code?: string | null): string {
  const n = NATIONALITIES.find((c) => c.code === code);
  return n ? n.flag : '🏁';
}

// Mapa de estados de ticket → etiqueta + color (kiosco / taquilla)
// Máquina de estados unificada (PROMPT MAESTRO):
//   PENDIENTE -> ASIGNADO -> LLAMANDO -> PREPARADO -> ACTIVO -> FINALIZADO
//   +AUSENTE (no se presentó, puede rellamarse) + REZAGADO (nunca se presentó,
//   se elimina del evento y vuelve a pendientes) + USADO / REVOCADO (terminales)
export const ESTADO_TICKET: Record<string, { label: string; color: string }> = {
  PENDIENTE: { label: 'Pendiente de pago', color: '#d97706' },
  ASIGNADO: { label: 'Asignado', color: '#3b82f6' },
  LLAMANDO: { label: 'Llamando a vestidores', color: '#3b82f6' },
  PREPARADO: { label: 'Listo para correr', color: '#16a34a' },
  ACTIVO: { label: 'En pista', color: '#16a34a' },
  FINALIZADO: { label: 'Finalizado', color: '#5f7095' },
  AUSENTE: { label: 'Ausente (rellamable)', color: '#dc2626' },
  REZAGADO: { label: 'Rezagado (fuera del evento)', color: '#b91c1c' },
  USADO: { label: 'Usado', color: '#5f7095' },
  REVOCADO: { label: 'Revocado', color: '#dc2626' },
};

// Estados terminales del ticket (no reasignables).
export const ESTADOS_TICKET_TERMINALES = ['FINALIZADO', 'USADO', 'REVOCADO'];

// Mapa de estados de evento → etiqueta + color (cards de eventos)
//   pendiente | llamando | preparada | activo | finalizado | incompleto | insuficiente | cancelado
export const ESTADO_EVENTO: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: '#d97706' },
  llamando: { label: 'Llamando', color: '#3b82f6' },
  preparada: { label: 'Preparado', color: '#16a34a' },
  activo: { label: 'En curso', color: '#ea580c' },
  finalizado: { label: 'Finalizado', color: '#5f7095' },
  incompleto: { label: 'Faltan pilotos', color: '#dc2626' },
  insuficiente: { label: 'Insuficiente', color: '#94a3b8' },
  cancelado: { label: 'Cancelado', color: '#94a3b8' },
};

// Eventos que NO pueden recibir tickets (no seleccionables).
export const EVENTOS_NO_SELECCIONABLES = ['finalizado', 'cancelado', 'insuficiente'];

export function eventoLabel(estado?: string | null): string {
  return (estado && ESTADO_EVENTO[estado]?.label) || '—';
}

export function eventoColor(estado?: string | null): string {
  return (estado && ESTADO_EVENTO[estado]?.color) || '#94a3b8';
}
