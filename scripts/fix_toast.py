
#!/usr/bin/env python3
import os

file_path = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'src', 'static', 'js', 'dashboard.js'
)

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

old_function = '''    function showToast(title, message, type = 'info') {
        // type puede ser: 'success', 'error', 'warning', 'info'
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.backgroundColor = type === 'success' ? '#1e7e34' : (type === 'error' ? '#dc3545' : (type === 'warning' ? '#ffc107' : '#17a2b8'));
        toast.style.color = 'white';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '8px';
        toast.style.zIndex = '10001';
        toast.style.fontSize = '0.9rem';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        toast.innerText = `${title}: ${message}`;
        document.body.appendChild(toast);
        
        setTimeout(() =&gt; {
            toast.style.opacity = '0';
            setTimeout(() =&gt; toast.remove(), 500);
        }, 3000);
    }'''

new_function = '''    function showToast(title, message, type = 'info') {
        // Normalizar el tipo para que siempre sea válido
        const validTypes = ['success', 'error', 'warning', 'info'];
        const normalizedType = validTypes.includes(type) ? type : 'info';

        // Colores definidos para cada tipo
        const colors = {
            success: { bg: '#28a745', text: '#ffffff' },
            error: { bg: '#dc3545', text: '#ffffff' },
            warning: { bg: '#ffc107', text: '#212529' },
            info: { bg: '#17a2b8', text: '#ffffff' }
        };

        const colorConfig = colors[normalizedType];

        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.backgroundColor = colorConfig.bg;
        toast.style.color = colorConfig.text;
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '8px';
        toast.style.zIndex = '10001';
        toast.style.fontSize = '0.9rem';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        toast.style.transition = 'opacity 0.3s ease';
        toast.style.opacity = '0';
        
        // Estructura HTML mejorada con título y mensaje
        toast.innerHTML = `
            &lt;div style="font-weight: bold; margin-bottom: 4px;"&gt;${title}&lt;/div&gt;
            &lt;div style="font-size: 0.85rem; opacity: 0.9;"&gt;${message}&lt;/div&gt;
        `;
        
        document.body.appendChild(toast);

        // Animación de entrada
        requestAnimationFrame(() =&gt; {
            toast.style.opacity = '1';
        });

        // Eliminar toast después de 3 segundos
        setTimeout(() =&gt; {
            toast.style.opacity = '0';
            setTimeout(() =&gt; {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }, 3000);
    }'''

content = content.replace(old_function, new_function)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Función showToast actualizada correctamente!")

