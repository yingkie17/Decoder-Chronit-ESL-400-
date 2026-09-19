#!/usr/bin/env python3
"""
Script de diagnóstico para el decoder ESL-400
Ejecutar en el contenedor: python diagnostico_decoder.py
"""

import serial
import time
import sys

PORT = '/dev/ttyUSB0'
BAUD = 9600

def test_serial():
    print("=" * 60)
    print("🔧 DIAGNÓSTICO DEL DECODER ESL-400")
    print("=" * 60)
    
    # 1. Verificar que el puerto existe
    import os
    if not os.path.exists(PORT):
        print(f"❌ Puerto {PORT} no encontrado")
        print("   Verifica que el decoder esté conectado")
        return
    
    print(f"✅ Puerto {PORT} encontrado")
    
    # 2. Abrir el puerto
    try:
        ser = serial.Serial(PORT, BAUD, timeout=1)
        print(f"✅ Puerto abierto correctamente (BAUD={BAUD})")
    except Exception as e:
        print(f"❌ Error abriendo puerto: {e}")
        return
    
    # 3. Enviar comando MODE CHRONIT
    print("\n📤 Enviando comando MODE CHRONIT...")
    ser.write(b'MODE CHRONIT\r\n')
    ser.flush()
    time.sleep(0.5)
    
    # 4. Enviar comando START
    print("📤 Enviando comando START...")
    ser.write(b'START\r\n')
    ser.flush()
    time.sleep(0.5)
    
    # 5. Leer respuesta
    print("\n📡 Leyendo datos del decoder durante 5 segundos...")
    datos = b''
    inicio = time.time()
    while time.time() - inicio < 5:
        if ser.in_waiting:
            datos += ser.read(ser.in_waiting)
        time.sleep(0.01)
    
    # 6. Mostrar resultados
    if datos:
        print(f"\n✅ Se recibieron {len(datos)} bytes")
        print(f"   Datos crudos: {repr(datos)}")
        
        # Mostrar líneas
        lineas = datos.decode('utf-8', errors='ignore').splitlines()
        print(f"\n📋 Líneas recibidas ({len(lineas)}):")
        for i, linea in enumerate(lineas):
            if linea.startswith('$'):
                print(f"   ✅ {i+1}: {repr(linea)} → DETECCIÓN VÁLIDA!")
            elif linea.startswith('@') or linea.startswith('<'):
                print(f"   ⚠️ {i+1}: {repr(linea)} → Formato alternativo")
            elif linea.startswith('#'):
                print(f"   ❌ {i+1}: {repr(linea)} → RUIDO (ignorar)")
            else:
                print(f"   📄 {i+1}: {repr(linea)}")
    else:
        print("\n❌ NO se recibieron datos del decoder")
        print("   Posibles causas:")
        print("   1. El decoder no está enviando datos (transponder no detectado)")
        print("   2. El decoder está en un modo diferente")
        print("   3. Problema de hardware (cable, alimentación)")
    
    ser.close()
    print("\n" + "=" * 60)

if __name__ == "__main__":
    test_serial()