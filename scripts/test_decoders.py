#!/usr/bin/env python3
"""
Script para probar los parsers con los datos reales del usuario
"""
import sys
import os

# Agregar el directorio src al path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from decoder_modes import (
    parse_decoder_data,
    translate_to_chronit_format,
    set_decoder_mode
)

print("=" * 80)
print("PRUEBA DE PARSERS CON DATOS REALES")
print("=" * 80)
print()

# -----------------------------------------------------------------------------
# MODO CHRONIT
# -----------------------------------------------------------------------------
print("\n--- MODO CHRONIT ---")
chronit_lines = [
    "$01005F65001545486FF7601001E05CC",
    "$01005F65001742472FF8801001F05CA"
]

set_decoder_mode("chronit")

for line in chronit_lines:
    print(f"\nLínea: {line}")
    parsed = parse_decoder_data(line, "chronit")
    print(f"Parseado: {parsed}")
    legacy = translate_to_chronit_format(line)
    print(f"Legacy: {legacy}")

# -----------------------------------------------------------------------------
# MODO A-120
# -----------------------------------------------------------------------------
print("\n--- MODO A-120 ---")
a120_lines = [
    "$0500005F6500001B4F104100",
    "$0500005F6500003B39AC7800"
]

set_decoder_mode("a120")

for line in a120_lines:
    print(f"\nLínea: {line}")
    parsed = parse_decoder_data(line, "a120")
    print(f"Parseado: {parsed}")
    legacy = translate_to_chronit_format(line)
    print(f"Legacy: {legacy}")

# -----------------------------------------------------------------------------
# MODO A-20
# -----------------------------------------------------------------------------
print("\n--- MODO A-20 ---")
a20_lines = [
    "@210000278899",
    "@210000310199",
    "@210000336599"
]

set_decoder_mode("a20")

for line in a20_lines:
    print(f"\nLínea: {line}")
    parsed = parse_decoder_data(line, "a20")
    print(f"Parseado: {parsed}")
    legacy = translate_to_chronit_format(line)
    print(f"Legacy: {legacy}")

# -----------------------------------------------------------------------------
# MODO FR-01
# -----------------------------------------------------------------------------
print("\n--- MODO FR-01 ---")
fr01_lines = [
    "<.21 TI:00:00'10\"314 TT:00'10\"314 NT:0001 022>",
    "<.21 TI:00:00'18\"142 TT:00'07\"828 NT:0002 046>"
]

set_decoder_mode("fr01")

for line in fr01_lines:
    print(f"\nLínea: {line}")
    parsed = parse_decoder_data(line, "fr01")
    print(f"Parseado: {parsed}")
    legacy = translate_to_chronit_format(line)
    print(f"Legacy: {legacy}")

print("\n" + "=" * 80)
print("FIN DE LAS PRUEBAS")
print("=" * 80)
