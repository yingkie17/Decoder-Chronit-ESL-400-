#!/usr/bin/env python3
"""
Script para probar la integración completa: decoder_modes + procesar_cadena_esl400
"""
import sys
import os

# Agregar el directorio src al path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from decoder_modes import (
    translate_to_chronit_format,
    set_decoder_mode
)
from unittest.mock import patch

# Simular variables globales de main.py para que no explote
def mock_main_variables():
    import types
    mock_main = types.ModuleType("mock_main")
    mock_main.VUELTA_BASE = {}
    mock_main.LAST_LAP_TIME = {}
    mock_main.SESSION_ID = 1
    mock_main.LAPS_LIMIT = 5
    mock_main.RACE_DRIVERS = {24421}
    mock_main.DRIVERS_FINISHED = set()
    mock_main.RACE_ACTIVE = True
    mock_main.RACE_PAUSED = False
    mock_main.FIRST_FINISHER = None
    mock_main.PRIMERA_VEZ = {}
    mock_main.VUELTA_SALIDA = {}
    mock_main.VUELTAS_CARRERA = {}
    
    # Inyectar en sys.modules
    sys.modules['main'] = mock_main
    return mock_main

# Cargar main.py para probar procesar_cadena_esl400
from main import procesar_cadena_esl400, get_driver_by_transponder

print("=" * 80)
print("PRUEBA DE INTEGRACIÓN COMPLETA")
print("=" * 80)
print()

# Datos de prueba
datos_prueba = {
    "chronit": [
        "$01005F65001545486FF7601001E05CC",
        "$01005F65001742472FF8801001F05CA"
    ],
    "a120": [
        "$0500005F6500001B4F104100",
        "$0500005F6500003B39AC7800"
    ],
    "a20": [
        "@210000278899",
        "@210000310199"
    ],
    "fr01": [
        "<.21 TI:00:00'10\"314 TT:00'10\"314 NT:0001 022>",
        "<.21 TI:00:00'18\"142 TT:00'07\"828 NT:0002 046>"
    ]
}

# Mockear funciones de BD para que no explote
with patch('main.get_timing_config') as mock_timing, \
     patch('main.get_antenna_config') as mock_antenna, \
     patch('main.add_transponder_detected') as mock_add_detected, \
     patch('main.get_driver_by_transponder') as mock_get_driver, \
     patch('main.save_lap') as mock_save_lap:

    # Configurar mocks
    mock_timing.return_value = {"time_source": "server", "min_valid_lap_time": 1.0}
    mock_antenna.return_value = {"min_signal": 60, "filter_time": 0.5}
    mock_add_detected.return_value = False
    mock_save_lap.return_value = None
    mock_get_driver.return_value = {
        "id": 1,
        "name": "Test",
        "lastname": "Driver",
        "transponder_id": 24421
    }

    for modo, lineas in datos_prueba.items():
        print(f"\n{'=' * 80}")
        print(f"MODO: {modo.upper()}")
        print("=" * 80)
        
        set_decoder_mode(modo)
        
        for linea in lineas:
            print(f"\n→ Línea: {linea}")
            
            # Primero, probar translate_to_chronit_format
            legacy = translate_to_chronit_format(linea)
            print(f"  translate_to_chronit_format: {legacy}")
            
            # Ahora, probar procesar_cadena_esl400 (para modo chronit, es la línea original; para otros, la fake)
            if modo == "chronit":
                resultado = procesar_cadena_esl400(linea)
                print(f"  procesar_cadena_esl400 (original): {resultado}")
            else:
                if legacy is not None:
                    transponder_id, time_str, physical_laps, val_h, val_l = legacy
                    linea_fake = f"${transponder_id:04X},{time_str},{physical_laps},{val_h:02X}{val_l:02X}"
                    print(f"  Línea fake: {linea_fake}")
                    resultado = procesar_cadena_esl400(linea_fake)
                    print(f"  procesar_cadena_esl400 (fake): {resultado}")

print("\n" + "=" * 80)
print("FIN DE LAS PRUEBAS")
print("=" * 80)
