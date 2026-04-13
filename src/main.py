import serial
import time
import os
import re
import subprocess
import sys
import threading
from datetime import datetime
from database import (
    init_db, save_lap, get_current_session, start_new_session,
    get_driver_by_transponder, add_transponder_detected,
    get_race_drivers, add_driver_to_race, cargar_estado_repetir, limpiar_estado_repetir,
    update_race_status,
)

# --- CONFIGURACIÓN ---
PORT = os.getenv('SERIAL_PORT', '/dev/ttyUSB0')
BAUD = 9600

# --- VARIABLES DE ESTADO ---
VUELTA_BASE = {}
ULTIMA_ACTIVIDAD = time.time()
ALERTA_MOSTRADA = False
SESSION_ID = None
LAST_LAP_TIME = {}
LAPS_LIMIT = 10
RACE_DRIVERS = set()
DRIVERS_FINISHED = set()

# --- CONTROL DE CARRERA ---
RACE_ACTIVE = False      # Si la carrera está activa (contando vueltas)
RACE_PAUSED = False      # Si está pausada
RACE_STARTED = False     # Si ya se inició alguna vez (para no reiniciar el countdown)

RESTART_FLAG_FILE = '/app/data/restart.flag'
NEXT_RACE_NAME_FILE = '/app/data/next_race_name.txt'
NEXT_RACE_LAPS_FILE = '/app/data/next_race_laps.txt'
RACE_COMMAND_FILE = '/app/data/race_command.txt'

# Lectura serie: el ESL-400 a menudo usa \r o bloques sin \n; readline() falla en silencio.
SERIAL_BUFFER_MAX = 16384
_ESL_FRAME_RE = re.compile(r'\$[0-9A-Fa-f]{20,}', re.IGNORECASE)

def repair_permissions(port):
    try:
        if os.path.exists(port):
            subprocess.run(['chmod', '666', port], check=True, stderr=subprocess.DEVNULL)
            if sys.platform.startswith('linux'):
                subprocess.run(
                    [
                        'stty', '-F', port, str(BAUD), 'raw',
                        '-echo', '-echoe', '-echok', '-echoctl', '-echoke',
                    ],
                    check=False,
                    stderr=subprocess.DEVNULL,
                )
            return True
    except Exception:
        pass
    return False

def check_restart_flag():
    if os.path.exists(RESTART_FLAG_FILE):
        print("\n[SISTEMA] Reiniciando...")
        os.remove(RESTART_FLAG_FILE)
        os._exit(0)
    return False

def check_race_commands():
    """Lee comandos desde la web"""
    global RACE_ACTIVE, RACE_PAUSED, RACE_STARTED, DRIVERS_FINISHED, VUELTA_BASE, LAST_LAP_TIME
    
    if os.path.exists(RACE_COMMAND_FILE):
        with open(RACE_COMMAND_FILE, 'r') as f:
            command = f.read().strip()
        os.remove(RACE_COMMAND_FILE)
        
        if command == 'start' and not RACE_STARTED:
            RACE_ACTIVE = True
            RACE_PAUSED = False
            RACE_STARTED = True
            DRIVERS_FINISHED = set()
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            print("\n🏁 ¡CARRERA INICIADA! Comenzando conteo de vueltas...\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'active')
        
        elif command == 'pause' and RACE_ACTIVE and not RACE_PAUSED:
            RACE_PAUSED = True
            print("\n⏸️ CARRERA PAUSADA - No se cuentan vueltas\n")
        
        elif command == 'resume' and RACE_ACTIVE and RACE_PAUSED:
            RACE_PAUSED = False
            print("\n▶️ CARRERA REANUDADA\n")
        
        elif command == 'finish' and RACE_ACTIVE:
            RACE_ACTIVE = False
            RACE_PAUSED = False
            RACE_STARTED = False
            print("\n🏆 ¡CARRERA FINALIZADA! Guardando resultados...\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'completed')
        
        elif command == 'reset_race':
            RACE_ACTIVE = False
            RACE_PAUSED = False
            RACE_STARTED = False
            DRIVERS_FINISHED = set()
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            print("\n🔄 Reiniciando carrera con los mismos pilotos...\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'pending')
        
        return True
    return False

def restaurar_estado_repetir():
    global SESSION_ID, LAPS_LIMIT, RACE_DRIVERS, RACE_ACTIVE, RACE_PAUSED, RACE_STARTED
    
    estado = cargar_estado_repetir()
    if not estado or estado.get('action') != 'repeat_race':
        return False
    
    print("\n" + "🔄"*40)
    print("🔄 REPETIR CARRERA - Restaurando pilotos...")
    print("🔄"*40)
    
    SESSION_ID = start_new_session(estado['circuit_name'], estado['laps_limit'])
    LAPS_LIMIT = estado['laps_limit']
    
    for driver in estado['race_drivers']:
        add_driver_to_race(SESSION_ID, driver['driver_id'], driver['transponder_id'])
        print(f"   ✅ Restaurado: {driver.get('name', 'Piloto')} (Transponder: {driver['transponder_id']})")
    
    RACE_DRIVERS = {d['transponder_id'] for d in estado['race_drivers']}
    RACE_ACTIVE = False
    RACE_PAUSED = False
    RACE_STARTED = False
    
    print("🔄"*40 + "\n")
    return True

def crear_nueva_carrera_al_inicio():
    global SESSION_ID, VUELTA_BASE, LAST_LAP_TIME, LAPS_LIMIT, RACE_DRIVERS, DRIVERS_FINISHED
    global RACE_ACTIVE, RACE_PAUSED, RACE_STARTED
    
    if restaurar_estado_repetir():
        return True
    
    race_name = None
    laps_limit = LAPS_LIMIT
    
    if os.path.exists(NEXT_RACE_NAME_FILE):
        with open(NEXT_RACE_NAME_FILE, 'r') as f:
            race_name = f.read().strip()
        os.remove(NEXT_RACE_NAME_FILE)
    
    if os.path.exists(NEXT_RACE_LAPS_FILE):
        with open(NEXT_RACE_LAPS_FILE, 'r') as f:
            laps_limit = int(f.read().strip())
        os.remove(NEXT_RACE_LAPS_FILE)
    
    if race_name:
        SESSION_ID = start_new_session(race_name, laps_limit)
        VUELTA_BASE = {}
        LAST_LAP_TIME = {}
        LAPS_LIMIT = laps_limit
        RACE_DRIVERS = set()
        DRIVERS_FINISHED = set()
        RACE_ACTIVE = False
        RACE_PAUSED = False
        RACE_STARTED = False
        
        print("\n" + "🏁"*40)
        print(f"🎬 NUEVA CARRERA: {race_name}")
        print(f"🔄 Vueltas: {laps_limit}")
        print("🏁"*40 + "\n")
        return True
    return False

def actualizar_pilotos_inscritos():
    global RACE_DRIVERS, SESSION_ID, DRIVERS_FINISHED
    if SESSION_ID:
        drivers = get_race_drivers(SESSION_ID)
        RACE_DRIVERS = {d['transponder_id'] for d in drivers}
        DRIVERS_FINISHED = set()
        if drivers:
            print(f"\n📋 Pilotos inscritos: {len(drivers)}")
            for d in drivers:
                nombre = f"{d['name']} {d.get('lastname', '')}".strip()
                print(f"   🏎️  {nombre} (Transponder: {d['transponder_id']})")
        else:
            print("\n📋 No hay pilotos inscritos. Los transponders se mostrarán para asignar.\n")
    return RACE_DRIVERS

def actualizar_sesion_activa():
    global SESSION_ID, VUELTA_BASE, LAST_LAP_TIME, LAPS_LIMIT, DRIVERS_FINISHED
    global RACE_ACTIVE, RACE_PAUSED, RACE_STARTED
    
    session = get_current_session()
    if session:
        if SESSION_ID != session['id']:
            SESSION_ID = session['id']
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            LAPS_LIMIT = session.get('laps_limit', 10)
            DRIVERS_FINISHED = set()
            RACE_ACTIVE = (session.get('status') == 'active')
            RACE_PAUSED = False
            RACE_STARTED = RACE_ACTIVE
            actualizar_pilotos_inscritos()
            print(f"\n📋 Sesión: {session['circuit_name']} | {LAPS_LIMIT} vueltas")
            print(f"📊 Estado: {'EN CURSO' if RACE_ACTIVE else 'PENDIENTE'}")
        return True
    return False

def procesar_cadena_esl400(raw_data):
    global VUELTA_BASE, LAST_LAP_TIME, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS, DRIVERS_FINISHED
    global RACE_ACTIVE, RACE_PAUSED
    
    try:
        data = raw_data.replace('$', '').strip()
        
        if len(data) < 20:
            return None
        
        transponder_id = int(data[4:8], 16)
        milisegundos_raw = int(data[8:16], 16)
        tiempo_total_segundos = milisegundos_raw / 1000.0
        val_h = int(data[16:18], 16)
        val_l = int(data[18:20], 16)
        vueltas_hex = data[-8:-4] 
        nro_vueltas_raw = int(vueltas_hex, 16)
        uso_equipo_fisico = nro_vueltas_raw + 1

        if val_h > 150:
            calidad = "🟢 EXCELENTE"
            calidad_icono = "🟢"
        elif val_h > 100:
            calidad = "🟡 MUY BUENA"
            calidad_icono = "🟡"
        elif val_h > 60:
            calidad = "🟠 REGULAR"
            calidad_icono = "🟠"
        else:
            calidad = "🔴 DEBIL"
            calidad_icono = "🔴"

        es_nuevo = add_transponder_detected(transponder_id)
        if es_nuevo:
            print(f"\n🔔 NUEVO TRANSPONDER DETECTADO: {transponder_id}")

        mins = int(tiempo_total_segundos // 60)
        secs = tiempo_total_segundos % 60
        
        print(f"\n🏁 ¡DETECCIÓN! {calidad_icono} {calidad}")
        print(f"🆔 ID Transponder: {transponder_id}")
        print(f"📡 Señal -> H: {val_h} | L: {val_l}")
        print(f"⏱️ Tiempo Acumulado: {mins:02d}:{secs:06.3f}")
        print(f"🔄 Vueltas Físicas (Equipo): {nro_vueltas_raw}")
        print(f"💾 Memoria física del ESL-400: {uso_equipo_fisico} registros")

        if transponder_id not in RACE_DRIVERS:
            print(f"⚠️ ESTADO: NO INSCRITO en la carrera actual")
            print(f"💡 Para inscribirlo: Web > PILOTOS > Agregar transponder {transponder_id}")
            print("-" * 50)
            return None

        driver = get_driver_by_transponder(transponder_id)
        if not driver:
            print(f"⚠️ Transponder {transponder_id} no tiene piloto asignado")
            print("-" * 50)
            return None

        driver_id = driver['id']
        nombre_piloto = driver['name']
        if driver.get('lastname'):
            nombre_piloto += f" {driver['lastname']}"

        print(f"👤 Piloto: {nombre_piloto}")

        # ============================================
        # CONTROL DE ESTADO DE CARRERA
        # ============================================
        if not RACE_ACTIVE:
            print(f"⏳ CARRERA NO INICIADA - Esperando inicio...")
            print("-" * 50)
            return None
        
        if RACE_PAUSED:
            print(f"⏸️ CARRERA PAUSADA - Reanudar para continuar")
            print("-" * 50)
            return None

        if transponder_id in DRIVERS_FINISHED:
            print(f"🏁 CARRERA COMPLETADA - No se cuentan más vueltas")
            print("-" * 50)
            return None

        # Calcular vuelta de carrera (SOLO si la carrera está activa)
        if transponder_id not in VUELTA_BASE:
            VUELTA_BASE[transponder_id] = nro_vueltas_raw
            vuelta_carrera = 0
            lap_time = None
        else:
            vuelta_carrera = nro_vueltas_raw - VUELTA_BASE[transponder_id]
            if transponder_id in LAST_LAP_TIME and vuelta_carrera > 0:
                lap_time = tiempo_total_segundos - LAST_LAP_TIME[transponder_id]
            else:
                lap_time = None

        LAST_LAP_TIME[transponder_id] = tiempo_total_segundos

        print(f"🏎️ Vueltas en Carrera: {vuelta_carrera}")
        
        if vuelta_carrera == 0:
            print(f"🏁 Tipo: VUELTA DE SALIDA")
        else:
            print(f"⚡ Tiempo de Vuelta {vuelta_carrera}: {lap_time:.3f} segundos")
            restantes = LAPS_LIMIT - vuelta_carrera
            if restantes == 1:
                print(f"⚠️ ¡ÚLTIMA VUELTA!")
            elif restantes == 0:
                print(f"\n🏆 ¡{nombre_piloto} HA COMPLETADO LA CARRERA!")
                DRIVERS_FINISHED.add(transponder_id)

        print("-" * 50)

        if SESSION_ID and driver_id:
            is_last_lap = (vuelta_carrera == LAPS_LIMIT)
            save_lap(
                SESSION_ID, driver_id, transponder_id, nro_vueltas_raw,
                vuelta_carrera, tiempo_total_segundos, lap_time, val_h, val_l,
                None, None, is_last_lap
            )

        return None
        
    except Exception as e:
        print(f"[DEBUG] Error parseando: {e}")
        return None

def listen_chronit():
    global ULTIMA_ACTIVIDAD, ALERTA_MOSTRADA, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS
    global RACE_ACTIVE, RACE_PAUSED
    
    print("\n" + "="*50)
    print("🛡️ SISTEMA ESL-400 | v9.0 - CONTROL DE CARRERA")
    print("="*50)
    print(">>> Esperando transponders...\n")
    if os.getenv('CHRONIT_DEBUG_SERIAL'):
        print("   (CHRONIT_DEBUG_SERIAL=1 → se imprimen tramas recibidas)\n")
    
    init_db()
    crear_nueva_carrera_al_inicio()
    
    if not get_current_session():
        nombre_defecto = f"Circuito {datetime.now().strftime('%d/%m')}"
        SESSION_ID = start_new_session(nombre_defecto, LAPS_LIMIT)
        print(f"📋 Nueva sesión: {nombre_defecto} ({LAPS_LIMIT} vueltas)")
    else:
        actualizar_sesion_activa()
    
    actualizar_pilotos_inscritos()
    
    ultimo_codigo = ""
    ultima_vez_deteccion = 0
    TIEMPO_FILTRO = 0.5
    
    while True:
        check_restart_flag()
        check_race_commands()
        
        if not os.path.exists(PORT):
            print(f"🔍 Buscando hardware en {PORT}...")
            time.sleep(5)
            continue
        
        try:
            repair_permissions(PORT)
            
            with serial.Serial(PORT, BAUD, timeout=0.05) as ser:
                if not hasattr(listen_chronit, 'conectado_msg'):
                    print(f"✅ Puerto {PORT} conectado. Vigilando pista...\n")
                    if not RACE_ACTIVE:
                        print("⏳ Carrera pendiente. Presiona 'INICIAR CARRERA' para comenzar.\n")
                    listen_chronit.conectado_msg = True
                
                ser.reset_input_buffer()
                ULTIMA_ACTIVIDAD = time.time()
                buffer_serial = ""
                
                while True:
                    check_restart_flag()
                    check_race_commands()
                    
                    if ser.in_waiting > 0:
                        chunk = ser.read(ser.in_waiting)
                        buffer_serial += chunk.decode('latin-1', errors='replace')
                        ULTIMA_ACTIVIDAD = time.time()
                        ALERTA_MOSTRADA = False
                    
                    buffer_serial = buffer_serial.replace('\r\n', '\n').replace('\r', '\n')
                    
                    lines_batch = []
                    while '\n' in buffer_serial:
                        line, buffer_serial = buffer_serial.split('\n', 1)
                        line = line.strip()
                        if line:
                            lines_batch.append(line)
                    
                    if not lines_batch and '\n' not in buffer_serial and len(buffer_serial) >= 2048:
                        cut = 0
                        for m in _ESL_FRAME_RE.finditer(buffer_serial):
                            lines_batch.append(m.group(0))
                            cut = m.end()
                        if cut > 0:
                            buffer_serial = buffer_serial[cut:].lstrip()
                        elif len(buffer_serial) > SERIAL_BUFFER_MAX:
                            print("[serial] Buffer grande sin tramas reconocibles; recortando.")
                            buffer_serial = buffer_serial[-4096:]
                    
                    for line in lines_batch:
                        ahora = time.time()
                        if os.getenv('CHRONIT_DEBUG_SERIAL'):
                            print(f"[serial rx] {line[:200]!r}")
                        if line != ultimo_codigo or (ahora - ultima_vez_deteccion) > TIEMPO_FILTRO:
                            if line.startswith('$'):
                                procesar_cadena_esl400(line)
                                ultima_vez_deteccion = ahora
                            elif line.startswith('#'):
                                pass
                            ultimo_codigo = line
                    
                    if time.time() - ULTIMA_ACTIVIDAD > 25 and not ALERTA_MOSTRADA:
                        print("\n" + "!"*60)
                        print("🚨 ALERTA: EL HARDWARE NO RESPONDE (25s de silencio)")
                        print("!"*60 + "\n")
                        ALERTA_MOSTRADA = True
                    
                    time.sleep(0.01)
                    
        except Exception as e:
            print(f"📡 Error en conexión serial: {e}. Reintentando...")
            time.sleep(2)

def start_api():
    try:
        from api import start_api_server
        start_api_server()
    except Exception as e:
        print(f"⚠️ API no iniciada: {e}")

if __name__ == "__main__":
    try:
        api_thread = threading.Thread(target=start_api, daemon=True)
        api_thread.start()
        time.sleep(1)
        listen_chronit()
    except KeyboardInterrupt:
        print("\n🛑 Sistema detenido.")
