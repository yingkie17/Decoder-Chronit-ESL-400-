// =============================================================================
// CHRONIT ECOSYSTEM — CRM: hook de listado reutilizable
// -----------------------------------------------------------------------------
// Concentra el comportamiento común de TODAS las vistas del CRM: filtros
// aplicados sólo al pulsar Buscar, paginación, manejo de errores y exportación
// CSV con los mismos filtros. Cada página sólo declara su endpoint, su estado
// inicial de filtros y sus columnas.
//
// Las consultas se auditan en el backend (crm_auditoria) de forma automática.
// =============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import { crmApi, crmDescargar } from '@/lib/api';

export interface Paginacion {
  total: number;
  page: number;
  limit: number;
  paginas: number;
}

interface RespuestaListado<T> {
  datos: T[];
  paginacion: Paginacion;
}

export function useListadoCrm<T = Record<string, unknown>>(
  endpoint: string,
  filtrosIniciales: Record<string, string>,
  limite = 50,
) {
  const [filtros, setFiltros] = useState<Record<string, string>>(filtrosIniciales);
  const [aplicados, setAplicados] = useState<Record<string, string>>(filtrosIniciales);
  const [page, setPage] = useState(1);
  const [datos, setDatos] = useState<T[]>([]);
  const [paginacion, setPaginacion] = useState<Paginacion>({ total: 0, page: 1, limit: limite, paginas: 1 });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  // Arma la query con los filtros no vacíos + paginación (+ extras como formato).
  const construirQuery = useCallback(
    (f: Record<string, string>, p: number, extra?: Record<string, string>) => {
      const sp = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => {
        if (v !== '' && v !== undefined && v !== null) sp.set(k, v);
      });
      sp.set('page', String(p));
      sp.set('limit', String(limite));
      if (extra) Object.entries(extra).forEach(([k, v]) => sp.set(k, v));
      return sp.toString();
    },
    [limite],
  );

  const cargar = useCallback(
    async (f: Record<string, string>, p: number) => {
      setCargando(true);
      setError('');
      try {
        const res = await crmApi<RespuestaListado<T>>(`${endpoint}?${construirQuery(f, p)}`);
        setDatos(res.datos || []);
        setPaginacion(res.paginacion);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setDatos([]);
      } finally {
        setCargando(false);
      }
    },
    [endpoint, construirQuery],
  );

  // Recarga cuando cambian los filtros aplicados o la página.
  useEffect(() => {
    void cargar(aplicados, page);
  }, [cargar, aplicados, page]);

  const campo = (clave: string, valor: string) => setFiltros((f) => ({ ...f, [clave]: valor }));

  // Aplica los filtros escritos y vuelve a la primera página.
  const buscar = () => {
    setAplicados({ ...filtros });
    setPage(1);
  };

  const limpiar = () => {
    setFiltros({ ...filtrosIniciales });
    setAplicados({ ...filtrosIniciales });
    setPage(1);
  };

  // Descarga CSV con los filtros aplicados (sin paginación).
  const exportar = async (nombreArchivo: string) => {
    try {
      await crmDescargar(`${endpoint}?${construirQuery(aplicados, 1, { formato: 'csv' })}`, nombreArchivo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    filtros, campo, page, setPage, datos, paginacion, cargando, error,
    buscar, limpiar, exportar,
  };
}

/** Nombre de archivo CSV con la fecha del día (espejo del backend). */
export function nombreCSV(base: string): string {
  const hoy = new Date().toISOString().slice(0, 10);
  return `crm_${base}_${hoy}.csv`;
}
