import serial
import time
import os
import subprocess
import threading
from datetime import datetime
from database import (
    init_db, save_lap, get_current_session, start_new_session,
    get_driver_by_transponder, add_transponder_detected,
    get_race_drivers, add_driver_to_race, cargar_estado_repetir,
    update_race_status,
)

PORT = os.getenv('SERIAL_PORT', '/dev/ttyUSB0')
BAUD = 9600

VUELTA_BASE = {}
ULTIMA_ACTIVIDAD = time.time()
ALERTA_MOSTRADA = False
SESSION_ID = None
LAST_LAP_TIME = {}
LAPS_LIMIT = 10
RACE_DRIVERS = set()
DRIVERS_FINISHED = set()
RACE_ACTIVE = False
RACE_PAUSED = False

RESTART_FLAG_FILE = '/app/data/restart.flag'
NEXT_RACE_NAME_FILE = '/app/data/next_race_name.txt'
NEXT_RACE_LAPS_FILE = '/app/data/next_race_laps.txt'
RACE_COMMAND_FILE = '/app/data/race_command.txt'

def repair_permissions(port):
    try:
        if os.path.exists(port):
            subprocess.run(['chmod', '666', port], check=True, stderr=subprocess.DEVNULL)
            subprocess.run(['stty', '-F', port, str(BAUD), 'raw', '-echo', '-hupcl'], 
                          check=False, stderr=subprocess.DEVNULL)
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

def check_race_commands():
    global RACE_ACTIVE, RACE_PAUSED, DRIVERS_FINISHED, VUELTA_BASE, LAST_LAP_TIME, SESSION_ID
    if os.path.exists(RACE_COMMAND_FILE):
        with open(RACE_COMMAND_FILE, 'r') as f:
            command = f.read().strip()
        os.remove(RACE_COMMAND_FILE)
        print(f"[COMANDO] Recibido: {command}")
        if command == 'start':
            RACE_ACTIVE = True
            RACE_PAUSED = False
            DRIVERS_FINISHED = set()
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            actualizar_pilotos_inscritos()
            print("\n🏁 ¡CARRERA INICIADA!\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'active')
        elif command == 'reset_usb':
            print("\n🛑 APAGADO SEGURO SOLICITADO\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'paused')
            # Forzamos salida del programa para que el contenedor se detenga
            os._exit(0)
        elif command == 'pause':
            RACE_ACTIVE = True
            RACE_PAUSED = True
            print("\n⏸️ CARRERA PAUSADA\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'paused')
        elif command == 'resume':
            RACE_ACTIVE = True
            RACE_PAUSED = False
            print("\n▶️ CARRERA REANUDADA\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'active')
        elif command == 'finish':
            RACE_ACTIVE = False
            RACE_PAUSED = False
            DRIVERS_FINISHED = set()
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            print("\n🏆 ¡CARRERA FINALIZADA!\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'completed')
        elif command == 'reset_race':
            RACE_ACTIVE = False
            RACE_PAUSED = False
            DRIVERS_FINISHED = set()
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            print("\n🧹 RESET TOTAL DEL TABLERO\n")
            if SESSION_ID:
                update_race_status(SESSION_ID, 'completed')
            # Forzamos un reinicio limpio del sistema
            with open(RESTART_FLAG_FILE, 'w') as f:
                f.write('restart')
        return True
    return False

def restaurar_estado_repetir():
    global SESSION_ID, LAPS_LIMIT, RACE_DRIVERS, RACE_ACTIVE, RACE_PAUSED
    estado = cargar_estado_repetir()
    if not estado or estado.get('action') != 'repeat_race':
        return False
    print("\n🔄 REPETIR CARRERA - Restaurando pilotos...")
    SESSION_ID = start_new_session(estado['circuit_name'], estado['laps_limit'])
    LAPS_LIMIT = estado['laps_limit']
    for driver in estado['race_drivers']:
        add_driver_to_race(SESSION_ID, driver['driver_id'], driver['transponder_id'])
        print(f"   ✅ Restaurado: {driver.get('name', 'Piloto')}")
    RACE_DRIVERS = {d['transponder_id'] for d in estado['race_drivers']}
    RACE_ACTIVE = False
    RACE_PAUSED = False
    return True

def crear_nueva_carrera_al_inicio():
    global SESSION_ID, VUELTA_BASE, LAST_LAP_TIME, LAPS_LIMIT, RACE_DRIVERS, DRIVERS_FINISHED, RACE_ACTIVE, RACE_PAUSED
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
        print("\n" + "🏁"*40)
        print(f"🎬 NUEVA CARRERA: {race_name}")
        print(f"🔄 Vueltas: {laps_limit}")
        print("🏁"*40 + "\n")
        return True
    return False

def actualizar_pilotos_inscritos():
    global RACE_DRIVERS, SESSION_ID
    if SESSION_ID:
        drivers = get_race_drivers(SESSION_ID)
        RACE_DRIVERS = {d['transponder_id'] for d in drivers}
        if drivers:
            print(f"\n📋 Pilotos inscritos: {len(drivers)}")
            for d in drivers:
                nombre = f"{d['name']} {d.get('lastname', '')}".strip()
                print(f"   🏎️  {nombre} (Transponder: {d['transponder_id']})")
    return RACE_DRIVERS

def actualizar_sesion_activa():
    global SESSION_ID, VUELTA_BASE, LAST_LAP_TIME, LAPS_LIMIT, DRIVERS_FINISHED, RACE_ACTIVE, RACE_PAUSED
    session = get_current_session()
    if session:
        if SESSION_ID != session['id']:
            SESSION_ID = session['id']
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            LAPS_LIMIT = session.get('laps_limit', 10)
            DRIVERS_FINISHED = set()
            RACE_ACTIVE = (session.get('status') in ['active', 'paused'])
            RACE_PAUSED = (session.get('status') == 'paused')
            actualizar_pilotos_inscritos()
            print(f"\n📋 Sesión: {session['circuit_name']} | {LAPS_LIMIT} vueltas")
            print(f"📊 Estado: {'EN CURSO' if RACE_ACTIVE else 'PENDIENTE'}")
        return True
    return False

def procesar_cadena_esl400(raw_data):
    global VUELTA_BASE, LAST_LAP_TIME, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS, DRIVERS_FINISHED, RACE_ACTIVE, RACE_PAUSED
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
        elif val_h > 100:
            calidad = "🟡 MUY BUENA"
        elif val_h > 60:
            calidad = "🟠 REGULAR"
        else:
            calidad = "🔴 DEBIL"

        mins = int(tiempo_total_segundos // 60)
        secs = tiempo_total_segundos % 60
        time_str = f"{mins:02d}:{secs:06.3f}"
        
        es_nuevo = add_transponder_detected(
            transponder_id, val_h, val_l, time_str, nro_vueltas_raw
        )
        if es_nuevo:
            print(f"\n🔔 NUEVO TRANSPONDER DETECTADO: {transponder_id}")

        print(f"\n🏁 ¡DETECCIÓN! ({calidad})")
        print(f"🆔 ID Transponder: {transponder_id}")
        print(f"📡 Señal -> H: {val_h} | L: {val_l}")
        print(f"⏱️ Tiempo Acumulado: {mins:02d}:{secs:06.3f}")
        print(f"🔄 Vueltas Físicas (Equipo): {nro_vueltas_raw}")
        print(f"💾 Memoria física: {uso_equipo_fisico} registros")

        if transponder_id not in RACE_DRIVERS:
            # Re-verificar una vez antes de descartar (por si se inscribió tarde)
            actualizar_pilotos_inscritos()
            if transponder_id not in RACE_DRIVERS:
                print(f"⚠️ NO INSCRITO - Ve a PILOTOS para asignarlo")
                print("-" * 50)
                return None
            else:
                print(f"✅ INSCRIPCIÓN DETECTADA TARDE PARA {transponder_id}")

        driver = get_driver_by_transponder(transponder_id)
        if not driver:
            print(f"⚠️ Sin piloto asignado")
            print("-" * 50)
            return None

        nombre_piloto = driver['name']
        if driver.get('lastname'):
            nombre_piloto += f" {driver['lastname']}"
        print(f"👤 Piloto: {nombre_piloto}")

        if not RACE_ACTIVE:
            print(f"⏳ Carrera no iniciada - Esperando inicio...")
            print("-" * 50)
            return None
        
        if RACE_PAUSED:
            print(f"⏸️ Carrera pausada - Reanudar para continuar")
            if transponder_id in VUELTA_BASE:
                # Si el piloto pasa por el decoder mientras la carrera está pausada,
                # incrementamos su base para que esa vuelta no se cuente al reanudar.
                VUELTA_BASE[transponder_id] += 1
                print(f"🛡️ Vuelta en pausa ignorada para {nombre_piloto}")
            print("-" * 50)
            return None

        if transponder_id in DRIVERS_FINISHED:
            print(f"🏁 Carrera completada")
            print("-" * 50)
            return None

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
            print(f"🏁 VUELTA DE SALIDA")
        else:
            print(f"⚡ Tiempo vuelta {vuelta_carrera}: {lap_time:.3f}s")
            restantes = LAPS_LIMIT - vuelta_carrera
            if restantes == 1:
                print(f"⚠️ ¡ÚLTIMA VUELTA!")
            elif restantes == 0:
                print(f"\n🏆 ¡{nombre_piloto} HA COMPLETADO LA CARRERA!")
                DRIVERS_FINISHED.add(transponder_id)

        print("-" * 50)

        if SESSION_ID:
            is_last_lap = (vuelta_carrera == LAPS_LIMIT)
            save_lap(
                SESSION_ID, driver['id'], transponder_id, nro_vueltas_raw,
                vuelta_carrera, tiempo_total_segundos, lap_time, val_h, val_l,
                None, None, is_last_lap
            )
        return None
    except Exception as e:
        return None

def listen_chronit():
    global ULTIMA_ACTIVIDAD, ALERTA_MOSTRADA, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS, RACE_ACTIVE, RACE_PAUSED
    
    print("\n" + "="*50)
    print("🛡️ SISTEMA ESL-400 | v9.0 - CONTROL DE CARRERA")
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
    
    buffer_serial = ""
    ultimo_codigo = ""
    ultima_vez_deteccion = 0
    TIEMPO_FILTRO = 0.5
    reconectar = False
    
    while True:
        check_restart_flag()
        check_race_commands()
        
        if not os.path.exists(PORT):
            print(f"🔍 Buscando hardware en {PORT}...")
            time.sleep(5)
            continue
        
        try:
            repair_permissions(PORT)
            
            with serial.Serial(PORT, BAUD, timeout=0.1) as ser:
                if reconectar or not hasattr(listen_chronit, 'conectado_msg'):
                    print(f"✅ Puerto {PORT} conectado. Vigilando pista...\n")
                    if not RACE_ACTIVE:
                        print("⏳ Carrera pendiente. Presiona 'INICIAR CARRERA' para comenzar.\n")
                    listen_chronit.conectado_msg = True
                    reconectar = False
                
                ser.reset_input_buffer()
                ULTIMA_ACTIVIDAD = time.time()
                
                while True:
                    check_restart_flag()
                    check_race_commands()
                    
                    # ============================================
                    # LECTURA CRUDA - MÉTODO DE LA VERSIÓN LEGACY (FUNCIONA)
                    # ============================================
                    if ser.in_waiting > 0:
                        datos_crudos = ser.read(ser.in_waiting)
                        ULTIMA_ACTIVIDAD = time.time()
                        ALERTA_MOSTRADA = False
                        
                        try:
                            texto = datos_crudos.decode('utf-8', errors='ignore')
                            buffer_serial += texto
                            
                            # Separar por líneas (como en la versión legacy)
                            lineas = buffer_serial.split('\n')
                            buffer_serial = lineas[-1]  # Guardar lo incompleto
                            
                            for linea in lineas[:-1]:
                                linea = linea.strip()
                                if not linea:
                                    continue
                                
                                ahora = time.time()
                                
                                if linea != ultimo_codigo or (ahora - ultima_vez_deteccion) > TIEMPO_FILTRO:
                                    if linea.startswith('$'):
                                        procesar_cadena_esl400(linea)
                                        ultima_vez_deteccion = ahora
                                    elif linea.startswith('#'):
                                        pass
                                    ultimo_codigo = linea
                                    
                        except Exception as e:
                            pass
                    else:
                        time.sleep(0.01)
                    
                    if time.time() - ULTIMA_ACTIVIDAD > 30 and not ALERTA_MOSTRADA:
                        print("\n" + "!"*60)
                        print("🚨 ALERTA: EL HARDWARE NO RESPONDE (30s de silencio)")
                        print("   Reintentando conexión...")
                        print("!"*60 + "\n")
                        ALERTA_MOSTRADA = True
                        reconectar = True
                        break
                    
        except Exception as e:
            print(f"📡 Error: {e}. Reintentando en 5 segundos...")
            time.sleep(5)
            reconectar = True

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
