import serial
import time
import os
import subprocess
import threading
import platform
import json
import sqlite3
import serial.tools.list_ports
from datetime import datetime
from collections import deque
CONTADOR_VUELTAS_INTERNO = {}


# ===== NUEVO: Módulo de traducción de modos del decoder =====
from decoder_modes import (
    translate_to_chronit_format,
    set_decoder_mode,
    get_decoder_mode,
    register_known_transponders,
    detect_mode_from_line,
)

# ==================== CONFIGURACIÓN INICIAL ====================

IS_WINDOWS = platform.system() == "Windows"
IS_LINUX = platform.system() == "Linux"

if IS_WINDOWS:
    BASE_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    if not os.path.exists(BASE_DATA_DIR):
        os.makedirs(BASE_DATA_DIR)
else:
    BASE_DATA_DIR = "/app/data"

LOG_BUFFER_FILE = os.path.join(BASE_DATA_DIR, "logs_buffer.txt")
log_buffer = deque(maxlen=500)
log_lock = threading.Lock()
_log_write_counter = 0
_LOG_MAX_LINES = 500
# Cola de logs pendientes de volcar a disco (ver add_log).
_pending_log_lines = []
_last_log_flush = 0.0

# ============================================
# FUNCIÓN PARA DETECTAR PUERTO AUTOMÁTICAMENTE
# ============================================

def find_serial_port():
    """Busca automáticamente el puerto serial del ESL-400"""
    try:
        ports = serial.tools.list_ports.comports()
        print(f"[SERIAL] Puertos disponibles: {[p.device for p in ports]}")

        for port in ports:
            # Buscar cualquier puerto que parezca un dispositivo serial
            desc = port.description.lower()
            device = port.device.lower()

            if "usb" in desc or "com" in device or "tty" in device:
                print(f"[SERIAL] Puerto detectado: {port.device} ({port.description})")
                return port.device

        print("[SERIAL] No se encontró ningún puerto serial. Usando valor por defecto.")
        return None
    except Exception as e:
        print(f"[SERIAL] Error detectando puerto: {e}")
        return None
        # ============================================
# CONFIGURACIÓN DEL PUERTO SERIAL
# ============================================

if IS_WINDOWS:
    # Windows: Detección automática o variable de entorno
    detected_port = find_serial_port()
    PORT = detected_port or os.getenv("SERIAL_PORT", "COM3")
    print(f"[SERIAL] Puerto configurado: {PORT}")
else:
    # Linux: usar /dev/ttyUSB0 por defecto
    PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")
    print(f"[SERIAL] Puerto configurado: {PORT}")

BAUD = 9600

def add_log(message):
    global _log_write_counter, _last_log_flush
    with log_lock:
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_line = f"[{timestamp}] {message}"
        log_buffer.append(log_line)
        _pending_log_lines.append(log_line)
        _log_write_counter += 1

        ahora = time.time()
        # Volcado a disco por LOTES (cada 50 mensajes o 2s). Antes se abría y
        # escribía el archivo en CADA llamada, y esta función se invoca varias
        # veces por línea del decoder: con >10 karts generaba I/O excesivo y
        # contención del lock con la API.
        if _log_write_counter < 50 and (ahora - _last_log_flush) < 2.0:
            return

        _log_write_counter = 0
        _last_log_flush = ahora
        pendientes = list(_pending_log_lines)
        _pending_log_lines.clear()

    try:
        with open(LOG_BUFFER_FILE, "a") as f:
            f.writelines(line + "\n" for line in pendientes)
        with open(LOG_BUFFER_FILE, "r") as fr:
            all_lines = fr.readlines()
        if len(all_lines) > _LOG_MAX_LINES:
            with open(LOG_BUFFER_FILE, "w") as fw:
                fw.writelines(all_lines[-_LOG_MAX_LINES:])
    except Exception as e:
        print(f"[LOGS] Error escribiendo archivo: {e}")


def get_logs(limit=100):
    with log_lock:
        return list(log_buffer)[-limit:]


def clear_logs():
    global _pending_log_lines
    # No llamar a add_log() dentro del lock (log_lock es no reentrante).
    with log_lock:
        log_buffer.clear()
        _pending_log_lines = []
    add_log("📋 Logs limpiados manualmente")
    try:
        if os.path.exists(LOG_BUFFER_FILE):
            os.remove(LOG_BUFFER_FILE)
        with open(LOG_BUFFER_FILE, "w") as f:
            f.write("")
    except Exception as e:
        print(f"[LOGS] Error limpiando archivo: {e}")


def formatear_tiempo(segundos):
    if segundos is None:
        return "00:00.000"
    horas = int(segundos // 3600)
    minutos = int((segundos % 3600) // 60)
    segs = segundos % 60
    if horas > 0:
        return f"{horas:02d}:{minutos:02d}:{segs:06.3f}"
    else:
        return f"{minutos:02d}:{segs:06.3f}"


import atexit
import signal

serial_port_global = None


def cleanup_serial():
    global serial_port_global
    if serial_port_global and serial_port_global.is_open:
        try:
            serial_port_global.close()
            print("[LIMPIANDO] ✅ Puerto serial liberado correctamente")
        except Exception as e:
            print(f"[LIMPIANDO] Error al cerrar puerto: {e}")


def handle_exit_signal(sig, frame):
    print(f"[LIMPIANDO] Señal {sig} recibida, liberando recursos...")
    cleanup_serial()
    print("[LIMPIANDO] Saliendo...")
    os._exit(0)


atexit.register(cleanup_serial)
signal.signal(signal.SIGTERM, handle_exit_signal)
signal.signal(signal.SIGINT, handle_exit_signal)

from database import (
    init_db,
    save_lap,
    get_current_session,
    start_new_session,
    get_driver_by_transponder,
    get_session_driver_by_transponder,
    add_transponder_detected,
    get_race_drivers,
    add_driver_to_race,
    cargar_estado_repetir,
    update_race_status,
    get_antenna_config,
    update_driver_finish_time,
    finalize_session_and_sync,
)

VUELTA_BASE = {}
ULTIMA_ACTIVIDAD = time.time()
ALERTA_MOSTRADA = False
SESSION_ID = None
LAST_LAP_TIME = {}
LAPS_LIMIT = 10
RACE_DRIVERS = set()
DRIVERS_FINISHED = set()
FIRST_FINISHER = None
RACE_ACTIVE = False
RACE_PAUSED = False
TIME_LIMIT_ACTIVE = False
TIME_LIMIT_END = 0.0
TIME_LIMIT_REMAINING = 0.0
VUELTAS_CARRERA = {}
PRIMERA_VEZ = {}
VUELTA_SALIDA = {}
PRIMER_TIEMPO_SERVIDOR = {}

if IS_WINDOWS:
    BASE_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    if not os.path.exists(BASE_DATA_DIR):
        os.makedirs(BASE_DATA_DIR)
else:
    BASE_DATA_DIR = "/app/data"

RESTART_FLAG_FILE = os.path.join(BASE_DATA_DIR, "restart.flag")
SHUTDOWN_FLAG_FILE = os.path.join(BASE_DATA_DIR, "shutdown.flag")
NEXT_RACE_NAME_FILE = os.path.join(BASE_DATA_DIR, "next_race_name.txt")
NEXT_RACE_LAPS_FILE = os.path.join(BASE_DATA_DIR, "next_race_laps.txt")
NEXT_RACE_MODE_FILE = os.path.join(BASE_DATA_DIR, "next_race_mode.txt")
RACE_COMMAND_FILE = os.path.join(BASE_DATA_DIR, "race_command.txt")
SIMULATION_FLAG_FILE = os.path.join(BASE_DATA_DIR, "simulation_mode.flag")
SIMULATION_SPEED_FILE = os.path.join(BASE_DATA_DIR, "simulation_speed.txt")
MANUAL_LAP_QUEUE_FILE = os.path.join(BASE_DATA_DIR, "manual_lap_queue.jsonl")
manual_lap_lock = threading.Lock()
_RECENT_LAP_DEDUP = {}
_DEDUP_WINDOW_SHORT = 2.0
_DEDUP_WINDOW_LONG = 2.0

# ===== CONTROL DE ESCUCHA DEL DECODER (toggle manual) =====
# Cuando NO hay carrera activa, la escucha continua del decoder se puede apagar
# para no llenar el buffer ni procesar señales de transponders que no aportan.
# Durante una carrera activa la escucha NUNCA puede desactivarse.
# Por defecto comienza APAGADA (casi nunca debe estar prendida). Si se activa
# manualmente fuera de carrera, se apaga sola a los 3 minutos.
DECODER_LISTENING = False
_LAST_LISTEN_ENABLE_TIME = 0
_AUTO_OFF_SECONDS = 180


def set_decoder_listening(enabled):
    """Activa/desactiva la escucha continua del decoder (solo fuera de carrera)."""
    global DECODER_LISTENING, _LAST_LISTEN_ENABLE_TIME
    enabled = bool(enabled)
    if enabled and not RACE_ACTIVE:
        # Iniciar el timer de auto-apagado: sin carrera activa, a los 3 min
        # se apaga sola para no llenar el buffer con señales sin valor.
        _LAST_LISTEN_ENABLE_TIME = time.time()
    DECODER_LISTENING = enabled
    print(f"[DECODER] Escucha de señales {'ACTIVADA' if DECODER_LISTENING else 'DESACTIVADA'}")
    add_log(f"🔄 Escucha del decoder {'activada' if DECODER_LISTENING else 'desactivada'}")
    return DECODER_LISTENING


def get_decoder_listening():
    return DECODER_LISTENING


def _auto_off_decoder_when_idle():
    """Fuera de carrera, si el usuario activó la escucha manualmente, se apaga
    sola a los 3 minutos para no llenar el buffer con señales sin carrera."""
    global _LAST_LISTEN_ENABLE_TIME
    if not DECODER_LISTENING or RACE_ACTIVE or _LAST_LISTEN_ENABLE_TIME <= 0:
        return
    if time.time() - _LAST_LISTEN_ENABLE_TIME >= _AUTO_OFF_SECONDS:
        _LAST_LISTEN_ENABLE_TIME = 0
        set_decoder_listening(False)
        print("[DECODER] Escucha apagada automáticamente tras 3 min sin carrera activa")
        add_log("⏱️ Escucha del decoder apagada automáticamente (3 min sin carrera)")


def is_simulation_mode():
    return os.path.exists(SIMULATION_FLAG_FILE)


def get_simulation_speed():
    try:
        if os.path.exists(SIMULATION_SPEED_FILE):
            with open(SIMULATION_SPEED_FILE, "r") as f:
                return float(f.read().strip())
    except:
        pass
    return 2.0


def activar_decoder(ser=None):
    """
    Envía comando START al decoder probando múltiples formatos.
    Guarda el formato que funcionó para futuras conexiones.
    """
    try:
        if is_simulation_mode():
            return True

        # Formatos a probar (el más común primero)
        formatos = [
            (b"START\r\n", "CR+LF"),
            (b"START\r", "solo CR"),
            (b"START\n", "solo LF"),
            (b"START", "sin salto")
        ]

        # Verificar si ya hay un formato guardado en memoria
        if hasattr(activar_decoder, "_formato_exitoso"):
            formato_guardado, nombre_guardado = activar_decoder._formato_exitoso
            # Probar primero el formato que funcionó antes
            formatos.insert(0, (formato_guardado, nombre_guardado))

        if ser and ser.is_open:
            for comando, nombre in formatos:
                try:
                    # Enviar comando SIN limpiar el buffer de entrada, para no
                    # descartar detecciones que ya estén llegando del decoder.
                    ser.write(comando)
                    ser.flush()

                    # Verificar respuesta sondeando una ventana corta: el decoder
                    # puede tardar en empezar a transmitir, por eso antes se
                    # reportaba un falso "ningún formato funcionó".
                    respuesta = b""
                    t_ini = time.time()
                    while time.time() - t_ini < 0.6:
                        n = ser.in_waiting
                        if n:
                            respuesta += ser.read(n)
                            break
                        time.sleep(0.05)

                    if respuesta:
                        print(f"[DECODER] ✅ Comando START ({nombre}) enviado - Respuesta: {repr(respuesta[:50])}")
                        add_log(f"[DECODER] Comando START ({nombre}) - Transmisión activada")
                        activar_decoder._formato_exitoso = (comando, nombre)
                        return True
                    else:
                        print(f"[DECODER] ⚠️ Comando {nombre} enviado, sin respuesta inmediata")
                except Exception as e:
                    print(f"[DECODER] ⚠️ Error con formato {nombre}: {e}")
                    continue

            # Si ningún formato funcionó, al menos dejar el puerto limpio
            print("[DECODER] ⚠️ Ningún formato de START funcionó")
            return False

        else:
            # Fallback: abrir puerto temporal
            import serial
            with serial.Serial(PORT, BAUD, timeout=1) as ser_tmp:
                for comando, nombre in formatos:
                    try:
                        ser_tmp.write(comando)
                        ser_tmp.flush()
                        time.sleep(0.2)
                        if ser_tmp.in_waiting > 0:
                            respuesta = ser_tmp.read(ser_tmp.in_waiting)
                            # ✅ USAR LA VARIABLE respuesta para diagnóstico
                            print(f"[DECODER] ✅ Comando START ({nombre}) enviado (temporal) - Respuesta: {repr(respuesta[:50])}")
                            add_log(f"[DECODER] Comando START ({nombre}) - Transmisión activada (temporal)")
                            activar_decoder._formato_exitoso = (comando, nombre)
                            return True
                    except:
                        continue
                print("[DECODER] ⚠️ Ningún formato funcionó en modo temporal")
                return False

    except Exception as e:
        print(f"[DECODER] ⚠️ Error en activar_decoder: {e}")
        add_log(f"[DECODER] ⚠️ No se pudo enviar START: {e}")
        return False


def generar_vuelta_simulada():
    global RACE_ACTIVE, RACE_PAUSED, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS
    global DRIVERS_FINISHED, FIRST_FINISHER, PRIMERA_VEZ, VUELTA_SALIDA
    global VUELTAS_CARRERA, VUELTA_BASE, PRIMER_TIEMPO_SERVIDOR

    if not RACE_ACTIVE or RACE_PAUSED:
        return

    if not SESSION_ID:
        return

    race_drivers = get_race_drivers(SESSION_ID)
    if not race_drivers:
        return

    import random

    active_drivers = [d for d in race_drivers if d["transponder_id"] not in DRIVERS_FINISHED]

    if not active_drivers:
        return

    driver = random.choice(active_drivers)
    transponder_id = driver["transponder_id"]
    driver_id = driver["driver_id"]
    nombre_piloto = f"{driver['name']} {driver.get('lastname', '')}".strip()
    lap_time = random.uniform(30.0, 90.0)
    tiempo_actual = time.time()

    session_info = get_current_session()
    race_mode = (
        session_info.get("race_mode", "position") if session_info else "position"
    )

    if transponder_id not in PRIMERA_VEZ:
        PRIMERA_VEZ[transponder_id] = True
        VUELTA_SALIDA[transponder_id] = 0
        VUELTAS_CARRERA[transponder_id] = 0
        VUELTA_BASE[transponder_id] = 0
        PRIMER_TIEMPO_SERVIDOR[transponder_id] = tiempo_actual
        print(f"🎮 [SIMULACIÓN] Primera detección para {nombre_piloto}")
        add_log(f"🎮 [SIMULACIÓN] Primera detección para {nombre_piloto}")
        return

    VUELTAS_CARRERA[transponder_id] = VUELTAS_CARRERA.get(transponder_id, 0) + 1
    vuelta_carrera = VUELTAS_CARRERA[transponder_id]
    tiempo_total = tiempo_actual - PRIMER_TIEMPO_SERVIDOR.get(
        transponder_id, tiempo_actual
    )

    print(f"\n🎮 [SIMULACIÓN] Vuelta generada para {nombre_piloto}")
    add_log(f"🎮 [SIMULACIÓN] Vuelta generada para {nombre_piloto}")
    print(f"   🏎️  Transponder: {transponder_id}")
    add_log(f"   🏎️  Transponder: {transponder_id}")
    print(f"   ⏱️  Tiempo vuelta {vuelta_carrera}: {lap_time:.3f}s")
    add_log(f"   ⏱️  Tiempo vuelta {vuelta_carrera}: {lap_time:.3f}s")
    print(f"   📊 Tiempo total: {tiempo_total:.3f}s")
    add_log(f"   📊 Tiempo total: {tiempo_total:.3f}s")

    from database import get_track_length

    track_length = get_track_length()
    avg_speed = (track_length / lap_time) * 3600 if track_length > 0 else None
    if avg_speed:
        print(f"   🏁 Velocidad: {avg_speed:.0f} km/h")
        add_log(f"   🏁 Velocidad: {avg_speed:.0f} km/h")

    from database import save_lap

    save_lap(
        session_id=SESSION_ID,
        driver_id=driver_id,
        transponder_id=transponder_id,
        physical_laps=vuelta_carrera,
        lap_number=vuelta_carrera,
        total_seconds=tiempo_total,
        lap_seconds=lap_time,
        signal_h=random.randint(60, 200),
        signal_l=random.randint(30, 100),
        is_last_lap=False,
    )

    print(
        f"🔍 DEBUG: {nombre_piloto} - vuelta_carrera={vuelta_carrera}, LAPS_LIMIT={LAPS_LIMIT}"
    )

    if (
        LAPS_LIMIT > 0
        and vuelta_carrera >= LAPS_LIMIT
        and transponder_id not in DRIVERS_FINISHED
    ):
        DRIVERS_FINISHED.add(transponder_id)
        finish_total = tiempo_total - VUELTA_SALIDA.get(transponder_id, 0)
        if finish_total < 0:
            finish_total = tiempo_total
        from datetime import datetime

        update_driver_finish_time(
            SESSION_ID, driver_id, finish_total, datetime.now().isoformat()
        )
        print(
            f"   🏆 ¡{nombre_piloto} COMPLETÓ LA CARRERA! (Tiempo final: {finish_total:.3f}s)"
        )
        add_log(f"   🏆 ¡{nombre_piloto} COMPLETÓ LA CARRERA!")

    if LAPS_LIMIT > 0 and len(DRIVERS_FINISHED) == len(race_drivers):
        print("\n" + "=" * 60)
        print("🏁 ¡TODOS LOS PILOTOS HAN COMPLETADO LA CARRERA!")
        print("=" * 60)
        RACE_ACTIVE = False
        RACE_PAUSED = False
        from database import get_leaderboard_with_details

        final_leaderboard = get_leaderboard_with_details(SESSION_ID)
        if final_leaderboard and len(final_leaderboard) > 0:
            true_winner = final_leaderboard[0]
            winner_id = true_winner["driver_id"]
            winner_time = true_winner.get("race_total_time")
            update_race_status(SESSION_ID, "completed", winner_id, winner_time)
            print(f"👑 ¡GANADOR OFICIAL: {true_winner['full_name']}!")
            add_log(f"👑 GANADOR OFICIAL: {true_winner['full_name']}")

        # Volcar la clasificación final a PostgreSQL para que el historial del
        # piloto en web-client se alimente aunque la carrera se haya cerrado por
        # auto-finalización (no por el botón manual de fin de carrera).
        if SESSION_ID:
            finalize_session_and_sync(SESSION_ID)

    print("-" * 50)
    add_log("-" * 50)


def repair_permissions(port):
    try:
        if os.path.exists(port):
            subprocess.run(
                ["chmod", "666", port], check=True, stderr=subprocess.DEVNULL
            )
            subprocess.run(
                ["stty", "-F", port, str(BAUD), "raw", "-echo", "-hupcl"],
                check=False,
                stderr=subprocess.DEVNULL,
            )
            return True
    except:
        pass
    return False


def diagnosticar_decoder():
    """Función de diagnóstico para verificar la comunicación con el decoder"""
    try:
        print("[DIAGNÓSTICO] Verificando comunicación con el decoder...")

        if not os.path.exists(PORT):
            print(f"[DIAGNÓSTICO] ❌ Puerto {PORT} no existe")
            return False

        with serial.Serial(PORT, BAUD, timeout=1.0) as ser_test:
            ser_test.write(b"START")
            ser_test.flush()
            time.sleep(0.5)

            if ser_test.in_waiting > 0:
                datos = ser_test.read(ser_test.in_waiting)
                print(f"[DIAGNÓSTICO] ✅ Decoder respondió: {repr(datos[:50])}")
                return True
            else:
                print("[DIAGNÓSTICO] ⚠️ Decoder no respondió al comando START")
                return False
    except Exception as e:
        print(f"[DIAGNÓSTICO] ❌ Error: {e}")
        return False

# ============================================
# FUNCIONES DE REINICIO DE ESTADO
# ============================================

def reset_race_state(preserve_drivers=True):
    """Reinicia el estado global de la carrera."""
    global RACE_ACTIVE, RACE_PAUSED, DRIVERS_FINISHED, VUELTA_BASE
    global LAST_LAP_TIME, VUELTAS_CARRERA, PRIMERA_VEZ, VUELTA_SALIDA
    global FIRST_FINISHER, TIME_LIMIT_ACTIVE, TIME_LIMIT_END, TIME_LIMIT_REMAINING
    global SESSION_ID, LAPS_LIMIT, PRIMER_TIEMPO_SERVIDOR, CONTADOR_VUELTAS_INTERNO
    global RACE_DRIVERS, _DETECTION_THROTTLE, _RECENT_LAP_DEDUP
    global _RAW_LAP_OFFSET

    print("[SISTEMA] Reiniciando estado global de carrera...")

    if "_DETECTION_THROTTLE" not in globals():
        _DETECTION_THROTTLE = {}

    PRIMER_TIEMPO_SERVIDOR = {}
    CONTADOR_VUELTAS_INTERNO = {}
    _DETECTION_THROTTLE = {}
    _RECENT_LAP_DEDUP = {}
    _RAW_LAP_OFFSET = {}
    RACE_ACTIVE = False
    RACE_PAUSED = False
    DRIVERS_FINISHED = set()
    # Al reiniciar el estado la escucha del decoder se apaga: sin carrera
    # activa debe casi nunca estar prendida (evita llenar el buffer).
    set_decoder_listening(False)
    VUELTA_BASE = {}
    LAST_LAP_TIME = {}
    VUELTAS_CARRERA = {}
    PRIMERA_VEZ = {}
    VUELTA_SALIDA = {}
    FIRST_FINISHER = None
    TIME_LIMIT_ACTIVE = False
    TIME_LIMIT_END = 0
    TIME_LIMIT_REMAINING = 0
    RACE_DRIVERS = set()

    if not preserve_drivers:
        print("[SISTEMA] Reiniciando sesión actual...")
        from database import start_new_session, update_race_status
        from datetime import datetime
        
        if SESSION_ID:
            update_race_status(SESSION_ID, "completed")
        
        nombre_defecto = f"Circuito {datetime.now().strftime('%d/%m')}"
        SESSION_ID = start_new_session(nombre_defecto, LAPS_LIMIT, "position", 0)
        print(f"[SISTEMA] Nueva sesión creada: {SESSION_ID}")

    try:
        time_limit_file = os.path.join(BASE_DATA_DIR, 'time_limit_info.json')
        if os.path.exists(time_limit_file):
            os.remove(time_limit_file)
            print("[TIME LIMIT] Archivo de estado eliminado")
    except Exception as e:
        print(f"[TIME LIMIT] Error limpiando archivo: {e}")

    print("[SISTEMA] Estado global reiniciado correctamente")


# ============================================
# CONTADOR MANUAL DE VUELTAS (DEDUP 3-5s + MOTOR UNIFICADO)
# ============================================

def _dedup_lap_event(transponder_id, tiempo_total_segundos):
    """Ventana de deduplicación 3-5s por transponder.
    Si hay dos eventos del MISMO kart/señal casi simultáneos (manual + decoder
    o doble click), se registra UNA SOLA vuelta: el primer evento se procesa y
    los siguientes dentro de la ventana se ignoran (no cuentan vuelta doble).
    Conservamos el menor tiempo acumulado entre los eventos de la misma pasada.
    """
    now = time.time()
    prev = _RECENT_LAP_DEDUP.get(transponder_id)
    if prev is not None:
        # Mantener anclado el inicio de la ventana al PRIMER evento de la pasada,
        # para no extenderla indefinidamente con duplicados.
        dif = now - prev.get("event_time", now)
        if dif < _DEDUP_WINDOW_LONG:
            prev_total = prev.get("tiempo_total")
            # Conservamos el menor tiempo acumulado de la misma pasada
            if (tiempo_total_segundos is not None and prev_total is not None
                    and tiempo_total_segundos < prev_total):
                prev["tiempo_total"] = tiempo_total_segundos
            print(f"   🔁 Duplicado de la misma pasada IGNORADO ({dif:.1f}s) - Transponder {transponder_id}")
            return True
    _RECENT_LAP_DEDUP[transponder_id] = {
        "event_time": now,
        "tiempo_total": tiempo_total_segundos,
    }
    return False


# Filtro anti-repetición POR TRANSPONDER (clave -> timestamp de última detección).
# Antes el filtro usaba variables globales y la detección de un kart podía
# descartar la de otro kart distinto que cruzaba casi al mismo tiempo.
_ULTIMA_DETECCION = {}


def _line_identity(linea):
    """Clave estable (por transponder) para el filtro anti-repetición.
    En el formato binario chronit el ID son los 4 dígitos hex de la posición
    5-8 (mismo índice que usa procesar_cadena_esl400). Así las detecciones de
    karts distintos se filtran de forma independiente y no se mezclan."""
    if linea.startswith("$") and "," not in linea and len(linea) >= 9:
        return linea[5:9]
    return linea


def process_lap_event(transponder_id, source, nro_vueltas_raw, tiempo_total_segundos,
                      val_h, val_l, origen_tiempo):
    """Motor unificado de vueltas. Usado por el decoder (source='decoder')
    y por el contador manual (source='manual'). Aplica deduplicación 3-5s.
    """
    global VUELTA_BASE, LAST_LAP_TIME, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS
    global DRIVERS_FINISHED, RACE_ACTIVE, RACE_PAUSED, FIRST_FINISHER
    global PRIMERA_VEZ, VUELTA_SALIDA, VUELTAS_CARRERA, PRIMER_TIEMPO_SERVIDOR, CONTADOR_VUELTAS_INTERNO

    # ===== DEDUPLICACIÓN: misma señal/kart dos veces casi al mismo tiempo =====
    if _dedup_lap_event(transponder_id, tiempo_total_segundos):
        return None

    es_nuevo = add_transponder_detected(
        transponder_id, val_h, val_l, formatear_tiempo(tiempo_total_segundos), nro_vueltas_raw
    )
    if es_nuevo:
        print(f"\n🔔 NUEVO TRANSPONDER DETECTADO: {transponder_id}")

    print(f"\n🏁 ¡DETECCIÓN! ({'MANUAL' if source == 'manual' else 'DECODER'}) - Fuente: {origen_tiempo}")
    print(f"🆔 ID Transponder: {transponder_id}")

    if transponder_id not in RACE_DRIVERS:
        actualizar_pilotos_inscritos()
        if transponder_id not in RACE_DRIVERS:
            print(f"⚠️ NO INSCRITO - Ve a PILOTOS para asignarlo")
            return None
        else:
            print(f"✅ INSCRIPCIÓN DETECTADA TARDE PARA {transponder_id}")

    driver = get_session_driver_by_transponder(SESSION_ID, transponder_id)
    if not driver:
        # Fallback: resolver por drivers.transponder_id (puede estar
        # desactualizado) solo si la inscripción de la sesión no lo encontró.
        driver = get_driver_by_transponder(transponder_id)
    if not driver:
        print(f"⚠️ Sin piloto asignado")
        return None

    nombre_piloto = driver["name"]
    if driver.get("lastname"):
        nombre_piloto += f" {driver['lastname']}"
    print(f"👤 Piloto: {nombre_piloto}")

    if transponder_id in DRIVERS_FINISHED:
        print(f"🏁 {nombre_piloto} ya completó la carrera - IGNORADO")
        return None

    session_info = get_current_session()
    race_mode = (
        session_info.get("race_mode", "position") if session_info else "position"
    )

    es_primera_vez = transponder_id not in PRIMERA_VEZ

    if es_primera_vez:
        PRIMERA_VEZ[transponder_id] = True
        VUELTA_SALIDA[transponder_id] = tiempo_total_segundos
        VUELTAS_CARRERA[transponder_id] = 0
        VUELTA_BASE[transponder_id] = nro_vueltas_raw
        vuelta_carrera = 0
        lap_time = None
        print(f"🏁 ¡PRIMERA DETECCIÓN! Vuelta de SALIDA/LARGADA para {nombre_piloto}")
        if race_mode == "qualifying_laps":
            add_log(f"🔴 VUELTA DE SALIDA (LARGADA) para {nombre_piloto} - NO CUENTA")
        print(f"   Cronómetro individual INICIADO (fuente: {origen_tiempo})")

        save_lap(
            session_id=SESSION_ID,
            driver_id=driver["id"],
            transponder_id=transponder_id,
            physical_laps=nro_vueltas_raw,
            lap_number=0,
            total_seconds=tiempo_total_segundos,
            lap_seconds=None,
            signal_h=val_h,
            signal_l=val_l,
            is_last_lap=False,
        )
    else:
        if nro_vueltas_raw > VUELTA_BASE.get(transponder_id, 0):
            VUELTAS_CARRERA[transponder_id] = (
                VUELTAS_CARRERA.get(transponder_id, 0) + 1
            )
            VUELTA_BASE[transponder_id] = nro_vueltas_raw
            vuelta_carrera = VUELTAS_CARRERA[transponder_id]

            if transponder_id in LAST_LAP_TIME and vuelta_carrera > 0:
                lap_time = tiempo_total_segundos - LAST_LAP_TIME[transponder_id]
            else:
                lap_time = None
        else:
            print(f"   🔄 Señal duplicada - IGNORADA")
            return None

    LAST_LAP_TIME[transponder_id] = tiempo_total_segundos
    print(f"🏎️ Vueltas en Carrera: {vuelta_carrera}")

    if vuelta_carrera == 0:
        print(f"🏁 VUELTA DE SALIDA (no cuenta para el límite)")
    else:
        if lap_time is not None:
            print(f"⚡ Tiempo vuelta {vuelta_carrera}: {lap_time:.3f}s")
        else:
            print(f"⚡ Tiempo vuelta {vuelta_carrera}: --")

        save_lap(
            session_id=SESSION_ID,
            driver_id=driver["id"],
            transponder_id=transponder_id,
            physical_laps=nro_vueltas_raw,
            lap_number=vuelta_carrera,
            total_seconds=tiempo_total_segundos,
            lap_seconds=lap_time,
            signal_h=val_h,
            signal_l=val_l,
            is_last_lap=False,
        )

        if race_mode not in ("endurance", "classification"):
            if (
                LAPS_LIMIT > 0
                and vuelta_carrera >= LAPS_LIMIT
                and transponder_id not in DRIVERS_FINISHED
            ):
                DRIVERS_FINISHED.add(transponder_id)
                finish_total = tiempo_total_segundos - VUELTA_SALIDA.get(
                    transponder_id, 0
                )
                if finish_total < 0:
                    finish_total = tiempo_total_segundos

                update_driver_finish_time(
                    SESSION_ID,
                    driver["id"],
                    finish_total,
                    datetime.now().isoformat(),
                )

                print(
                    f"\n🏆 ¡{nombre_piloto} HA COMPLETADO LA CARRERA! (Tiempo final: {finish_total:.3f}s)"
                )
                add_log(
                    f"🏆 {nombre_piloto} ({transponder_id}) COMPLETÓ LA CARRERA!"
                )

                if len(DRIVERS_FINISHED) == len(RACE_DRIVERS):
                    print("\n" + "=" * 60)
                    print("🏁 ¡TODOS LOS PILOTOS HAN COMPLETADO LA CARRERA!")
                    print("=" * 60)
                    RACE_ACTIVE = False
                    RACE_PAUSED = False
                    # La carrera terminó en TODOS los modos → apagar la escucha
                    # del decoder para no seguir llenando el buffer.
                    set_decoder_listening(False)

                    from database import get_leaderboard_with_details, update_race_status

                    final_leaderboard = get_leaderboard_with_details(SESSION_ID)
                    if final_leaderboard and len(final_leaderboard) > 0:
                        true_winner = final_leaderboard[0]
                        winner_id = true_winner["driver_id"]
                        winner_time = true_winner.get("race_total_time")
                        update_race_status(
                            SESSION_ID, "completed", winner_id, winner_time
                        )
                        print(f"👑 ¡GANADOR OFICIAL: {true_winner['full_name']}!")
                        add_log(f"👑 GANADOR OFICIAL: {true_winner['full_name']}")

                    # Auto-finalización: volcar resultados a PostgreSQL para el
                    # historial del piloto (web-client).
                    if SESSION_ID:
                        finalize_session_and_sync(SESSION_ID)

    return None


def enqueue_manual_lap(kart_number, session_id=None, transponder_id=None):
    """Encola una vuelta manual (escrita desde la API). Devuelve True/False."""
    try:
        with manual_lap_lock:
            with open(MANUAL_LAP_QUEUE_FILE, "a") as f:
                f.write(json.dumps({
                    "kart_number": str(kart_number),
                    "transponder_id": transponder_id,
                    "session_id": session_id,
                    "event_time": datetime.now().isoformat(),
                    "created_at": time.time(),
                }) + "\n")
            return True
    except Exception as e:
        print(f"[MANUAL] Error encolando vuelta: {e}")
        return False


def procesar_vuelta_manual(ev):
    """Procesa un evento manual (se usa dentro de la cola)."""
    global SESSION_ID, RACE_ACTIVE, RACE_PAUSED, CONTADOR_VUELTAS_INTERNO, VUELTA_BASE

    if not RACE_ACTIVE:
        print(f"[MANUAL] Carrera no activa - vuelta manual ignorada")
        return
    if RACE_PAUSED:
        print(f"[MANUAL] Carrera pausada - vuelta manual ignorada")
        return

    kart_number = ev.get("kart_number")
    transponder_id = ev.get("transponder_id")

    # Resolver el transponder por kart si no vino explícito
    if not transponder_id and kart_number is not None:
        from database import get_kart_by_number
        kart = get_kart_by_number(kart_number)
        if kart and kart.get("transponder_id"):
            transponder_id = kart["transponder_id"]

    if not transponder_id:
        print(f"[MANUAL] Kart {kart_number} sin transponder - ignorado")
        return

    transponder_id = int(transponder_id)

    # Tiempo basado en servidor (el manual no viene del decoder)
    momento = time.time()
    if transponder_id not in PRIMER_TIEMPO_SERVIDOR:
        PRIMER_TIEMPO_SERVIDOR[transponder_id] = momento
    tiempo_total_segundos = momento - PRIMER_TIEMPO_SERVIDOR[transponder_id]

    # Contador físico siempre creciente para que SIEMPRE sume una vuelta
    nuevo = CONTADOR_VUELTAS_INTERNO.get(transponder_id, 0) + 1
    CONTADOR_VUELTAS_INTERNO[transponder_id] = nuevo
    nro_vueltas_raw = max(nuevo, VUELTA_BASE.get(transponder_id, 0) + 1)
    CONTADOR_VUELTAS_INTERNO[transponder_id] = nro_vueltas_raw

    print(f"\n👆 [MANUAL] Vuelta manual para Kart {kart_number} (transponder {transponder_id})")
    add_log(f"[MANUAL] Vuelta manual marcada para Kart {kart_number} (transponder {transponder_id})")

    process_lap_event(
        transponder_id=transponder_id,
        source="manual",
        nro_vueltas_raw=nro_vueltas_raw,
        tiempo_total_segundos=tiempo_total_segundos,
        val_h=160,
        val_l=0,
        origen_tiempo="MANUAL",
    )


def process_manual_lap_queue():
    """Procesa la cola de vueltas manuales (archivo JSONL)."""
    if not os.path.exists(MANUAL_LAP_QUEUE_FILE):
        return
    with manual_lap_lock:
        try:
            with open(MANUAL_LAP_QUEUE_FILE, "r") as f:
                lineas = f.readlines()
            if not lineas:
                return
            with open(MANUAL_LAP_QUEUE_FILE, "w") as f:
                f.write("")
        except Exception as e:
            print(f"[MANUAL] Error leyendo cola: {e}")
            return

    for linea in lineas:
        linea = linea.strip()
        if not linea:
            continue
        try:
            ev = json.loads(linea)
            procesar_vuelta_manual(ev)
        except Exception as e:
            print(f"[MANUAL] Error procesando línea: {e}")


# ============================================
# FUNCIONES DE CONTROL DE CARRERA
# ============================================

def check_restart_flag():
    if os.path.exists(RESTART_FLAG_FILE):
        print("\n[SISTEMA] restart.flag detectado; limpiando bandera residual.")
        try:
            os.remove(RESTART_FLAG_FILE)
        except OSError:
            pass
    return False


def periodic_state_cleanup():
    if "_last_periodic_cleanup" not in globals():
        global _last_periodic_cleanup
        _last_periodic_cleanup = 0
    ahora = time.time()
    if ahora - _last_periodic_cleanup < 300.0:
        return
    _last_periodic_cleanup = ahora

    if "_DETECTION_THROTTLE" in globals():
        global _DETECTION_THROTTLE
        if isinstance(_DETECTION_THROTTLE, dict) and len(_DETECTION_THROTTLE) > 200:
            antes = len(_DETECTION_THROTTLE)
            _DETECTION_THROTTLE = {
                tid: ts for tid, ts in _DETECTION_THROTTLE.items()
                if ahora - ts < 7200.0
            }
            despues = len(_DETECTION_THROTTLE)
            if antes != despues:
                print(f"[LIMPIEZA] Throttle reducido: {antes} -> {despues}")

    if isinstance(_ULTIMA_DETECCION, dict) and len(_ULTIMA_DETECCION) > 500:
        corte = ahora - 120.0
        for clave in [k for k, ts in _ULTIMA_DETECCION.items() if ts < corte]:
            _ULTIMA_DETECCION.pop(clave, None)
    if not RACE_ACTIVE:
        for nombre_dict in ("VUELTA_BASE", "LAST_LAP_TIME", "VUELTAS_CARRERA",
                            "PRIMERA_VEZ", "VUELTA_SALIDA", "PRIMER_TIEMPO_SERVIDOR",
                            "CONTADOR_VUELTAS_INTERNO"):
            if nombre_dict in globals() and isinstance(globals()[nombre_dict], dict):
                d = globals()[nombre_dict]
                if len(d) > 1000:
                    globals()[nombre_dict] = {}
                    print(f"[LIMPIEZA] {nombre_dict} limpiado (tenía {len(d)})")


def check_race_commands():
    global RACE_ACTIVE, RACE_PAUSED, DRIVERS_FINISHED, VUELTA_BASE, LAST_LAP_TIME, SESSION_ID
    global FIRST_FINISHER, VUELTAS_CARRERA, PRIMERA_VEZ, VUELTA_SALIDA, LAPS_LIMIT, TIME_LIMIT_ACTIVE, TIME_LIMIT_END
    global TIME_LIMIT_REMAINING, PRIMER_TIEMPO_SERVIDOR, CONTADOR_VUELTAS_INTERNO, RACE_DRIVERS

    if os.path.exists(RACE_COMMAND_FILE):
        with open(RACE_COMMAND_FILE, "r") as f:
            content = f.read().strip()
        os.remove(RACE_COMMAND_FILE)

        try:
            comando = json.loads(content)

            if comando.get("action") == "new_race":
                print(f"\n🎬 NUEVA CARRERA SOLICITADA: {comando['race_name']}")
                print(f"🎯 Modo de carrera: {comando.get('race_mode', 'position')}")
                print(f"⏱️ Tiempo límite: {comando.get('time_limit_seconds', 0)}s")

                reset_race_state(preserve_drivers=True)

                race_mode = comando.get("race_mode", "position")
                laps_limit = comando["laps_limit"]

                if race_mode in ("endurance", "classification"):
                    laps_limit = 0
                    print(f"   🔄 Modo {race_mode.upper()} - Sin límite de vueltas")
                elif race_mode == "qualifying_laps":
                    print(f"   🔄 Modo QUALIFYING LAPS - Límite: {laps_limit} vueltas (sin tiempo límite)")
                else:
                    print(f"   🔄 Límite de vueltas: {laps_limit}")

                SESSION_ID = start_new_session(
                    comando["race_name"],
                    laps_limit,
                    race_mode,
                    comando.get("time_limit_seconds", 0),
                )
                LAPS_LIMIT = laps_limit

                actualizar_sesion_activa()
                actualizar_pilotos_inscritos()

                print(
                    f"✅ Nueva carrera creada: {comando['race_name']} ({comando['laps_limit']} vueltas)"
                )
                print(f"📊 Estado: PENDIENTE")
                return True

            elif comando.get("action") == "repeat_race":
                print(f"\n🔄 REPETIR CARRERA SOLICITADA: {comando['circuit_name']}")
                reset_race_state(preserve_drivers=True)

                from database import get_session_time_limit

                original_time_limit = (
                    get_session_time_limit(SESSION_ID) if SESSION_ID else 0
                )

                SESSION_ID = start_new_session(
                    comando["circuit_name"],
                    comando["laps_limit"],
                    comando.get("race_mode", "position"),
                    original_time_limit,
                )
                LAPS_LIMIT = comando["laps_limit"]
                actualizar_sesion_activa()

                for driver in comando["race_drivers"]:
                    add_driver_to_race(
                        SESSION_ID, driver["driver_id"], driver["transponder_id"]
                    )

                actualizar_pilotos_inscritos()
                print(
                    f"✅ Carrera repetida: {comando['circuit_name']} ({comando['laps_limit']} vueltas)"
                )
                print(f"⏱️ Tiempo límite: {original_time_limit}s")
                return True

            elif comando.get("action") == "clear_all":
                print(f"\n⚠️ REINICIO FORZADO TOTAL SOLICITADO")
                from database import safe_hard_reset

                backup_file = safe_hard_reset()
                print(f"✅ Respaldo creado: {backup_file}")
                reset_race_state(preserve_drivers=False)
                SESSION_ID = start_new_session("Circuito Principal", 10, "position", 0)
                LAPS_LIMIT = 10
                actualizar_sesion_activa()
                actualizar_pilotos_inscritos()
                print(f"✅ Sistema reiniciado desde cero con respaldo")
                return True

            elif comando.get("action") == "continue_race":
                print(f"\n🏁 CONTINUAR DESDE CLASIFICACIÓN - Recargando sesión final")
                # La sesión final (con los pilotos) YA fue creada en BD por la API.
                # Solo limpiamos el estado global y recargamos la sesión actual,
                # SIN crear una sesión nueva vacía (eso es lo que causaba el bug).
                reset_race_state(preserve_drivers=True)
                actualizar_sesion_activa()
                actualizar_pilotos_inscritos()
                print(
                    f"✅ Sesión final recargada (ID: {SESSION_ID}) - "
                    f"{len(RACE_DRIVERS)} pilotos inscritos"
                )
                return True

            elif comando.get("action") == "reload_session":
                # La API ya creó/actualizó la sesión en BD (p.ej. al iniciar un
                # evento desde el módulo de carrera). Aquí SOLO recargamos el
                # estado global y los pilotos desde la sesión actual, sin crear
                # una sesión nueva vacía ni perder la configuración modificada.
                print(f"\n🔄 RECARGAR CONFIGURACIÓN - Volviendo a cargar la sesión actual")
                reset_race_state(preserve_drivers=True)
                actualizar_sesion_activa()
                actualizar_pilotos_inscritos()
                print(
                    f"✅ Configuración recargada (Sesión {SESSION_ID}) - "
                    f"{len(RACE_DRIVERS)} pilotos inscritos"
                )
                return True

            elif comando.get("action") == "update_race_config":
                # Editar una carrera AÚN NO INICIADA (nombre, modo, límite de
                # vueltas/tiempo) sin borrar a los pilotos ya inscritos. La API
                # ya actualizó la sesión en BD; aquí sincronizamos el motor.
                print("\n✏️ ACTUALIZAR CONFIGURACIÓN DE CARRERA (sin borrar pilotos)")
                session_info = get_current_session()
                if session_info:
                    SESSION_ID = session_info["id"]
                    LAPS_LIMIT = int(session_info.get("laps_limit", 10) or 0)
                    TIME_LIMIT_ACTIVE = False
                    TIME_LIMIT_END = 0.0
                    actualizar_pilotos_inscritos()
                    print(
                        f"✅ Configuración actualizada: {session_info['circuit_name']} | "
                        f"modo {session_info.get('race_mode')} | {LAPS_LIMIT} vueltas | "
                        f"{session_info.get('time_limit_seconds', 0)}s"
                    )
                return True

        except json.JSONDecodeError:
            command = content
            print(f"[COMANDO] Recibido: {command}")

            if command == "start":
                print(
                    f"\n🔥 [DEBUG] Comando START recibido. RACE_ACTIVE antes: {RACE_ACTIVE}"
                )

                PRIMERA_VEZ = {}
                VUELTA_SALIDA = {}
                VUELTAS_CARRERA = {}
                VUELTA_BASE = {}
                LAST_LAP_TIME = {}
                PRIMER_TIEMPO_SERVIDOR = {}
                CONTADOR_VUELTAS_INTERNO = {}
                DRIVERS_FINISHED = set()
                FIRST_FINISHER = None
                if "_RAW_LAP_OFFSET" not in globals():
                    global _RAW_LAP_OFFSET
                _RAW_LAP_OFFSET = {}

                RACE_ACTIVE = True
                RACE_PAUSED = False
                print(f"🔥 [DEBUG] RACE_ACTIVE después: {RACE_ACTIVE}")

                if SESSION_ID:
                    session_info = get_current_session()
                    if session_info:
                        race_mode = session_info.get("race_mode", "")
                        if race_mode in (
                            "classification",
                            "clasificacion",
                            "class",
                            "cl",
                            "endurance",
                            "enduro",
                            "en",
                        ):
                            tls = int(session_info.get("time_limit_seconds", 0) or 0)
                            if tls > 0:
                                TIME_LIMIT_ACTIVE = True
                                if TIME_LIMIT_REMAINING > 0:
                                    TIME_LIMIT_END = time.time() + TIME_LIMIT_REMAINING
                                    TIME_LIMIT_REMAINING = 0
                                    print(f"⏱️ {race_mode.upper()} reanudado: {TIME_LIMIT_END - time.time():.0f}s restantes")
                                else:
                                    TIME_LIMIT_END = time.time() + tls
                                    print(f"⏱️ {race_mode.upper()} activo: {tls}s restantes")
                                add_log(f"⏱️ {race_mode.upper()} activada: {tls}s")
                                try:
                                    time_limit_info = {
                                        "time_limit_active": True,
                                        "time_limit_end": TIME_LIMIT_END,
                                        "time_limit_seconds": tls,
                                        "remaining_on_pause": 0
                                    }
                                    time_limit_file = os.path.join(
                                        BASE_DATA_DIR, "time_limit_info.json"
                                    )
                                    with open(time_limit_file, "w") as f:
                                        json.dump(time_limit_info, f)
                                    print(f"[TIME LIMIT] Estado guardado en {time_limit_file}")
                                except Exception as e:
                                    print(f"[TIME LIMIT] Error guardando estado: {e}")

                actualizar_pilotos_inscritos()
                print("\n🏁 ¡CARRERA INICIADA!\n")
                add_log("🏁 CARRERA INICIADA")
                if SESSION_ID:
                    update_race_status(SESSION_ID, "active")
                    print(
                        f"[DEBUG] Estado actualizado a 'active' para sesión {SESSION_ID}"
                    )

            elif command == "finish":
                RACE_ACTIVE = False
                RACE_PAUSED = False
                # La carrera terminó en TODOS los modos → apagar la escucha del
                # decoder para no seguir llenando el buffer con señales sin valor.
                set_decoder_listening(False)
                print("\n🏆 ¡CARRERA FINALIZADA MANUALMENTE!\n")
                add_log("🏆 CARRERA FINALIZADA")
                try:
                    time_limit_file = os.path.join(
                        BASE_DATA_DIR, "time_limit_info.json"
                    )
                    if os.path.exists(time_limit_file):
                        os.remove(time_limit_file)
                        print("[TIME LIMIT] Estado limpiado")
                except Exception as e:
                    print(f"[TIME LIMIT] Error limpiando estado: {e}")

                if SESSION_ID:
                    update_race_status(
                        SESSION_ID,
                        "completed",
                        FIRST_FINISHER["driver_id"] if FIRST_FINISHER else None,
                        FIRST_FINISHER["finish_time"] if FIRST_FINISHER else None,
                    )
                    try:
                        from database import get_db

                        with get_db() as conn:
                            cursor = conn.execute(
                                "SELECT status FROM race_sessions WHERE id = ?",
                                (SESSION_ID,),
                            )
                            row = cursor.fetchone()
                            if row:
                                print(
                                    f"[DEBUG] Verificación - Estado en BD: {row['status']}"
                                )
                    except Exception as e:
                        print(f"[DEBUG] Error verificando estado: {e}")
                FIRST_FINISHER = None

                # 🧹 Limpiar los datos basura acumulados por la escucha del
                # decoder (contador de detecciones, última señal, etc.) para que
                # la próxima carrera arranque con lecturas limpias.
                try:
                    from database import reset_transponders_junk_data
                    reset_transponders_junk_data()
                    print("[LIMPIEZA] Datos basura de transponders limpiados tras fin de carrera")
                except Exception as e:
                    print(f"[LIMPIEZA] Error limpiando datos basura: {e}")

            elif command == "pause":
                RACE_ACTIVE = True
                RACE_PAUSED = True
                print("\n⏸️ CARRERA PAUSADA\n")
                add_log("⏸️ CARRERA PAUSADA")

                if TIME_LIMIT_ACTIVE and TIME_LIMIT_END > 0:
                    TIME_LIMIT_REMAINING = max(0, TIME_LIMIT_END - time.time())
                    print(f"⏱️ Tiempo restante guardado: {TIME_LIMIT_REMAINING:.0f}s")
                    add_log(f"⏱️ Tiempo restante guardado: {TIME_LIMIT_REMAINING:.0f}s")
                    try:
                        time_limit_info = {
                            "time_limit_active": True,
                            "time_limit_end": TIME_LIMIT_END,
                            "time_limit_seconds": TIME_LIMIT_REMAINING,
                            "remaining_on_pause": TIME_LIMIT_REMAINING
                        }
                        time_limit_file = os.path.join(BASE_DATA_DIR, "time_limit_info.json")
                        with open(time_limit_file, "w") as f:
                            json.dump(time_limit_info, f)
                    except Exception as e:
                        print(f"[TIME LIMIT] Error guardando estado en pausa: {e}")

                if SESSION_ID:
                    update_race_status(SESSION_ID, "paused")

            elif command == "resume":
                RACE_ACTIVE = True
                RACE_PAUSED = False
                print("\n▶️ CARRERA REANUDADA\n")
                add_log("▶️ CARRERA REANUDADA")

                if TIME_LIMIT_ACTIVE and TIME_LIMIT_REMAINING > 0:
                    TIME_LIMIT_END = time.time() + TIME_LIMIT_REMAINING
                    print(f"⏱️ Tiempo restante restaurado: {TIME_LIMIT_REMAINING:.0f}s")
                    add_log(f"⏱️ Tiempo restante restaurado: {TIME_LIMIT_REMAINING:.0f}s")
                    try:
                        time_limit_info = {
                            "time_limit_active": True,
                            "time_limit_end": TIME_LIMIT_END,
                            "time_limit_seconds": TIME_LIMIT_REMAINING,
                            "remaining_on_pause": 0
                        }
                        time_limit_file = os.path.join(BASE_DATA_DIR, "time_limit_info.json")
                        with open(time_limit_file, "w") as f:
                            json.dump(time_limit_info, f)
                    except Exception as e:
                        print(f"[TIME LIMIT] Error actualizando estado al reanudar: {e}")
                    TIME_LIMIT_REMAINING = 0
                elif TIME_LIMIT_ACTIVE and TIME_LIMIT_END > 0:
                    TIME_LIMIT_REMAINING = max(0, TIME_LIMIT_END - time.time())
                    TIME_LIMIT_END = time.time() + TIME_LIMIT_REMAINING

                if SESSION_ID:
                    update_race_status(SESSION_ID, "active")

            elif command == "reset_usb":
                print("\n🛑 APAGADO SEGURO SOLICITADO\n")
                if SESSION_ID:
                    update_race_status(SESSION_ID, "paused")
                cleanup_serial()
                os._exit(0)

            elif command == "reset_race":
                reset_race_state(preserve_drivers=True)

                print("\n🧹 RESET TOTAL DEL TABLERO - Creando nueva sesión limpia\n")
                if SESSION_ID:
                    update_race_status(SESSION_ID, "completed")

                current = get_current_session() or {}
                event_uuid = current.get("event_uuid")

                # Si la carrera pertenecía a un evento, recrear la sesión
                # CONSERVANDO su configuración (nombre, vueltas, modo) pero con el
                # tablero LIMPIO (0 pilotos). Para volver a correr con los mismos
                # pilotos del evento existe "Repetir carrera"; "Resetear tablero"
                # debe dejar el tablero vacío.
                from database import (
                    normalize_race_mode,
                    get_future_event_by_uuid,
                )
                evento = get_future_event_by_uuid(event_uuid) if event_uuid else None

                if evento:
                    race_name = (
                        evento.get("name")
                        or current.get("circuit_name")
                        or f"Circuito {datetime.now().strftime('%d/%m')}"
                    )
                    laps_limit = (
                        evento.get("laps_limit")
                        or current.get("laps_limit")
                        or LAPS_LIMIT
                        or 10
                    )
                    race_mode = normalize_race_mode(
                        evento.get("race_mode")
                        or current.get("race_mode")
                        or "position"
                    )
                    time_limit_seconds = evento.get("time_limit_seconds") or 0
                    mode_sesion = (
                        evento.get("mode") or current.get("mode") or "rapida"
                    ).strip().lower()

                    SESSION_ID = start_new_session(
                        race_name, laps_limit, race_mode, time_limit_seconds,
                        mode=mode_sesion, event_uuid=event_uuid,
                    )
                    LAPS_LIMIT = laps_limit
                    actualizar_sesion_activa()

                    # Tablero LIMPIO: se conserva la configuración del evento
                    # (nombre, vueltas, modo) pero NO se re-inscriben sus pilotos.
                    # Para volver a correr con los mismos pilotos existe "Repetir carrera".
                    actualizar_pilotos_inscritos()
                    print(
                        f"✅ Nueva sesión desde evento '{race_name}' (ID: {SESSION_ID})"
                        f" - tablero limpio (0 pilotos)"
                    )
                else:
                    SESSION_ID = start_new_session(
                        f"Circuito {datetime.now().strftime('%d/%m')}",
                        LAPS_LIMIT or 10,
                        current.get("race_mode", "position"),
                        0,
                    )
                    LAPS_LIMIT = LAPS_LIMIT or 10
                    actualizar_sesion_activa()
                    actualizar_pilotos_inscritos()
                    print(f"✅ Nueva sesión creada (ID: {SESSION_ID})")
                print("🧹 RESET TOTAL - Limpieza completada sin reinicio")

                # 🧹 Limpiar datos basura de la escucha del decoder y apagar la
                # escucha para que arranque limpio y sin llenar el buffer.
                set_decoder_listening(False)
                try:
                    from database import reset_transponders_junk_data
                    reset_transponders_junk_data()
                    print("[LIMPIEZA] Datos basura de transponders limpiados al resetear el tablero")
                except Exception as e:
                    print(f"[LIMPIEZA] Error limpiando datos basura: {e}")
        return True
    return False


def check_time_limit():
    global TIME_LIMIT_ACTIVE, RACE_ACTIVE, RACE_PAUSED, SESSION_ID, TIME_LIMIT_END, TIME_LIMIT_REMAINING

    if TIME_LIMIT_ACTIVE and RACE_ACTIVE and not RACE_PAUSED and time.time() >= TIME_LIMIT_END:
        print(f"\n⏰ ¡TIEMPO LÍMITE ALCANZADO!\n")
        add_log("⏰ TIEMPO LÍMITE ALCANZADO - Finalizando carrera")
        RACE_ACTIVE = False
        RACE_PAUSED = False
        TIME_LIMIT_ACTIVE = False
        TIME_LIMIT_REMAINING = 0
        # La carrera terminó (modo con tiempo) → apagar la escucha del decoder.
        set_decoder_listening(False)

        try:
            time_limit_info = {
                'time_limit_active': False,
                'time_limit_end': 0,
                'time_limit_seconds': 0,
                'completed': True,
                'remaining_on_pause': 0
            }
            time_limit_file = os.path.join(BASE_DATA_DIR, 'time_limit_info.json')
            with open(time_limit_file, 'w') as f:
                json.dump(time_limit_info, f)
            print(f"[TIME LIMIT] Estado actualizado a completado")
        except Exception as e:
            print(f"[TIME LIMIT] Error actualizando estado: {e}")

        if SESSION_ID:
            from database import get_leaderboard_with_details
            final_leaderboard = get_leaderboard_with_details(SESSION_ID)
            if final_leaderboard and len(final_leaderboard) > 0:
                true_winner = final_leaderboard[0]
                winner_id = true_winner["driver_id"]
                winner_time = true_winner.get("race_total_time")
                update_race_status(SESSION_ID, "completed", winner_id, winner_time)
                print(f"👑 ¡GANADOR OFICIAL: {true_winner['full_name']}!")
                add_log(f"👑 GANADOR OFICIAL: {true_winner['full_name']}")
            else:
                update_race_status(SESSION_ID, "completed")
                print("⚠️ No se pudo determinar el ganador (leaderboard vacío)")
                add_log("⚠️ No se pudo determinar el ganador")

            # Fin por tiempo límite: volcar resultados a PostgreSQL para que el
            # historial del piloto en web-client se alimente.
            finalize_session_and_sync(SESSION_ID)


def restaurar_estado_repetir():
    global         SESSION_ID,         LAPS_LIMIT,         RACE_DRIVERS,         RACE_ACTIVE,         RACE_PAUSED,         FIRST_FINISHER
    estado = cargar_estado_repetir()
    if not estado or estado.get("action") != "repeat_race":
        return False
    print("\n🔄 REPETIR CARRERA - Restaurando pilotos...")
    SESSION_ID = start_new_session(
        estado["circuit_name"],
        estado["laps_limit"],
        estado.get("race_mode", "position"),
        0,
    )
    LAPS_LIMIT = estado["laps_limit"]
    for driver in estado["race_drivers"]:
        add_driver_to_race(SESSION_ID, driver["driver_id"], driver["transponder_id"])
        print(f"   ✅ Restaurado: {driver.get('name', 'Piloto')}")
    RACE_DRIVERS = {d["transponder_id"] for d in estado["race_drivers"]}
    RACE_ACTIVE = False
    RACE_PAUSED = False
    FIRST_FINISHER = None
    return True


def crear_nueva_carrera_al_inicio():
    global SESSION_ID, VUELTA_BASE, LAST_LAP_TIME, LAPS_LIMIT, RACE_DRIVERS, DRIVERS_FINISHED, RACE_ACTIVE, RACE_PAUSED, PRIMERA_VEZ, VUELTA_SALIDA

    PRIMERA_VEZ = {}
    VUELTA_SALIDA = {}
    VUELTA_BASE = {}
    LAST_LAP_TIME = {}
    DRIVERS_FINISHED = set()
    RACE_DRIVERS = set()

    if restaurar_estado_repetir():
        return True

    race_name = None
    laps_limit = LAPS_LIMIT
    race_mode = "position"
    if os.path.exists(NEXT_RACE_NAME_FILE):
        with open(NEXT_RACE_NAME_FILE, "r") as f:
            race_name = f.read().strip()
        os.remove(NEXT_RACE_NAME_FILE)
    if os.path.exists(NEXT_RACE_LAPS_FILE):
        with open(NEXT_RACE_LAPS_FILE, "r") as f:
            laps_limit = int(f.read().strip())
        os.remove(NEXT_RACE_LAPS_FILE)
    if os.path.exists(NEXT_RACE_MODE_FILE):
        with open(NEXT_RACE_MODE_FILE, "r") as f:
            race_mode = f.read().strip() or "position"
        os.remove(NEXT_RACE_MODE_FILE)

    if race_name:
        SESSION_ID = start_new_session(race_name, laps_limit, race_mode, 0)
        VUELTA_BASE = {}
        LAST_LAP_TIME = {}
        LAPS_LIMIT = laps_limit
        RACE_DRIVERS = set()
        DRIVERS_FINISHED = set()
        FIRST_FINISHER = None
        RACE_ACTIVE = False
        RACE_PAUSED = False
        print("\n" + "🏁" * 40)
        print(f"🎬 NUEVA CARRERA: {race_name}")
        print(f"🔄 Vueltas: {laps_limit}")
        print(f"🎯 Modo: {race_mode}")
        print("🏁" * 40 + "\n")
        return True
    return False


def actualizar_pilotos_inscritos():
    global RACE_DRIVERS, SESSION_ID, PRIMERA_VEZ, VUELTA_SALIDA
    PRIMERA_VEZ = {}
    VUELTA_SALIDA = {}

    if SESSION_ID:
        drivers = get_race_drivers(SESSION_ID)
        RACE_DRIVERS = {d["transponder_id"] for d in drivers}
        # Registrar transponders de la sesión para resolver IDs parciales (a20/fr01)
        register_known_transponders(RACE_DRIVERS)
        if drivers:
            print(f"\n📋 Pilotos inscritos: {len(drivers)}")
            for d in drivers:
                nombre = f"{d['name']} {d.get('lastname', '')}".strip()
                print(f"   🏎️  {nombre} (Transponder: {d['transponder_id']})")
    return RACE_DRIVERS


def actualizar_sesion_activa():
    global         SESSION_ID,         VUELTA_BASE,         LAST_LAP_TIME,         LAPS_LIMIT,         DRIVERS_FINISHED,         RACE_ACTIVE,         RACE_PAUSED
    session = get_current_session()
    if session:
        if SESSION_ID != session["id"]:
            SESSION_ID = session["id"]
            VUELTA_BASE = {}
            LAST_LAP_TIME = {}
            LAPS_LIMIT = session.get("laps_limit", 10)
            DRIVERS_FINISHED = set()
            RACE_ACTIVE = session.get("status") in ["active", "paused"]
            RACE_PAUSED = session.get("status") == "paused"
            actualizar_pilotos_inscritos()
            print(f"\n📋 Sesión: {session['circuit_name']} | {LAPS_LIMIT} vueltas")
            print(f"📊 Estado: {'EN CURSO' if RACE_ACTIVE else 'PENDIENTE'}")
        return True
    return False


def procesar_cadena_esl400(raw_data):
    global VUELTA_BASE, LAST_LAP_TIME, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS
    global DRIVERS_FINISHED, RACE_ACTIVE, RACE_PAUSED, FIRST_FINISHER
    global PRIMERA_VEZ, VUELTA_SALIDA, VUELTAS_CARRERA, PRIMER_TIEMPO_SERVIDOR, CONTADOR_VUELTAS_INTERNO

    if "_DETECTION_THROTTLE" not in globals():
        global _DETECTION_THROTTLE
        _DETECTION_THROTTLE = {}

    try:
        data = raw_data.replace("$", "").strip()
        if len(data) < 10:
            return None

        # ===== DETERMINAR FORMATO =====
        formato_con_coma = "," in data
        if formato_con_coma:
            parts = data.split(",")
            if len(parts) >= 4:
                transponder_id_hex = parts[0].strip()
                transponder_id = int(transponder_id_hex, 16)
                physical_laps = int(parts[2].strip())
                signal_hex = parts[3].strip()
                val_h = int(signal_hex[0:2], 16) if len(signal_hex) >= 2 else 60
                val_l = int(signal_hex[2:4], 16) if len(signal_hex) >= 4 else 0
                nro_vueltas_raw = physical_laps
                milisegundos_raw = 0
            else:
                return None
        else:
            if len(data) < 20:
                return None
            transponder_id = int(data[4:8], 16)
            milisegundos_raw = int(data[8:16], 16)
            val_h = int(data[16:18], 16)
            val_l = int(data[18:20], 16)
            vueltas_hex = data[-8:-4]
            nro_vueltas_raw = int(vueltas_hex, 16)

        # ===== CONFIGURACIÓN DE FUENTE DE TIEMPO =====
        if "CONFIG_CACHE" not in globals():
            global CONFIG_CACHE
            from database import get_timing_config, get_antenna_config, get_cache_refresh_seconds
            CONFIG_CACHE = {
                "timing": get_timing_config(),
                "antenna": get_antenna_config(),
                "decoder_mode": get_decoder_mode(),
                "refresh_seconds": get_cache_refresh_seconds(),
                "last_update": 0
            }

        ahora_config = time.time()
        if ahora_config - CONFIG_CACHE.get("last_update", 0) > CONFIG_CACHE.get("refresh_seconds", 5):
            from database import get_timing_config, get_antenna_config, get_cache_refresh_seconds
            CONFIG_CACHE["timing"] = get_timing_config()
            CONFIG_CACHE["antenna"] = get_antenna_config()
            CONFIG_CACHE["decoder_mode"] = get_decoder_mode()
            CONFIG_CACHE["refresh_seconds"] = get_cache_refresh_seconds()
            CONFIG_CACHE["last_update"] = ahora_config

        config_tiempo = CONFIG_CACHE["timing"]
        time_source = config_tiempo.get("time_source", "server")
        min_lap_time = config_tiempo.get("min_valid_lap_time", 5.0)

        config = CONFIG_CACHE["antenna"]
        umbral_minimo = config.get("min_signal", 60)
        modo_actual = CONFIG_CACHE["decoder_mode"]

        # ===== FILTRO DE SEÑAL (aplica a TODOS los modos) =====
        # Antes solo se filtraba en modo chronit y en los demás se forzaba
        # val_h = 160, lo que dejaba pasar ruido/señales débiles.
        if val_h < umbral_minimo:
            print(f"   🔇 Señal débil ({val_h} < {umbral_minimo}) - IGNORADA para transponder {transponder_id}")
            add_log(f"[FILTRADO] Señal débil: {val_h} < {umbral_minimo} | Transponder: {transponder_id}")
            return None

        # Re-calcular después del filtro de señal
        if not formato_con_coma:
            val_l = int(data[18:20], 16)
            vueltas_hex = data[-8:-4]
            nro_vueltas_raw = int(vueltas_hex, 16)
        else:
            val_l = 0
            if RACE_ACTIVE:
                if not isinstance(CONTADOR_VUELTAS_INTERNO, dict):
                    CONTADOR_VUELTAS_INTERNO = {}
                if transponder_id not in CONTADOR_VUELTAS_INTERNO:
                    CONTADOR_VUELTAS_INTERNO[transponder_id] = 0
                CONTADOR_VUELTAS_INTERNO[transponder_id] += 1
                nro_vueltas_raw = CONTADOR_VUELTAS_INTERNO[transponder_id]

        # ===== CALIDAD DE SEÑAL =====
        if modo_actual == "chronit":
            if val_h > 150:
                calidad = "🟢 EXCELENTE"
            elif val_h > 100:
                calidad = "🟡 MUY BUENA"
            elif val_h > 60:
                calidad = "🟠 REGULAR"
            else:
                calidad = "🔴 DEBIL"
        else:
            calidad = "🟢 EXCELENTE"

        # ===== SI NO HAY CARRERA ACTIVA: DETECCIÓN LIGERA SIN EFECTOS LATERALES =====
        if not RACE_ACTIVE:
            ahora = time.time()
            throttled = (ahora - _DETECTION_THROTTLE.get(transponder_id, 0)) < 60.0
            if not throttled:
                _DETECTION_THROTTLE[transponder_id] = ahora
                es_nuevo = add_transponder_detected(
                    transponder_id, val_h, val_l, "--", nro_vueltas_raw
                )
                if es_nuevo:
                    print(f"\n🔔 NUEVO TRANSPONDER DETECTADO: {transponder_id}")
                    add_log(f"[DETECCIÓN] Nuevo transponder: {transponder_id} (Sin carrera)")
            print(f"\n🏁 ¡DETECCIÓN! ({calidad}) - Sin carrera activa")
            print(f"🆔 ID Transponder: {transponder_id}")
            print(f"📡 Señal -> H: {val_h} | L: {val_l}")
            print(f"⏳ Esperando inicio de carrera...")
            return None

        if RACE_PAUSED:
            print(f"\n🏁 ¡DETECCIÓN! ({calidad}) - Carrera pausada")
            print(f"🆔 ID Transponder: {transponder_id}")
            print(f"⏸️ Reanudar para continuar...")
            return None

        # ===== A PARTIR DE AQUÍ: CARRERA ACTIVA - PROCESAMIENTO COMPLETO =====
        momento_deteccion = time.time()

        if time_source == "decoder":
            tiempo_total_segundos = milisegundos_raw / 1000.0
            origen_tiempo = "DECODER"
        else:
            if transponder_id not in PRIMER_TIEMPO_SERVIDOR:
                PRIMER_TIEMPO_SERVIDOR[transponder_id] = momento_deteccion
            tiempo_total_segundos = (
                momento_deteccion - PRIMER_TIEMPO_SERVIDOR[transponder_id]
            )
            origen_tiempo = "SERVIDOR"

            if time_source == "server" and transponder_id in LAST_LAP_TIME:
                tiempo_ultima_vuelta = LAST_LAP_TIME.get(transponder_id, 0)
                if tiempo_ultima_vuelta > 0:
                    lap_candidate = tiempo_total_segundos - tiempo_ultima_vuelta
                    if lap_candidate < min_lap_time and lap_candidate > 0:
                        print(f"   🔇 Señal fantasma ({lap_candidate:.2f}s < {min_lap_time}s) - IGNORADA para transponder {transponder_id}")
                        add_log(f"[FILTRADO] Fantasma: {lap_candidate:.2f}s < {min_lap_time}s | Transponder: {transponder_id}")
                        return None

        # ===== PROTECCIÓN: reinicio/wrap del contador físico del decoder =====
        # El contador físico puede reiniciarse o hacer wrap (ej. 255→0). Antes,
        # si el valor bajaba, la vuelta se ignoraba y Ese kart dejaba de contar
        # para siempre. Mantenemos un offset acumulado por transponder para que
        # el conteo efectivo siga siendo creciente.
        if "_RAW_LAP_OFFSET" not in globals():
            global _RAW_LAP_OFFSET
            _RAW_LAP_OFFSET = {}
        prev_raw_info = _RAW_LAP_OFFSET.get(transponder_id)
        if prev_raw_info is not None:
            prev_raw = prev_raw_info.get("last_raw", nro_vueltas_raw)
            offset = prev_raw_info.get("offset", 0)
            if nro_vueltas_raw < prev_raw:
                # Reinicio/wrap detectado: sumamos el rango (256, contador 8-bit).
                offset += 256
            _RAW_LAP_OFFSET[transponder_id] = {
                "last_raw": nro_vueltas_raw, "offset": offset
            }
        else:
            _RAW_LAP_OFFSET[transponder_id] = {
                "last_raw": nro_vueltas_raw, "offset": 0
            }
        nro_vueltas_raw = nro_vueltas_raw + _RAW_LAP_OFFSET[transponder_id]["offset"]

        # Llamar al motor unificado (dedup 3-5s + procesamiento completo de vuelta)
        return process_lap_event(
            transponder_id=transponder_id,
            source="decoder",
            nro_vueltas_raw=nro_vueltas_raw,
            tiempo_total_segundos=tiempo_total_segundos,
            val_h=val_h,
            val_l=val_l,
            origen_tiempo=origen_tiempo,
        )
    except Exception as e:
        print(f"Error procesando: {e}")
        return None


def listen_chronit():
    global serial_port_global
    global ULTIMA_ACTIVIDAD, ALERTA_MOSTRADA, SESSION_ID, LAPS_LIMIT, RACE_DRIVERS, RACE_ACTIVE, RACE_PAUSED

    print("\n" + "=" * 50)
    print("🛡️ SISTEMA ESL-400 | v9.1 - CONTROL DE CARRERA")
    print("=" * 50)

    try:
        if os.path.exists(RESTART_FLAG_FILE):
            os.remove(RESTART_FLAG_FILE)
            print("[INICIO] restart.flag eliminado")
        if os.path.exists(SHUTDOWN_FLAG_FILE):
            os.remove(SHUTDOWN_FLAG_FILE)
            print("[INICIO] shutdown.flag eliminado")
    except Exception as e:
        print(f"[INICIO] Error limpiando flags: {e}")

    try:
        print(">>> Inicializando base de datos...")
        init_db()
        print(">>> Base de datos OK")
    except Exception as e:
        print(f"❌ Error en base de datos: {e}")
        print(">>> Reintentando en 5 segundos...")
        time.sleep(5)
        init_db()
        print(">>> Base de datos OK tras reintento")

    print(">>> Esperando transponders...\n")

    init_db()
    crear_nueva_carrera_al_inicio()

    if not get_current_session():
        nombre_defecto = f"Circuito {datetime.now().strftime('%d/%m')}"
        SESSION_ID = start_new_session(nombre_defecto, LAPS_LIMIT, "position", 0)
        print(f"📋 Nueva sesión: {nombre_defecto} ({LAPS_LIMIT} vueltas)")
    else:
        actualizar_sesion_activa()

    actualizar_pilotos_inscritos()

    repair_permissions(PORT)

    # ===== BUFFER ROBUSTO ANTI-SATURACIÓN =====
    buffer_serial = ""
    reconectar = False

    # Inicializar cache de configuraciones
    if "CONFIG_CACHE" not in globals():
        global CONFIG_CACHE
        from database import get_timing_config, get_antenna_config, get_cache_refresh_seconds
        CONFIG_CACHE = {
            "timing": get_timing_config(),
            "antenna": get_antenna_config(),
            "decoder_mode": get_decoder_mode(),
            "refresh_seconds": get_cache_refresh_seconds(),
            "last_update": 0
        }

    primera_vez_hardware = True

    # ===== BUCLE PRINCIPAL =====
    while True:
        # ===== MODO SIMULACIÓN =====
        if is_simulation_mode():
            print("🎮 [SIMULACIÓN] Modo simulación ACTIVADO")
            print("   Generando vueltas automáticas...")
            
            # ✅ NUEVO: Reiniciar estado al entrar a simulación
            if not hasattr(listen_chronit, "_simulation_active"):
                reset_race_state(preserve_drivers=True)
                listen_chronit._simulation_active = True
                print("🔄 Estado reiniciado para modo simulación")

            while is_simulation_mode():
                check_restart_flag()
                check_race_commands()
                check_time_limit()
                periodic_state_cleanup()
                process_manual_lap_queue()

                if RACE_ACTIVE and not RACE_PAUSED and SESSION_ID:
                    race_drivers = get_race_drivers(SESSION_ID)
                    if race_drivers:
                        generar_vuelta_simulada()
                    time.sleep(get_simulation_speed())
                else:
                    time.sleep(1)

            print("🎮 [SIMULACIÓN] Modo simulación DESACTIVADO - Cambiando a modo hardware")
            
            # ✅ NUEVO: Reiniciar estado al salir de simulación
            if hasattr(listen_chronit, "_simulation_active") and listen_chronit._simulation_active:
                reset_race_state(preserve_drivers=True)
                listen_chronit._simulation_active = False
                print("🔄 Estado reiniciado al salir de simulación")
                reconectar = True  # Forzar reconexión al hardware
            
            primera_vez_hardware = True
            continue

        # ===== MODO HARDWARE REAL =====
        if primera_vez_hardware:
            print("🔧 [HARDWARE] Modo hardware real ACTIVADO")
            print("   Esperando conexión del decoder ESL-400...")
            primera_vez_hardware = False

        contador_busqueda = 0
        while not is_simulation_mode():
            if not os.path.exists(PORT):
                contador_busqueda += 1
                if contador_busqueda == 1:
                    print(f"🔍 Hardware no encontrado en {PORT} - esperando...")
                elif contador_busqueda % 60 == 0:
                    print(f"🔍 Aún esperando hardware en {PORT}...")
                # Aunque no haya hardware, los comandos de carrera (finish,
                # reset_race, start, reload_session…) deben procesarse. Si no,
                # quedan atascados en race_command.txt y la sesión se queda en
                # 'active' sin poder resetearla.
                check_race_commands()
                check_restart_flag()
                # El contador manual también debe funcionar sin decoder: si no
                # se procesa la cola aquí, las vueltas marcadas a mano se
                # acumulan en manual_lap_queue.jsonl sin contarse nunca.
                process_manual_lap_queue()
                time.sleep(1)
                continue
            contador_busqueda = 0

            try:
                with serial.Serial(PORT, BAUD, timeout=1.0) as ser:
                    serial_port_global = ser
                    if reconectar or not hasattr(listen_chronit, "conectado_msg"):
                        print(f"✅ Puerto {PORT} conectado. Vigilando pista...\n")
                        if not RACE_ACTIVE:
                            print("⏳ Carrera pendiente. Presiona 'INICIAR CARRERA' para comenzar.\n")
                        listen_chronit.conectado_msg = True
                        reconectar = False
                        listen_chronit._hw_aviso = False

                        ser.flush()

                        # Forzar modo del decoder al conectar
                        modo_actual = get_decoder_mode()
                        comando_modo = f"MODE {modo_actual.upper()}\r\n".encode()
                        ser.write(comando_modo)
                        ser.flush()
                        time.sleep(0.3)
                        print(f"[DECODER] Comando MODE {modo_actual.upper()} enviado")

                        activar_decoder(ser)
                        ser.flush()
                        ULTIMA_ACTIVIDAD = time.time()

                    while not is_simulation_mode():
                        # Prioridad: revisar comandos ANTES de leer el puerto
                        check_restart_flag()
                        check_race_commands()
                        check_time_limit()
                        periodic_state_cleanup()

                        # Actualizar cache de configuraciones.
                        # NOTA: no se consulta la BD en cada iteración del bucle
                        # (antes se hacía y saturaba SQLite). El valor de refresco
                        # se lee de la BD solo cuando toca renovar el cache.
                        ahora_modo = time.time()
                        if ahora_modo - CONFIG_CACHE.get("last_update", 0) > CONFIG_CACHE.get("refresh_seconds", 5):
                            from database import get_decoder_mode as get_db_mode, get_cache_refresh_seconds
                            nuevo_modo = get_db_mode()
                            if nuevo_modo != CONFIG_CACHE["decoder_mode"]:
                                CONFIG_CACHE["decoder_mode"] = nuevo_modo
                                set_decoder_mode(nuevo_modo)
                                print(f"[DECODER] Modo actualizado: {nuevo_modo}")
                            CONFIG_CACHE["antenna"] = get_antenna_config()
                            CONFIG_CACHE["timing"] = get_timing_config()
                            CONFIG_CACHE["refresh_seconds"] = get_cache_refresh_seconds()
                            CONFIG_CACHE["last_update"] = ahora_modo

                        # ===== LECTURA SERIAL ROBUSTA =====
                        bytes_leidos = b''

                        # 🎛️ CONTROL DE ESCUCHA: solo leer del puerto si la
                        # escucha está activa O hay una carrera en curso.
                        # En carrera la escucha NUNCA puede desactivarse, por eso
                        # RACE_ACTIVE fuerza la lectura aunque esté apagada.
                        # Fuera de carrera se apaga sola a los 3 min si se activó
                        # manualmente, para no llenar el buffer.
                        _auto_off_decoder_when_idle()
                        escucha_on = get_decoder_listening() or RACE_ACTIVE
                        if escucha_on and ser.in_waiting > 0:
                            # Leer todo lo disponible SIN bloquear
                            bytes_leidos = ser.read(ser.in_waiting)
                            ULTIMA_ACTIVIDAD = time.time()
                            ALERTA_MOSTRADA = False

                        # ===== PROCESAR DATOS (solo si hay algo) =====
                        if bytes_leidos:
                            try:
                                texto = bytes_leidos.decode("utf-8", errors="ignore")
                                buffer_serial += texto

                                # ✅ ANTI-SATURACIÓN: Limitar tamaño del buffer
                                if len(buffer_serial) > 4096:
                                    ultimo_salto = max(buffer_serial.rfind('\n'), buffer_serial.rfind('\r'))
                                    if ultimo_salto != -1:
                                        buffer_serial = buffer_serial[ultimo_salto + 1:]
                                    else:
                                        buffer_serial = ""
                                    # ✅ Solo mostrar el mensaje cada 20 limpiezas
                                    if not hasattr(procesar_cadena_esl400, "_contador_limpieza"):
                                        procesar_cadena_esl400._contador_limpieza = 0
                                    procesar_cadena_esl400._contador_limpieza += 1
                                    if procesar_cadena_esl400._contador_limpieza % 20 == 0:
                                        print(f"[BUFFER] Limpieza anti-saturación #{procesar_cadena_esl400._contador_limpieza}")

                                # Separar líneas completas
                                lineas = buffer_serial.splitlines()

                                # Si la última línea no terminó con delimitador, guardarla para la próxima
                                if buffer_serial and not buffer_serial.endswith(('\n', '\r')):
                                    buffer_serial = lineas[-1] if lineas else ""
                                    lineas = lineas[:-1]
                                else:
                                    buffer_serial = ""

                                # ✅ ANTI-SATURACIÓN: Procesar máximo 20 líneas por ciclo
                                lineas_procesadas = 0
                                for linea_idx, linea in enumerate(lineas):
                                    linea = linea.strip()
                                    if not linea:
                                        continue

                                    # Ignorar líneas de control del decoder
                                    if linea in ("@START", "START", "@", "#") or linea.startswith("#"):
                                        continue

                                    ahora = time.time()
                                    # Usar el cache en memoria: antes se consultaba
                                    # la BD por CADA línea recibida del decoder, lo
                                    # que con >10 karts saturaba SQLite.
                                    config_antena = CONFIG_CACHE.get("antenna") or {"filter_time": 0.5}
                                    tiempo_filtro = config_antena.get("filter_time", 0.5)

                                    # Usar el cache en memoria: antes se llamaba
                                    # get_decoder_mode() por CADA línea y esa función
                                    # abre una conexión SQLite + SELECT, lo que con
                                    # >10 karts saturaba el bucle y congelaba también
                                    # el contador manual. El cache se refresca en el
                                    # bucle externo cada refresh_seconds.
                                    modo_actual = CONFIG_CACHE.get("decoder_mode", "chronit")

                                    # ===== VERIFICAR / AUTO-DETECTAR MODO =====
                                    # Solo se autocorrige con firmas inequívocas
                                    # (@ = a20, <...>/DEPART = fr01). El prefijo '$'
                                    # es ambiguo (chronit o a120), por lo que NUNCA
                                    # se cambia el modo automáticamente en ese caso.
                                    modo_detectado = detect_mode_from_line(linea)
                                    if modo_detectado in ("a20", "fr01") and modo_detectado != modo_actual:
                                        set_decoder_mode(modo_detectado)
                                        try:
                                            from database import update_decoder_mode
                                            update_decoder_mode(modo_detectado)
                                        except Exception:
                                            pass
                                        if "CONFIG_CACHE" in globals():
                                            CONFIG_CACHE["decoder_mode"] = modo_detectado
                                        add_log(f"[DECODER] Modo auto-detectado: {modo_detectado}")
                                        print(f"[DECODER] 🔎 Modo auto-detectado: {modo_detectado} (antes {modo_actual})")
                                        modo_actual = modo_detectado

                                    # ===== FILTRO ANTI-REPETICIÓN POR TRANSPONDER =====
                                    # La clave es el ID de cada kart, así una repetición
                                    # del mismo kart se filtra sin afectar a otro kart
                                    # que cruce casi al mismo tiempo.
                                    if modo_actual == "chronit":
                                        if linea.startswith("$") and not ("," in linea):
                                            clave = _line_identity(linea)
                                            if (ahora - _ULTIMA_DETECCION.get(clave, 0)) > tiempo_filtro:
                                                _ULTIMA_DETECCION[clave] = ahora
                                                procesar_cadena_esl400(linea)
                                    else:
                                        datos_legacy = translate_to_chronit_format(linea)
                                        if datos_legacy is not None:
                                            transponder_id, time_str, physical_laps, val_h, val_l = datos_legacy
                                            linea_fake = f"${transponder_id:04X},{time_str},{physical_laps},{val_h:02X}{val_l:02X}"
                                            clave = _line_identity(linea_fake)
                                            if (ahora - _ULTIMA_DETECCION.get(clave, 0)) > tiempo_filtro:
                                                _ULTIMA_DETECCION[clave] = ahora
                                                procesar_cadena_esl400(linea_fake)

                                    lineas_procesadas += 1
                                    if lineas_procesadas >= 20:
                                        # Dejar el resto para la siguiente iteración.
                                        # Se usa el índice REAL de la línea (no el contador),
                                        # porque las líneas vacías/de control no lo incrementan.
                                        resto = lineas[linea_idx + 1:]
                                        if resto:
                                            buffer_serial = "\n".join(resto) + "\n" + buffer_serial
                                        break

                            except Exception as e:
                                print(f"❌ [SERIAL] Error procesando datos: {e}")
                                add_log(f"[SERIAL ERROR] {e} | Bytes: {repr(bytes_leidos[:50])}")
                                buffer_serial = ""

                        # Pequeña pausa para no saturar CPU
                        time.sleep(0.01)

                        # ===== PROCESAR COLAS DE VUELTAS MANUALES =====
                        process_manual_lap_queue()

                        # Verificar inactividad prolongada
                        if time.time() - ULTIMA_ACTIVIDAD > 300 and not ALERTA_MOSTRADA:
                            print("\n⚠️ 5 minutos sin detecciones - el decoder podría estar apagado o sin transponders")
                            ALERTA_MOSTRADA = True

                        # Si se activa el modo simulación, salimos del bucle hardware
                        if is_simulation_mode():
                            print("🎮 [SIMULACIÓN] Modo simulación ACTIVADO - Cambiando a modo simulación")
                            break

            except Exception as e:
                msg = str(e)
                es_falta_hw = (
                    isinstance(e, (OSError, serial.SerialException))
                    and (
                        "could not open port" in msg
                        or "No such device" in msg
                        or "No such file" in msg
                        or "Input/output error" in msg
                        or "No device or address" in msg
                    )
                )
                if es_falta_hw:
                    # El nodo del puerto existe pero NO hay receptor ESL-400 real
                    # conectado (p.ej. /dev/ttyUSB0 huérfano sin dispositivo físico).
                    # No spamear errores: esperar en silencio como "hardware no
                    # disponible", igual que cuando el puerto no existe.
                    if not getattr(listen_chronit, "_hw_aviso", False):
                        print(f"🔍 Hardware (ESL-400) no disponible en {PORT} - esperando receptor...")
                        listen_chronit._hw_aviso = True
                    # Igual que en la rama de puerto inexistente: procesar los
                    # comandos de carrera aunque falte el hardware para que el
                    # reset/finish/start no queden atascados en el archivo.
                    check_race_commands()
                    check_restart_flag()
                    # Sin decoder el cronometraje manual debe seguir funcionando.
                    process_manual_lap_queue()
                    time.sleep(5)
                    continue
                print(f"📡 Error: {e}. Reintentando en 5 segundos...")
                # Antes de reintentar, no perder las vueltas manuales encoladas.
                check_race_commands()
                process_manual_lap_queue()
                time.sleep(5)
                reconectar = True
                listen_chronit._hw_aviso = False
                if is_simulation_mode():
                    break

        # Reiniciar bucle principal si no hay simulación
        if not is_simulation_mode():
            time.sleep(2)
            continue


def start_api():
    try:
        from api import start_api_server
        start_api_server()
    except Exception as e:
        print(f"⚠️ API no iniciada: {e}")


def cargar_modo_decoder():
    from database import get_decoder_mode
    modo = get_decoder_mode()
    set_decoder_mode(modo)
    print(f"[DECODER] Modo cargado: {modo}")






cargar_modo_decoder()

if __name__ == "__main__":
    try:
        api_thread = threading.Thread(target=start_api, daemon=True)
        api_thread.start()
        time.sleep(1)
        listen_chronit()
    except KeyboardInterrupt:
        print("\n🛑 Sistema detenido.")




