"""
decoder_modes.py - Traductor de formatos del decoder ESL-400
Convierte cualquier modo al formato estándar que entiende main.py
Basado en DATOS REALES extraídos del puerto serial
"""

import struct
import re

# Modo actual seleccionado (se guarda en BD)
current_mode = "chronit"  # chronit, a120, a20, fr01

def set_decoder_mode(mode):
    """Cambia el modo del decoder"""
    global current_mode
    current_mode = mode
    print(f"[DECODER] Modo cambiado a: {mode}")

def get_decoder_mode():
    return current_mode

def parse_decoder_data(data_bytes, mode):
    """
    Función principal para decodificar datos del decoder según el modo activo.
    Recibe:
        data_bytes: bytes o string crudos del decoder
        mode: string con el modo ('chronit', 'a20', 'a120', 'fr01')
    Devuelve:
        dict con {"transponder_id": int, "timestamp_ms": int, "raw_valid": bool}
    """
    try:
        if mode == "chronit":
            return parse_chronit_to_dict(data_bytes)
        elif mode == "a120":
            return parse_a120_to_dict(data_bytes)
        elif mode == "a20":
            return parse_a20_to_dict(data_bytes)
        elif mode == "fr01":
            return parse_fr01_to_dict(data_bytes)
        else:
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
    except Exception as e:
        print(f"[DECODER] Error decodificando datos en modo {mode}: {e}")
        return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}

def parse_chronit_to_dict(raw_data):
    """
    MODO CHRONIT (el que ya funcionaba)
    Datos reales: $01005F65001545486FF7601001E05CC
    - ID: índices 3-8 (005F65) → hex a decimal = 24421
    """
    try:
        if isinstance(raw_data, bytes):
            raw_data = raw_data.decode("ascii", errors="ignore")
        
        data = raw_data.strip()
        
        # Ignorar líneas que no empiecen con $
        if not data.startswith("$"):
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
        
        # Extraer ID (índices 3-8, 6 caracteres)
        if len(data) < 9:
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
        
        transponder_id_hex = data[3:9].strip()  # 005F65
        transponder_id = int(transponder_id_hex, 16)  # 24421
        
        # Tiempo: extraer los siguientes 8 caracteres (índices 9-17)
        timestamp_ms = 0
        if len(data) >= 17:
            timestamp_hex = data[9:17].strip()
            try:
                timestamp_ms = int(timestamp_hex, 16)
            except:
                pass
        
        return {"transponder_id": transponder_id, "timestamp_ms": timestamp_ms, "raw_valid": True}
    except Exception as e:
        print(f"[CHRONIT] Error: {e}")
        return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}

def parse_a120_to_dict(raw_data):
    """
    MODO A-120 (AMB TranX120)
    Datos reales: $0500005F6500001B4F104100
    - ID: índices 5-10 (005F65) → hex a decimal = 24421
    """
    try:
        if isinstance(raw_data, bytes):
            raw_data = raw_data.decode("ascii", errors="ignore")
        
        data = raw_data.strip()
        
        # Ignorar líneas que no empiecen con $
        if not data.startswith("$"):
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
        
        # Extraer ID (índices 5-10, 6 caracteres)
        if len(data) < 11:
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
        
        transponder_id_hex = data[5:11].strip()  # 005F65
        transponder_id = int(transponder_id_hex, 16)  # 24421
        
        # Tiempo: extraer los siguientes 8 caracteres
        timestamp_ms = 0
        if len(data) >= 19:
            timestamp_hex = data[11:19].strip()
            try:
                timestamp_ms = int(timestamp_hex, 16)
            except:
                pass
        
        return {"transponder_id": transponder_id, "timestamp_ms": timestamp_ms, "raw_valid": True}
    except Exception as e:
        print(f"[A-120] Error: {e}")
        return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}

def parse_a20_to_dict(raw_data):
    """
    MODO A-20 (AMB TranX20)
    Datos reales: @210000278899 (transponder 24421), @170020427599 (transponder 24417)
    - Ignorar líneas de sincronismo (@000000XX)
    - ID parcial: primeros 2 caracteres (últimos dos dígitos del transponder completo)
    """
    try:
        if isinstance(raw_data, bytes):
            raw_data = raw_data.decode("ascii", errors="ignore")
        
        data = raw_data.strip()
        
        # Ignorar líneas que no empiecen con @
        if not data.startswith("@"):
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
        
        # Ignorar líneas de sincronismo (@000000XX)
        if data.startswith("@0000"):
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
        
        # Extraer contenido después del @
        content = data[1:].strip()
        if len(content) < 6:
            return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}
        
        # ID parcial: primeros 2 caracteres (últimos dos dígitos del transponder)
        transponder_id_partial = content[0:2]
        
        # Mapear los últimos dos dígitos al ID completo del transponder
        if transponder_id_partial == "17":
            transponder_id = 24417
        elif transponder_id_partial == "21":
            transponder_id = 24421
        else:
            # Si es un transponder desconocido, usar el valor por defecto o devolver None
            transponder_id = 24417  # Por defecto tu transponder principal
        
        print(f"[A-20] Parcial ID: {transponder_id_partial} → Transponder completo: {transponder_id}")
        
        # Tiempo: últimos 6 caracteres
        timestamp_ms = 0
        if len(content) >= 8:
            time_str = content[2:8].strip()
            try:
                timestamp_ms = int(time_str)
            except:
                pass
        
        return {"transponder_id": transponder_id, "timestamp_ms": timestamp_ms, "raw_valid": True}
    except Exception as e:
        print(f"[A-20] Error: {e}")
        return {"transponder_id": None, "timestamp_ms": None, "raw_valid": False}

def parse_fr01_to_dict(raw_data):
    """
    MODO FR-01 (Chronelec / Tag Heuer)
    Maneja diferentes formatos y ignora líneas de DEPART
    """
    try:
        if isinstance(raw_data, bytes):
            raw_data = raw_data.decode("ascii", errors="ignore")
        
        data = raw_data.strip()
        
        # Ignorar líneas de DEPART
        if "*****DEPART*****" in data:
            print(f"[FR-01] Ignorando línea DEPART: {data}")
            return {"transponder_id": None, "timestamp_ms": None, "lap_number": 0, "signal_h": 60, "raw_valid": False}
        
        print(f"[FR-01] Analizando línea: {data}")
        
        transponder_id = None
        timestamp_ms = 0
        lap_number = 0
        signal_h = 50
        
        # ===== PRIMER FORMATO: <.XX TI:HH:MM'SS"mmm ...> =====
        if data.startswith("<") and data.endswith(">"):
            content = data[1:-1].strip()
            
            # Buscar ID parcial después de <.
            if content.startswith("."):
                id_part = content[1:3].strip()
                if id_part.isdigit():
                    # Intentar construir el ID completo (según tus transponders conocidos)
                    # Si tienes más transponders, agrégalos aquí
                    if id_part == "17":
                        transponder_id = 24417
                    elif id_part == "21":
                        transponder_id = 24421
                    else:
                        # Si es un ID desconocido, usamos el valor parcial (o puedes agregar más mappings)
                        transponder_id = int(id_part) if id_part.isdigit() else None
            
            # Buscar NT (número de vuelta)
            nt_match = re.search(r"NT:(\d+)", content)
            if nt_match:
                lap_number = int(nt_match.group(1))
            
            # Buscar la señal (últimos 3 dígitos si es un número)
            parts = content.split()
            if len(parts) >= 1 and parts[-1].isdigit() and len(parts[-1]) == 3:
                signal_h = int(parts[-1])
            
            # Buscar TI (tiempo de día)
            ti_match = re.search(r"TI:(\d+):(\d+)'(\d+)\"(\d+)", content)
            if ti_match:
                hours = int(ti_match.group(1))
                minutes = int(ti_match.group(2))
                seconds = int(ti_match.group(3))
                millis = int(ti_match.group(4))
                timestamp_ms = (hours * 3600 + minutes * 60 + seconds) * 1000 + millis
        
        # ===== SEGUNDO FORMATO: Cualquier otro formato que contenga un ID =====
        else:
            # Buscar números que puedan ser ID de transponder
            numbers = re.findall(r"\d+", data)
            if numbers:
                # Si hay números, intenta usar el más largo o el que se ajuste a tus transponders
                for num_str in numbers:
                    num = int(num_str)
                    if num in [24417, 24421]:
                        transponder_id = num
                        break
                if not transponder_id:
                    transponder_id = int(numbers[0])
        
        # Si no encontramos ID, devolvemos inválido
        if transponder_id is None:
            print(f"[FR-01] No se encontró ID de transponder en línea: {data}")
            return {"transponder_id": None, "timestamp_ms": None, "lap_number": lap_number, "signal_h": signal_h, "raw_valid": False}
        
        print(f"[FR-01] Transponder detectado: {transponder_id}, Lap: {lap_number}, Señal: {signal_h}")
        return {"transponder_id": transponder_id, "timestamp_ms": timestamp_ms, "lap_number": lap_number, "signal_h": signal_h, "raw_valid": True}
    except Exception as e:
        print(f"[FR-01] Error: {e}")
        return {"transponder_id": None, "timestamp_ms": None, "lap_number": 0, "signal_h": 60, "raw_valid": False}

def translate_to_chronit_format(raw_data):
    """
    Traduce cualquier formato al formato CHRONIT estándar.
    Retorna: (transponder_id, time_str, physical_laps, signal_h, signal_l)
    """
    try:
        mode = get_decoder_mode()
        
        if mode == "chronit":
            return parse_chronit_legacy(raw_data)
        elif mode == "a120":
            return parse_a120_legacy(raw_data)
        elif mode == "a20":
            return parse_a20_legacy(raw_data)
        elif mode == "fr01":
            return parse_fr01_legacy(raw_data)
        else:
            return parse_chronit_legacy(raw_data)
    except Exception as e:
        print(f"[DECODER] Error traduciendo: {e}")
        return None

def parse_chronit_legacy(raw_data):
    """Formato: $ID, TIEMPO, VUELTAS, SEÑAL (original)"""
    try:
        data = raw_data.replace("$", "").strip()
        parts = data.split(",")
        if len(parts) >= 4:
            transponder_id = int(parts[0].strip())
            time_str = parts[1].strip()
            physical_laps = int(parts[2].strip())
            signal_h = int(parts[3].strip()) if len(parts) > 3 else 60
            signal_l = 0
            return (transponder_id, time_str, physical_laps, signal_h, signal_l)
    except:
        pass
    return None

def parse_a120_legacy(raw_data):
    """
    MODO A-120 - Versión legacy para mantener compatibilidad con main.py
    """
    try:
        parsed = parse_a120_to_dict(raw_data)
        if not parsed["raw_valid"]:
            return None
        
        transponder_id = parsed["transponder_id"]
        timestamp_ms = parsed["timestamp_ms"]
        
        seconds = timestamp_ms / 1000.0
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        
        if hours > 0:
            time_str = f"{hours:02d}:{minutes:02d}:{secs:06.3f}"
        else:
            time_str = f"{minutes:02d}:{secs:06.3f}"
        
        physical_laps = 0
        signal_h = 60
        signal_l = 0
        
        return (transponder_id, time_str, physical_laps, signal_h, signal_l)
    except:
        pass
    return None

def parse_a20_legacy(raw_data):
    """
    MODO A-20 - Versión legacy para mantener compatibilidad con main.py
    """
    try:
        parsed = parse_a20_to_dict(raw_data)
        if not parsed["raw_valid"]:
            return None
        
        transponder_id = parsed["transponder_id"]
        timestamp_ms = parsed["timestamp_ms"]
        
        seconds = timestamp_ms / 1000.0
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        
        if hours > 0:
            time_str = f"{hours:02d}:{minutes:02d}:{secs:06.3f}"
        else:
            time_str = f"{minutes:02d}:{secs:06.3f}"
        
        physical_laps = 0
        signal_h = 60
        signal_l = 0
        
        return (transponder_id, time_str, physical_laps, signal_h, signal_l)
    except:
        pass
    return None

def parse_fr01_legacy(raw_data):
    """
    MODO FR-01 - Versión legacy para mantener compatibilidad con main.py
    """
    try:
        parsed = parse_fr01_to_dict(raw_data)
        if not parsed["raw_valid"]:
            return None
        
        transponder_id = parsed["transponder_id"]
        timestamp_ms = parsed["timestamp_ms"] if parsed["timestamp_ms"] else 0
        
        seconds = timestamp_ms / 1000.0
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        
        if hours > 0:
            time_str = f"{hours:02d}:{minutes:02d}:{secs:06.3f}"
        else:
            time_str = f"{minutes:02d}:{secs:06.3f}"
        
        physical_laps = parsed.get("lap_number", 0)
        signal_h = parsed.get("signal_h", 160)
        signal_l = 0
        
        return (transponder_id, time_str, physical_laps, signal_h, signal_l)
    except:
        pass
    return None
