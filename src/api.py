import logging
import json
import os
import threading
import time
import platform
import secrets
from flask import Flask, jsonify, request, render_template, make_response, session
from flask_cors import CORS
import netifaces  

current_dir = os.path.dirname(os.path.abspath(__file__))
static_path = os.path.join(current_dir, 'static')
template_path = os.path.join(current_dir, 'templates')

app = Flask(__name__, 
            static_folder=os.path.join(current_dir, 'static'),
            template_folder=os.path.join(current_dir, 'templates'))
app.secret_key = secrets.token_hex(32)

CORS(app, supports_credentials=True)
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
)
from users_db import init_users_db, verify_user

logging.getLogger('werkzeug').setLevel(logging.ERROR)

# Detectar sistema operativo
IS_WINDOWS = platform.system() == 'Windows'

# Configurar rutas de archivos según SO
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

def send_race_command(command):
    with open(RACE_COMMAND_FILE, 'w') as f:
        f.write(command)
    return True

@app.route('/')
def index():
    resp = make_response(render_template('dashboard.html'))
    # Evita HTML/JS viejo en pantallas múltiples (Chrome cache agresivo)
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/api/status')
def status():
    session = get_current_session()
    return jsonify({'status': 'online', 'current_session': session, 'timestamp': time.time()})

@app.route('/api/session/current')
def get_current_session_info():
    """Endpoint principal para la tabla de posiciones"""
    session = get_current_session() or get_latest_session()
    if not session:
        return jsonify({'active': False, 'leaderboard': []})
    
    leaderboard = get_leaderboard_with_details(session['id'])
    session['race_elapsed_seconds'] = get_session_elapsed_seconds(session)
    session['can_repeat'] = session.get('status') == 'completed'
    session['can_reset_board'] = session.get('status') == 'completed'
    session['can_manage_enrollment'] = session.get('status') == 'pending'
    return jsonify({
        'active': True, 
        'session': session, 
        'leaderboard': leaderboard
    })

@app.route('/api/session/current/podium')
def get_current_session_podium():
    from database import get_podium
    session = get_current_session() or get_latest_session()
    if not session:
        return jsonify({'active': False, 'session_id': None, 'race_mode': 'position', 'podium': []})
    res = get_podium(session['id'])
    return jsonify({'active': True, 'session_id': session['id'], 'race_mode': res.get('race_mode', 'position'), 'podium': res.get('podium', [])})

@app.route('/api/leaderboard')
def get_leaderboard_api():
    session = get_current_session()
    if not session:
        return jsonify([])
    return jsonify(get_leaderboard_with_details(session['id']))

@app.route('/api/signals/recent')
def get_recent_signals_api():
    limit = request.args.get('limit', 10, type=int)
    return jsonify(get_recent_signals(limit))

# ==================== CONTROL DE CARRERA ====================

@app.route('/api/race/start', methods=['POST'])
def race_start():
    send_race_command('start')
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
        session = get_current_session()
        if not session:
            session = get_latest_session()
        if not session:
            return jsonify({'success': False, 'error': 'No hay carrera disponible'}), 400
        if session.get('status') != 'completed':
            return jsonify({'success': False, 'error': 'Solo se puede repetir cuando la carrera ha finalizado'}), 400

        race_drivers = get_race_drivers(session['id'])
        if not race_drivers:
            return jsonify({'success': False, 'error': 'No hay pilotos inscritos'}), 400

        # En lugar de matar el proceso, enviamos comando JSON
        comando = {
            'action': 'repeat_race',
            'circuit_name': session['circuit_name'],
            'laps_limit': session.get('laps_limit', 10),
            'race_mode': session.get('race_mode', 'position'),
            'race_drivers': race_drivers
        }
        
        with open(RACE_COMMAND_FILE, 'w') as f:
            f.write(json.dumps(comando))
        
        print(f"[API] Comando repeat_race enviado: {comando['circuit_name']}")
        return jsonify({'success': True, 'message': 'Repitiendo carrera...'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/reset', methods=['POST'])
def race_reset():
    session = get_current_session() or get_latest_session()
    if session and session.get('status') != 'completed':
        return jsonify({'success': False, 'error': 'Solo puedes resetear el tablero cuando la carrera haya finalizado'}), 400
    send_race_command('reset_race')
    return jsonify({'success': True, 'message': 'Reiniciando carrera'})

@app.route('/api/race/clear-all', methods=['POST'])
def race_clear_all():
    comando = {'action': 'clear_all'}
    with open(RACE_COMMAND_FILE, 'w') as f:
        f.write(json.dumps(comando))
    return jsonify({'success': True, 'message': 'Limpiando sistema...'})

# ==================== DETALLES DE CARRERA ====================

@app.route('/api/race/lap-details/<int:session_id>/<int:driver_id>')
def get_driver_lap_details(session_id, driver_id):
    laps = get_lap_details(session_id, driver_id)
    return jsonify(laps)

@app.route('/api/race/history')
def race_history():
    history = get_race_history()
    return jsonify(history)

# ==================== PILOTOS ====================

@app.route('/api/drivers', methods=['GET'])
def get_drivers():
    return jsonify(get_all_drivers())

@app.route('/api/drivers', methods=['POST'])
def create_driver():
    try:
        data = request.get_json()
        driver_id = add_driver(
            data['transponder_id'], data['name'], data.get('lastname', ''),
            data.get('age'), data.get('gender', ''), data.get('nationality', ''),
            data.get('weight'), data.get('description', '')
        )
        return jsonify({'success': True, 'driver_id': driver_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/drivers/<int:driver_id>', methods=['PUT'])
def update_driver_api(driver_id):
    try:
        data = request.get_json()
        update_driver(driver_id, data['transponder_id'], data['name'], data.get('lastname', ''))
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

# ==================== TRANSPONDERS ====================

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
        return jsonify({'success': success, 'error': None if success else 'No se puede eliminar un transponder asignado a un piloto'})
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
        return jsonify({'success': success, 'error': None if success else 'No se puede editar: el ID ya existe o está asignado a un piloto'})
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
def update_transponder_details_api(transponder_id):
    try:
        data = request.get_json()
        update_transponder(
            transponder_id=transponder_id,
            kart_id=data.get('kart_id'),
            description=data.get('description')
        )
        return jsonify({'success': True, 'message': 'Transponder actualizado'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/transponders/health')
def transponder_health_api():
    return jsonify(get_transponder_health())

@app.route('/api/transponders/health/<int:t_id>/reset', methods=['POST'])
def reset_transponder_health_api(t_id):
    try:
        success = reset_transponder_health(t_id)
        return jsonify({'success': success, 'error': None if success else 'Transponder no encontrado'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== INSCRIPCIONES ====================

@app.route('/api/race/add', methods=['POST'])
def add_to_race():
    try:
        data = request.get_json()
        add_driver_to_race(data['session_id'], data['driver_id'], data['transponder_id'], data.get('start_position'))
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

# ==================== REINICIAR SERVIDOR (Contenedor Docker)====================
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




# ==================== USB ====================

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

def start_api_server():
    init_db()
    init_users_db()
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False, threaded=True)

@app.route('/api/race/driver-times/<int:session_id>')
def get_driver_individual_times(session_id):
    """Obtiene los tiempos individuales de cada piloto"""
    from database import get_driver_individual_times
    return jsonify(get_driver_individual_times(session_id))





# ==================== RESPALDOS Y MANTENIMIENTO ====================

@app.route('/api/db/stats', methods=['GET'])
def get_db_stats_api():
    """Obtiene estadísticas de la base de datos"""
    from database import get_db_stats
    return jsonify(get_db_stats())

@app.route('/api/db/backup', methods=['POST'])
def create_backup_api():
    """Crea un respaldo manual de la base de datos"""
    from database import create_backup
    backup_file = create_backup()
    if backup_file:
        return jsonify({'success': True, 'backup_file': backup_file, 'message': 'Respaldo creado correctamente'})
    else:
        return jsonify({'success': False, 'message': 'Error al crear respaldo'}), 500

@app.route('/api/db/backups', methods=['GET'])
def get_backups_api():
    """Lista todos los respaldos disponibles"""
    from database import get_backups_list
    return jsonify(get_backups_list())

@app.route('/api/db/restore/<backup_filename>', methods=['POST'])
def restore_backup_api(backup_filename):
    """Restaura un respaldo específico"""
    from database import restore_backup
    try:
        restore_backup(backup_filename)
        return jsonify({'success': True, 'message': f'Base de datos restaurada desde {backup_filename}'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/db/soft-reset', methods=['POST'])
def soft_reset_api():
    """Limpieza segura (conserva pilotos y transponders)"""
    from database import soft_reset_race_data
    result = soft_reset_race_data()
    return jsonify({'success': True, 'message': 'Limpieza segura completada', 'details': result})

@app.route('/api/db/safe-hard-reset', methods=['POST'])
def safe_hard_reset_api():
    """Reinicio total CON respaldo previo"""
    from database import safe_hard_reset
    backup_file = safe_hard_reset()
    return jsonify({'success': True, 'message': 'Reinicio total completado', 'backup_file': backup_file})

# ==================== CONFIGURACIÓN DE ANTENA ====================

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


# ==================== AUTENTICACIÓN ====================

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
            'session_token': token  # Enviar token al frontend
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
    
    from users_db import verify_session
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

# ==================== RESPALDOS DE PILOTOS Y TRANSPONDERS ====================

@app.route('/api/backup/pilotos', methods=['POST'])
def backup_pilotos_api():
    from database import backup_drivers_and_transponders
    filepath = backup_drivers_and_transponders()
    return jsonify({'success': True, 'message': 'Respaldo de pilotos creado', 'file': filepath})

@app.route('/api/backup/pilotos/list', methods=['GET'])
def list_pilotos_backups_api():
    from database import get_pilotos_backups_list
    return jsonify(get_pilotos_backups_list())

@app.route('/api/backup/pilotos/restore/<filename>', methods=['POST'])
def restore_pilotos_backup_api(filename):
    from database import restore_drivers_and_transponders_from_backup
    try:
        result = restore_drivers_and_transponders_from_backup(filename)
        return jsonify({'success': True, 'message': f'Restaurados {result["drivers"]} pilotos y {result["transponders"]} transponders'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500  


# ==================== VISUALIZAR RESPALDOS EN SQLITE-WEB ====================

import shutil

@app.route('/api/backup/view/<filename>', methods=['GET'])
def view_backup_in_sqlite(filename):
    """Prepara un respaldo para ser visto en sqlite-web"""
    from database import get_backup_dir
    
    backup_dir = get_backup_dir()
    backup_path = os.path.join(backup_dir, filename)
    
    if not os.path.exists(backup_path):
        return jsonify({'success': False, 'message': f'Respaldo no encontrado: {filename}'}), 404
    
    # Copiar el respaldo a un archivo temporal fijo
    temp_backup_path = os.path.join(backup_dir, '_temp_view.db')
    shutil.copy2(backup_path, temp_backup_path)
    
    return jsonify({
        'success': True,
        'message': f'Respaldo {filename} preparado para visualización',
        'temp_file': '_temp_view.db',
        'url': f'http://localhost:8883'  # Puerto que usaremos para el panel de respaldos
    })       
    
               
# ==================== ELIMINAR RESPALDOS ====================
@app.route('/api/backup/delete/<filename>', methods=['POST'])
def delete_backup_api(filename):
    """Elimina un archivo de respaldo específico"""
    from database import get_backup_dir
    
    # Verificar autenticación desde header también
    token = request.headers.get('X-Session-Token')
    if not token:
        data = request.get_json() or {}
        token = data.get('session_token')
    
    if token:
        from users_db import verify_session
        user = verify_session(token)
        if not user:
            return jsonify({'success': False, 'message': 'No autorizado'}), 401
    else:
        if 'user_id' not in session:
            return jsonify({'success': False, 'message': 'No autorizado'}), 401
    
    backup_dir = get_backup_dir()
    filepath = os.path.join(backup_dir, filename)
    
    # Seguridad: evitar eliminar archivos fuera de la carpeta de backups
    if not filepath.startswith(backup_dir):
        return jsonify({'success': False, 'message': 'Ruta inválida'}), 400
    
    if not os.path.exists(filepath):
        return jsonify({'success': False, 'message': 'Respaldo no encontrado'}), 404
    
    try:
        os.remove(filepath)
        return jsonify({'success': True, 'message': f'Respaldo {filename} eliminado'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500;


@app.route('/api/backup/delete-old', methods=['POST'])
def delete_old_backups_api():
    from database import get_backup_dir
    import time
    
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'No autorizado'}), 401
    
    days = request.args.get('days', 30, type=int)
    cutoff_time = time.time() - (days * 24 * 3600)
    
    backup_dir = get_backup_dir()
    deleted = 0
    
    for file in os.listdir(backup_dir):
        if file.endswith('.db') and file.startswith('chronit_backup_'):
            filepath = os.path.join(backup_dir, file)
            if os.path.getctime(filepath) < cutoff_time:
                os.remove(filepath)
                deleted += 1
    
    return jsonify({'success': True, 'message': f'Se eliminaron {deleted} respaldos antiguos'})

@app.route('/api/backup/pilotos/delete/<filename>', methods=['POST'])
def delete_pilotos_backup_api(filename):
    """Elimina un archivo de respaldo de pilotos y transponders"""
    from database import get_backup_dir
    import os
    
    # Verificar autenticación
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'No autorizado'}), 401
    
    backup_dir = get_backup_dir()
    filepath = os.path.join(backup_dir, filename)
    
    # Seguridad: evitar eliminar archivos fuera de la carpeta de backups
    if not filepath.startswith(backup_dir):
        return jsonify({'success': False, 'message': 'Ruta inválida'}), 400
    
    if not os.path.exists(filepath):
        return jsonify({'success': False, 'message': 'Respaldo no encontrado'}), 404
    
    # Solo permitir eliminar archivos JSON de pilotos
    if not filename.startswith('pilotos_transponders_backup_') or not filename.endswith('.json'):
        return jsonify({'success': False, 'message': 'Tipo de archivo no válido'}), 400
    
    try:
        os.remove(filepath)
        return jsonify({'success': True, 'message': f'Respaldo de pilotos {filename} eliminado'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== CONFIGURACIÓN DE FUENTE DE TIEMPO ====================

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


# ==================== IP DE CONEXIÓN ====================
@app.route('/api/system/ip', methods=['GET'])
def get_local_ip():
    """Obtiene la IP local de la laptop"""
    import socket
    import os
    
    ips = []
    
    # Método 1: hostname -I (comando Linux confiable)
    try:
        result = os.popen('hostname -I').read().strip()
        for ip in result.split():
            if not ip.startswith('127.') and not ip.startswith('172.'):
                ips.append(ip)
    except:
        pass
    
    # Método 2: socket.gethostbyname_ex
    if not ips:
        try:
            hostname = socket.gethostname()
            for ip in socket.gethostbyname_ex(hostname)[2]:
                if not ip.startswith('127.') and not ip.startswith('172.'):
                    ips.append(ip)
        except:
            pass
    
    # Método 3: conectar a 8.8.8.8
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if not ip.startswith('127.'):
                ips.append(ip)
            s.close()
        except:
            pass
    
    # Si todo falla, mostrar IP por defecto
    if not ips:
        ips = ['192.168.1.100']
    
    print(f"[IP] IPs encontradas: {ips}")
    
    return jsonify({
        'success': True,
        'ips': ips,
        'main_ip': ips[0],
        'port': 5000,
        'urls': [f'http://{ip}:5000' for ip in ips]
    })


#==================== REINICIO PRUEBA ====================
@app.route('/api/race/create-new', methods=['POST'])
def create_new_race():
    """Crea una nueva carrera sin reiniciar el servidor"""
    try:
        data = request.get_json()
        race_name = data.get('next_race_name')
        laps_limit = data.get('next_race_laps', 10)
        race_mode = data.get('next_race_mode', 'position')
        
        if not race_name:
            return jsonify({'success': False, 'error': 'Nombre de carrera requerido'}), 400
        
        # Enviar comando a main.py para crear nueva carrera
        comandos = {
            'action': 'new_race',
            'race_name': race_name,
            'laps_limit': laps_limit,
            'race_mode': race_mode
        }
        
        # Guardar comando en archivo
        with open(RACE_COMMAND_FILE, 'w') as f:
            f.write(json.dumps(comandos))
        
        return jsonify({'success': True, 'message': 'Creando nueva carrera...'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== CONFIGURACIÓN DE PISTA ====================

@app.route('/api/circuit/config', methods=['GET'])
def get_circuit_config():
    from database import get_circuit_config
    return jsonify(get_circuit_config())

@app.route('/api/circuit/config', methods=['POST'])
def update_circuit_config():
    try:
        from database import update_circuit_config
        data = request.get_json()
        track_length = data.get('track_length_km')
        track_type = data.get('track_type')
        
        update_circuit_config(
            track_length_km=float(track_length) if track_length is not None else None,
            track_type=track_type
        )
        return jsonify({'success': True, 'message': 'Configuración guardada'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/laps/speed/<int:session_id>/<int:driver_id>')
def get_laps_with_speed(session_id, driver_id):
    from database import get_db
    with get_db() as conn:
        laps = conn.execute('''
            SELECT lap_number, lap_seconds, avg_speed_kmh
            FROM laps
            WHERE session_id = ? AND driver_id = ? AND lap_number > 0
            ORDER BY lap_number ASC
        ''', (session_id, driver_id)).fetchall()
        return jsonify([dict(l) for l in laps])       


if __name__ == "__main__":
    start_api_server()

