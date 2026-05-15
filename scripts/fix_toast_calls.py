
#!/usr/bin/env python3
import os
import re

file_path = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'src', 'static', 'js', 'dashboard.js'
)

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Lista de reemplazos para corregir las llamadas a showToast
replacements = [
    # (old_pattern, new_pattern)
    (r"showToast\('⚠️',\s*'Sesión expirada. Por favor inicia sesión nuevamente.',\s*'warning'\)", r"showToast('Sesión expirada', 'Por favor inicia sesión nuevamente.', 'warning')"),
    (r"showToast\('✅','Configuración Guardada','success'\)", r"showToast('Configuración guardada', 'Los cambios se han guardado correctamente.', 'success')"),
    (r"showToast\('El ID debe ser un número',\s*'error'\)", r"showToast('Error', 'El ID debe ser un número válido.', 'error')"),
    (r"showToast\(res\.error \|\| 'Error al actualizar',\s*'error'\)", r"showToast('Error', res.error || 'No se pudo actualizar el transponder.', 'error')"),
    (r"showToast\('❌',\s*'Transponder no encontrado',\s*'error'\)", r"showToast('Error', 'Transponder no encontrado.', 'error')"),
    (r"showToast\('❌',\s*'El ID debe ser un número',\s*'error'\)", r"showToast('Error', 'El ID debe ser un número válido.', 'error')"),
    (r"showToast\('❌',\s*`El ID \$\{newId\} ya existe`,\s*'error'\)", r"showToast('Error', `El ID ${newId} ya está en uso.`, 'error')"),
    (r"showToast\('❌',\s*idRes\?.error \|\| 'Error al cambiar ID',\s*'error'\)", r"showToast('Error', idRes?.error || 'No se pudo cambiar el ID.', 'error')"),
]

for old, new in replacements:
    content = re.sub(old, new, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Llamadas a showToast corregidas correctamente!")

