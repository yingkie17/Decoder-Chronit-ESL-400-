-- =============================================================================
-- CHRONIT ECOSYSTEM — Migración 0004: Roles del PROMPT MAESTRO
-- -----------------------------------------------------------------------------
-- Reemplaza el set de roles (piloto/taquilla/vestidor/admin) por:
--   piloto (público) | cajero | coordinador | admin | desarrollador
-- Remapea usuarios existentes: taquilla -> cajero, vestidor -> coordinador.
-- =============================================================================

-- 1) Insertar/actualizar los roles base del prompt. 'piloto' y 'admin' ya existen.
INSERT INTO roles (nombre, permisos) VALUES
    ('cajero',        '{"registrar": true, "pagar": true, "asignar_evento": true, "ver_reportes": false}'),
    ('coordinador',   '{"llamar": true, "marcar_ready": true, "gestionar_vestidores": true, "ver_reportes": false}'),
    ('desarrollador', '{"gestionar_usuarios": true, "gestionar_eventos": true, "configurar_pantalla": true, "ver_reportes": true, "gestionar_roles": true}')
ON CONFLICT (nombre) DO UPDATE SET permisos = EXCLUDED.permisos;

-- 'admin' mantiene todos los permisos de gestión
INSERT INTO roles (nombre, permisos) VALUES
    ('admin', '{"configurar_pantalla": true, "gestionar_usuarios": true, "gestionar_eventos": true, "ver_reportes": true, "gestionar_roles": true, "gestionar_vestidores": true}')
ON CONFLICT (nombre) DO UPDATE SET permisos = EXCLUDED.permisos;

-- 2) Remapear usuarios existentes a los nuevos nombres de rol.
UPDATE usuarios SET rol = 'cajero'      , actualizado_en = now() WHERE rol = 'taquilla';
UPDATE usuarios SET rol = 'coordinador' , actualizado_en = now() WHERE rol = 'vestidor';

-- 3) Eliminar los roles legacy solo si ya no los referencia ningún usuario.
DELETE FROM roles
WHERE nombre IN ('taquilla', 'vestidor')
  AND NOT EXISTS (SELECT 1 FROM usuarios WHERE rol = roles.nombre);
