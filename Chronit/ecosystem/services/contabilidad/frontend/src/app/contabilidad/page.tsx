// =============================================================================
// CHRONIT ECOSYSTEM — Contabilidad (/contabilidad)
// -----------------------------------------------------------------------------
// Consola financiera con pestañas:
//   Resumen · Ventas · Egresos · Cierres · Reportes · Conciliación QR ·
//   Propinas · Catálogo · Cuentas destino · Impuestos · Configuración ·
//   Notas de crédito · Anticipos · Cartera · Compras · Nómina · Activos ·
//   Asientos · Administración (alertas/SIAT/backup)
//
// REGLA DE ORO: los reportes y listados leen SNAPSHOTS (precio, IVA, descuento,
// cajero, cuenta responsable). Nunca se recalcula el pasado.
//
// Roles: contador / socio / dueño / supervisor / admin (+ desarrollador).
// socio y dueño son de SOLO LECTURA.
// =============================================================================
'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import GuardLoading from '@/components/GuardLoading';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { TICKETS_FRONTEND_URL } from '@/lib/api';

import Resumen from '@/components/conta/Resumen';
import Ventas from '@/components/conta/Ventas';
import Egresos from '@/components/conta/Egresos';
import Cierres from '@/components/conta/Cierres';
import Reportes from '@/components/conta/Reportes';
import Conciliacion from '@/components/conta/Conciliacion';
import Propinas from '@/components/conta/Propinas';
import Catalogo from '@/components/conta/Catalogo';
import Cuentas, { Impuestos } from '@/components/conta/Cuentas';
import Configuracion from '@/components/conta/Configuracion';
import NotasCredito from '@/components/conta/NotasCredito';
import Anticipos from '@/components/conta/Anticipos';
import Cartera from '@/components/conta/Cartera';
import Compras from '@/components/conta/Compras';
import Nomina from '@/components/conta/Nomina';
import Activos from '@/components/conta/Activos';
import Asientos from '@/components/conta/Asientos';
import AdminConta from '@/components/conta/AdminConta';

const TABS = [
  ['resumen', 'Resumen'],
  ['ventas', 'Ventas'],
  ['egresos', 'Egresos'],
  ['cierres', 'Cierres'],
  ['reportes', 'Reportes'],
  ['conciliacion', 'Conciliación QR'],
  ['propinas', 'Propinas'],
  ['catalogo', 'Catálogo'],
  ['cuentas', 'Cuentas destino'],
  ['impuestos', 'Impuestos'],
  ['configuracion', 'Configuración'],
  ['notas-credito', 'Notas de crédito'],
  ['anticipos', 'Anticipos'],
  ['cartera', 'Cartera (CxC/CxP)'],
  ['compras', 'Compras'],
  ['nomina', 'Nómina'],
  ['activos', 'Activos fijos'],
  ['asientos', 'Asientos'],
  ['admin', 'Admin (Alertas/SIAT/Backup)'],
] as const;

type Tab = typeof TABS[number][0];

export default function ContabilidadPage() {
  const { ready, user } = useAuthGuard(['contador', 'socio', 'dueno', 'supervisor', 'admin']);
  const [tab, setTab] = useState<Tab>('resumen');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const ok = useCallback((m: string) => { setMsg(m); setError(''); }, []);
  const ko = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setMsg('');
  }, []);

  if (!ready) return <GuardLoading />;

  const rol = user?.rol || '';
  const soloLectura = ['socio', 'dueno'].includes(rol);
  const esSupervisor = ['supervisor', 'admin', 'desarrollador'].includes(rol);
  const puedeGestion = ['contador', 'supervisor', 'admin', 'desarrollador'].includes(rol);
  const esAdmin = ['admin', 'desarrollador'].includes(rol);

  return (
    <>
      <Navbar />
      <main style={{ padding: 20, maxWidth: 1280, margin: '0 auto' }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Contabilidad CHRONIT</h2>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a href={`${TICKETS_FRONTEND_URL}/caja`} className="btn btn-primary">Caja de carreras</a>
              {esSupervisor && <Link href="/admin/configuracion" className="btn">Configuración</Link>}
              {esSupervisor && <Link href="/admin/usuarios" className="btn">Usuarios</Link>}
            </div>
          </div>
          {soloLectura && (
            <p style={{ color: '#f59e0b', fontSize: '0.8rem', margin: '8px 0 0' }}>
              Tu rol ({rol}) es de <b>solo lectura</b>: puedes consultar reportes, conciliación y
              balances, pero no registrar movimientos.
            </p>
          )}
        </div>

        {msg && <p className="card" style={{ color: '#22c55e', padding: 12 }}>{msg}</p>}
        {error && <p className="card" style={{ color: '#ef4444', padding: 12 }}>{error}</p>}

        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {TABS.map(([k, etiqueta]) => (
            <button key={k} className={`btn ${tab === k ? 'btn-primary' : ''}`}
              onClick={() => { setTab(k as Tab); setMsg(''); setError(''); }}>
              {etiqueta}
            </button>
          ))}
        </div>

        {tab === 'resumen' && <Resumen onError={ko} />}
        {tab === 'ventas' && <Ventas esSupervisor={esSupervisor} soloLectura={soloLectura} ok={ok} ko={ko} />}
        {tab === 'egresos' && <Egresos soloLectura={soloLectura} ok={ok} ko={ko} />}
        {tab === 'cierres' && <Cierres esSupervisor={esSupervisor} soloLectura={soloLectura} ok={ok} ko={ko} />}
        {tab === 'reportes' && <Reportes ko={ko} />}
        {tab === 'conciliacion' && <Conciliacion puedeConciliar={puedeGestion && !soloLectura} ok={ok} ko={ko} />}
        {tab === 'propinas' && <Propinas esSupervisor={esSupervisor} soloLectura={soloLectura} ok={ok} ko={ko} />}
        {tab === 'catalogo' && <Catalogo puedeGestion={puedeGestion && !soloLectura} ok={ok} ko={ko} />}
        {tab === 'cuentas' && (
          <Cuentas puedeGestion={puedeGestion && !soloLectura} esSupervisor={esSupervisor && !soloLectura} ok={ok} ko={ko} />
        )}
        {tab === 'impuestos' && <Impuestos puedeGestion={puedeGestion && !soloLectura} ok={ok} ko={ko} />}
        {tab === 'configuracion' && (
          esSupervisor
            ? <Configuracion rol={rol} />
            : (
              <section className="card">
                <h3 style={{ marginTop: 0 }}>Configuración</h3>
                <p style={{ color: '#8aa4c7', fontSize: '0.85rem' }}>
                  La edición de la configuración está reservada a <b>supervisor</b> o superior. Puedes
                  consultar los valores vigentes en la pestaña de reportes.
                </p>
              </section>
            )
        )}
        {tab === 'notas-credito' && (
          <NotasCredito esSupervisor={esSupervisor} soloLectura={soloLectura} puedeGestion={puedeGestion} ok={ok} />
        )}
        {tab === 'anticipos' && (
          <Anticipos esSupervisor={esSupervisor} soloLectura={soloLectura} puedeGestion={puedeGestion} ok={ok} />
        )}
        {tab === 'cartera' && (
          <Cartera soloLectura={soloLectura} puedeGestion={puedeGestion} ok={ok} />
        )}
        {tab === 'compras' && (
          <Compras soloLectura={soloLectura} puedeGestion={puedeGestion} ok={ok} />
        )}
        {tab === 'nomina' && (
          <Nomina soloLectura={soloLectura} puedeGestion={puedeGestion} ok={ok} />
        )}
        {tab === 'activos' && (
          <Activos soloLectura={soloLectura} puedeGestion={puedeGestion} ok={ok} />
        )}
        {tab === 'asientos' && (
          <Asientos soloLectura={soloLectura} puedeGestion={puedeGestion} ok={ok} />
        )}
        {tab === 'admin' && (
          <AdminConta soloLectura={soloLectura} esSupervisor={esSupervisor} esAdmin={esAdmin} ok={ok} />
        )}
      </main>
    </>
  );
}
