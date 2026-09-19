-- =============================================================================
-- CHRONIT ECOSYSTEM — Módulo de CONTABILIDAD (v2)
-- Migración 0017: cuentas contables adicionales para asientos automáticos
-- -----------------------------------------------------------------------------
-- Idempotente (ON CONFLICT DO NOTHING). Complementa el plan de cuentas de la
-- migración 0016 con las cuentas que necesitan los asientos automáticos de
-- propinas (pasivo) y de compras (IVA crédito fiscal).
-- =============================================================================

INSERT INTO conta_cuentas_contables (codigo, nombre, tipo, padre_id)
SELECT v.codigo, v.nombre, v.tipo, p.id
  FROM (VALUES
    ('2105', 'Propinas por Pagar',   'pasivo'),
    ('2106', 'IVA Crédito Fiscal',   'activo'),
    ('1105', 'Anticipos a Proveedores', 'activo'),
    ('4103', 'Otros Ingresos',       'ingreso')
  ) AS v(codigo, nombre, tipo)
  JOIN conta_cuentas_contables p ON p.codigo = CASE
        WHEN v.tipo = 'activo'  THEN '1'
        WHEN v.tipo = 'pasivo'  THEN '2'
        WHEN v.tipo = 'ingreso' THEN '4'
        ELSE '6' END
ON CONFLICT (codigo) DO NOTHING;
