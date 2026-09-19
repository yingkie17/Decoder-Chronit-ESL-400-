// =============================================================================
// CHRONIT ECOSYSTEM — Pantalla de carga mientras se valida el acceso
// -----------------------------------------------------------------------------
// Evita que se muestre el contenido de un módulo protegido antes de verificar
// la sesión en el frontend.
// =============================================================================
'use client';

export default function GuardLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#8aa4c7',
        fontWeight: 600,
      }}
    >
      Verificando acceso…
    </div>
  );
}
