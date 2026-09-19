import json
import os
import re
import threading
import time
import secrets
import logging
import uuid
from datetime import datetime
from flask import Flask, jsonify, request, render_template, make_response, session, send_from_directory, redirect
from flask_cors import CORS
from flask_socketio import SocketIO
from users_db import init_users_db, verify_user, verify_session
from PIL import Image

# ============================================
# CONFIGURACIÓN DE RUTAS (LINUX/DOCKER)
# ============================================
current_dir = os.path.dirname(os.path.abspath(__file__))
static_path = os.path.join(current_dir, 'static')
template_path = os.path.join(current_dir, 'templates')

# ============================================
# FUNCIONES DE UTILIDAD PARA FOTOS
# ============================================

def get_upload_folder():
    """Obtiene la carpeta de uploads para Linux/Docker"""
    upload_dir = '/app/static/uploads/drivers'
    
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)
    return upload_dir

def get_thumbnails_folder():
    """Obtiene la carpeta de thumbnails"""
    upload_dir = get_upload_folder()
    thumb_dir = os.path.join(upload_dir, 'thumbnails')
    if not os.path.exists(thumb_dir):
        os.makedirs(thumb_dir)
    return thumb_dir

# ============================================
# CREAR LA APLICACIÓN FLASK
# ============================================
app = Flask(__name__, 
            static_folder=os.path.join(current_dir, 'static'),
            static_url_path='/static',
            template_folder=os.path.join(current_dir, 'templates'))
app.secret_key = secrets.token_hex(32)

app.config['UPLOAD_FOLDER'] = get_upload_folder()
app.config['THUMBNAIL_FOLDER'] = get_thumbnails_folder()

CORS(app, supports_credentials=True)

# ============================================
# TIEMPO REAL (WebSocket / Socket.IO)
# ============================================
# Se usa async_mode='threading' + simple-websocket: da soporte real de
# WebSocket sin monkey-patch (eventlet/gevent), por lo que el hilo serial y
# el cronometraje de la carrera siguen funcionando igual que antes.
socketio = SocketIO(
    app,
    async_mode='threading',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False,
    ping_interval=25,
    ping_timeout=60,
)

# Contador de clientes conectados (para no emitir si nadie escucha).
_realtime_clients = 0
_realtime_clients_lock = threading.Lock()


def _realtime_has_clients():
    with _realtime_clients_lock:
        return _realtime_clients > 0


# Valores por defecto de la cuenta regresiva (si no hay nada en la BD).
COUNTDOWN_DEFAULT_DURATION = 10
COUNTDOWN_DEFAULT_SPEED = 1.0


def get_countdown_config():
    """Lee la cuenta regresiva desde la BD (tabla settings) con valores por defecto.

    Antes vivía solo en localStorage del navegador; ahora es global para que
    todos los dispositivos usen exactamente el mismo valor.
    """
    from database import get_global_setting
    duration = COUNTDOWN_DEFAULT_DURATION
    speed = COUNTDOWN_DEFAULT_SPEED
    try:
        raw_duration = get_global_setting('countdown_duration')
        if raw_duration is not None:
            duration = int(float(raw_duration))
        raw_speed = get_global_setting('countdown_speed')
        if raw_speed is not None:
            speed = float(raw_speed)
    except Exception as e:  # noqa: BLE001 - nunca romper por configuración
        print(f"[COUNTDOWN] Usando valores por defecto: {e}")
    duration = max(3, min(20, duration))
    speed = max(0.3, min(2.0, speed))
    return {'duration': duration, 'speed': round(speed, 2)}


def save_countdown_config(duration, speed):
    """Persiste la cuenta regresiva y avisa por WebSocket a todos los clientes."""
    from database import set_global_setting
    duration = max(3, min(20, int(duration)))
    speed = max(0.3, min(2.0, float(speed)))
    set_global_setting('countdown_duration', str(duration))
    set_global_setting('countdown_speed', str(round(speed, 2)))
    config = {'duration': duration, 'speed': round(speed, 2)}
    # Propagación inmediata: todos los dispositivos actualizan su cuenta regresiva.
    socketio.emit('countdown_config', config)
    return config


# Estado del último arranque de cuenta regresiva. Se incluye en el payload del
# tablero para que las pantallas que pierdan el evento WebSocket 'countdown_start'
# lo recuperen por polling (respaldo), sin depender de un reloj sincronizado.
_countdown_state = {'id': 0, 'started_at': 0.0}
_countdown_state_lock = threading.Lock()


def get_countdown_state():
    """Devuelve la última cuenta regresiva disparada (id incremental + hora)."""
    with _countdown_state_lock:
        return dict(_countdown_state)


@socketio.on('connect')
def _rt_on_connect():
    """Al conectar, envía de inmediato el estado actual (payload y config)."""
    global _realtime_clients
    with _realtime_clients_lock:
        _realtime_clients += 1
    try:
        socketio.emit('countdown_config', get_countdown_config(), to=request.sid)
    except Exception as e:  # noqa: BLE001 - no bloquear la conexión
        print(f"[REALTIME] No se pudo enviar config inicial: {e}")


@socketio.on('disconnect')
def _rt_on_disconnect():
    global _realtime_clients
    with _realtime_clients_lock:
        _realtime_clients = max(0, _realtime_clients - 1)


@app.before_request
def _collapse_duplicate_slashes():
    """Normaliza rutas con barras duplicadas.

    Clientes antiguos (o páginas cacheadas) pueden pedir rutas como
    '/static/uploads/drivers//api/uploads/x.jpg'. Werkzeug no hace match de
    '<path:...>' cuando el primer segmento empieza con '/', por lo que se
    colapsan las barras duplicadas y se redirige a la ruta correcta para
    evitar el 404 en las fotos de pilotos.
    """
    if '//' in request.path:
        normalized = re.sub(r'/{2,}', '/', request.path)
        if request.query_string:
            normalized += '?' + request.query_string.decode('latin-1')
        return redirect(normalized, code=301)
    return None

@app.context_processor
def _inject_asset_version():
    """Versiona JS/CSS con su fecha de modificación.

    Evita que el navegador reutilice un dashboard.js/css viejo en caché, que
    dejaba botones (p. ej. "Resetear Tablero") sin manejador tras una
    actualización del servidor.
    """
    assets = [
        os.path.join(current_dir, 'static', 'js', 'dashboard.js'),
        os.path.join(current_dir, 'static', 'css', 'dashboard.css'),
        # Vista "Pantalla en Pista" + card de detección (compartida)
        os.path.join(current_dir, 'static', 'js', 'pantalla_pista.js'),
        os.path.join(current_dir, 'static', 'css', 'pantalla_pista.css'),
        os.path.join(current_dir, 'static', 'js', 'detection_card.js'),
        os.path.join(current_dir, 'static', 'css', 'detection_card.css'),
        # Cliente Socket.IO servido localmente (sincronización en tiempo real)
        os.path.join(current_dir, 'static', 'js', 'socket.io.min.js'),
    ]
    mtimes = []
    for path in assets:
        try:
            mtimes.append(os.path.getmtime(path))
        except OSError:
            # Si algún asset aún no existe, se ignora para no invalidar el resto.
            continue
    version = str(int(max(mtimes))) if mtimes else '0'
    return {'asset_version': version}

# Configurar logging después de crear app
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# ============================================
# FUNCIONES DE UTILIDAD ADICIONALES
# ============================================
def get_photo_url(filename):
    """Obtiene la URL pública de una foto"""
    if not filename or filename == 'default-avatar.png':
        return '/static/default-avatar.png'
    return f'/static/uploads/drivers/{filename}'

def create_thumbnail(image_path, thumb_path, size=(80, 80)):
    """Crea un thumbnail de la imagen usando PIL"""
    try:
        with Image.open(image_path) as img:
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            img.thumbnail(size, Image.Resampling.LANCZOS)
            img.save(thumb_path, 'JPEG', quality=85, optimize=True)
            return True
    except Exception as e:
        print(f"[PHOTO] Error creando thumbnail: {e}")
        return False

def delete_driver_photo_files(driver_id, filename):
    """Elimina los archivos de foto de un piloto"""
    try:
        if not filename or filename == 'default-avatar.png':
            return
        
        upload_dir = get_upload_folder()
        thumb_dir = get_thumbnails_folder()
        
        filepath = os.path.join(upload_dir, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
        
        thumb_filename = f"thumb_{filename}"
        thumb_path = os.path.join(thumb_dir, thumb_filename)
        if os.path.exists(thumb_path):
            os.remove(thumb_path)
            
        print(f"[PHOTO] Archivos eliminados para driver {driver_id}: {filename}")
    except Exception as e:
        print(f"[PHOTO] Error eliminando archivos: {e}")

# ============================================
# IMPORTS DE BASE DE DATOS
# ============================================
from database import (
    init_db,
    get_current_session,
    get_latest_session,
    get_leaderboard_with_details,
    get_all_drivers,
    get_unassigned_transponders,
    add_driver,
    add_transponder_manual,
    get_all_transponders,
    delete_transponder,
    update_transponder_id,
    update_transponder,
    add_driver_to_race,
    get_race_drivers,
    remove_driver_from_race,
    delete_driver,
    update_driver,
    clear_all_driver_transponders,
    start_new_session,
    clear_race_drivers,
    update_session_settings,
    get_lap_details,
    get_race_history,
    update_race_status,
    get_session_info,
    guardar_estado_repetir,
    get_recent_signals,
    get_session_elapsed_seconds,
    get_transponder_health,
    reset_transponder_health,
    hard_reset_all_data,
    get_podium,
    get_db,
    get_track_length,
    get_circuit_config,
    update_circuit_config,
    get_decoder_mode,
    update_decoder_mode,
    create_future_event,
    get_future_events,
    get_future_event,
    update_future_event,
    delete_future_event,
    complete_future_event,
    get_event_history,
    add_driver_to_event,
    add_drivers_to_event_bulk,
    remove_driver_from_event,
    get_event_drivers,
    set_event_driver_transponder,
    mark_event_driver_called,
    set_event_driver_locker,
    set_event_driver_ready,
    event_drivers_all_ready,
    mark_event_drivers_called,
    mark_event_drivers_ready,
    get_available_event_transponders,
    get_latest_race_session,
    get_finished_race_transponders,
    unbind_finished_race_transponders,
    bind_event_drivers_transponders,
    unbind_all_transponders,
    set_event_status,
)

# ============================================
# CONFIGURACIÓN DE ARCHIVOS DEL SISTEMA
# ============================================
BASE_DATA_DIR = '/app/data'

RESTART_FLAG_FILE = os.path.join(BASE_DATA_DIR, 'restart.flag')
SHUTDOWN_FLAG_FILE = os.path.join(BASE_DATA_DIR, 'shutdown.flag')
NEXT_RACE_NAME_FILE = os.path.join(BASE_DATA_DIR, 'next_race_name.txt')
NEXT_RACE_LAPS_FILE = os.path.join(BASE_DATA_DIR, 'next_race_laps.txt')
NEXT_RACE_MODE_FILE = os.path.join(BASE_DATA_DIR, 'next_race_mode.txt')
RACE_COMMAND_FILE = os.path.join(BASE_DATA_DIR, 'race_command.txt')
SIMULATION_MODE_FILE = os.path.join(BASE_DATA_DIR, 'simulation_mode.flag')
SIMULATION_SPEED_FILE = os.path.join(BASE_DATA_DIR, 'simulation_speed.txt')
LOG_BUFFER_FILE = os.path.join(BASE_DATA_DIR, 'logs_buffer.txt')
MANUAL_LAP_QUEUE_FILE = os.path.join(BASE_DATA_DIR, 'manual_lap_queue.jsonl')

def send_race_command(command):
    """Envía un comando a la carrera con escritura robusta"""
    try:
        temp_file = RACE_COMMAND_FILE + ".tmp"
        with open(temp_file, 'w') as f:
            f.write(command)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_file, RACE_COMMAND_FILE)
        return True
    except Exception as e:
        print(f"[API] Error enviando comando: {e}")
        return False


def _enqueue_manual_lap(kart_number, session_id=None, transponder_id=None):
    """Encola una vuelta manual.

    main.py corre como __main__ en este mismo proceso, por lo que reutilizamos
    su función enqueue_manual_lap (comparte el mismo lock de la cola). Si por
    algún motivo no está disponible, escribimos directamente al archivo JSONL.
    """
    import sys

    try:
        main_mod = sys.modules.get('__main__')
        enqueue = getattr(main_mod, 'enqueue_manual_lap', None)
        if enqueue is not None:
            return bool(enqueue(kart_number, session_id, transponder_id))
    except Exception as e:
        print(f"[MANUAL] No se pudo encolar via main: {e}")

    # Fallback: escribir directo al archivo (misma estructura que main)
    try:
        with open(MANUAL_LAP_QUEUE_FILE, 'a') as f:
            f.write(json.dumps({
                'kart_number': str(kart_number),
                'transponder_id': transponder_id,
                'session_id': session_id,
                'event_time': datetime.now().isoformat(),
                'created_at': time.time(),
            }) + '\n')
            f.flush()
        return True
    except Exception as e:
        print(f"[MANUAL] Error encolando vuelta: {e}")
        return False

# ============================================
# ENDPOINTS - PÁGINA PRINCIPAL
# ============================================
@app.route('/')
def index():
    resp = make_response(render_template('dashboard.html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/pantalla-en-pista')
def pantalla_en_pista():
    """Vista limpia para pantallas LED grandes (sin menús ni barra de usuario).

    Es un clon visual de la pantalla de carrera actual: mismos datos y misma
    lógica (consume /api/dashboard/full-data con polling de 500 ms), pero
    escala todo con vw/vh/clamp() y agrega la card de detección de piloto.
    """
    resp = make_response(render_template('pantalla_en_pista.html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

# ============================================
# ENDPOINTS - ARCHIVOS ESTÁTICOS (FOTOS)
# ============================================
@app.route('/static/uploads/drivers/<path:filename>')
def serve_driver_photo(filename):
    """Sirve las fotos de pilotos desde las carpetas de uploads (carrera y compartida)"""
    try:
        # Normalizar: quitar barras iniciales para evitar rutas absolutas/duplicadas
        filename = filename.lstrip('/')

        # Carpetas donde pueden residir las fotos
        search_dirs = [get_upload_folder(), '/app/data/uploads', '/app/uploads']

        # Probar el nombre tal cual y, si viene con prefijo (p. ej. 'uploads/x.jpg'
        # o 'api/uploads/x.jpg'), también solo el nombre base del archivo.
        candidates = [filename]
        base = os.path.basename(filename)
        if base and base != filename:
            candidates.append(base)

        for name in candidates:
            for folder in search_dirs:
                if os.path.exists(os.path.join(folder, name)):
                    return send_from_directory(folder, name)

        # Thumbnails
        thumb_dir = get_thumbnails_folder()
        if filename.startswith('thumb_'):
            return send_from_directory(thumb_dir, filename)

        return send_from_directory(
            os.path.join(current_dir, 'static'),
            'default-avatar.png'
        )
    except Exception as e:
        print(f"[STATIC] Error sirviendo foto: {e}")
        return send_from_directory(
            os.path.join(current_dir, 'static'),
            'default-avatar.png'
        )

@app.route('/static/default-avatar.png')
def serve_default_avatar():
    """Sirve el avatar por defecto"""
    try:
        return send_from_directory(
            os.path.join(current_dir, 'static'),
            'default-avatar.png'
        )
    except Exception as e:
        return send_from_directory(
            os.path.join(current_dir, 'static'),
            'pilotcircle1.png'
        )

# ============================================
# ENDPOINTS - FOTOS DE PILOTOS (API)
# ============================================
@app.route("/api/drivers/<int:driver_id>/photo", methods=["POST"])
def upload_driver_photo(driver_id):
    """Sube una foto para un piloto (multipart/form-data)"""
    try:
        from database import get_driver_by_id, update_driver_photo
        
        driver = get_driver_by_id(driver_id)
        if not driver:
            return jsonify({"success": False, "error": "Piloto no encontrado"}), 404

        if "photo" not in request.files:
            return jsonify({"success": False, "error": "No se envió ningún archivo"}), 400
        
        file = request.files["photo"]
        if file.filename == "":
            return jsonify({"success": False, "error": "Nombre de archivo vacío"}), 400

        allowed_extensions = {"jpg", "jpeg", "png", "gif", "webp"}
        extension = file.filename.rsplit(".", 1)[1].lower() if "." in file.filename else ""
        if extension not in allowed_extensions:
            return jsonify({
                "success": False,
                "error": f"Formato no permitido. Use: {', '.join(allowed_extensions)}"
            }), 400

        file.seek(0, os.SEEK_END)
        size = file.tell()
        file.seek(0)
        if size > 5 * 1024 * 1024:
            return jsonify({"success": False, "error": "La imagen no puede superar los 5MB"}), 400

        unique_id = str(uuid.uuid4())[:8]
        filename = f"driver_{driver_id}_{unique_id}.{extension}"

        upload_dir = get_upload_folder()
        filepath = os.path.join(upload_dir, filename)
        file.save(filepath)
        print(f"[PHOTO] Foto guardada: {filepath}")

        thumb_dir = get_thumbnails_folder()
        thumb_filename = f"thumb_{filename}"
        thumb_path = os.path.join(thumb_dir, thumb_filename)
        create_thumbnail(filepath, thumb_path)
        print(f"[PHOTO] Thumbnail creado: {thumb_path}")

        old_photo = driver.get("photo")
        if old_photo and old_photo != "default-avatar.png":
            delete_driver_photo_files(driver_id, old_photo)

        update_driver_photo(driver_id, filename)

        photo_url = get_photo_url(filename)
        thumb_url = f"/static/uploads/drivers/thumbnails/{thumb_filename}"

        return jsonify({
            "success": True,
            "photo_url": photo_url,
            "thumbnail_url": thumb_url,
            "filename": filename,
            "message": "Foto subida correctamente"
        })

    except Exception as e:
        print(f"[PHOTO] Error en upload: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/drivers/<int:driver_id>/photo", methods=["DELETE"])
def delete_driver_photo(driver_id):
    """Elimina la foto de un piloto (vuelve a default)"""
    try:
        from database import get_driver_by_id, update_driver_photo
        
        driver = get_driver_by_id(driver_id)
        if not driver:
            return jsonify({"success": False, "error": "Piloto no encontrado"}), 404

        old_photo = driver.get("photo")
        if old_photo and old_photo != "default-avatar.png":
            delete_driver_photo_files(driver_id, old_photo)

        update_driver_photo(driver_id, "default-avatar.png")

        return jsonify({
            "success": True,
            "message": "Foto eliminada, usando imagen por defecto"
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/drivers/<int:driver_id>/photo", methods=["GET"])
def get_driver_photo(driver_id):
    """Obtiene la URL de la foto de un piloto"""
    try:
        from database import get_driver_photo_filename
        
        filename = get_driver_photo_filename(driver_id)
        photo_url = get_photo_url(filename)
        return jsonify({
            "success": True,
            "photo_url": photo_url,
            "filename": filename
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ============================================
# ENDPOINTS - ESTADO DEL SISTEMA
# ============================================
@app.route('/api/status')
def status():
    session_info = get_current_session()
    session_status = (session_info or {}).get('status')
    # Criterio ÚNICO de "carrera activa": la sesión está en active/paused o el
    # motor en memoria lo confirma. Una sesión 'pending' (tablero recién
    # reseteado o carrera recién configurada, aún NO iniciada) NO es activa.
    # Todos los módulos (vestidores, dashboard) deben consumir este flag para
    # evitar umbrales inconsistentes.
    race_active = bool(_get_race_active()) or (session_status in ('active', 'paused'))
    return jsonify({
        'status': 'online', 
        'current_session': session_info, 
        'race_active': race_active,
        'timestamp': time.time()
    })

@app.route('/api/session/current')
def get_current_session_info():
    session_info = get_current_session() or get_latest_session()
    if not session_info:
        return jsonify({'active': False, 'leaderboard': []})
    
    leaderboard = get_leaderboard_with_details(session_info['id'])
    session_info['race_elapsed_seconds'] = get_session_elapsed_seconds(session_info)
    session_info['can_repeat'] = session_info.get('status') == 'completed'
    session_info['can_reset_board'] = session_info.get('status') == 'completed'
    session_info['can_manage_enrollment'] = session_info.get('status') == 'pending'
    return jsonify({
        'active': True, 
        'session': session_info, 
        'leaderboard': leaderboard
    })

@app.route('/api/session/current/podium')
def get_current_session_podium():
    session_info = get_current_session() or get_latest_session()
    if not session_info:
        return jsonify({
            'active': False, 
            'session_id': None, 
            'race_mode': 'position', 
            'podium': []
        })
    res = get_podium(session_info['id'])
    return jsonify({
        'active': True, 
        'session_id': session_info['id'], 
        'race_mode': res.get('race_mode', 'position'), 
        'podium': res.get('podium', []), 
        'classification_groups': res.get('classification_groups')
    })

@app.route('/api/leaderboard')
def get_leaderboard_api():
    session_info = get_current_session()
    if not session_info:
        return jsonify([])
    return jsonify(get_leaderboard_with_details(session_info['id']))

@app.route('/api/signals/recent')
def get_recent_signals_api():
    limit = request.args.get('limit', 10, type=int)
    return jsonify(get_recent_signals(limit))

# ============================================
# ENDPOINTS - CONTROL DE CARRERA
# ============================================
@app.route('/api/race/start', methods=['POST'])
def race_start():
    token = request.headers.get('X-Session-Token')
    user_role = 'admin'
    
    if token:
        user = verify_session(token)
        if user:
            user_role = user['role']
    
    port_exists = os.path.exists('/dev/ttyUSB0') or os.path.exists('/dev/ttyACM0')
    simulation_active = os.path.exists(SIMULATION_MODE_FILE)

    # El modo simulación permite iniciar la carrera sin hardware. Esto habilita
    # arrancar desde el panel LED (que no tiene sesión de usuario). Sin hardware
    # ni simulación, el inicio queda bloqueado.
    if not port_exists and not simulation_active:
        if user_role == 'developer':
            error = 'Decoder no conectado. Activa el modo simulación en el panel Sistema para pruebas sin hardware.'
        else:
            error = 'Decoder no conectado. El hardware es obligatorio para usuarios administradores.'
        return jsonify({'success': False, 'error': error}), 400
    
    session_info = get_current_session()
    if session_info:
        race_drivers = get_race_drivers(session_info['id'])
        if not race_drivers:
            return jsonify({
                'success': False, 
                'error': 'No hay pilotos inscritos en la carrera.'
            }), 400
    if session_info and session_info.get('status') == 'active':
        return jsonify({
            'success': False,
            'error': 'Ya hay una carrera activa.'
        }), 400
        
    send_race_command('start')
    
    time.sleep(0.5)
    current = get_current_session()
    if current and current['status'] != 'active':
        update_race_status(current['id'], 'active')
        print("[API] Forzada actualización de estado a 'active'")
    
    if current:
        with get_db() as conn:
            from datetime import datetime
            conn.execute('UPDATE race_sessions SET elapsed_seconds = 0, start_time = ? WHERE id = ?',
                        (datetime.now().isoformat(), current['id']))
            print(f"[API] elapsed_seconds reseteado a 0 para sesión {current['id']}")

        # Si la carrera pertenece a un evento, al iniciarla el evento pasa a
        # 'activo' y los tickets de los pilotos en pista a ACTIVO.
        event_uuid = current.get('event_uuid')
        if event_uuid:
            try:
                from database import get_future_event_by_uuid
                from pg_db import mark_event_tickets_activo
                ev = get_future_event_by_uuid(event_uuid)
                if ev:
                    set_event_status(ev['id'], 'active')
                    uuids = [
                        rd.get('uuid_global')
                        for rd in get_race_drivers(current['id'])
                        if rd.get('uuid_global')
                    ]
                    mark_event_tickets_activo(event_uuid, uuids)
                    print(f"[API] Evento {ev['id']} marcado como activo y tickets ACTIVO")
            except Exception as e:  # noqa: BLE001 - no bloquear el inicio por sync
                print(f"[API] No se pudo activar el evento/tickets: {e}")

    return jsonify({'success': True, 'message': 'Carrera iniciada'})

# ============================================
# ENDPOINTS - CUENTA REGRESIVA PARA SALIDA
# ============================================
@app.route('/api/countdown/config', methods=['GET'])
def get_countdown_config_api():
    """Devuelve la cuenta regresiva guardada en la BD (global para todos)."""
    return jsonify({'success': True, **get_countdown_config()})

@app.route('/api/countdown/config', methods=['POST'])
def set_countdown_config_api():
    """Guarda la cuenta regresiva en la BD y la propaga a todos los dispositivos."""
    from users_db import verify_session
    token = request.headers.get('X-Session-Token')
    user = verify_session(token) if token else None
    if not user or user['role'] != 'developer':
        return jsonify({'success': False, 'error': 'Solo desarrolladores pueden modificar esta configuración'}), 403

    data = request.get_json() or {}
    try:
        duration = int(float(data.get('duration', COUNTDOWN_DEFAULT_DURATION)))
        speed = float(data.get('speed', COUNTDOWN_DEFAULT_SPEED))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Valores inválidos'}), 400

    config = save_countdown_config(duration, speed)
    return jsonify({'success': True, **config})

@app.route('/api/race/start-countdown', methods=['POST'])
def race_start_countdown():
    """Dispara la cuenta regresiva en TODOS los dispositivos (pantalla en pista).

    Se propaga por WebSocket ('countdown_start') y además se publica en el
    payload del tablero (con un 'id' incremental) para que las pantallas que
    pierdan el evento lo recuperen por polling. Cada cliente cuenta desde el
    momento en que recibe el aviso (reloj local), de modo que un reloj
    desajustado en la pantalla LED no congela la cuenta. El arranque real de la
    carrera lo hace cada cliente con POST /api/race/start.
    """
    global _countdown_state
    config = get_countdown_config()
    with _countdown_state_lock:
        _countdown_state = {
            'id': _countdown_state['id'] + 1,
            'started_at': time.time(),
        }
        state = dict(_countdown_state)
    payload = dict(config)
    payload.update(state)
    socketio.emit('countdown_start', payload)
    return jsonify({'success': True, **payload})

@app.route('/api/race/pause', methods=['POST'])
def race_pause():
    send_race_command('pause')
    # Reflejar el estado en la BD de forma síncrona: main.py procesa el comando
    # de forma asíncrona y, si el front refresca antes, los botones mostraban el
    # estado anterior (Pausar seguía visible en vez de Reanudar).
    try:
        session_info = get_current_session() or get_latest_session()
        if session_info and session_info.get('status') == 'active':
            update_race_status(session_info['id'], 'paused')
    except Exception as e:
        print(f"[API] No se pudo marcar la sesión como pausada: {e}")
    return jsonify({'success': True, 'message': 'Carrera pausada'})

@app.route('/api/race/resume', methods=['POST'])
def race_resume():
    send_race_command('resume')
    # Igual que en pause: reflejar el estado de inmediato para no desincronizar
    # los botones del panel de control de carrera.
    try:
        session_info = get_current_session() or get_latest_session()
        if session_info and session_info.get('status') == 'paused':
            update_race_status(session_info['id'], 'active')
    except Exception as e:
        print(f"[API] No se pudo marcar la sesión como activa: {e}")
    return jsonify({'success': True, 'message': 'Carrera reanudada'})

@app.route('/api/race/finish', methods=['POST'])
def race_finish():
    send_race_command('finish')
    # Sincronizar resultados a PostgreSQL (best-effort: nunca debe romper el API).
    try:
        from database import get_latest_session, finalize_session_and_sync
        session = get_latest_session()
        if session:
            # Red de seguridad: cerrar la sesión de forma síncrona. El comando
            # 'finish' lo procesa main.py y también la marca 'completed', pero
            # si ese proceso no alcanza a leer el comando (p.ej. reinicio del
            # contenedor o comando sobrescrito), la sesión quedaría colgada en
            # 'active' y bloquearía configurar/iniciar la siguiente carrera.
            if session.get('status') in ('active', 'paused'):
                update_race_status(session['id'], 'completed')
                print(f"[API] Sesión {session['id']} cerrada síncronamente (completed)")
            # Volcar la clasificación final a PostgreSQL (historial del piloto en
            # web-client) y cerrar el evento asociado.
            finalize_session_and_sync(session['id'])
    except Exception as e:  # noqa: BLE001 - no bloquear la finalización por un error de sync
        print(f"[API] Error al sincronizar resultados: {e}")
    return jsonify({'success': True, 'message': 'Carrera finalizada'})

@app.route('/api/race/repeat', methods=['POST'])
def race_repeat():
    try:
        session_info = get_current_session()
        if not session_info:
            session_info = get_latest_session()
        if not session_info:
            return jsonify({'success': False, 'error': 'No hay carrera disponible'}), 400
        if session_info.get('status') != 'completed':
            return jsonify({
                'success': False, 
                'error': 'Solo se puede repetir cuando la carrera ha finalizado'
            }), 400

        race_drivers_list = get_race_drivers(session_info['id'])
        if not race_drivers_list:
            return jsonify({'success': False, 'error': 'No hay pilotos inscritos'}), 400

        comando = {
            'action': 'repeat_race',
            'circuit_name': session_info['circuit_name'],
            'laps_limit': session_info.get('laps_limit', 10),
            'race_mode': session_info.get('race_mode', 'position'),
            'race_drivers': race_drivers_list
        }
        
        send_race_command(json.dumps(comando))
        
        print(f"[API] Comando repeat_race enviado: {comando['circuit_name']}")
        return jsonify({'success': True, 'message': 'Repitiendo carrera...'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/reset', methods=['POST'])
def race_reset():
    """Resetea el tablero (limpia vueltas y reinicia la carrera actual)"""
    try:
        session_info = get_current_session() or get_latest_session()
        
        if not session_info:
            from database import start_new_session
            from datetime import datetime
            default_name = f"Circuito {datetime.now().strftime('%d/%m')}"
            session_id = start_new_session(default_name, 10, "position", 0)
            print(f"[API] Carrera por defecto creada: ID {session_id}")
        send_race_command('reset_race')
        return jsonify({'success': True, 'message': 'Tablero reseteado correctamente'})
    except Exception as e:
        print(f"[API] Error en race_reset: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/clear-all', methods=['POST'])
def race_clear_all():
    send_race_command(json.dumps({'action': 'clear_all'}))
    return jsonify({'success': True, 'message': 'Limpiando sistema...'})

def _validar_config_carrera(race_mode, laps_limit, time_limit_seconds):
    """Valida y normaliza la configuración según el modo de carrera.

    Reglas comunes a crear y editar una carrera. Devuelve
    (error:str|None, laps_limit:int, time_limit_seconds:int).
    """
    try:
        laps_limit = int(laps_limit)
    except (TypeError, ValueError):
        laps_limit = 10
    try:
        time_limit_seconds = int(float(time_limit_seconds or 0))
    except (TypeError, ValueError):
        time_limit_seconds = 0

    if race_mode in ('classification', 'endurance'):
        if time_limit_seconds <= 0:
            return 'Para TIME LIMIT y ENDURANCE, la duración debe ser mayor a 0 minutos', laps_limit, time_limit_seconds
        if race_mode == 'classification':
            laps_limit = 0
    elif race_mode == 'qualifying_laps':
        if laps_limit <= 0:
            return 'Para CLASIFICACIÓN POR VUELTAS, el límite de vueltas debe ser mayor a 0', laps_limit, time_limit_seconds
        time_limit_seconds = 0
    elif race_mode == 'position':
        if laps_limit <= 0:
            laps_limit = 10

    return None, laps_limit, time_limit_seconds


@app.route('/api/race/create-new', methods=['POST'])
def create_new_race():
    try:
        data = request.get_json()
        race_name = data.get('next_race_name')
        laps_limit = data.get('next_race_laps', 10)
        race_mode = data.get('next_race_mode', 'position')
        time_limit_seconds = data.get('time_limit_seconds', 0)

        error, laps_limit, time_limit_seconds = _validar_config_carrera(
            race_mode, laps_limit, time_limit_seconds
        )
        if error:
            return jsonify({'success': False, 'error': error}), 400

        if not race_name:
            return jsonify({
                'success': False, 
                'error': 'Nombre de carrera requerido'
            }), 400

        # Limpiar pilotos de la sesión actual si existe
        current_session = get_current_session()
        if current_session:
            clear_race_drivers(current_session['id'])
            print(f"[API] Limpiados pilotos de la sesión {current_session['id']}")

        # Enviar comando para crear nueva carrera
        comandos = {
            'action': 'new_race',
            'race_name': race_name,
            'laps_limit': laps_limit,
            'race_mode': race_mode,
            'time_limit_seconds': time_limit_seconds
        }

        send_race_command(json.dumps(comandos))

        return jsonify({'success': True, 'message': 'Creando nueva carrera...'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/update', methods=['POST'])
def update_race():
    """Edita la carrera ACTUAL siempre que aún no se haya iniciado.

    Permite cambiar nombre, modo, límite de vueltas y límite de tiempo SIN
    borrar a los pilotos ya inscritos (a diferencia de create-new).
    """
    try:
        data = request.get_json() or {}
        race_name = (data.get('next_race_name') or data.get('race_name') or '').strip()
        laps_limit = data.get('next_race_laps', 10)
        race_mode = data.get('next_race_mode', 'position')
        time_limit_seconds = data.get('time_limit_seconds', 0)

        error, laps_limit, time_limit_seconds = _validar_config_carrera(
            race_mode, laps_limit, time_limit_seconds
        )
        if error:
            return jsonify({'success': False, 'error': error}), 400

        if not race_name:
            return jsonify({'success': False, 'error': 'Nombre de carrera requerido'}), 400

        current_session = get_current_session()
        if not current_session:
            return jsonify({'success': False, 'error': 'No hay una carrera creada'}), 400

        if (current_session.get('status') or 'pending') != 'pending':
            return jsonify({
                'success': False,
                'error': 'Solo se puede editar una carrera que todavía no se inició'
            }), 400

        ok = update_session_settings(
            current_session['id'],
            circuit_name=race_name,
            laps_limit=laps_limit,
            race_mode=race_mode,
            time_limit_seconds=time_limit_seconds,
        )
        if not ok:
            return jsonify({'success': False, 'error': 'No se pudo actualizar la carrera'}), 400

        # Sincronizar el estado del motor (LAPS_LIMIT en memoria) sin tocar pilotos.
        send_race_command(json.dumps({'action': 'update_race_config'}))

        print(f"[API] Carrera {current_session['id']} actualizada: {race_name} | "
              f"modo {race_mode} | {laps_limit} vueltas | {time_limit_seconds}s")
        return jsonify({'success': True, 'message': 'Carrera actualizada correctamente'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/continue-from-qualifying', methods=['POST'])
def continue_from_qualifying():
    try:
        from database import normalize_race_mode, get_podium, add_driver_to_race, get_current_session, get_latest_session, start_new_session

        # 1. Obtener la sesión actual (debe ser qualifying_laps o classification y estar completada)
        session_info = get_current_session() or get_latest_session()
        if not session_info:
            return jsonify({'success': False, 'error': 'No hay sesión activa'}), 400

        session_mode = normalize_race_mode(session_info.get('race_mode', ''))
        if session_mode not in ('qualifying_laps', 'classification'):
            return jsonify({'success': False, 'error': 'La carrera actual no es una clasificación (por vueltas o por tiempo)'}), 400

        if session_info.get('status') != 'completed':
            return jsonify({'success': False, 'error': 'La clasificación debe estar finalizada para continuar'}), 400

        # 2. Obtener datos del request
        data = request.get_json() or {}
        race_name = data.get('race_name', f"Carrera Final - {session_info['circuit_name']}")
        laps_limit = data.get('laps_limit', session_info.get('laps_limit', 10))
        try:
            laps_limit = int(laps_limit)
        except:
            laps_limit = 10
        
        # 2.b Obtener lista de pilotos seleccionados (si viene desde el modal)
        selected_drivers = data.get('selected_driver_ids') or None

        # 3. Obtener el podio y los grupos de clasificación
        podium_data = get_podium(session_info['id'])
        groups = podium_data.get('classification_groups', {})
        
        # 4. Construir lista ordenada de pilotos: Q1 → Q2 → Q3 → DNQ
        ordered_drivers = []
        for group_key in ('q1', 'q2', 'q3', 'dnq'):
            group = groups.get(group_key, [])
            for driver in group:
                ordered_drivers.append(driver)

        if not ordered_drivers:
            return jsonify({'success': False, 'error': 'No hay pilotos en la clasificación'}), 400

        # 5. Filtrar si el front envió pilotos seleccionados
        if selected_drivers and len(selected_drivers) > 0:
            # Crear un mapa: driver_id -> datos completos desde ordered_drivers
            driver_map = {d['driver_id']: d for d in ordered_drivers}
            # Construir la lista final en el orden que envía el front (que ya viene por grupos)
            filtered_ordered = []
            for sel in selected_drivers:
                did = sel.get('driver_id') if isinstance(sel, dict) else sel
                if did in driver_map:
                    filtered_ordered.append(driver_map[did])
            ordered_drivers = filtered_ordered

        if not ordered_drivers:
            return jsonify({'success': False, 'error': 'No hay pilotos seleccionados para continuar'}), 400

        # 6. Crear una nueva sesión directamente (sin usar reset_race)
        new_session_id = start_new_session(race_name, laps_limit, 'position', 0)

        # 7. Inscribir a los pilotos en la nueva sesión EN ORDEN DE GRUPOS
        inscritos = 0
        for idx, driver in enumerate(ordered_drivers):
            # Incluir piloto si tiene datos válidos de driver/transponder
            has_valid_ids = driver.get('driver_id') and driver.get('transponder_id')
            if has_valid_ids:
                add_driver_to_race(
                    new_session_id,
                    driver['driver_id'],
                    driver['transponder_id'],
                    start_position=idx + 1
                )
                inscritos += 1

        if inscritos == 0:
            return jsonify({'success': False, 'error': 'Ningún piloto tiene datos válidos para continuar'}), 400

        # 8. Forzar actualización de la sesión activa en main.py (mediante archivo de comando)
        send_race_command(json.dumps({"action": "reload_session"}))  # Solo recarga la sesión sin crear nueva

        print(f"[API] Carrera creada desde clasificación ({session_mode}): {race_name} con {inscritos} pilotos, {laps_limit} vueltas")

        return jsonify({
            'success': True,
            'message': f'Carrera creada desde clasificación con {inscritos} pilotos',
            'session_id': new_session_id,
            'race_name': race_name,
            'laps_limit': laps_limit
        })

    except Exception as e:
        print(f"[API] Error en continue_from_qualifying: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================
# ENDPOINTS - DETALLES DE CARRERA
# ============================================
@app.route('/api/race/lap-details/<int:session_id>/<int:driver_id>')
def get_driver_lap_details(session_id, driver_id):
    laps = get_lap_details(session_id, driver_id)
    return jsonify(laps)

@app.route('/api/race/history')
def race_history():
    history = get_race_history()
    return jsonify(history)

@app.route('/api/race/time-remaining', methods=['GET'])
def get_time_remaining():
    try:
        session_info = get_current_session()
        if not session_info:
            return jsonify({'success': False, 'error': 'No hay carrera activa'}), 404
        
        race_mode = session_info.get('race_mode', 'position')
        if race_mode not in ('classification', 'endurance'):
            return jsonify({
                'success': False, 
                'error': 'La carrera actual no tiene tiempo límite'
            }), 400
        
        # ✅ Leer el archivo de tiempo límite
        time_limit_file = os.path.join(BASE_DATA_DIR, 'time_limit_info.json')
        if os.path.exists(time_limit_file):
            try:
                with open(time_limit_file, 'r') as f:
                    data = json.load(f)
                    time_limit_end = data.get('time_limit_end', 0)
                    time_limit_active = data.get('time_limit_active', False)
                    remaining_on_pause = data.get('remaining_on_pause', 0)
                    
                    # ✅ Si la carrera está pausada, devolver el tiempo congelado
                    if session_info.get('status') == 'paused':
                        return jsonify({
                            'success': True,
                            'remaining_seconds': remaining_on_pause,
                            'remaining_formatted': format_race_clock(remaining_on_pause),
                            'is_active': True,
                            'is_paused': True
                        })
                    
                    # ✅ Si está activa y el tiempo límite es válido
                    if time_limit_active and time_limit_end > 0:
                        remaining = max(0, time_limit_end - time.time())
                        return jsonify({
                            'success': True,
                            'remaining_seconds': remaining,
                            'remaining_formatted': format_race_clock(remaining),
                            'is_active': True,
                            'is_paused': False
                        })
                    else:
                        # ✅ Si el tiempo límite ha expirado
                        return jsonify({
                            'success': True,
                            'remaining_seconds': 0,
                            'remaining_formatted': '00:00.000',
                            'is_active': False,
                            'is_paused': False
                        })
            except Exception as e:
                print(f"[TIME LIMIT] Error leyendo archivo: {e}")
                # ✅ En caso de error, devolver 0
                return jsonify({
                    'success': True,
                    'remaining_seconds': 0,
                    'remaining_formatted': '00:00.000',
                    'is_active': False,
                    'is_paused': False
                })
        else:
            # ✅ Si no hay archivo, la carrera no tiene tiempo límite
            return jsonify({
                'success': True,
                'remaining_seconds': 0,
                'remaining_formatted': '00:00.000',
                'is_active': False,
                'is_paused': False
            })
    except Exception as e:
        print(f"[TIME LIMIT] Error en endpoint: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - TIEMPO LÍMITE
# ============================================

@app.route('/api/race/time-limit-status', methods=['POST'])
def set_time_limit_status():
    """Actualiza el estado del tiempo límite (para resetear)"""
    try:
        data = request.get_json()
        time_limit_active = data.get('time_limit_active', False)
        time_limit_end = data.get('time_limit_end', 0)
        completed = data.get('completed', False)
        remaining_on_pause = data.get('remaining_on_pause', 0)
        
        # Guardar en archivo JSON
        time_limit_info = {
            'time_limit_active': time_limit_active,
            'time_limit_end': time_limit_end,
            'time_limit_seconds': 0,
            'completed': completed,
            'remaining_on_pause': remaining_on_pause
        }
        
        time_limit_file = os.path.join(BASE_DATA_DIR, 'time_limit_info.json')
        with open(time_limit_file, 'w') as f:
            json.dump(time_limit_info, f)
        
        print(f"[TIME LIMIT] Estado actualizado por API: {time_limit_info}")
        return jsonify({'success': True, 'message': 'Estado de tiempo límite actualizado'})
        
    except Exception as e:
        print(f"[TIME LIMIT] Error actualizando estado: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================
# ENDPOINTS - PILOTOS
# ============================================
@app.route('/api/drivers', methods=['GET'])
def get_drivers():
    return jsonify(get_all_drivers())

@app.route('/api/drivers', methods=['POST'])
def create_driver():
    try:
        data = request.get_json()
        
        driver_id = add_driver(
            data.get('transponder_id') or None, 
            data['name'], 
            data.get('lastname', ''),
            data.get('age'), 
            data.get('gender', ''), 
            data.get('nationality', ''),
            data.get('weight'), 
            data.get('description', ''),
            data.get('email', ''), 
            data.get('carnet', ''), 
            data.get('phone', ''),
            None
        )
        
        photo_data = data.get('photo')
        if photo_data and photo_data.startswith('data:image'):
            try:
                import base64
                import io
                
                if ',' in photo_data:
                    photo_data = photo_data.split(',')[1]
                image_bytes = base64.b64decode(photo_data)
                
                extension = 'jpg'
                unique_id = str(uuid.uuid4())[:8]
                filename = f"driver_{driver_id}_{unique_id}.{extension}"
                
                upload_dir = get_upload_folder()
                filepath = os.path.join(upload_dir, filename)
                with open(filepath, 'wb') as f:
                    f.write(image_bytes)
                
                thumb_dir = get_thumbnails_folder()
                thumb_filename = f"thumb_{filename}"
                thumb_path = os.path.join(thumb_dir, thumb_filename)
                
                from PIL import Image
                with Image.open(io.BytesIO(image_bytes)) as img:
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    img.thumbnail((80, 80), Image.Resampling.LANCZOS)
                    img.save(thumb_path, 'JPEG', quality=85, optimize=True)
                
                from database import update_driver_photo
                update_driver_photo(driver_id, filename)
                
            except Exception as e:
                print(f"[PHOTO] Error guardando foto base64: {e}")
        
        return jsonify({
            'success': True, 
            'driver_id': driver_id,
            'message': 'Piloto creado correctamente'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/drivers/<int:driver_id>', methods=['PUT'])
def update_driver_api(driver_id):
    try:
        data = request.get_json()
        
        # ============================================================
        # VALIDACIONES BÁSICAS
        # ============================================================
        name = data.get('name')
        if not name:
            return jsonify({'success': False, 'error': 'Nombre es obligatorio'}), 400

        # ============================================================
        # ACTUALIZAR PILOTO EN BASE DE DATOS
        # ============================================================
        from database import update_driver
        
        try:
            update_driver(
                driver_id,
                data.get('transponder_id') or None,
                name,
                data.get('lastname', ''),
                data.get('email', ''),
                data.get('carnet', ''),
                data.get('phone', '')
            )
        except ValueError as e:
            # Capturar error de transponder duplicado
            return jsonify({'success': False, 'error': str(e)}), 400

        # ============================================================
        # PROCESAR FOTO (si se envió)
        # ============================================================
        photo_data = data.get('photo')
        if photo_data and photo_data.startswith('data:image'):
            try:
                import base64
                import io
                
                # Decodificar imagen base64
                if ',' in photo_data:
                    photo_data = photo_data.split(',')[1]
                image_bytes = base64.b64decode(photo_data)
                
                # Generar nombre único
                extension = 'jpg'
                unique_id = str(uuid.uuid4())[:8]
                filename = f"driver_{driver_id}_{unique_id}.{extension}"
                
                # Guardar archivo
                upload_dir = get_upload_folder()
                filepath = os.path.join(upload_dir, filename)
                with open(filepath, 'wb') as f:
                    f.write(image_bytes)
                
                # Crear thumbnail
                thumb_dir = get_thumbnails_folder()
                thumb_filename = f"thumb_{filename}"
                thumb_path = os.path.join(thumb_dir, thumb_filename)
                
                from PIL import Image
                with Image.open(io.BytesIO(image_bytes)) as img:
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    img.thumbnail((80, 80), Image.Resampling.LANCZOS)
                    img.save(thumb_path, 'JPEG', quality=85, optimize=True)
                
                # Eliminar foto antigua
                from database import get_driver_by_id, update_driver_photo
                driver = get_driver_by_id(driver_id)
                if driver and driver.get('photo') and driver['photo'] != 'default-avatar.png':
                    delete_driver_photo_files(driver_id, driver['photo'])
                
                # Guardar nueva foto en BD
                update_driver_photo(driver_id, filename)
                print(f"[PHOTO] Foto actualizada para piloto {driver_id}: {filename}")
                
            except Exception as e:
                print(f"[PHOTO] Error guardando foto base64: {e}")
                # No fallar la operación completa solo por la foto
                # return jsonify({'success': False, 'error': f'Error al procesar foto: {e}'}), 400

        # ============================================================
        # RESPUESTA EXITOSA
        # ============================================================
        return jsonify({
            'success': True, 
            'message': 'Piloto actualizado correctamente',
            'driver_id': driver_id
        })
        
    except Exception as e:
        print(f"[API] Error en update_driver_api: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/drivers/<int:driver_id>', methods=['DELETE'])
def delete_driver_by_id(driver_id):
    try:
        delete_driver(driver_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/drivers/clear-transponders', methods=['POST'])
def clear_transponders_api():
    try:
        clear_all_driver_transponders()
        return jsonify({
            'success': True, 
            'message': 'Transponders eliminados de todos los pilotos'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/unenroll-all', methods=['POST'])
def unenroll_all_drivers():
    try:
        session_info = get_current_session() or get_latest_session()
        if not session_info:
            return jsonify({'success': False, 'error': 'No hay sesión activa'}), 400
        clear_race_drivers(session_info['id'])
        return jsonify({'success': True, 'message': 'Todos los pilotos desinscritos'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - TRANSPONDERS
# ============================================
@app.route('/api/transponders/all')
def get_all_transponders_api():
    return jsonify(get_all_transponders())

@app.route('/api/transponders/unassigned')
def get_unassigned_transponders_api():
    return jsonify(get_unassigned_transponders())

@app.route('/api/transponders/<int:t_id>', methods=['DELETE'])
def delete_transponder_api(t_id):
    try:
        success = delete_transponder(t_id)
        return jsonify({
            'success': success,
            'error': None if success else 'No se puede eliminar un transponder asignado a un piloto'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/transponders/<int:old_id>', methods=['PUT'])
def update_transponder_api(old_id):
    try:
        data = request.get_json()
        new_id = data.get('new_id')
        if not new_id:
            return jsonify({'success': False, 'error': 'Nuevo ID requerido'}), 400
        success = update_transponder_id(old_id, new_id)
        return jsonify({
            'success': success,
            'error': None if success else 'No se puede editar: el ID ya existe o está asignado a un piloto'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/transponders/manual', methods=['POST'])
def add_transponder_manual_api():
    try:
        data = request.get_json()
        success = add_transponder_manual(data['id'], data.get('description', ''))
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/transponders/manual/extended', methods=['POST'])
def add_transponder_manual_extended_api():
    try:
        data = request.get_json()
        success = add_transponder_manual(
            transponder_id=data['id'],
            description=data.get('description', ''),
            kart_id=data.get('kart_id', '')
        )
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/transponders/<int:transponder_id>/details', methods=['PUT'])
def update_transponder_details(transponder_id):
    try:
        data = request.get_json()
        kart_id = data.get('kart_id', '')
        description = data.get('description', '')
        
        from database import update_transponder
        success = update_transponder(transponder_id, kart_id, description)
        
        if success:
            return jsonify({'success': True, 'message': 'Transponder actualizado'})
        else:
            return jsonify({'success': False, 'error': 'Transponder no encontrado'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/transponders/health')
def transponder_health_api():
    return jsonify(get_transponder_health())

@app.route('/api/transponders/health/<int:t_id>/reset', methods=['POST'])
def reset_transponder_health_api(t_id):
    try:
        success = reset_transponder_health(t_id)
        return jsonify({
            'success': success,
            'error': None if success else 'Transponder no encontrado'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

        
# ============================================
# ENDPOINTS - GESTIÓN DE KARTS
# ============================================

@app.route('/api/karts', methods=['GET'])
def get_karts():
    """Obtiene todos los karts con su estado"""
    from database import get_all_karts
    return jsonify(get_all_karts())

@app.route('/api/karts/<kart_number>', methods=['GET'])
def get_kart(kart_number):
    """Obtiene un kart específico"""
    from database import get_kart_by_number
    kart = get_kart_by_number(kart_number)
    if kart:
        return jsonify(kart)
    return jsonify({'success': False, 'error': 'Kart no encontrado'}), 404

@app.route('/api/karts/<kart_number>/status', methods=['PUT'])
def update_kart(kart_number):
    """Actualiza el estado de un kart"""
    try:
        data = request.get_json()
        status = data.get('status')
        driver_name = data.get('driver_name')
        notes = data.get('notes')
        
        valid_statuses = ['disponible', 'en_pista', 'mantenimiento']
        if status not in valid_statuses:
            return jsonify({
                'success': False, 
                'error': f'Estado inválido. Opciones: {valid_statuses}'
            }), 400
        
        from database import update_kart_status
        update_kart_status(kart_number, status, driver_name, notes)
        
        return jsonify({'success': True, 'message': f'Kart {kart_number} actualizado'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/karts/<kart_number>/assign', methods=['POST'])
def assign_transponder_to_kart_endpoint(kart_number):
    """Asigna un transponder a un kart"""
    try:
        data = request.get_json()
        transponder_id = data.get('transponder_id')
        
        if not transponder_id:
            return jsonify({'success': False, 'error': 'Transponder ID requerido'}), 400
        
        from database import assign_transponder_to_kart, get_kart_by_number, get_driver_by_transponder
        
        # Verificar que el kart existe
        kart = get_kart_by_number(kart_number)
        if not kart:
            return jsonify({'success': False, 'error': 'Kart no encontrado'}), 404
        
        # Verificar que el transponder existe
        driver = get_driver_by_transponder(transponder_id)
        if not driver:
            return jsonify({'success': False, 'error': 'Transponder no encontrado'}), 404
        
        # Asignar
        assign_transponder_to_kart(kart_number, transponder_id)
        
        return jsonify({
            'success': True, 
            'message': f'Transponder {transponder_id} asignado al kart {kart_number}'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/karts/<kart_number>/remove-transponder', methods=['POST'])
def remove_transponder_from_kart_endpoint(kart_number):
    """Desmonta el transponder de un kart"""
    try:
        from database import remove_transponder_from_kart
        remove_transponder_from_kart(kart_number)
        return jsonify({
            'success': True, 
            'message': f'Transponder desmontado del kart {kart_number}'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/karts/<kart_number>/mount-transponder', methods=['POST'])
def mount_transponder_to_kart_endpoint(kart_number):
    """Monta un transponder en un kart (sin exigir que esté vinculado a un piloto).

    A diferencia de /assign (que requiere un driver), este endpoint vincula el
    binomio kart<->transponder directamente, igual que el gestor de transponders
    del panel de control de carrera. Desmonta automáticamente del kart anterior.
    """
    try:
        data = request.get_json(silent=True) or {}
        transponder_id = data.get('transponder_id')
        if not transponder_id:
            return jsonify({'success': False, 'error': 'Transponder ID requerido'}), 400

        from database import (
            assign_transponder_to_kart,
            get_kart_by_number,
            get_all_transponders,
        )

        kart = get_kart_by_number(kart_number)
        if not kart:
            return jsonify({'success': False, 'error': 'Kart no encontrado'}), 404

        exists = any(str(t['id']) == str(transponder_id) for t in get_all_transponders())
        if not exists:
            return jsonify({'success': False, 'error': 'Transponder no encontrado'}), 404

        assign_transponder_to_kart(kart_number, transponder_id)
        return jsonify({
            'success': True,
            'message': f'Transponder {transponder_id} montado en el kart {kart_number}'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/karts/initialize', methods=['POST'])
def initialize_karts_endpoint():
    """Inicializa los karts del 1 al 25"""
    try:
        data = request.get_json() or {}
        count = data.get('count', 25)
        from database import initialize_karts
        initialize_karts(count)
        return jsonify({
            'success': True, 
            'message': f'{count} karts inicializados'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/karts/available')
def get_available_karts():
    """Obtiene los karts disponibles (sin transponder o en estado disponible)"""
    from database import get_all_karts
    karts = get_all_karts()
    available = [k for k in karts if k.get('status') == 'disponible' and not k.get('transponder_id')]
    return jsonify(available)        

# ============================================
# ENDPOINTS - INSCRIPCIONES
# ============================================
@app.route('/api/race/add', methods=['POST'])
def add_to_race():
    try:
        data = request.get_json()
        add_driver_to_race(
            data['session_id'], 
            data['driver_id'], 
            data['transponder_id'], 
            data.get('start_position')
        )
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/remove', methods=['POST'])
def remove_from_race():
    try:
        data = request.get_json()
        remove_driver_from_race(data['session_id'], data['driver_id'])
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/drivers/<int:session_id>')
def get_race_drivers_api(session_id):
    return jsonify(get_race_drivers(session_id))

@app.route('/api/race/driver-times/<int:session_id>')
def get_driver_individual_times(session_id):
    from database import get_driver_individual_times
    return jsonify(get_driver_individual_times(session_id))

# ============================================
# ENDPOINTS - CONTADOR MANUAL DE VUELTAS
# ============================================
@app.route('/api/race/karts-with-drivers/<int:session_id>')
def get_karts_with_drivers(session_id):
    """Devuelve los karts participantes (los de los pilotos inscritos) para el panel manual.

    Usa como fuente de verdad los pilotos inscritos (race_drivers) y su kart
    asignado (transponders.kart_id). Así el tablero muestra UNA casilla por cada
    piloto en carrera, sin depender de que el transponder esté montado en la tabla
    karts (que suele quedar incompleta/desactualizada).
    """
    try:
        from database import get_kart_by_transponder

        race_drivers = get_race_drivers(session_id)
        karts = []
        seen_tids = set()
        for rd in race_drivers:
            transponder_id = rd.get('transponder_id')
            if not transponder_id:
                continue
            tid = int(transponder_id) if str(transponder_id).isdigit() else transponder_id
            if tid in seen_tids:
                continue
            seen_tids.add(tid)

            # Número de kart del piloto: transponders.kart_id (mismo criterio del leaderboard)
            kart_number = rd.get('transponder_kart_id')
            if not kart_number:
                # Fallback: qué kart tiene este transponder montado en la tabla karts
                kart = get_kart_by_transponder(tid)
                kart_number = kart.get('kart_number') if kart else None
            if not kart_number:
                kart_number = str(tid)

            driver_name = (rd.get('name', '') + ' ' + rd.get('lastname', '')).strip()

            karts.append({
                'kart_number': str(kart_number),
                'transponder_id': tid,
                'driver_id': rd.get('driver_id'),
                'driver_name': driver_name,
            })

        def _kart_order(k):
            try:
                return int(k['kart_number'])
            except (ValueError, TypeError):
                return 10 ** 9

        karts.sort(key=_kart_order)
        return jsonify({'success': True, 'karts': karts})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'karts': []}), 500

@app.route('/api/manual-lap', methods=['POST'])
def manual_lap():
    """Marca manualmente una vuelta para un kart."""
    try:
        data = request.get_json() or {}
        kart_number = data.get('kart_number')
        if kart_number is None and data.get('transponder_id') is None:
            return jsonify({'success': False, 'error': 'kart_number requerido'}), 400

        ok = _enqueue_manual_lap(
            kart_number=kart_number,
            session_id=data.get('session_id'),
            transponder_id=data.get('transponder_id'),
        )
        if not ok:
            return jsonify({'success': False, 'error': 'No se pudo encolar la vuelta'}), 500
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - REINICIAR SERVIDOR
# ============================================
@app.route('/api/restart', methods=['POST'])
def restart_server():
    try:
        data = request.get_json() or {}
        next_race_name = data.get('next_race_name')
        next_race_laps = data.get('next_race_laps', 10)
        next_race_mode = data.get('next_race_mode')
        
        if next_race_name:
            with open(NEXT_RACE_NAME_FILE, 'w') as f:
                f.write(next_race_name)
            with open(NEXT_RACE_LAPS_FILE, 'w') as f:
                f.write(str(next_race_laps))
            if next_race_mode:
                with open(NEXT_RACE_MODE_FILE, 'w') as f:
                    f.write(str(next_race_mode))
        
        with open(RESTART_FLAG_FILE, 'w') as f:
            f.write('restart')
        
        def do_exit():
            time.sleep(0.5)
            os._exit(1)
        
        threading.Thread(target=do_exit, daemon=True).start()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - USB
# ============================================
@app.route('/api/usb/status')
def usb_status():
    try:
        if os.path.exists('/dev/ttyUSB0'):
            return jsonify({'connected': True, 'port': '/dev/ttyUSB0'})
        elif os.path.exists('/dev/ttyACM0'):
            return jsonify({'connected': True, 'port': '/dev/ttyACM0'})
        else:
            return jsonify({'connected': False, 'port': None})
    except Exception as e:
        return jsonify({'connected': False, 'error': str(e)})

@app.route('/api/usb/reset', methods=['POST'])
def reset_usb():
    with open(SHUTDOWN_FLAG_FILE, 'w') as f:
        f.write('shutdown')
    return jsonify({'success': True, 'message': 'Apagando sistema de forma segura...'})

# ============================================
# ENDPOINTS - RESPALDOS Y MANTENIMIENTO
# ============================================
@app.route('/api/db/stats', methods=['GET'])
def get_db_stats_api():
    from database import get_db_stats
    return jsonify(get_db_stats())

@app.route('/api/db/backup', methods=['POST'])
def create_backup_api():
    from database import create_backup
    backup_file = create_backup()
    if backup_file:
        return jsonify({
            'success': True, 
            'backup_file': backup_file, 
            'message': 'Respaldo creado correctamente'
        })
    else:
        return jsonify({'success': False, 'message': 'Error al crear respaldo'}), 500

@app.route('/api/db/backups', methods=['GET'])
def get_backups_api():
    from database import get_backups_list
    return jsonify(get_backups_list())

@app.route('/api/db/restore/<backup_filename>', methods=['POST'])
def restore_backup_api(backup_filename):
    from database import restore_backup_and_reset
    try:
        restore_backup_and_reset(backup_filename)
        return jsonify({
            'success': True, 
            'message': f'Base de datos restaurada desde {backup_filename} y sistema reiniciado'
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/db/soft-reset', methods=['POST'])
def soft_reset_api():
    from database import soft_reset_race_data
    result = soft_reset_race_data()
    return jsonify({
        'success': True, 
        'message': 'Limpieza segura completada', 
        'details': result
    })

@app.route('/api/db/safe-hard-reset', methods=['POST'])
def safe_hard_reset_api():
    from database import safe_hard_reset
    backup_file = safe_hard_reset()
    return jsonify({
        'success': True, 
        'message': 'Reinicio total completado', 
        'backup_file': backup_file
    })

# ============================================
# ENDPOINTS - CONFIGURACIÓN
# ============================================
@app.route('/api/config/antenna', methods=['GET'])
def get_antenna_config_api():
    from database import get_antenna_config
    return jsonify(get_antenna_config())

@app.route('/api/config/antenna', methods=['POST'])
def update_antenna_config_api():
    try:
        from database import update_antenna_config
        data = request.get_json()
        update_antenna_config(
            min_signal=data.get('min_signal'),
            filter_time=data.get('filter_time')
        )
        return jsonify({'success': True, 'message': 'Configuración actualizada'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/circuit/config', methods=['GET'])
def get_circuit_config_api():
    return jsonify(get_circuit_config())

@app.route('/api/circuit/config', methods=['POST'])
def update_circuit_config_api():
    try:
        data = request.get_json()
        track_length = data.get('track_length_km')
        track_type = data.get('track_type')
        if track_length is None or track_length == 0:
            track_length = 0.33
        update_circuit_config(
            track_length_km=float(track_length) if track_length is not None else None,
            track_type=track_type
        )
        return jsonify({'success': True, 'message': 'Configuración guardada'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/config/timing', methods=['GET'])
def get_timing_config_api():
    from database import get_timing_config
    return jsonify(get_timing_config())

@app.route('/api/config/timing', methods=['POST'])
def update_timing_config_api():
    try:
        from database import update_timing_config
        data = request.get_json()
        update_timing_config(
            time_source=data.get('time_source'),
            min_valid_lap_time=data.get('min_valid_lap_time')
        )
        return jsonify({'success': True, 'message': 'Configuración de tiempo actualizada'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - AUTENTICACIÓN
# ============================================
@app.route('/api/auth/login', methods=['POST'])
def login_api():
    data = request.get_json()
    username = data.get('username', '')
    password = data.get('password', '')
    
    user = verify_user(username, password)
    if user:
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']

        from users_db import create_session
        token = create_session(user['id'])

        return jsonify({
            'success': True, 
            'user': {
                'username': user['username'],
                'role': user['role']
            },
            'session_token': token
        })
    else:
        return jsonify({'success': False, 'message': 'Usuario o contraseña incorrectos'}), 401

@app.route('/api/auth/logout', methods=['POST'])
def logout_api():
    data = request.get_json() or {}
    token = data.get('session_token')
    
    if token:
        from users_db import delete_session
        delete_session(token)
    
    session.pop('user_id', None)
    session.pop('username', None)
    session.pop('role', None)
    
    return jsonify({'success': True, 'message': 'Sesión cerrada'})

@app.route('/api/auth/check', methods=['GET'])
def check_auth_api():
    if 'user_id' in session:
        return jsonify({
            'authenticated': True,
            'user': {
                'username': session['username'],
                'role': session['role']
            }
        })
    else:
        return jsonify({'authenticated': False})

@app.route('/api/auth/verify-session', methods=['POST'])
def verify_session_api():
    data = request.get_json()
    token = data.get('session_token')
    
    user = verify_session(token)
    
    if user:
        return jsonify({
            'success': True,
            'user': {
                'username': user['username'],
                'role': user['role']
            }
        })
    else:
        return jsonify({'success': False, 'message': 'Sesión inválida o expirada'}), 401

# ============================================
# ENDPOINTS - MODO SIMULACIÓN
# ============================================
@app.route('/api/simulation/mode', methods=['POST'])
def set_simulation_mode():
    try:
        print(f"[SIMULACIÓN] Recibida petición POST")
        data = request.get_json()
        print(f"[SIMULACIÓN] Datos recibidos: {data}")
        enabled = data.get('enabled', False)
        print(f"[SIMULACIÓN] enabled = {enabled}")
        print(f"[SIMULACIÓN] SIMULATION_MODE_FILE = {SIMULATION_MODE_FILE}")
        
        if enabled:
            os.makedirs(os.path.dirname(SIMULATION_MODE_FILE), exist_ok=True)
            with open(SIMULATION_MODE_FILE, 'w') as f:
                f.write('simulation')
            print("[SIMULACIÓN] ✅ Modo simulación ACTIVADO")
        else:
            if os.path.exists(SIMULATION_MODE_FILE):
                os.remove(SIMULATION_MODE_FILE)
                print("[SIMULACIÓN] ✅ Modo simulación DESACTIVADO")
            else:
                print("[SIMULACIÓN] El archivo no existía, nada que eliminar")
        
        return jsonify({'success': True, 'enabled': enabled})
    except Exception as e:
        print(f"[SIMULACIÓN] ❌ ERROR DETALLADO: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/simulation/speed', methods=['GET'])
def get_simulation_speed():
    try:
        if os.path.exists(SIMULATION_SPEED_FILE):
            with open(SIMULATION_SPEED_FILE, 'r') as f:
                speed = float(f.read().strip())
        else:
            speed = 2.0
        return jsonify({'success': True, 'speed': speed})
    except:
        return jsonify({'success': True, 'speed': 2.0})

@app.route('/api/simulation/speed', methods=['POST'])
def set_simulation_speed():
    try:
        data = request.get_json()
        speed = float(data.get('speed', 2.0))
        speed = max(0.2, min(5.0, speed))
        with open(SIMULATION_SPEED_FILE, 'w') as f:
            f.write(str(speed))
        return jsonify({'success': True, 'speed': speed})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/simulation/generate-lap', methods=['POST'])
def generate_simulation_lap():
    try:
        return jsonify({'success': True, 'message': 'Vuelta generada (simulación)'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/system/ip', methods=['GET'])
def get_local_ip():
    import socket
    import os
    import subprocess
    import re
    
    ips = []
    
    # ============================================================
    # MÉTODO 1: Usar variable de entorno HOST_IP
    # ============================================================
    host_ip = os.environ.get('HOST_IP')
    if host_ip:
        ips.append(host_ip)
        return jsonify({
            'success': True,
            'ips': ips,
            'main_ip': ips[0],
            'port': 5000,
            'urls': [f'http://{ip}:5000' for ip in ips]
        })
    
    # ============================================================
    # MÉTODO 2: Detectar IPs (todas, sin filtrar agresivamente)
    # ============================================================
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if ip not in ips:
                ips.append(ip)
    except:
        pass
    
    # ============================================================
    # MÉTODO 3: Usar hostname -I (Linux)
    # ============================================================
    if not ips:
        try:
            result = subprocess.run(
                ["hostname", "-I"],
                capture_output=True,
                text=True
            )
            if result.stdout:
                for ip in result.stdout.strip().split():
                    if ip not in ips:
                        ips.append(ip)
        except:
            pass
    
    # ============================================================
    # MÉTODO 4: Si hay IPs, devolverlas (incluyendo 172.x.x.x)
    # ============================================================
    if ips:
        return jsonify({
            'success': True,
            'ips': ips,
            'main_ip': ips[0],
            'port': 5000,
            'urls': [f'http://{ip}:5000' for ip in ips]
        })
    
    # ============================================================
    # MÉTODO 5: Fallback - localhost
    # ============================================================
    return jsonify({
        'success': True,
        'ips': ['localhost'],
        'main_ip': 'localhost',
        'port': 5000,
        'urls': ['http://localhost:5000']
    })

    
@app.route('/api/decoder/status', methods=['GET'])
def decoder_status():
    try:
        if os.path.exists('/dev/ttyUSB0'):
            return jsonify({'connected': True, 'port': '/dev/ttyUSB0'})
        elif os.path.exists('/dev/ttyACM0'):
            return jsonify({'connected': True, 'port': '/dev/ttyACM0'})
        else:
            return jsonify({'connected': False, 'port': None})
    except Exception as e:
        return jsonify({'connected': False, 'error': str(e)})

@app.route('/api/decoder/mode', methods=['GET'])
def get_decoder_mode_api():
    return jsonify({'mode': get_decoder_mode()})

@app.route('/api/decoder/mode', methods=['POST'])
def set_decoder_mode_api():
    try:
        from decoder_modes import set_decoder_mode as set_mode
        data = request.get_json()
        mode = data.get('mode', 'chronit')
        
        valid_modes = ['chronit', 'a120', 'a20', 'fr01']
        if mode not in valid_modes:
            return jsonify({
                'success': False, 
                'error': f'Modo inválido. Opciones: {valid_modes}'
            }), 400
        
        update_decoder_mode(mode)
        set_mode(mode)
        
        return jsonify({'success': True, 'message': f'Modo cambiado a {mode}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def _get_main_module():
    """Devuelve el módulo __main__ (main.py), que es donde viven las variables
    globales de carrera (RACE_ACTIVE) y las funciones de escucha del decoder."""
    import sys
    return sys.modules.get('__main__')

def _get_race_active():
    main_mod = _get_main_module()
    if main_mod and hasattr(main_mod, 'RACE_ACTIVE'):
        return bool(main_mod.RACE_ACTIVE)
    return False

def _get_decoder_listen():
    main_mod = _get_main_module()
    if main_mod and hasattr(main_mod, 'get_decoder_listening'):
        try:
            return bool(main_mod.get_decoder_listening())
        except Exception:
            pass
    return True

@app.route('/api/decoder/listen', methods=['GET'])
def decoder_listen_get():
    """Estado actual de la escucha del decoder + si hay carrera activa."""
    try:
        return jsonify({
            'success': True,
            'enabled': _get_decoder_listen(),
            'race_active': _get_race_active(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/decoder/listen', methods=['POST'])
def decoder_listen_set():
    """Activa/desactiva la escucha continua del decoder.

    ⛔ Durante una carrera activa NO se puede desactivar la escucha.
    """
    try:
        data = request.get_json() or {}
        enabled = bool(data.get('enabled', True))

        if _get_race_active():
            return jsonify({
                'success': False,
                'error': 'No se puede apagar la escucha: hay una carrera en curso.',
            }), 400

        main_mod = _get_main_module()
        if main_mod and hasattr(main_mod, 'set_decoder_listening'):
            main_mod.set_decoder_listening(enabled)
            print(f"[API] Escucha del decoder → {'enabled' if enabled else 'disabled'}")
            return jsonify({'success': True, 'enabled': enabled})
        return jsonify({'success': False, 'error': 'Módulo de escucha no disponible'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - LOGS
# ============================================
def get_logs_from_file(limit=200):
    try:
        if not os.path.exists(LOG_BUFFER_FILE):
            return []
        with open(LOG_BUFFER_FILE, 'r') as f:
            lines = f.readlines()
            return [line.strip() for line in lines[-limit:] if line.strip()]
    except Exception as e:
        print(f"[LOGS] Error leyendo archivo: {e}")
        return []

@app.route('/api/logs', methods=['GET'])
def get_realtime_logs():
    try:
        lines = request.args.get('lines', 200, type=int)
        logs = get_logs_from_file(lines)
        
        formatted_logs = []
        for log in logs:
            log_type = 'info'
            if 'ERROR' in log or '❌' in log:
                log_type = 'error'
            elif 'CARRERA INICIADA' in log or '✅' in log:
                log_type = 'success'
            elif '⚠️' in log or 'WARNING' in log:
                log_type = 'warning'
            elif '🏁' in log or '🏆' in log or 'DETECCIÓN' in log:
                log_type = 'race'
            
            formatted_logs.append({
                'text': log,
                'type': log_type,
                'timestamp': time.time()
            })
        
        return jsonify({'logs': formatted_logs, 'total': len(formatted_logs)})
    except Exception as e:
        print(f"[ERROR] get_realtime_logs: {e}")
        return jsonify({'error': str(e), 'logs': []}), 500

@app.route('/api/logs/clear', methods=['POST'])
def clear_realtime_logs():
    try:
        if os.path.exists(LOG_BUFFER_FILE):
            os.remove(LOG_BUFFER_FILE)
        with open(LOG_BUFFER_FILE, 'w') as f:
            f.write("")
        return jsonify({'success': True, 'message': 'Logs limpiados'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - DASHBOARD COMPLETO
# ============================================
@app.route('/api/dashboard/full-data')
def get_full_dashboard_data():
    return jsonify(_build_full_dashboard_payload())


def _build_full_dashboard_payload():
    """Construye el payload completo del tablero (reutilizado por REST y WebSocket)."""
    session_info = get_current_session() or get_latest_session()
    if not session_info:
        return {
            'active': False,
            'leaderboard': [],
            'lap_details': {},
            'speeds': {},
            'countdown': get_countdown_state()
        }

    session_id = session_info['id']
    session_info['race_elapsed_seconds'] = get_session_elapsed_seconds(session_info)

    leaderboard = get_leaderboard_with_details(session_id)
    
    with get_db() as conn:
        lap_rows = conn.execute('''
            SELECT 
                l.driver_id,
                l.lap_number,
                l.lap_seconds,
                l.gap_to_leader,
                l.avg_speed_kmh
            FROM laps l
            WHERE l.session_id = ?
            AND l.lap_number > 0
            AND l.id IN (
                SELECT id FROM laps l2 
                WHERE l2.session_id = l.session_id 
                AND l2.driver_id = l.driver_id 
                ORDER BY l2.lap_number DESC 
                LIMIT 6
            )
            ORDER BY l.driver_id, l.lap_number DESC
        ''', (session_id,)).fetchall()
        
        lap_details = {}
        for row in lap_rows:
            if row['driver_id'] not in lap_details:
                lap_details[row['driver_id']] = []
            lap_details[row['driver_id']].append({
                'lap_number': row['lap_number'],
                'lap_seconds': row['lap_seconds'],
                'gap_to_leader': row['gap_to_leader'],
                'avg_speed_kmh': row['avg_speed_kmh']
            })
        for driver_id in lap_details:
            lap_details[driver_id].reverse()
        
        speed_rows = conn.execute('''
            SELECT 
                l.driver_id,
                l.avg_speed_kmh
            FROM laps l
            WHERE l.session_id = ?
            AND l.lap_number = (
                SELECT MAX(lap_number) 
                FROM laps l2 
                WHERE l2.session_id = l.session_id AND l2.driver_id = l.driver_id
                AND l2.lap_number > 0
            )
        ''', (session_id,)).fetchall()
        
        speeds = {row['driver_id']: row['avg_speed_kmh'] for row in speed_rows}
    
    return {
        'active': True,
        'session': session_info,
        'leaderboard': leaderboard,
        'lap_details': lap_details,
        'speeds': speeds,
        'countdown': get_countdown_state(),
        'timestamp': time.time()
    }


# ============================================
# BROADCAST EN TIEMPO REAL (WebSocket)
# ============================================
# Estrategia anti-saturación:
#   * Un único hilo recorre el estado cada BROADCAST_INTERVAL segundos.
#   * Se calcula una "firma" compacta del estado relevante y SOLO se emite
#     cuando cambia (nueva vuelta, cambio de posición, cambio de estado, etc.),
#     limitando así la frecuencia de eventos.
#   * El cronómetro se redondea a segundos para no emitir en cada milisegundo:
#     el cliente lo suaviza localmente y se re-sincroniza 1 vez por segundo.
#   * Si no hay clientes conectados, no se emite nada.
BROADCAST_INTERVAL = 0.4
_last_dashboard_signature = None


def _dashboard_signature(payload):
    """Firma compacta del estado del tablero para detectar cambios reales."""
    if not payload or not payload.get('active'):
        return 'inactive'
    session = payload.get('session') or {}
    cd = payload.get('countdown') or {}
    parts = [
        'sid=' + str(session.get('id')),
        'st=' + str(session.get('status')),
        'rm=' + str(session.get('race_mode')),
        'll=' + str(session.get('laps_limit')),
        'cd=' + str(cd.get('id') or 0),
        # Redondeado a segundos: 1 emisión/segundo como máximo por el reloj.
        'el=' + str(int(float(session.get('race_elapsed_seconds') or 0))),
    ]
    for d in payload.get('leaderboard') or []:
        parts.append('%s:%s:%s:%s:%s:%s' % (
            d.get('driver_id'), d.get('position'), d.get('total_laps'),
            d.get('best_lap'), d.get('gap'),
            1 if d.get('is_finished') else 0,
        ))
    speeds = payload.get('speeds') or {}
    for key in sorted(speeds.keys(), key=lambda k: str(k)):
        try:
            parts.append('v%s=%d' % (key, int(round(float(speeds[key] or 0)))))
        except (TypeError, ValueError):
            parts.append('v%s=--' % key)
    return '|'.join(parts)


def _realtime_broadcaster():
    """Hilo único que emite 'dashboard_update' solo cuando el estado cambia."""
    global _last_dashboard_signature
    while True:
        try:
            if _realtime_has_clients():
                payload = _build_full_dashboard_payload()
                signature = _dashboard_signature(payload)
                if signature != _last_dashboard_signature:
                    _last_dashboard_signature = signature
                    socketio.emit('dashboard_update', payload)
        except Exception as e:  # noqa: BLE001 - el hilo nunca debe morir
            print(f"[REALTIME] Error en broadcast: {e}")
        time.sleep(BROADCAST_INTERVAL)

# ============================================
# ENDPOINTS - HISTORIAL Y RESPALDOS DE PILOTOS
# ============================================
@app.route('/api/race/history/<int:session_id>', methods=['GET'])
def get_race_detail(session_id):
    try:
        session_info = get_session_info(session_id)
        if not session_info:
            return jsonify({'success': False, 'error': 'Carrera no encontrada'}), 404
        
        leaderboard = get_leaderboard_with_details(session_id)
        session_info['race_elapsed_seconds'] = get_session_elapsed_seconds(session_info)
        
        laps_by_driver = {}
        with get_db() as conn:
            lap_rows = conn.execute('''
                SELECT driver_id, lap_number, lap_seconds, total_seconds, avg_speed_kmh, timestamp
                FROM laps
                WHERE session_id = ? AND lap_number > 0
                ORDER BY driver_id, lap_number ASC
            ''', (session_id,)).fetchall()
            for row in lap_rows:
                r = dict(row)
                driver_id = str(r['driver_id'])
                if driver_id not in laps_by_driver:
                    laps_by_driver[driver_id] = []
                laps_by_driver[driver_id].append({
                    'lap_number': r['lap_number'],
                    'lap_seconds': r['lap_seconds'],
                    'total_seconds': r['total_seconds'],
                    'avg_speed_kmh': r['avg_speed_kmh'],
                    'timestamp': r['timestamp']
                })
        
        return jsonify({
            'success': True,
            'session': session_info,
            'leaderboard': leaderboard,
            'laps_by_driver': laps_by_driver
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/history/<int:session_id>', methods=['DELETE'])
def delete_race_history(session_id):
    token = request.headers.get('X-Session-Token')
    user_role = 'admin'
    
    if token:
        user = verify_session(token)
        if user:
            user_role = user['role']
    
    if user_role != 'developer':
        return jsonify({
            'success': False, 
            'error': 'Acceso denegado. Solo desarrolladores pueden eliminar carreras'
        }), 403
    
    try:
        with get_db() as conn:
            conn.execute('DELETE FROM laps WHERE session_id = ?', (session_id,))
            conn.execute('DELETE FROM race_drivers WHERE session_id = ?', (session_id,))
            conn.execute('DELETE FROM race_sessions WHERE id = ?', (session_id,))
        
        return jsonify({
            'success': True,
            'message': f'Carrera {session_id} eliminada correctamente'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - BACKUP DE PILOTOS
# ============================================
@app.route('/api/backup/pilotos/list', methods=['GET'])
def get_pilotos_backups_list():
    try:
        from database import get_pilotos_backups_list
        backups = get_pilotos_backups_list()
        return jsonify(backups)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/backup/pilotos', methods=['POST'])
def backup_pilotos():
    try:
        from database import backup_drivers_and_transponders
        backup_file = backup_drivers_and_transponders()
        return jsonify({
            'success': True, 
            'message': 'Respaldo creado', 
            'backup_file': backup_file
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/pilotos/restore/<filename>', methods=['POST'])
def restore_pilotos_backup(filename):
    try:
        from database import restore_drivers_and_transponders_from_backup
        result = restore_drivers_and_transponders_from_backup(filename)
        return jsonify({
            'success': True, 
            'message': f'Restaurados {result["drivers"]} pilotos y {result["transponders"]} transponders'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/pilotos/delete/<filename>', methods=['POST'])
def delete_pilotos_backup(filename):
    try:
        import os
        from database import get_backup_dir
        backup_dir = get_backup_dir()
        filepath = os.path.join(backup_dir, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'Archivo no encontrado'}), 404
        
        os.remove(filepath)
        return jsonify({'success': True, 'message': f'Respaldo {filename} eliminado'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - GESTIÓN DE RESPALDOS
# ============================================
@app.route('/api/backup/delete/<filename>', methods=['POST'])
def delete_backup_file(filename):
    try:
        import os
        from database import get_backup_dir
        backup_dir = get_backup_dir()
        filepath = os.path.join(backup_dir, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'Archivo no encontrado'}), 404
        
        os.remove(filepath)
        return jsonify({'success': True, 'message': f'Respaldo {filename} eliminado'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/delete-old', methods=['POST'])
def delete_old_backups():
    try:
        import os
        from datetime import datetime, timedelta
        from database import get_backup_dir
        
        days = request.args.get('days', 30, type=int)
        backup_dir = get_backup_dir()
        cutoff = datetime.now() - timedelta(days=days)
        
        deleted = 0
        for filename in os.listdir(backup_dir):
            if filename.endswith('.db') and filename.startswith('chronit_backup_'):
                filepath = os.path.join(backup_dir, filename)
                mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
                if mtime < cutoff:
                    os.remove(filepath)
                    deleted += 1
        
        return jsonify({
            'success': True, 
            'message': f'Eliminados {deleted} respaldos antiguos'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/backup/view/<filename>', methods=['GET'])
def view_backup(filename):
    try:
        import shutil
        from database import get_backup_dir
        
        backup_dir = get_backup_dir()
        source = os.path.join(backup_dir, filename)
        
        if not os.path.exists(source):
            return jsonify({'success': False, 'error': 'Archivo no encontrado'}), 404
        
        temp_view = os.path.join(backup_dir, '_temp_view.db')
        shutil.copy2(source, temp_view)
        
        return jsonify({
            'success': True, 
            'message': f'Respaldo {filename} listo para visualizar'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
# ENDPOINTS - VELOCIDAD POR VUELTA
# ============================================
@app.route('/api/laps/speed/<int:session_id>/<int:driver_id>', methods=['GET'])
def get_laps_speed(session_id, driver_id):
    try:
        from database import get_db
        with get_db() as conn:
            laps = conn.execute('''
                SELECT lap_number, lap_seconds, avg_speed_kmh
                FROM laps
                WHERE session_id = ? AND driver_id = ? AND lap_number > 0
                ORDER BY lap_number ASC
            ''', (session_id, driver_id)).fetchall()
            return jsonify([dict(lap) for lap in laps])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================
# FUNCIONES DE UTILIDAD
# ============================================
def format_race_clock(totalSeconds):
    if totalSeconds is None or totalSeconds < 0:
        totalSeconds = 0
    minutes = int(totalSeconds // 60)
    seconds = int(totalSeconds % 60)
    millis = int((totalSeconds % 1) * 1000)
    return f"{minutes:02d}:{seconds:02d}.{millis:03d}"

# ============================================
# PUNTO DE ENTRADA PRINCIPAL
# ============================================
def start_api_server():
    init_db()
    init_users_db()
    # Hilo único de difusión en tiempo real (anti-saturación: solo emite cambios).
    threading.Thread(target=_realtime_broadcaster, daemon=True).start()
    # Se usa socketio.run (Werkzeug + threading) para habilitar WebSocket sin
    # monkey-patch: el hilo serial y el cronometraje siguen intactos.
    socketio.run(
        app,
        host='0.0.0.0',
        port=5000,
        debug=False,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )

# ============================================
# ENDPOINTS - PREFERENCIAS DE USUARIO
# ============================================


@app.route('/api/user/preferences', methods=['GET'])
def get_user_preferences_api():
    """Obtiene todas las preferencias del usuario actual"""
    token = request.headers.get('X-Session-Token')
    if not token:
        return jsonify({'success': False, 'error': 'No autenticado'}), 401
    
    from users_db import verify_session
    user = verify_session(token)
    if not user:
        return jsonify({'success': False, 'error': 'Sesión inválida'}), 401
    
    from database import get_user_preferences
    prefs = get_user_preferences(user['id'])
    
    # ✅ LOG PARA DEPURACIÓN
    print(f"[API] Preferencias devueltas para usuario {user['id']}: {prefs}")
    
    return jsonify({'success': True, 'preferences': prefs})

@app.route('/api/user/preferences', methods=['POST'])
def set_user_preferences_api():
    """Guarda las preferencias del usuario actual"""
    token = request.headers.get('X-Session-Token')
    if not token:
        return jsonify({'success': False, 'error': 'No autenticado - Token requerido'}), 401
    
    from users_db import verify_session
    user = verify_session(token)
    if not user:
        return jsonify({'success': False, 'error': 'Sesión inválida o expirada'}), 401
    
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Datos inválidos'}), 400
    
    try:
        from database import set_user_preference
        
        # ✅ LOG PARA DEPURACIÓN
        print(f"[API] Guardando preferencias para usuario {user['id']}: {data}")
        
        # Guardar cada preferencia
        for key, value in data.items():
            set_user_preference(user['id'], key, str(value))
        
        # ✅ VERIFICAR QUE SE GUARDARON
        from database import get_user_preferences
        prefs_after = get_user_preferences(user['id'])
        print(f"[API] Preferencias después de guardar: {prefs_after}")
        
        return jsonify({'success': True, 'message': 'Preferencias guardadas'})
    except Exception as e:
        print(f"[API] Error guardando preferencias: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
        

@app.route('/api/user/preferences/<key>', methods=['DELETE'])
def delete_user_preference_api(key):
    """Elimina una preferencia de usuario"""
    token = request.headers.get('X-Session-Token')
    if not token:
        return jsonify({'success': False, 'error': 'No autenticado'}), 401
    
    from users_db import verify_session
    user = verify_session(token)
    if not user:
        return jsonify({'success': False, 'error': 'Sesión inválida'}), 401
    
    from database import set_user_preference
    set_user_preference(user['id'], key, None)  # Eliminar (guardar null)
    
    return jsonify({'success': True, 'message': 'Preferencia eliminada'})



# ============================================
# ENDPOINTS - CONFIGURACIÓN GLOBAL DE COLUMNAS (PÚBLICA)
# ============================================

@app.route('/api/columns/config', methods=['GET'])
def get_columns_config():
    """Obtiene la configuración global de columnas (sin autenticación)"""
    from database import get_global_setting
    try:
        desktop = get_global_setting('hidden_columns_desktop')
        mobile = get_global_setting('hidden_columns_mobile')
        # Columna independiente para la pantalla en pista (LED): no comparte
        # preferencias con escritorio ni móvil.
        led = get_global_setting('hidden_columns_led')

        # Si no hay configuración, devolver arrays vacíos (mostrar todo)
        return jsonify({
            'success': True,
            'desktop': json.loads(desktop) if desktop else [],
            'mobile': json.loads(mobile) if mobile else [],
            'led': json.loads(led) if led else []
        })
    except Exception as e:
        return jsonify({
            'success': True,
            'desktop': [],
            'mobile': [],
            'led': []
        })

@app.route('/api/columns/config', methods=['POST'])
def save_columns_config():
    """Guarda la configuración global de columnas (SOLO desarrolladores)"""
    from database import set_global_setting
    from users_db import verify_session
    
    # ✅ Verificar que el usuario sea desarrollador
    token = request.headers.get('X-Session-Token')
    if not token:
        return jsonify({'success': False, 'error': 'Se requiere autenticación'}), 401
    
    user = verify_session(token)
    if not user or user['role'] != 'developer':
        return jsonify({'success': False, 'error': 'Solo desarrolladores pueden modificar esta configuración'}), 403
    
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Datos inválidos'}), 400
    
    try:
        desktop = data.get('desktop', [])
        mobile = data.get('mobile', [])
        led = data.get('led', [])
        
        set_global_setting('hidden_columns_desktop', json.dumps(desktop))
        set_global_setting('hidden_columns_mobile', json.dumps(mobile))
        set_global_setting('hidden_columns_led', json.dumps(led))
        
        return jsonify({'success': True, 'message': 'Configuración guardada'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500



# ============================================
# ENDPOINTS - CONFIGURACIÓN DE CACHÉ (SOLO DESARROLLADORES)
# ============================================

@app.route('/api/config/cache', methods=['GET'])
def get_cache_config():
    """Obtiene la configuración del caché"""
    from database import get_cache_refresh_seconds
    return jsonify({
        'refresh_seconds': get_cache_refresh_seconds()
    })

@app.route('/api/config/cache', methods=['POST'])
def set_cache_config():
    """Actualiza la configuración del caché (solo desarrolladores)"""
    # ✅ Verificar que sea desarrollador
    token = request.headers.get('X-Session-Token')
    if not token:
        return jsonify({'success': False, 'error': 'No autenticado'}), 401
    
    from users_db import verify_session
    user = verify_session(token)
    if not user or user['role'] != 'developer':
        return jsonify({'success': False, 'error': 'Solo desarrolladores'}), 403
    
    data = request.get_json()
    seconds = data.get('refresh_seconds', 5)
    
    if seconds < 1 or seconds > 60:
        return jsonify({'success': False, 'error': 'Valor entre 1 y 60 segundos'}), 400
    
    from database import set_cache_refresh_seconds
    set_cache_refresh_seconds(seconds)
    
    return jsonify({'success': True, 'refresh_seconds': seconds})


# ============================================
# ENDPOINTS - EVENTOS FUTUROS
# ============================================
@app.route('/api/events', methods=['GET'])
def api_get_events():
    try:
        include_completed = request.args.get('include_completed') == '1'
        events = get_future_events(include_completed=include_completed)
        return jsonify(events)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/pending', methods=['GET'])
def api_get_events_pending():
    """Eventos pendientes de correr (aún no activos ni finalizados)."""
    try:
        events = get_future_events()
        pendientes = [
            e for e in events
            if e.get('status') in ('upcoming', 'pendiente', 'preparada', 'pending')
        ]
        return jsonify(pendientes)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/active', methods=['GET'])
def api_get_events_active():
    """Eventos actualmente en carrera (activos) o vinculados a la sesión activa."""
    try:
        events = get_future_events()
        actives = [e for e in events if e.get('status') in ('active', 'activo')]
        # Si hay una sesión en curso, preferimos devolver el evento en 'active'
        session = get_current_session()
        if session and session.get('status') == 'active' and not actives:
            for e in events:
                if e.get('status') in ('preparada', 'active', 'activo'):
                    actives.append(e)
                    break
        return jsonify(actives)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events', methods=['POST'])
def api_create_event():
    try:
        data = request.get_json()
        event_id = create_future_event(data)
        return jsonify({'success': True, 'id': event_id}), 201
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>', methods=['GET'])
def api_get_event(event_id):
    event = get_future_event(event_id)
    if not event:
        return jsonify({'success': False, 'error': 'Evento no encontrado'}), 404
    return jsonify(event)


@app.route('/api/events/<int:event_id>', methods=['PUT'])
def api_update_event(event_id):
    try:
        data = request.get_json()
        update_future_event(event_id, data)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>', methods=['DELETE'])
def api_delete_event(event_id):
    try:
        delete_future_event(event_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/complete', methods=['POST'])
def api_complete_event(event_id):
    try:
        ok = complete_future_event(event_id)
        if not ok:
            return jsonify({'success': False, 'error': 'Evento no encontrado'}), 404
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/history', methods=['GET'])
def api_get_event_history():
    try:
        return jsonify(get_event_history())
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers', methods=['GET'])
def api_get_event_drivers(event_id):
    return jsonify(get_event_drivers(event_id))


@app.route('/api/events/<int:event_id>/drivers', methods=['POST'])
def api_add_event_drivers(event_id):
    try:
        data = request.get_json()
        driver_ids = data.get('driver_ids', [])
        block = data.get('block')
        if not driver_ids:
            return jsonify({'success': False, 'error': 'No se enviaron pilotos'}), 400
        add_drivers_to_event_bulk(event_id, driver_ids, block)
        return jsonify({'success': True, 'added': len(driver_ids)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/<int:driver_id>', methods=['DELETE'])
def api_remove_event_driver(event_id, driver_id):
    try:
        remove_driver_from_event(event_id, driver_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/<int:driver_id>/transponder', methods=['POST'])
def api_set_event_driver_transponder(event_id, driver_id):
    try:
        data = request.get_json() or {}
        transponder_id = data.get('transponder_id')
        set_event_driver_transponder(event_id, driver_id, transponder_id)
        return jsonify({'success': True})
    except ValueError as ve:
        return jsonify({'success': False, 'error': str(ve)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/<int:driver_id>/called', methods=['POST'])
def api_mark_event_driver_called(event_id, driver_id):
    try:
        data = request.get_json() or {}
        mark_event_driver_called(event_id, driver_id, bool(data.get('called', True)))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/<int:driver_id>/locker', methods=['POST'])
def api_set_event_driver_locker(event_id, driver_id):
    try:
        data = request.get_json() or {}
        set_event_driver_locker(event_id, driver_id, data.get('locker_room'))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/<int:driver_id>/ready', methods=['POST'])
def api_set_event_driver_ready(event_id, driver_id):
    try:
        data = request.get_json() or {}
        set_event_driver_ready(event_id, driver_id, bool(data.get('ready', True)))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/ready-all', methods=['POST'])
def api_ready_all_event_drivers(event_id):
    """Pone en 'Ready' a todos los pilotos inscritos del evento (en bloque).

    La persona con rol marca el grupo completo de corredores como Listo para
    luego iniciar la carrera de una sola vez.
    """
    try:
        count = mark_event_drivers_ready(event_id, True)
        return jsonify({'success': True, 'ready': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/call-all', methods=['POST'])
def api_call_all_event_drivers(event_id):
    """Llama en bloque a todos los tickets (pilotos) del evento.

    Marca como 'llamado' a todos los pilotos inscritos del evento, para mostrar
    en bloque en la pantalla los tickets que deben dirigirse a vestidores.
    """
    try:
        count = mark_event_drivers_called(event_id, True)
        return jsonify({'success': True, 'called': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/transponders/available', methods=['GET'])
def api_get_event_transponders_available(event_id):
    try:
        return jsonify(get_available_event_transponders(event_id))
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/start', methods=['POST'])
def api_start_event_as_race(event_id):
    """DEPRECADO: el inicio de carrera ya NO se hace desde el panel de eventos.

    Se conserva la ruta únicamente para responder con un error explícito a
    clientes antiguos. El flujo correcto es:

      1. Configurar la carrera:  POST /api/events/<id>/setup
      2. Iniciar desde el panel de Control de Carrera: POST /api/race/start
    """
    return jsonify({
        'success': False,
        'error': 'El inicio de carrera no se realiza desde el panel de eventos. '
                 'Configura la carrera e iníciala desde el Control de Carrera.',
    }), 405


@app.route('/api/events/<int:event_id>/setup', methods=['POST'])
def api_setup_event_as_race(event_id):
    """Configura la carrera a partir del evento (botón "Configurar carrera").

    Replica EXACTAMENTE la lógica de una creación manual de carrera
    (create_new_race) pero tomando los datos del evento:

      1. Limpia el tablero: desvincula TODOS los transponders asignados en este
         momento a pilotos/karts y libera los karts usados.
      2. Vincula el código de transponder de cada piloto del evento a su ficha.
      3. Crea la sesión de carrera con nombre, modo de pista, vueltas/tiempo y
         origen de pilotos del evento (igual que una carrera sin evento).
      4. Inscribe a los pilotos del evento con su transponder (auto-asigna uno
         libre si el piloto aún no tiene).
      5. Recarga el motor de carrera (reload_session).

    IMPORTANTE: NO inicia la carrera. El inicio se hace desde el panel de
    Control de Carrera (POST /api/race/start).
    """
    try:
        from database import normalize_race_mode

        event = get_future_event(event_id)
        if not event:
            return jsonify({'success': False, 'error': 'Evento no encontrado'}), 404

        # Sólo se puede configurar cuando vestidores/coordinador marcó 'preparada'.
        status = (event.get('status') or '').strip().lower()
        if status not in ('preparada', 'prepared', 'preparado'):
            return jsonify({
                'success': False,
                'error': 'El evento no está PREPARADO. Vestidores debe marcar el grupo como preparado (ready) antes de configurar la carrera.',
            }), 400

        # Regla de negocio: NO se puede configurar una carrera si ya hay una en curso.
        # El inicio/fin se gestiona desde el panel de Control de Carrera.
        guard_session = get_latest_race_session()
        if _get_race_active() or (guard_session and guard_session.get('status') in ('active', 'paused')):
            return jsonify({
                'success': False,
                'error': 'Hay una carrera ACTIVA. Finalízala desde el Control de Carrera antes de configurar otra.',
            }), 409

        event_mode = ((event.get('mode') or 'rapida') or 'rapida').strip().lower()
        event_uuid = event.get('uuid_global')

        # Lista local del evento: incluye el transponder provisional por piloto.
        event_drivers_local = get_event_drivers(event_id)
        local_tp = {
            int(d['driver_id']): d.get('transponder_id')
            for d in event_drivers_local
            if d.get('driver_id')
        }

        # Origen de pilotos: 'gestionada' lee las colas de PostgreSQL, 'rapida' usa la lista local.
        if event_mode == 'gestionada':
            from pg_db import get_gestionada_pilots
            pilotos = get_gestionada_pilots(event_uuid) if event_uuid else []
            event_drivers = []
            if pilotos:
                with get_db() as conn:
                    for p in pilotos:
                        row = conn.execute(
                            'SELECT id, uuid_global FROM drivers WHERE uuid_global = ?',
                            (str(p['uuid_global']),),
                        ).fetchone()
                        if row:
                            event_drivers.append({
                                'driver_id': row['id'],
                                'uuid_global': p['uuid_global'],
                                'transponder_id': local_tp.get(int(row['id'])),
                            })
            if not event_drivers:
                event_drivers = event_drivers_local
        else:
            event_drivers = event_drivers_local

        if not event_drivers:
            return jsonify({'success': False, 'error': 'El evento no tiene pilotos inscritos.'}), 400

        # ---- Configuración de carrera (idéntica a create_new_race) ----
        race_name = event['name']
        laps_limit = event.get('laps_limit') or 10
        race_mode = normalize_race_mode(event.get('race_mode') or 'position')
        time_limit_seconds = event.get('time_limit_seconds') or 0

        if race_mode in ('classification', 'endurance'):
            if time_limit_seconds <= 0:
                return jsonify({
                    'success': False,
                    'error': 'Este evento requiere duración en minutos mayor a 0',
                }), 400
            if race_mode == 'classification':
                laps_limit = 0
        elif race_mode == 'qualifying_laps':
            if laps_limit <= 0:
                return jsonify({
                    'success': False,
                    'error': 'Para clasificación por vueltas el límite debe ser mayor a 0',
                }), 400
            time_limit_seconds = 0
        elif race_mode == 'position' and laps_limit <= 0:
            laps_limit = 10

        # ---- 1) LIMPIAR TABLERO POR COMPLETO ----
        latest = get_latest_race_session()
        if latest:
            # Cerrar la carrera anterior y borrar sus inscripciones
            if latest.get('status') == 'active':
                update_race_status(latest['id'], 'completed')
            clear_race_drivers(latest['id'])
        # Desvincular TODOS los transponders asignados (pilotos y karts)
        freed = unbind_all_transponders()

        # ---- 2) VINCULAR TRANSPONDERS DEL EVENTO A SUS PILOTOS ----
        try:
            bound = bind_event_drivers_transponders(event_id)
        except ValueError as ve:
            return jsonify({'success': False, 'error': str(ve)}), 400

        # ---- 3) CREAR LA SESIÓN DE CARRERA ----
        new_session_id = start_new_session(
            race_name, laps_limit, race_mode, time_limit_seconds,
            mode=event_mode, event_uuid=event_uuid,
        )

        # ---- 4) INSCRIBIR PILOTOS CON SU TRANSPONDER ----
        used_tps = {
            str(d.get('transponder_id'))
            for d in event_drivers if d.get('transponder_id')
        }
        pool = [
            t for t in get_available_event_transponders(event_id)
            if str(t['id']) not in used_tps
        ]

        inscritos = 0
        idx = 1
        for d in event_drivers:
            tp = d.get('transponder_id')
            # Auto-asignar un transponder libre si el piloto aún no tiene
            if not tp and pool:
                free_tp = pool.pop(0)
                set_event_driver_transponder(event_id, d['driver_id'], free_tp['id'])
                tp = free_tp['id']
            if tp and d.get('driver_id'):
                add_driver_to_race(new_session_id, d['driver_id'], tp, idx)
                inscritos += 1
                idx += 1

        if inscritos == 0:
            return jsonify({
                'success': False,
                'error': 'Ningún piloto del evento tiene transponder asignado y no hay transponders disponibles. Asígnalos manualmente (selector 📟) antes de configurar.',
            }), 400

        # ---- 5) RECARGAR EL MOTOR DE CARRERA (no inicia la carrera) ----
        send_race_command(json.dumps({"action": "reload_session"}))

        print(
            f"[API] Carrera configurada desde evento: {race_name} "
            f"(sesión {new_session_id}, {inscritos} pilotos, modo {race_mode}, {laps_limit} v, {time_limit_seconds}s)"
        )

        return jsonify({
            'success': True,
            'message': f'Carrera configurada: {race_name} con {inscritos} pilotos. Iníciala desde el Control de Carrera.',
            'session_id': new_session_id,
            'race_name': race_name,
            'laps_limit': laps_limit,
            'race_mode': race_mode,
            'time_limit_seconds': time_limit_seconds,
            'drivers': inscritos,
            'bound': bound,
            'freed_transponders': freed,
        })

    except Exception as e:
        print(f"[API] Error en setup_event_as_race: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/status', methods=['POST'])
def api_set_event_status(event_id):
    """Cambia el estado de un evento futuro (pendiente | preparada | activo | finalizado).

    Vestidores marca 'preparada' cuando el grupo está completo y listo; sin ese
    estado el control de carrera no permite iniciar el evento (ver /start).
    """
    try:
        data = request.get_json() or {}
        status = data.get('status')
        if status not in ('pendiente', 'preparada', 'activo', 'finalizado', 'active', 'upcoming', 'completed'):
            return jsonify({'success': False, 'error': f'Estado inválido: {status}'}), 400
        try:
            ok = set_event_status(event_id, status)
        except ValueError as e:
            return jsonify({'success': False, 'error': str(e), 'code': 'TRANSICION_INVALIDA'}), 409
        if not ok:
            return jsonify({'success': False, 'error': 'Evento no encontrado'}), 404
        return jsonify({'success': True, 'status': status})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/tickets', methods=['GET'])
def api_get_event_tickets(event_id):
    """Devuelve la info de tickets (PostgreSQL) de los pilotos del evento.

    Estructura: { uuid_piloto: {ticket_id, ticket_numero, ticket_estado} }.
    Es de mejor esfuerzo: si PG no está disponible devuelve {}.
    """
    try:
        from pg_db import get_event_tickets
        event = get_future_event(event_id)
        if not event:
            return jsonify({'success': False, 'error': 'Evento no encontrado'}), 404
        return jsonify(get_event_tickets(event.get('uuid_global')))
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/events/<int:event_id>/drivers/<int:driver_id>/ticket-status', methods=['POST'])
def api_set_event_driver_ticket_status(event_id, driver_id):
    """Cambia manualmente el estado del ticket de un piloto (acciones de emergencia).

    Localiza el ticket en PostgreSQL por el uuid_global del piloto y del evento.
    Estados permitidos: PENDIENTE, ASIGNADO, LLAMANDO, PREPARADO, ACTIVO,
    FINALIZADO, AUSENTE, REVOCADO, USADO.
    """
    try:
        from pg_db import EVENT_TICKET_STATUSES, set_ticket_status_by_driver_uuid
        data = request.get_json() or {}
        status = (data.get('status') or '').upper()
        if status not in EVENT_TICKET_STATUSES:
            return jsonify({'success': False, 'error': f'Estado inválido: {status}'}), 400
        event = get_future_event(event_id)
        if not event:
            return jsonify({'success': False, 'error': 'Evento no encontrado'}), 404
        with get_db() as conn:
            row = conn.execute(
                "SELECT uuid_global FROM drivers WHERE id = ?", (driver_id,)
            ).fetchone()
        driver_uuid = row['uuid_global'] if row else None
        if not driver_uuid:
            return jsonify({'success': False, 'error': 'El piloto no tiene uuid_global (no está vinculado en PostgreSQL)'}), 404
        ok = set_ticket_status_by_driver_uuid(event.get('uuid_global'), driver_uuid, status)
        if not ok:
            return jsonify({'success': False, 'error': 'No se encontró el ticket en PostgreSQL o no hay conexión'}), 404
        return jsonify({'success': True, 'status': status})
    except Exception as e:
        print(f"[API] Error en ticket-status: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/connectivity', methods=['GET'])
def api_connectivity():
    """Estado de conectividad del core: servidor y PostgreSQL (online/offline)."""
    try:
        from pg_db import pg_check_online
        from database import get_global_setting
        pg_online = pg_check_online()
        data_source = (get_global_setting(DATA_SOURCE_SETTING_KEY) or 'local').lower()
        if data_source not in VALID_DATA_SOURCES:
            data_source = 'local'
        return jsonify({
            'success': True,
            'server': 'online',
            'pg_online': pg_online,
            'data_source': data_source,
            'mode': 'online' if pg_online else 'offline',
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# Fuente de datos del módulo de carreras: 'local' (SQLite) o 'postgres' (central).
# Se guarda en la tabla settings para que persista entre reinicios y la usan
# create_future_event (modo por defecto) y la UI de Sistema.
DATA_SOURCE_SETTING_KEY = 'data_source'
VALID_DATA_SOURCES = ('local', 'postgres')


@app.route('/api/config/data-source', methods=['GET'])
def get_data_source():
    """Devuelve la fuente de datos activa del módulo de carreras."""
    try:
        from database import get_global_setting
        from pg_db import pg_check_online
        source = (get_global_setting(DATA_SOURCE_SETTING_KEY) or 'local').lower()
        if source not in VALID_DATA_SOURCES:
            source = 'local'
        return jsonify({'success': True, 'source': source, 'pg_online': pg_check_online()})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/config/data-source', methods=['POST'])
def set_data_source():
    """Cambia la fuente de datos del módulo de carreras (local/PostgreSQL)."""
    data = request.get_json(silent=True) or {}
    source = (data.get('source') or '').lower()
    if source not in VALID_DATA_SOURCES:
        return jsonify({'success': False, 'error': "source debe ser 'local' o 'postgres'"}), 400
    try:
        from database import set_global_setting
        from pg_db import pg_check_online
        if source == 'postgres' and not pg_check_online():
            return jsonify({'success': False, 'error': 'PostgreSQL no está disponible'}), 503
        set_global_setting(DATA_SOURCE_SETTING_KEY, source)
        return jsonify({'success': True, 'source': source})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == "__main__":
    start_api_server()