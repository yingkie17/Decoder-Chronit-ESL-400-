import serial
import time
import os
import subprocess

# --- CONFIGURACIÓN ---
PORT = os.getenv('SERIAL_PORT', '/dev/ttyUSB0')
BAUD = 9600

# --- VARIABLES DE ESTADO ---
VUELTA_BASE = {}
ULTIMA_ACTIVIDAD = time.time()
ALERTA_MOSTRADA = False

def repair_permissions(port):
    try:
        if os.path.exists(port):
            subprocess.run(['chmod', '666', port], check=True, stderr=subprocess.DEVNULL)
            subprocess.run(['stty', '-F', port, '9600', 'raw', '-echo'], 
                          check=True, stderr=subprocess.DEVNULL)
            return True
    except:
        pass
    return False

def procesar_trama_esl400(trama):
    """
    Parsea tramas del ESL-400
    Formato esperado: $01005F610111568713F1501000B05A7
    """
    global VUELTA_BASE
    
    try:
        if not trama or trama[0] != '$':
            return None
        
        # Remover el '$' inicial
        datos = trama[1:]
        
        # Según tus tramas reales:
        # $01005F610111568713F1501000B05A7
        # Los primeros bytes son el ID del transponder
        if len(datos) < 20:
            return None
        
        # Extraer ID (primeros 8 caracteres después de $)
        id_hex = datos[0:8]
        transponder_id = int(id_hex, 16)
        
        # Extraer tiempo (siguientes 8 caracteres)
        tiempo_hex = datos[8:16]
        milisegundos = int(tiempo_hex, 16)
        segundos_totales = milisegundos / 1000.0
        
        # Extraer señal H y L (siguientes 4 caracteres)
        senal_h_hex = datos[16:18]
        senal_l_hex = datos[18:20]
        valor_h = int(senal_h_hex, 16)
        valor_l = int(senal_l_hex, 16)
        
        # Extraer vueltas (últimos 4 caracteres antes del checksum)
        # Según tus datos, parece que los últimos 4-5 caracteres son checksum/vueltas
        if len(datos) >= 24:
            vueltas_hex = datos[-8:-4]
            vueltas_raw = int(vueltas_hex, 16)
        else:
            vueltas_raw = 0
        
        # Lógica de carrera
        if transponder_id not in VUELTA_BASE:
            VUELTA_BASE[transponder_id] = vueltas_raw
            vuelta_carrera = 0
        else:
            vuelta_carrera = vueltas_raw - VUELTA_BASE[transponder_id]
        
        return {
            "id": transponder_id,
            "vueltas_fisicas": vueltas_raw,
            "vuelta_carrera": vuelta_carrera,
            "segundos": segundos_totales,
            "h": valor_h,
            "l": valor_l,
            "trama_original": trama
        }
        
    except Exception as e:
        # Debug opcional
        # print(f"Error parseando: {e} - Trama: {trama}", flush=True)
        return None

def listen_chronit():
    global ULTIMA_ACTIVIDAD, ALERTA_MOSTRADA
    
    print("\n" + "="*55, flush=True)
    print("🏁 SISTEMA ESL-400 v5.1 - MODO LECTURA CRUDA", flush=True)
    print("="*55, flush=True)
    print(f"📡 Puerto: {PORT} a {BAUD} baudios", flush=True)
    print("🔄 Leyendo datos en tiempo real...\n", flush=True)
    
    buffer_serial = ""
    
    while True:
        if not os.path.exists(PORT):
            print(f"⚠️ Puerto {PORT} no encontrado. Reintentando...", flush=True)
            time.sleep(5)
            continue
        
        try:
            repair_permissions(PORT)
            
            with serial.Serial(PORT, BAUD, timeout=0.05) as ser:
                print(f"✅ Conectado a {PORT}\n", flush=True)
                ser.reset_input_buffer()
                ULTIMA_ACTIVIDAD = time.time()
                
                while True:
                    # Leer TODO lo disponible
                    if ser.in_waiting > 0:
                        datos_crudos = ser.read(ser.in_waiting)
                        ULTIMA_ACTIVIDAD = time.time()
                        ALERTA_MOSTRADA = False
                        
                        try:
                            texto = datos_crudos.decode('utf-8', errors='ignore')
                            buffer_serial += texto
                            
                            # Buscar tramas completas (empiezan con $)
                            lineas = buffer_serial.split('\n')
                            buffer_serial = lineas[-1]  # Guardar lo incompleto
                            
                            for linea in lineas[:-1]:
                                linea = linea.strip()
                                if not linea:
                                    continue
                                
                                # Procesar transponders (tramas que empiezan con $)
                                if linea.startswith('$'):
                                    info = procesar_trama_esl400(linea)
                                    if info:
                                        minutos = int(info['segundos'] // 60)
                                        segs = info['segundos'] % 60
                                        
                                        # Calidad de señal
                                        if info['h'] > 200:
                                            calidad = "🟢 EXCELENTE"
                                        elif info['h'] > 100:
                                            calidad = "🟡 BUENA"
                                        elif info['h'] > 50:
                                            calidad = "🟠 REGULAR"
                                        else:
                                            calidad = "🔴 DÉBIL"
                                        
                                        print(f"\n🏁 ¡TRANSPONDER DETECTADO! {calidad}", flush=True)
                                        print(f"   🆔 ID: {info['id']}", flush=True)
                                        print(f"   🔄 Vuelta carrera: {info['vuelta_carrera']}", flush=True)
                                        print(f"   📟 Vueltas físicas: {info['vueltas_fisicas']}", flush=True)
                                        print(f"   ⏱️  Tiempo: {minutos:02d}:{segs:06.3f}", flush=True)
                                        print(f"   📡 Señal H:{info['h']:3d} L:{info['l']:3d}", flush=True)
                                        print(f"   📝 Trama: {info['trama_original'][:30]}...", flush=True)
                                        print("-"*55, flush=True)
                                
                                # Heartbeats (silenciosos)
                                elif linea.startswith('#'):
                                    # Mostrar solo si quieres debug
                                    # print(".", end="", flush=True)
                                    pass
                                
                        except Exception as e:
                            print(f"Error procesando buffer: {e}", flush=True)
                    
                    # Watchdog
                    if time.time() - ULTIMA_ACTIVIDAD > 20 and not ALERTA_MOSTRADA:
                        print("\n" + "!"*55, flush=True)
                        print("🚨 ALERTA: SIN DATOS DEL HARDWARE POR 20 SEGUNDOS", flush=True)
                        print("   Verifique la conexión del ESL-400", flush=True)
                        print("!"*55 + "\n", flush=True)
                        ALERTA_MOSTRADA = True
                    
                    time.sleep(0.005)  # Pequeña pausa
                    
        except serial.SerialException as e:
            print(f"❌ Error serial: {e}. Reintentando...", flush=True)
            time.sleep(3)
        except Exception as e:
            print(f"⚠️ Error: {e}. Reintentando...", flush=True)
            time.sleep(2)

if __name__ == "__main__":
    try:
        listen_chronit()
    except KeyboardInterrupt:
        print("\n\n🛑 Sistema detenido por el operador", flush=True)
        print("👋 ¡Hasta pronto!\n", flush=True)
