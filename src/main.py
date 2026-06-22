import serial
import time
import os
import subprocess
import threading
import platform
import json
import sqlite3
from datetime import datetime
from collections import deque

# ===== NUEVO: Módulo de traducción de modos del decoder =====
from decoder_modes import (
    translate_to_chronit_format,
    set_decoder_mode,
    get_decoder_mode,
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


def add_log(message):
    with log_lock:
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_line = f"[{timestamp}] {message}"
        log_buffer.append(log_line)
        try:
            with open(LOG_BUFFER_FILE, "a") as f:
                f.write(log_line + "\n")
        except Exception as e:
            print(f"[LOGS] Error escribiendo archivo: {e}")


def get_logs(limit=100):
    with log_lock:
        return list(log_buffer)[-limit:]


def clear_logs():
    with log_lock:
        log_buffer.clear()
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
    print(f"\n[LIMPIANDO] Señal {sig} recibida, liberando recursos...")
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
    add_transponder_detected,
    get_race_drivers,
    add_driver_to_race,
    cargar_estado_repetir,
    update_race_status,
    get_antenna_config,
    update_driver_finish_time,
)

if IS_WINDOWS:
    PORT = os.getenv("SERIAL_PORT", "COM3")
else:
    PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")

BAUD = 9600

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


def activar_decoder():
    try:
        if not is_simulation_mode():
            import serial

            with serial.Serial(PORT, BAUD, timeout=1) as ser:
                ser.write(b"START\r\n")
                ser.flush()
                time.sleep(0.5)
                print("[DECODER] ✅ Comando START enviado")
                add_log("[DECODER] Comando START enviado - Transmisión activada")
    except Exception as e:
        print(f"[DECODER] ⚠️ No se pudo enviar START: {e}")
        add_log(f"[DECODER] ⚠️ No se pudo enviar START: {e}")


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

    driver = random.choice(race_drivers)
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

    # Solo verificar finalización por vueltas si LAPS_LIMIT > 0 (Position Race y Time Attack)
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

    print("-" * 50)
    add_log("-" * 50)


def repair_permissions(port):
    if IS_WINDOWS:
        return True
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


def check_restart_flag():
    if os.path.exists(RESTART_FLAG_FILE):
        print("\n[SISTEMA] restart.flag detectado; limpiando bandera residual.")
        try:
            os.remove(RESTART_FLAG_FILE)
        except OSError:
            pass
    return False


def check_race_commands():
    global \
        RACE_ACTIVE, \
        RACE_PAUSED, \
        DRIVERS_FINISHED, \
        VUELTA_BASE, \
        LAST_LAP_TIME, \
        SESSION_ID
    global \
        FIRST_FINISHER, \
        VUELTAS_CARRERA, \
        PRIMERA_VEZ, \
        VUELTA_SALIDA, \
        LAPS_LIMIT, \
        TIME_LIMIT_ACTIVE, \
        TIME_LIMIT_END

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

                RACE_ACTIVE = False
                RACE_PAUSED = False
                DRIVERS_FINISHED = set()
                VUELTA_BASE = {}
                LAST_LAP_TIME = {}
                VUELTAS_CARRERA = {}
                PRIMERA_VEZ = {}
                VUELTA_SALIDA = {}
                FIRST_FINISHER = None

                race_mode = comando.get("race_mode", "position")
                laps_limit = comando["laps_limit"]

                if race_mode in ("endurance", "classification"):
                    laps_limit = 0
                    print(f"   🔄 Modo {race_mode.upper()} - Sin límite de vueltas")
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
                RACE_ACTIVE = False
                RACE_PAUSED = False
                DRIVERS_FINISHED = set()
                VUELTA_BASE = {}
                LAST_LAP_TIME = {}
                VUELTAS_CARRERA = {}
                PRIMERA_VEZ = {}
                VUELTA_SALIDA = {}
                FIRST_FINISHER = None
                TIME_LIMIT_ACTIVE = False
                TIME_LIMIT_END = 0

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
                RACE_ACTIVE = False
                RACE_PAUSED = False
                DRIVERS_FINISHED = set()
                VUELTA_BASE = {}
                LAST_LAP_TIME = {}
                VUELTAS_CARRERA = {}
                PRIMERA_VEZ = {}
                VUELTA_SALIDA = {}
                FIRST_FINISHER = None
                SESSION_ID = start_new_session("Circuito Principal", 10, "position", 0)
                LAPS_LIMIT = 10
                actualizar_sesion_activa()
                actualizar_pilotos_inscritos()
                print(f"✅ Sistema reiniciado desde cero con respaldo")
                return True

        except json.JSONDecodeError:
            command = content
            print(f"[COMANDO] Recibido: {command}")

            if command == "start":
                print(
                    f"\n🔥 [DEBUG] Comando START recibido. RACE_ACTIVE antes: {RACE_ACTIVE}"
                )
                RACE_ACTIVE = True
                RACE_PAUSED = False
                print(f"🔥 [DEBUG] RACE_ACTIVE después: {RACE_ACTIVE}")
                DRIVERS_FINISHED = set()
                VUELTA_BASE = {}
                LAST_LAP_TIME = {}
                FIRST_FINISHER = None

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
                                TIME_LIMIT_END = time.time() + tls
                                print(f"⏱️ {race_mode.upper()} activo: {tls}s restantes")
                                add_log(f"⏱️ {race_mode.upper()} activada: {tls}s")
                                try:
                                    time_limit_info = {
                                        "time_limit_active": True,
                                        "time_limit_end": TIME_LIMIT_END,
                                        "time_limit_seconds": tls,
                                    }
                                    time_limit_file = os.path.join(
                                        BASE_DATA_DIR, "time_limit_info.json"
                                    )
                                    with open(time_limit_file, "w") as f:
                                        json.dump(time_limit_info, f)
                                    print(
                                        f"[TIME LIMIT] Estado guardado en {time_limit_file}"
                                    )
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

            elif command == "pause":
                RACE_ACTIVE = True
                RACE_PAUSED = True
                print("\n⏸️ CARRERA PAUSADA\n")
                add_log("⏸️ CARRERA PAUSADA")
                if SESSION_ID:
                    update_race_status(SESSION_ID, "paused")

            elif command == "resume":
                RACE_ACTIVE = True
                RACE_PAUSED = False
                print("\n▶️ CARRERA REANUDADA\n")
                add_log("▶️ CARRERA REANUDADA")
                if SESSION_ID:
                    update_race_status(SESSION_ID, "active")

            elif command == "reset_usb":
                print("\n🛑 APAGADO SEGURO SOLICITADO\n")
                if SESSION_ID:
                    update_race_status(SESSION_ID, "paused")
                cleanup_serial()
                os._exit(0)

            elif command == "reset_race":
                RACE_ACTIVE = False
                RACE_PAUSED = False
                DRIVERS_FINISHED = set()
                VUELTA_BASE = {}
                LAST_LAP_TIME = {}
                VUELTAS_CARRERA = {}
                PRIMERA_VEZ = {}
                VUELTA_SALIDA = {}
                FIRST_FINISHER = None
                TIME_LIMIT_ACTIVE = False
                TIME_LIMIT_END = 0
                try:
                    time_limit_file = os.path.join(
                        BASE_DATA_DIR, "time_limit_info.json"
                    )
                    if os.path.exists(time_limit_file):
                        os.remove(time_limit_file)
                        print(
                            "[TIME LIMIT] Archivo de estado eliminado al resetear carrera"
                        )
                except Exception as e:
                    print(f"[TIME LIMIT] Error eliminando archivo: {e}")

                print("\n🧹 RESET TOTAL DEL TABLERO - Creando nueva sesión limpia\n")
                if SESSION_ID:
                    update_race_status(SESSION_ID, "completed")
                current = get_current_session() or {}
                SESSION_ID = start_new_session(
                    f"Circuito {datetime.now().strftime('%d/%m')}",
                    LAPS_LIMIT,
                    current.get("race_mode", "position"),
                    0,
                )
                actualizar_sesion_activa()
                print(f"✅ Nueva sesión creada (ID: {SESSION_ID})")
                print("🧹 RESET TOTAL - Limpieza completada sin reinicio")
        return True
    return False


def check_time_limit():
    global TIME_LIMIT_ACTIVE, RACE_ACTIVE, SESSION_ID, TIME_LIMIT_END
    if TIME_LIMIT_ACTIVE and RACE_ACTIVE and time.time() >= TIME_LIMIT_END:
        print(f"\n⏰ ¡TIEMPO LÍMITE ALCANZADO!\n")
        add_log("⏰ TIEMPO LÍMITE ALCANZADO - Finalizando carrera")
        RACE_ACTIVE = False
        RACE_PAUSED = False
        TIME_LIMIT_ACTIVE = False

        try:
            time_limit_info = {
                'time_limit_active': False,
                'time_limit_end': 0,
                'time_limit_seconds': 0,
                'completed': True
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
                # ✅ CORREGIDO: Eliminada variable race_mode no usada
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


def restaurar_estado_repetir():
    global \
        SESSION_ID, \
        LAPS_LIMIT, \
        RACE_DRIVERS, \
        RACE_ACTIVE, \
        RACE_PAUSED, \
        FIRST_FINISHER
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
    global \
        SESSION_ID, \
        VUELTA_BASE, \
        LAST_LAP_TIME, \
        LAPS_LIMIT, \
        RACE_DRIVERS, \
        DRIVERS_FINISHED, \
        RACE_ACTIVE, \
        RACE_PAUSED, \
        PRIMERA_VEZ, \
        VUELTA_SALIDA

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
        if drivers:
            print(f"\n📋 Pilotos inscritos: {len(drivers)}")
            for d in drivers:
                nombre = f"{d['name']} {d.get('lastname', '')}".strip()
                print(f"   🏎️  {nombre} (Transponder: {d['transponder_id']})")
    return RACE_DRIVERS


def actualizar_sesion_activa():
    global \
        SESSION_ID, \
        VUELTA_BASE, \
        LAST_LAP_TIME, \
        LAPS_LIMIT, \
        DRIVERS_FINISHED, \
        RACE_ACTIVE, \
        RACE_PAUSED
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
    global PRIMERA_VEZ, VUELTA_SALIDA, VUELTAS_CARRERA

    try:
        data = raw_data.replace("$", "").strip()
        if len(data) < 10:
            return None

        # ===== DETERMINAR FORMATO =====
        if "," in data:
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
        from database import get_timing_config

        config_tiempo = get_timing_config()
        time_source = config_tiempo.get("time_source", "server")
        min_lap_time = config_tiempo.get("min_valid_lap_time", 5.0)

        if "PRIMER_TIEMPO_SERVIDOR" not in globals():
            global PRIMER_TIEMPO_SERVIDOR
            PRIMER_TIEMPO_SERVIDOR = {}

        config = get_antenna_config()
        umbral_minimo = config.get("min_signal", 60)
        modo_actual = get_decoder_mode()

        # ===== FILTRO DE SEÑAL =====
        if modo_actual == "chronit":
            if val_h < umbral_minimo:
                print(f"   🔇 Señal débil ({val_h} < {umbral_minimo}) - IGNORADA")
                return None
        else:
            val_h = 160

        if "," not in data:
            val_l = int(data[18:20], 16)
            vueltas_hex = data[-8:-4]
            nro_vueltas_raw = int(vueltas_hex, 16)
        else:
            val_l = 0
            if "CONTADOR_VUELTAS_INTERNO" not in globals():
                global CONTADOR_VUELTAS_INTERNO
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

        # ===== CALCULAR TIEMPO =====
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
                        print(
                            f"   🔇 Señal fantasma ({lap_candidate:.2f}s < {min_lap_time}s) - IGNORADA"
                        )
                        return None

        mins = int(tiempo_total_segundos // 60)
        secs = tiempo_total_segundos % 60
        time_str = f"{mins:02d}:{secs:06.3f}"

        es_nuevo = add_transponder_detected(
            transponder_id, val_h, val_l, time_str, nro_vueltas_raw
        )
        if es_nuevo:
            print(f"\n🔔 NUEVO TRANSPONDER DETECTADO: {transponder_id}")

        print(f"\n🏁 ¡DETECCIÓN! ({calidad}) - Fuente: {origen_tiempo}")
        print(f"🆔 ID Transponder: {transponder_id}")
        print(f"📡 Señal -> H: {val_h} | L: {val_l}")
        tiempo_formateado = formatear_tiempo(tiempo_total_segundos)
        print(f"⏱️ Tiempo Acumulado: {tiempo_formateado}")
        print(f"🔄 Vueltas Físicas (Equipo): {nro_vueltas_raw}")

        if transponder_id not in RACE_DRIVERS:
            actualizar_pilotos_inscritos()
            if transponder_id not in RACE_DRIVERS:
                print(f"⚠️ NO INSCRITO - Ve a PILOTOS para asignarlo")
                return None
            else:
                print(f"✅ INSCRIPCIÓN DETECTADA TARDE PARA {transponder_id}")

        driver = get_driver_by_transponder(transponder_id)
        if not driver:
            print(f"⚠️ Sin piloto asignado")
            return None

        nombre_piloto = driver["name"]
        if driver.get("lastname"):
            nombre_piloto += f" {driver['lastname']}"
        print(f"👤 Piloto: {nombre_piloto}")

        if not RACE_ACTIVE:
            print(f"⏳ Carrera no iniciada - Esperando inicio...")
            return None

        if RACE_PAUSED:
            print(f"⏸️ Carrera pausada - Reanudar para continuar")
            return None

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
            print(f"🏁 ¡PRIMERA DETECCIÓN! Vuelta de SALIDA para {nombre_piloto}")
            print(f"   Cronómetro individual INICIADO (fuente: {origen_tiempo})")

            from database import save_lap

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

            from database import save_lap

            # ✅ CORREGIDO: save_lap ya calcula avg_speed internamente, no necesitamos calcularlo aquí
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

                    from datetime import datetime

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

                        from database import get_leaderboard_with_details

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

        return None
    except Exception as e:
        print(f"Error procesando: {e}")
        return None


def listen_chronit():
    global \
        ULTIMA_ACTIVIDAD, \
        ALERTA_MOSTRADA, \
        SESSION_ID, \
        LAPS_LIMIT, \
        RACE_DRIVERS, \
        RACE_ACTIVE, \
        RACE_PAUSED

    print("\n" + "=" * 50)
    print("🛡️ SISTEMA ESL-400 | v9.0 - CONTROL DE CARRERA")
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

    buffer_serial = ""
    ultimo_codigo = ""
    ultima_vez_deteccion = 0
    reconectar = False
    ultima_actualizacion_modo = time.time()

    # ✅ BUCLE PRINCIPAL QUE MONITOREA EL MODO DE SIMULACIÓN
    while True:
        # ===== VERIFICAR MODO SIMULACIÓN =====
        if is_simulation_mode():
            print("🎮 [SIMULACIÓN] Modo simulación ACTIVADO")
            print("   Generando vueltas automáticas cada 2 segundos...")

            # Bucle de simulación
            while is_simulation_mode():
                check_restart_flag()
                check_race_commands()
                check_time_limit()

                if RACE_ACTIVE and not RACE_PAUSED and SESSION_ID:
                    generar_vuelta_simulada()
                    time.sleep(get_simulation_speed())
                else:
                    time.sleep(1)

            # Cuando se desactiva la simulación, salimos del bucle interno
            print(
                "🎮 [SIMULACIÓN] Modo simulación DESACTIVADO - Cambiando a modo hardware"
            )
            # Continuamos al bucle de hardware (no hacemos return)

        # ===== MODO HARDWARE REAL =====
        # Este bloque se ejecuta cuando NO está en modo simulación
        # (ya sea porque se desactivó o porque nunca se activó)

        # Limpiar banderas de simulación por si acaso
        # Pero no salimos del bucle principal

        # Ejecutar modo hardware
        print("🔧 [HARDWARE] Modo hardware real ACTIVADO")
        print("   Esperando conexión del decoder ESL-400...")

        contador_busqueda = 0
        while not is_simulation_mode():
            if not os.path.exists(PORT):
                contador_busqueda += 1
                if contador_busqueda == 1:
                    print(f"🔍 Hardware no encontrado en {PORT} - esperando...")
                elif contador_busqueda % 12 == 0:
                    print(f"🔍 Aún esperando hardware en {PORT}...")
                time.sleep(5)
                continue
            contador_busqueda = 0

            try:
                repair_permissions(PORT)

                with serial.Serial(PORT, BAUD, timeout=0.1) as ser:
                    global serial_port_global
                    serial_port_global = ser
                    if reconectar or not hasattr(listen_chronit, "conectado_msg"):
                        print(f"✅ Puerto {PORT} conectado. Vigilando pista...\n")
                        if not RACE_ACTIVE:
                            print(
                                "⏳ Carrera pendiente. Presiona 'INICIAR CARRERA' para comenzar.\n"
                            )
                        listen_chronit.conectado_msg = True
                        reconectar = False

                        ser.reset_input_buffer()
                        ser.flush()
                        activar_decoder()
                        ser.flush()
                        ULTIMA_ACTIVIDAD = time.time()

                    while not is_simulation_mode():
                        check_restart_flag()
                        check_race_commands()
                        check_time_limit()

                        ahora_modo = time.time()
                        if ahora_modo - ultima_actualizacion_modo > 5:
                            from database import get_decoder_mode as get_db_mode

                            nuevo_modo = get_db_mode()
                            modo_actual_antes = get_decoder_mode()
                            if nuevo_modo != modo_actual_antes:
                                set_decoder_mode(nuevo_modo)
                                print(
                                    f"[DECODER] Modo actualizado desde BD: {modo_actual_antes} → {nuevo_modo}"
                                )
                            ultima_actualizacion_modo = ahora_modo

                        if ser.in_waiting > 0:
                            datos_crudos = ser.read(ser.in_waiting)
                            ULTIMA_ACTIVIDAD = time.time()
                            ALERTA_MOSTRADA = False

                            try:
                                texto = datos_crudos.decode("utf-8", errors="ignore")
                                buffer_serial += texto
                                lineas = buffer_serial.split("\n")
                                buffer_serial = lineas[-1]

                                for linea in lineas[:-1]:
                                    linea = linea.strip()
                                    if not linea:
                                        continue

                                    ahora = time.time()
                                    config_antena = get_antenna_config()
                                    tiempo_filtro = config_antena.get(
                                        "filter_time", 0.5
                                    )

                                    if linea.startswith("#"):
                                        continue

                                    if (
                                        linea != ultimo_codigo
                                        or (ahora - ultima_vez_deteccion)
                                        > tiempo_filtro
                                    ):
                                        modo_actual = get_decoder_mode()

                                        if modo_actual == "chronit":
                                            if linea.startswith("$") and not (
                                                "," in linea
                                            ):
                                                print(
                                                    f"[SERIAL] Línea Chronit válida: {linea}"
                                                )
                                                procesar_cadena_esl400(linea)
                                                ultima_vez_deteccion = ahora
                                        else:
                                            datos_legacy = translate_to_chronit_format(
                                                linea
                                            )
                                            if datos_legacy is not None:
                                                (
                                                    transponder_id,
                                                    time_str,
                                                    physical_laps,
                                                    val_h,
                                                    val_l,
                                                ) = datos_legacy
                                                linea_fake = f"${transponder_id:04X},{time_str},{physical_laps},{val_h:02X}{val_l:02X}"
                                                print(
                                                    f"[DECODER] Línea {modo_actual} convertida a Chronit: {linea_fake}"
                                                )
                                                procesar_cadena_esl400(linea_fake)
                                                ultima_vez_deteccion = ahora

                                        ultimo_codigo = linea

                            except Exception as e:
                                pass
                        else:
                            time.sleep(0.01)

                        if time.time() - ULTIMA_ACTIVIDAD > 300 and not ALERTA_MOSTRADA:
                            print(
                                "\n⚠️ 5 minutos sin detecciones - el decoder podría estar apagado o sin transponders"
                            )
                            ALERTA_MOSTRADA = True

                        # Si se activa el modo simulación, salimos del bucle hardware
                        if is_simulation_mode():
                            print(
                                "🎮 [SIMULACIÓN] Modo simulación ACTIVADO - Cambiando a modo simulación"
                            )
                            break

            except Exception as e:
                print(f"📡 Error: {e}. Reintentando en 5 segundos...")
                time.sleep(5)
                reconectar = True
                if is_simulation_mode():
                    break

        time.sleep(0.5)


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