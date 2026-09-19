// =============================================================================
// CHRONIT WEB CLIENT — Cabecera de perfil (Client Component)
// -----------------------------------------------------------------------------
// Muestra la foto de portada, la foto de perfil solapada, el nombre/bio y un
// icono de lápiz que abre/cierra el editor de perfil (estilo Facebook).
// =============================================================================
'use client';

import { useState } from 'react';
import ProfileEditor from './ProfileEditor';
import UserAvatar from './UserAvatar';
import { flagOf } from '@/lib/constants';
import { DEFAULT_COVER } from '@/lib/assets';
import { useImageUrl } from '@/lib/imageClient';

interface Props {
  user: {
    id: number;
    nombre: string;
    apellido: string;
    email: string | null;
    telefono: string | null;
    carnet: string;
    nacionalidad: string | null;
    edad: number | null;
    genero: string | null;
    foto: string | null;
    portada: string | null;
  };
}

export default function ProfileHero({ user }: Props) {
  const [edit, setEdit] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const coverResolved = useImageUrl(user.portada);
  const cover = !coverResolved || coverBroken ? DEFAULT_COVER : coverResolved;
  const nombre = `${user.nombre} ${user.apellido}`.trim();
  const bio = [
    user.edad ? `${user.edad} años` : null,
    user.genero ? (user.genero === 'femenino' ? 'Femenino' : user.genero === 'masculino' ? 'Masculino' : user.genero) : null,
    user.nacionalidad ? flagOf(user.nacionalidad) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Portada */}
      <div style={{ position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover} alt="" className="cover" onError={() => setCoverBroken(true)} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.55))' }} />
      </div>

      {/* Perfil solapado */}
      <div className="profile-head">
        <UserAvatar foto={user.foto} className="avatar avatar-xl" />
        <div style={{ paddingBottom: 10, flex: 1, minWidth: 200 }}>
          <h1 style={{ fontSize: '1.7rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            {nombre} {flagOf(user.nacionalidad)}
          </h1>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {bio || `Piloto ${user.carnet ? `· Carnet ${user.carnet}` : ''}`}
          </div>
        </div>
        <button
          className="btn"
          onClick={() => setEdit((v) => !v)}
          style={{ marginBottom: 10 }}
          title="Editar perfil"
        >
          {edit ? '✕ Cerrar' : '✏️ Editar'}
        </button>
      </div>

      {/* Editor (colapsable) */}
      {edit && (
        <div style={{ padding: '16px 24px 24px' }} className="fade-in">
          <ProfileEditor user={user} />
        </div>
      )}
    </div>
  );
}
