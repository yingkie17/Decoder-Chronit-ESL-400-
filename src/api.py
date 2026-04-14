import logging
import os
import threading
import time
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
from database import (
    init_db,
    get_current_session,
    get_leaderboard_with_details,
    get_all_drivers,
    get_unassigned_transponders,
    add_driver,
    add_transponder_manual,
    get_all_transponders,
    delete_transponder,
    update_transponder_id,
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
)

logging.getLogger('werkzeug').setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app)

RESTART_FLAG_FILE = '/app/data/restart.flag'
SHUTDOWN_FLAG_FILE = '/app/data/shutdown.flag'
NEXT_RACE_NAME_FILE = '/app/data/next_race_name.txt'
NEXT_RACE_LAPS_FILE = '/app/data/next_race_laps.txt'
RACE_COMMAND_FILE = '/app/data/race_command.txt'

def send_race_command(command):
    with open(RACE_COMMAND_FILE, 'w') as f:
        f.write(command)
    return True

@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/api/status')
def status():
    session = get_current_session()
    return jsonify({'status': 'online', 'current_session': session, 'timestamp': time.time()})

@app.route('/api/session/current')
def get_current_session_info():
    """Endpoint principal para la tabla de posiciones"""
    session = get_current_session()
    if not session:
        return jsonify({'active': False, 'leaderboard': []})
    
    leaderboard = get_leaderboard_with_details(session['id'])
    return jsonify({
        'active': True, 
        'session': session, 
        'leaderboard': leaderboard
    })

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
            return jsonify({'success': False, 'error': 'No hay carrera activa'}), 400

        race_drivers = get_race_drivers(session['id'])
        if not race_drivers:
            return jsonify({'success': False, 'error': 'No hay pilotos inscritos'}), 400

        guardar_estado_repetir(
            session_id=session['id'],
            circuit_name=session['circuit_name'],
            laps_limit=session.get('laps_limit', 10),
            race_drivers=race_drivers,
        )
        
        with open(RESTART_FLAG_FILE, 'w') as f:
            f.write('restart')
        
        def do_exit():
            time.sleep(0.5)
            os._exit(1)
        
        threading.Thread(target=do_exit, daemon=True).start()
        return jsonify({'success': True, 'message': 'Repitiendo carrera...'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/race/reset', methods=['POST'])
def race_reset():
    send_race_command('reset_race')
    return jsonify({'success': True, 'message': 'Reiniciando carrera'})

@app.route('/api/race/clear-all', methods=['POST'])
def race_clear_all():
    with open(RESTART_FLAG_FILE, 'w') as f:
        f.write('restart')
    
    def do_exit():
        time.sleep(0.5)
        os._exit(1)
    
    threading.Thread(target=do_exit, daemon=True).start()
    return jsonify({'success': True, 'message': 'Reiniciando sistema...'})

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

# ==================== REINICIAR SERVIDOR ====================

@app.route('/api/restart', methods=['POST'])
def restart_server():
    try:
        data = request.get_json() or {}
        next_race_name = data.get('next_race_name')
        next_race_laps = data.get('next_race_laps', 10)
        
        if next_race_name:
            with open(NEXT_RACE_NAME_FILE, 'w') as f:
                f.write(next_race_name)
            with open(NEXT_RACE_LAPS_FILE, 'w') as f:
                f.write(str(next_race_laps))
        
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
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False, threaded=True)

if __name__ == "__main__":
    start_api_server()
