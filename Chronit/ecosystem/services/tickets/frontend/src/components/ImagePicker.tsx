// =============================================================================
// CHRONIT TICKETS — Selector de imagen (Client Component)
// -----------------------------------------------------------------------------
// Selector reutilizable para el kiosco (creación de piloto) con:
//   - Cámara del dispositivo (getUserMedia) y captura en tiempo real.
//   - Almacenamiento local (input file).
//   - Gestión de permisos con mensajes de error claros.
//   - Validación de formato (JPG/PNG/WebP) y tamaño (5 MB).
//   - Vista previa + recorte básico al formato requerido (aspect ratio).
// Devuelve la imagen final recortada como data URL mediante `onChange`.
// =============================================================================
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ACCEPTED_IMAGE_ATTR,
  MAX_IMAGE_MB,
  cameraErrorMessage,
  validateImageFile,
} from '@/lib/imageValidation';

interface Props {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
  /** Relación de aspecto del recorte. 1 = cuadrado (foto). */
  aspect?: number;
  /** Lado mayor (px) de la imagen final. */
  outputSize?: number;
  shape?: 'circle' | 'rect';
  /** Texto del botón de galería. */
  label?: string;
  disabled?: boolean;
}

const STAGE_W = 320;

export default function ImagePicker({
  value,
  onChange,
  aspect = 1,
  outputSize = 512,
  shape = 'circle',
  label = 'Subir foto',
  disabled = false,
}: Props) {
  const STAGE_H = Math.round(STAGE_W / aspect);

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Dimensiones naturales de la imagen y escala "cover" base (zoom = 1).
  const [imgDim, setImgDim] = useState({ w: 0, h: 0 });
  const [base, setBase] = useState(1);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  // Detiene la cámara al desmontar.
  useEffect(() => () => stopCamera(), []);

  // Conecta el stream al <video> cuando se abre la cámara.
  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOpen]);

  const clampOffset = (x: number, y: number, z: number) => {
    if (!imgDim.w || !imgDim.h) return { x, y };
    const scale = base * z;
    const dw = imgDim.w * scale;
    const dh = imgDim.h * scale;
    return {
      x: Math.max(Math.min(0, STAGE_W - dw), Math.min(0, x)),
      y: Math.max(Math.min(0, STAGE_H - dh), Math.min(0, y)),
    };
  };

  const startCrop = (dataUrl: string) => {
    setReady(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImgDim({ w: 0, h: 0 });
    setCropSrc(dataUrl);
  };

  const closeCrop = () => {
    setCropSrc(null);
    setReady(false);
  };

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const b = Math.max(STAGE_W / w, STAGE_H / h);
    const dw = w * b;
    const dh = h * b;
    setImgDim({ w, h });
    setBase(b);
    setOffset({
      x: Math.max(Math.min(0, STAGE_W - dw), Math.min(0, (STAGE_W - dw) / 2)),
      y: Math.max(Math.min(0, STAGE_H - dh), Math.min(0, (STAGE_H - dh) / 2)),
    });
    setReady(true);
  };

  const openCamera = async () => {
    setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Tu navegador no soporta el acceso a la cámara.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (e) {
      setError(cameraErrorMessage(e));
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    stopCamera();
    startCrop(dataUrl);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const check = validateImageFile(file);
    if (!check.ok) {
      setError(check.error || 'Imagen no válida.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => startCrop(reader.result as string);
    reader.onerror = () => setError('No se pudo leer la imagen seleccionada.');
    reader.readAsDataURL(file);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clampOffset(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y), zoom));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const confirmCrop = () => {
    const img = imgRef.current;
    if (!img || !ready) return;
    const scale = base * zoom;
    const sw = STAGE_W / scale;
    const sh = STAGE_H / scale;
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const outW = outputSize;
    const outH = Math.round(outputSize / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    onChange(canvas.toDataURL('image/jpeg', 0.9));
    closeCrop();
  };

  const radius = shape === 'circle' ? '50%' : 12;
  const previewSize = aspect === 1 ? 88 : 120;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        style={{
          width: previewSize,
          height: aspect === 1 ? previewSize : Math.round(previewSize / aspect),
          borderRadius: radius,
          overflow: 'hidden',
          background: '#1b2130',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
        }}
      >
        {value && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Vista previa" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="kiosk-btn kiosk-btn-sm" disabled={disabled} onClick={openCamera}>
            Cámara
          </button>
          <button type="button" className="kiosk-btn kiosk-btn-sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
            {label}
          </button>
        </div>
        <span style={{ color: '#8aa4c7', fontSize: '0.78rem' }}>JPG, PNG o WebP · máx. {MAX_IMAGE_MB} MB</span>
        {error && <span style={{ color: '#f87171', fontSize: '0.82rem' }}>{error}</span>}
      </div>

      <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_ATTR} onChange={onFile} style={{ display: 'none' }} />

      {/* Modal: cámara en vivo */}
      {cameraOpen && (
        <div className="modal-overlay" onClick={stopCamera}>
          <div className="modal fade-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, textAlign: 'center' }}>
            <h3 style={{ marginBottom: 12 }}>Capturar foto</h3>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 360, objectFit: 'cover' }}
            />
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
              <button type="button" className="kiosk-btn" onClick={stopCamera}>
                Cancelar
              </button>
              <button type="button" className="kiosk-btn kiosk-btn-primary" onClick={capture}>
                Capturar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: vista previa + recorte */}
      {cropSrc && (
        <div className="modal-overlay" onClick={closeCrop}>
          <div className="modal fade-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, textAlign: 'center' }}>
            <h3 style={{ marginBottom: 12 }}>Ajusta tu imagen</h3>
            <div
              style={{
                position: 'relative',
                width: STAGE_W,
                height: STAGE_H,
                margin: '0 auto',
                overflow: 'hidden',
                borderRadius: radius,
                background: '#000',
                touchAction: 'none',
                cursor: 'grab',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={cropSrc}
                alt="Recorte"
                onLoad={onImgLoad}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: offset.x,
                  top: offset.y,
                  width: imgDim.w * base * zoom || 'auto',
                  height: imgDim.h * base * zoom || 'auto',
                  maxWidth: 'none',
                  userSelect: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 4px 6px' }}>
              <span style={{ color: '#8aa4c7', fontSize: '0.8rem' }}>Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => {
                  const z = Number(e.target.value);
                  setZoom(z);
                  setOffset((o) => clampOffset(o.x, o.y, z));
                }}
                style={{ flex: 1 }}
              />
            </div>
            <p style={{ color: '#8aa4c7', fontSize: '0.8rem', marginBottom: 12 }}>
              Arrastra para mover y usa el zoom para ajustar.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button type="button" className="kiosk-btn" onClick={closeCrop}>
                Cancelar
              </button>
              <button type="button" className="kiosk-btn kiosk-btn-success" onClick={confirmCrop} disabled={!ready}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
