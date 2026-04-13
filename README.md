# Chronit Racing System

Sistema de cronometraje con interfaz web, hardware serial (ESL-400 / Chronit) y persistencia en SQLite.

## Estructura del repositorio

```
Chronit/
├── src/                 # Código Python (main.py, api.py, database.py, templates/)
├── infrastructure/      # Dockerfile y docker-compose.yml
├── scripts/             # Utilidades (arranque con USB, reinicio API, pruebas serie)
├── docs/                # Documentación e instrucciones
├── tests/               # Pruebas / datos de prueba
├── data/                # Base de datos y archivos de estado (chronit.db, flags)
├── .env                 # Variables locales (no se sube a Git; ver .env.example)
├── .env.example         # Plantilla de variables de entorno
├── .gitignore
└── README.md
```

## Requisitos

- Docker y plugin **Docker Compose** v2
- Puerto USB del decodificador disponible para el contenedor (`privileged` + `devices`)

## Puesta en marcha (Linux)

1. En la raíz del proyecto:

   ```bash
   cp .env.example .env
   ```

   Edita `.env` y define `SERIAL_PORT` (por ejemplo `/dev/ttyUSB0`).

2. Arranque recomendado (detecta USB y lanza Compose):

   ```bash
   chmod +x scripts/start.sh
   ./scripts/start.sh
   ```

   La primera vez puedes forzar rebuild:

   ```bash
   ./scripts/start.sh --build
   ```

3. Arranque manual:

   ```bash
   cd infrastructure
   docker compose up --build
   ```

Interfaz: **http://localhost:5000**

## Windows

Ejecuta `setup.bat` una vez (crea `.env`, `start.bat` y `stop.bat` en la raíz). Después usa `start.bat`; internamente usa `docker compose` desde `infrastructure/` con `--env-file` apuntando al `.env` de la raíz.

## Datos y migración desde rutas antiguas

La base de datos vive en **`data/chronit.db`** (montada en el contenedor como `/app/data`).

Si aún tienes una copia en `App/Python/data/chronit.db` de una versión anterior, cópiala a `data/` y elimina la carpeta antigua cuando puedas (puede requerir permisos de administrador si los archivos fueron creados por Docker con otro usuario).

## Scripts útiles (desde la raíz del repo)

| Script | Uso |
|--------|-----|
| `scripts/start.sh` | Protocolo USB + `docker compose up` |
| `scripts/restart.sh` | Reinicio vía API |
| `scripts/reset-race.sh` | Reinicio de sesión de carrera vía API |
| `scripts/reset-usb.sh` | Reinicio USB vía API |
| `scripts/test_serial.py` | Escucha simple del puerto serie (fuera de Docker) |

## Licencia

Ver `LICENSE` en la raíz del proyecto.
