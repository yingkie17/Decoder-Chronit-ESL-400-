import serial
import time
import os
import subprocess
import threading
from datetime import datetime
from database import (
    init_db, save_lap, get_current_session, start_new_session,
    get_driver_by_transponder, add_transponder_detected,
    get_race_drivers
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

RESTART_FLAG_FILE = '/app/data/restart.flag'
NEXT_RACE_NAME_FILE = '/app/data/next_race_name.txt'
NEXT_RACE_LAPS_FILE = '/app/data/next_race_laps.txt'

def repair_permissions(port):
    try:
        if os.path.exists(port):
            subprocess.run(['chmod', '666', port], check=True, stderr=subprocess.DEVNULL)
            return True
    except:
        pass
    return False

def check_restart_flag():
    if os.path.exists(RESTART_FLAG_FILE):
        print("\n[SISTEMA] Reiniciando...")
        os.remove(RESTART_FLAG_FILE)
        os._exit(0)
    return False

def crear_nueva_carrera_al_inicio():
    global SESSION_ID, VUELTA_BASE, LAST_LAP_TIME, LAPS_LIMIT, RACE_DRIVERS, DRIVERS_FINISHED
    
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
    return RACE_DRIVERS

def actualizar_sesion_activa():
    global SESSION_ID, VUELTA_BASE, LAST_LAP_TIME, LAPS_LIMIT, DRIVERS_FINISHED
    session = get_current_session()
    if session:
        if SESSION_ID != session['id']:
            SESSION_ID = session['id']
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            LAPS_LIMIT = session.get('laps_limit', 10)
            DRIVERS_FINISHED = set()
            actualizar_pilotos_inscritos()
            print(f"\n📋 Sesión: {session['circuit_name']} | {LAPS_LIMIT} vueltas")
        return True
    return False

def procesar_cadena_esl400(raw_data):
    """
    PARSEO ORIGINAL - EL MISMO QUE FUNCIONABA
    """
    global VUELTA_BASE, LAST_LAP_TIME, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS, DRIVERS_FINISHED
    
    try:
        data = raw_data.replace('$', '').strip()
        
        if len(data) < 20:
            return None
        
        # 1. ID DEL TRANSPONDER (data[4:8]) - ESTE ES EL CÓDIGO CORRECTO
        transponder_id = int(data[4:8], 16)

        # 2. TIEMPO EN MILISEGUNDOS (data[8:16])
        milisegundos_raw = int(data[8:16], 16)
        tiempo_total_segundos = milisegundos_raw / 1000.0

        # 3. VALORES H y L (Señal) (data[16:20])
        val_h = int(data[16:18], 16)
        val_l = int(data[18:20], 16)

        # 4. CONTADOR DE VUELTAS (data[-8:-4])
        vueltas_hex = data[-8:-4] 
        nro_vueltas_raw = int(vueltas_hex, 16)
        uso_equipo_fisico = nro_vueltas_raw + 1

        # Calidad de señal
        if val_h > 150:
            calidad = "🟢 EXCELENTE"
        elif val_h > 100:
            calidad = "🟡 MUY BUENA"
        elif val_h > 60:
            calidad = "🟠 REGULAR"
        else:
            calidad = "🔴 DEBIL"

        # Registrar transponder detectado (para módulo semiautomático)
        es_nuevo = add_transponder_detected(transponder_id)
        if es_nuevo:
            print(f"\n🔔 NUEVO TRANSPONDER DETECTADO: {transponder_id}")

        # MOSTRAR SIEMPRE TODA LA INFORMACIÓN (sin importar si está inscrito)
        mins = int(tiempo_total_segundos // 60)
        secs = tiempo_total_segundos % 60
        
        print(f"\n🏁 ¡NUEVA DETECCIÓN! ({calidad})")
        print(f"🆔 ID Transponder: {transponder_id}")
        print(f"📡 Señal -> H: {val_h} | L: {val_l}")
        print(f"⏱️ Tiempo Acumulado: {mins:02d}:{secs:06.3f}")
        print(f"🔄 Vueltas Físicas (Equipo): {nro_vueltas_raw}")
        print(f"🏎️ Vueltas en Carrera: {vuelta_carrera if 'vuelta_carrera' in dir() else '--'}")
        print(f"💾 Memoria física del ESL-400: {uso_equipo_fisico} registros")

        # Verificar si está inscrito (solo informativo, no bloquea)
        if transponder_id not in RACE_DRIVERS:
            print(f"⚠️ ESTADO: NO INSCRITO en la carrera actual")
            print(f"💡 Para inscribirlo, ve al panel web > PILOTOS")
        else:
            driver = get_driver_by_transponder(transponder_id)
            if driver:
                nombre_piloto = driver['name']
                if driver.get('lastname'):
                    nombre_piloto += f" {driver['lastname']}"
                print(f"👤 Piloto: {nombre_piloto}")

        print("-" * 50)

        # Si está inscrito, guardar en base de datos
        if SESSION_ID and transponder_id in RACE_DRIVERS:
            driver = get_driver_by_transponder(transponder_id)
            if driver:
                # Calcular vuelta de carrera solo si está inscrito
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
                
                is_last_lap = (vuelta_carrera == LAPS_LIMIT)
                save_lap(
                    SESSION_ID, driver['id'], transponder_id, nro_vueltas_raw,
                    vuelta_carrera, tiempo_total_segundos, lap_time, val_h, val_l,
                    None, None, is_last_lap
                )

        return None
        
    except Exception as e:
        print(f"[DEBUG] Error parseando: {e}")
        return None

def listen_chronit():
    global ULTIMA_ACTIVIDAD, ALERTA_MOSTRADA, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS
    
    print("\n" + "="*50)
    print("🛡️ SISTEMA ESL-400 | v8.0 ESTABLE")
    print("="*50)
    print(">>> Esperando transponders...\n")
    
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
        
        if not os.path.exists(PORT):
            print(f"🔍 Buscando hardware en {PORT}...")
            time.sleep(5)
            continue
        
        try:
            repair_permissions(PORT)
            
            with serial.Serial(PORT, BAUD, timeout=0.1) as ser:
                if not hasattr(listen_chronit, 'conectado_msg'):
                    print(f"✅ Puerto {PORT} conectado. Vigilando pista...\n")
                    listen_chronit.conectado_msg = True
                
                ser.reset_input_buffer()
                ULTIMA_ACTIVIDAD = time.time()
                
                while True:
                    check_restart_flag()
                    
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    ahora = time.time()
                    
                    if line:
                        ULTIMA_ACTIVIDAD = ahora
                        ALERTA_MOSTRADA = False
                        
                        if line != ultimo_codigo or (ahora - ultima_vez_deteccion) > TIEMPO_FILTRO:
                            
                            if line.startswith('$'):
                                procesar_cadena_esl400(line)
                                ultima_vez_deteccion = ahora
                            
                            elif line.startswith('#'):
                                # Heartbeat silencioso
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
