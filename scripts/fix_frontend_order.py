
#!/usr/bin/env python3
import os

# Ruta al archivo dashboard.js
file_path = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'src', 'static', 'js', 'dashboard.js'
)

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Buscar y reemplazar el bloque (tablero público)
old_block_public = '''                &lt;td class="best-lap"&gt;${best}&lt;/td&gt;
                &lt;td&gt;${speedsMap[d.driver_id] ? Math.round(speedsMap[d.driver_id]) + ' km/h' : '--'}&lt;/td&gt;
                &lt;td&gt;${last}&lt;/td&gt;'''
new_block_public = '''                &lt;td class="best-lap"&gt;${best}&lt;/td&gt;
                &lt;td&gt;${last}&lt;/td&gt;
                &lt;td&gt;${speedsMap[d.driver_id] ? Math.round(speedsMap[d.driver_id]) + ' km/h' : '--'}&lt;/td&gt;'''

content = content.replace(old_block_public, new_block_public)

# Guardar el archivo
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Archivo dashboard.js actualizado correctamente!")

