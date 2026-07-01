import json
import os
import threading
import time
import platform
import secrets
import logging
import uuid
from datetime import datetime
from flask import Flask, jsonify, request, render_template, make_response, session, send_from_directory
from flask_cors import CORS
from users_db import init_users_db, verify_user, verify_session
from PIL import Image

# ============================================
# CONFIGURACIÓN DE RUTAS
# ============================================
current_dir = os.path.dirname(os.path.abspath(__file__))
static_path = os.path.join(current_dir, 'static')
template_path = os.path.join(current_dir, 'templates')

# Detectar sistema operativo
IS_WINDOWS = platform.system() == 'Windows'

# ============================================
# FUNCIONES DE UTILIDAD PARA FOTOS (DEFINIDAS ANTES DE app)
# ============================================
def get_upload_folder():
    """Obtiene la carpeta de uploads según SO"""
    if IS_WINDOWS:
        upload_dir = os.path.join(current_dir, 'static', 'uploads', 'drivers')
    else:
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
)

# ============================================
# CONFIGURACIÓN DE ARCHIVOS DEL SISTEMA
# ============================================
if IS_WINDOWS:
    BASE_DATA_DIR = os.path.join(current_dir, 'data')
    if not os.path.exists(BASE_DATA_DIR):
        os.makedirs(BASE_DATA_DIR)
else:
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

def send_race_command(command):
    with open(RACE_COMMAND_FILE, 'w') as f:
        f.write(command)
    return True

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

# ============================================
# ENDPOINTS - ARCHIVOS ESTÁTICOS (FOTOS)
# ============================================
@app.route('/static/uploads/drivers/<path:filename>')
def serve_driver_photo(filename):
    """Sirve las fotos de pilotos desde la carpeta uploads"""
    try:
        upload_dir = get_upload_folder()
        filepath = os.path.join(upload_dir, filename)
        if os.path.exists(filepath):
            return send_from_directory(upload_dir, filename)
        
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
    return jsonify({
        'status': 'online', 
        'current_session': session_info, 
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
    
    if user_role == 'developer':
        simulation_active = os.path.exists(SIMULATION_MODE_FILE)
        if not port_exists and not simulation_active:
            return jsonify({
                'success': False, 
                'error': 'Decoder no conectado. Activa el modo simulación en el panel Sistema para pruebas sin hardware.'
            }), 400
    else:
        if not port_exists:
            return jsonify({
                'success': False, 
                'error': 'Decoder no conectado. El hardware es obligatorio para usuarios administradores.'
            }), 400
    
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
    
    return jsonify({'success': True, 'message': 'Carrera iniciada'})

@app.route('/api/race/pause', methods=['POST'])
def race_pause():
    send_race_command('pause')
    return jsonify({'success': True, 'message': 'Carrera pausada'})

@app.route('/api/race/resume', methods=['POST'])
def race_resume():
    send_race_command('resume')
    return jsonify({'success': True, 'message': 'Carrera reanudada'})

@app.route('/api/race/finish', methods=['POST'])
def race_finish():
    send_race_command('finish')
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
        
        with open(RACE_COMMAND_FILE, 'w') as f:
            f.write(json.dumps(comando))
        
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
    comando = {'action': 'clear_all'}
    with open(RACE_COMMAND_FILE, 'w') as f:
        f.write(json.dumps(comando))
    return jsonify({'success': True, 'message': 'Limpiando sistema...'})

@app.route('/api/race/create-new', methods=['POST'])
def create_new_race():
    try:
        data = request.get_json()
        race_name = data.get('next_race_name')
        laps_limit = data.get('next_race_laps', 10)
        race_mode = data.get('next_race_mode', 'position')
        time_limit_seconds = data.get('time_limit_seconds', 0)
        
        if race_mode in ('classification', 'endurance'):
            if time_limit_seconds <= 0:
                return jsonify({
                    'success': False, 
                    'error': 'Para TIME LIMIT y ENDURANCE, la duración debe ser mayor a 0 minutos'
                }), 400
            if race_mode == 'classification':
                laps_limit = 0
        elif race_mode == 'position':
            if laps_limit <= 0:
                laps_limit = 10
        
        if not race_name:
            return jsonify({
                'success': False, 
                'error': 'Nombre de carrera requerido'
            }), 400
        
        current_session = get_current_session()
        if current_session:
            clear_race_drivers(current_session['id'])
            print(f"[API] Limpiados pilotos de la sesión {current_session['id']}")
        
        comandos = {
            'action': 'new_race',
            'race_name': race_name,
            'laps_limit': laps_limit,
            'race_mode': race_mode,
            'time_limit_seconds': time_limit_seconds
        }
        
        with open(RACE_COMMAND_FILE, 'w') as f:
            f.write(json.dumps(comandos))
        
        return jsonify({'success': True, 'message': 'Creando nueva carrera...'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================
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
        
        time_limit_file = os.path.join(BASE_DATA_DIR, 'time_limit_info.json')
        if os.path.exists(time_limit_file):
            with open(time_limit_file, 'r') as f:
                data = json.load(f)
                time_limit_end = data.get('time_limit_end', 0)
                time_limit_active = data.get('time_limit_active', False)
                
                if time_limit_active and time_limit_end > 0:
                    remaining = max(0, time_limit_end - time.time())
                    return jsonify({
                        'success': True,
                        'remaining_seconds': remaining,
                        'remaining_formatted': format_race_clock(remaining),
                        'is_active': True
                    })
        
        return jsonify({
            'success': True,
            'remaining_seconds': 0,
            'remaining_formatted': '00:00',
            'is_active': False
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/time-limit-status', methods=['POST'])
def update_time_limit_status():
    try:
        data = request.get_json()
        time_limit_file = os.path.join(BASE_DATA_DIR, 'time_limit_info.json')
        with open(time_limit_file, 'w') as f:
            json.dump(data, f)
        return jsonify({'success': True})
    except Exception as e:
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
        
        name = data.get('name')
        if not name:
            return jsonify({'success': False, 'error': 'Nombre es obligatorio'}), 400

        from database import update_driver
        update_driver(
            driver_id,
            data.get('transponder_id') or None,
            name,
            data.get('lastname', ''),
            data.get('email', ''),
            data.get('carnet', ''),
            data.get('phone', '')
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
                
                from database import get_driver_by_id, update_driver_photo
                driver = get_driver_by_id(driver_id)
                if driver and driver.get('photo') and driver['photo'] != 'default-avatar.png':
                    delete_driver_photo_files(driver_id, driver['photo'])
                
                update_driver_photo(driver_id, filename)
                
            except Exception as e:
                print(f"[PHOTO] Error guardando foto base64: {e}")

        return jsonify({'success': True})
    except Exception as e:
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
    from database import restore_backup
    try:
        restore_backup(backup_filename)
        return jsonify({
            'success': True, 
            'message': f'Base de datos restaurada desde {backup_filename}'
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
    session_info = get_current_session() or get_latest_session()
    if not session_info:
        return jsonify({
            'active': False, 
            'leaderboard': [], 
            'lap_details': {}, 
            'speeds': {}
        })
    
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
    
    return jsonify({
        'active': True,
        'session': session_info,
        'leaderboard': leaderboard,
        'lap_details': lap_details,
        'speeds': speeds,
        'timestamp': time.time()
    })

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
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False, threaded=True)

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
    return jsonify({'success': True, 'preferences': prefs})

@app.route('/api/user/preferences', methods=['POST'])
def set_user_preferences_api():
    """Guarda las preferencias del usuario actual"""
    token = request.headers.get('X-Session-Token')
    if not token:
        return jsonify({'success': False, 'error': 'No autenticado'}), 401
    
    from users_db import verify_session
    user = verify_session(token)
    if not user:
        return jsonify({'success': False, 'error': 'Sesión inválida'}), 401
    
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Datos inválidos'}), 400
    
    from database import set_user_preference
    
    # Guardar cada preferencia
    for key, value in data.items():
        set_user_preference(user['id'], key, str(value))
    
    return jsonify({'success': True, 'message': 'Preferencias guardadas'})

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
        
        # Si no hay configuración, devolver arrays vacíos (mostrar todo)
        return jsonify({
            'success': True,
            'desktop': json.loads(desktop) if desktop else [],
            'mobile': json.loads(mobile) if mobile else []
        })
    except Exception as e:
        return jsonify({
            'success': True,
            'desktop': [],
            'mobile': []
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
        
        set_global_setting('hidden_columns_desktop', json.dumps(desktop))
        set_global_setting('hidden_columns_mobile', json.dumps(mobile))
        
        return jsonify({'success': True, 'message': 'Configuración guardada'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == "__main__":
    start_api_server()