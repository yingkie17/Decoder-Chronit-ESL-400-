// =============================================================================
// CHRONIT ECOSYSTEM — PANEL CONTABLE: acceso
// -----------------------------------------------------------------------------
// Autentica contra el backend de tickets (misma sesión del ecosistema) y sólo
// deja entrar a los roles con competencia financiera. El resto de roles es
// redirigido a su sistema con un mensaje explícito.
// =============================================================================
'use client';

import { useState } from 'react';
import { api, setSession } from '@/lib/api';

const ROLES_CONTABLES = ['contador', 'socio', 'dueno', 'supervisor', 'admin', 'desarrollador'];

export default function LoginPage() {
  const [carnet, setCarnet] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [cargando, setCargando] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setCargando(true);
    try {
      const data = await api<{ token?: string; user: { rol?: string } }>('/api/auth/login', {
        method: 'POST',
        body: { carnet, password },
      });
      if (!ROLES_CONTABLES.includes(data.user?.rol || '')) {
        setMsg('Tu cuenta no tiene acceso al panel contable. Ingresa desde el sistema de tickets.');
        setCargando(false);
        return;
      }
      setSession(data.token ?? null, data.user);
      window.location.href = '/contabilidad';
    } catch (err) {
      setMsg((err as Error).message);
      setCargando(false);
    }
  };

  return (
    <div className="login-fondo">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="CHRONIT" style={{ height: 44, width: 'auto' }} />
          <div>
            <h1 className="login-titulo">Contabilidad</h1>
            <p className="login-sub">Panel financiero y fiscal</p>
          </div>
        </div>

        <label className="label">Carnet o correo</label>
        <input
          className="input"
          value={carnet}
          onChange={(e) => setCarnet(e.target.value)}
          placeholder="Ej: CONTADOR-001"
          autoComplete="username"
          required
        />

        <label className="label">Contraseña</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />

        {msg && <p className="login-error">{msg}</p>}

        <button className="btn btn-primary login-boton" type="submit" disabled={cargando}>
          {cargando ? 'Verificando…' : 'Ingresar'}
        </button>

        <p className="login-nota">
          Acceso restringido a contador, supervisor, dirección y administración.
        </p>
      </form>
    </div>
  );
}
