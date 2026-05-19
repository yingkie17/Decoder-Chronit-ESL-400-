
#!/usr/bin/env python3
import os

# Ruta al archivo dashboard.js
file_path = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'src', 'static', 'js', 'dashboard.js'
)

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Buscar y reemplazar el estilo rojo
old_style = 'style="background:red; color:white;"'
new_style = ''
content = content.replace(old_style, new_style)

# Guardar el archivo
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Estilo rojo de la columna de velocidad eliminado correctamente!")

