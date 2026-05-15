# 🏁 CHRONIT Racing System

Sistema profesional de cronometraje para karts y deportes de motor. Conecta con decoder **ESL-400** por USB, detecta transponders y gestiona carreras en tiempo real.

---

## ✨ Características principales

- ✅ **Detección de transponders** vía ESL-400 (USB)
- ✅ **API REST** completa
- ✅ **Dashboard web** con 7 paneles:
  - Tablero Público (pantalla principal)
  - Control de Carrera (admin)
  - Paddock Live Feed (público)
  - Pit Wall Monitor (TV)
  - Gestión de Pilotos (CRUD)
  - Gestión de Transponders (manual + semiautomático)
  - Sistema y Mantenimiento
- ✅ **Base de datos SQLite** persistente
- ✅ **Control de carrera completo** (iniciar/pausar/reanudar/finalizar/repetir/resetear)
- ✅ **Dos modos de carrera**:
  - *Position Race*: gana el primero en completar las vueltas
  - *Time Attack*: gana el mejor tiempo acumulado
- ✅ **Cronometraje Individual** con selector de fuente de tiempo:
  - Servidor (filtra señales fantasmas)
  - Decoder (máxima precisión)
- ✅ **Filtro anti-señales fantasmas** (tiempo mínimo configurable)
- ✅ **Autenticación de usuarios** con sesiones persistentes
- ✅ **Botón de IP de conexión** con código QR para celulares
- ✅ **Monitor de señales en vivo**
- ✅ **Configuración de antena** (umbral H + tiempo filtro)
- ✅ **Salud y desgaste de transponders**
- ✅ **Respaldos automáticos** de base de datos y pilotos
- ✅ **Limpieza segura** de datos de carrera
- ✅ **Dockerizado** (fácil instalación)

---

## 📁 Estructura del proyecto
Chronit/
├── src/
│ ├── main.py # Lector del decoder (CONGELADO)
│ ├── api.py # API REST (solo AGREGAR endpoints)
│ ├── database.py # Base de datos (solo AGREGAR tablas)
│ ├── users_db.py # Autenticación y sesiones
│ ├── cleanup.py # Mantenimiento de BD
│ └── templates/
│ └── dashboard.html # Interfaz web
├── infrastructure/
│ ├── docker-compose.yml
│ └── Dockerfile
├── data/ # Base de datos persistente
├── scripts/ # Utilidades
└── constitution/ # Reglas del proyecto

---

## 🚀 Instalación y puesta en marcha

### Requisitos
- **Docker** y **Docker Compose** v2
- Puerto USB disponible (`/dev/ttyUSB0` en Linux, `COMx` en Windows)

### Linux

```bash
# Clonar repositorio
git clone https://github.com/yingkie17/Decoder-Chronit-ESL-400-.git
cd Decoder-Chronit-ESL-400-

# Copiar configuración
cp .env.example .env

# Editar .env con el puerto serial (ej: SERIAL_PORT=/dev/ttyUSB0)
nano .env

# Iniciar sistema
cd infrastructure
docker compose up --build
🌐 Acceso
Servicio	URL
Dashboard principal	http://localhost:5000
Base de datos (chronit.db)	http://localhost:8880
Usuarios (users.db)	http://localhost:8881
Respaldos temporales	http://localhost:8883
Credenciales por defecto
Usuario: admin

Contraseña: admin123

🎮 Uso básico
Registrar pilotos → Panel "Pilotos"

Asignar transponders → Panel "Transponders" (detección automática o manual)

Inscribir pilotos a carrera → Panel "Pilotos" → "Inscribir"

Configurar carrera → Panel "Carrera" (nombre, vueltas, modo)

Iniciar carrera → Panel "Control de Carrera" → "Iniciar Carrera"

Ver resultados → Tablero Público o "Mostrar Ganadores"

⚙️ Configuración avanzada
Fuente de tiempo (Cronometraje)
Servidor (recomendado): filtra señales fantasmas con tiempo mínimo por vuelta

Decoder: tiempo preciso del hardware (sin filtro)

Antena
Umbral mínimo H: señales por debajo se ignoran

Tiempo filtro: evita detecciones repetidas rápidas

🛠️ Mantenimiento
Limpieza de datos
bash
cd infrastructure
docker compose down -v
docker system prune -a -f
docker compose up --build
Respaldos automáticos
Se guardan en data/backups/

Se pueden restaurar desde el panel "Sistema"

Logs
bash
docker compose logs -f
📜 Reglas del proyecto (Constitución)
❌ NO modificar main.py

❌ NO modificar endpoints existentes

❌ NO modificar tablas existentes

✅ Solo AGREGAR nuevas funcionalidades

✅ Probar un cambio a la vez

✅ Respetar la Constitución (ver constitution/)

🐛 Solución de problemas
Problema	Solución
El puerto USB no se detecta	sudo chmod 666 /dev/ttyUSB0
Error Errno 5	Reiniciar Docker: docker compose down && up
No se inicia la carrera	Verificar que haya pilotos inscritos
El QR no funciona	Usar la IP manual desde hostname -I
📝 Scripts útiles
Script	Uso
scripts/start.sh	Inicio con detección USB
scripts/restart.sh	Reinicio vía API
scripts/reset-race.sh	Reinicio de carrera
scripts/reset-usb.sh	Reinicio USB
👨‍💻 Autor
Herbert Ying Kie Lee Covarrubias
Email: bluestone.integrations@gmail.com,yingkie17@gmail.com,
GitHub: yingkie17

📄 Licencia
Ver LICENSE en la raíz del proyecto.

⚠️ Nota importante
Este software es propiedad intelectual del autor. No está permitida su redistribución ni modificación sin autorización.

🏁 Estado actual
✅ Versión estable v2.0 - Todas las funcionalidades implementadas y probadas.


