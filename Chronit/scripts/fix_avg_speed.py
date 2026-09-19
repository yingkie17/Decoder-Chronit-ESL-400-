
#!/usr/bin/env python3
import sqlite3
import os

# Ruta de la base de datos (para ejecutar en el host)
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    print("="*60)
    print("CHRONIT: Script de reparación de velocidad promedio (km/h)")
    print("="*60)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Paso 1: Obtener la configuración del circuito
    cursor.execute("SELECT track_length_km FROM circuit_config WHERE id = 1")
    config = cursor.fetchone()
    track_length_km = config['track_length_km'] if config else 0

    print(f"\n✅ Configuración de pista: {track_length_km} km")

    if track_length_km <= 0:
        print("\n❌ ERROR: El largo de pista es 0 o negativo. Por favor, configura un valor válido en la interfaz.")
        conn.close()
        return

    # Paso 2: Listar vueltas con avg_speed_kmh NULL
    cursor.execute("""
        SELECT id, session_id, driver_id, lap_number, lap_seconds
        FROM laps
        WHERE avg_speed_kmh IS NULL AND lap_seconds IS NOT NULL AND lap_seconds > 0
    """)
    null_laps = cursor.fetchall()

    print(f"\n📊 Vueltas con velocidad NULL: {len(null_laps)}")

    if len(null_laps) == 0:
        print("\n✅ No hay vueltas para reparar.")
        conn.close()
        return

    # Mostrar primeras 5 vueltas para confirmar
    print("\n🔍 Muestra de vueltas a reparar (primeras 5):")
    for lap in null_laps[:5]:
        print(f"  - ID: {lap['id']} | Piloto: {lap['driver_id']} | Vuelta: {lap['lap_number']} | Tiempo: {lap['lap_seconds']}s")

    # Paso 3: Actualizar las vueltas
    print(f"\n⚙️ Actualizando {len(null_laps)} vueltas...")
    updated_count = 0

    for lap in null_laps:
        avg_speed_kmh = (track_length_km / lap['lap_seconds']) * 3600
        cursor.execute(
            "UPDATE laps SET avg_speed_kmh = ? WHERE id = ?",
            (avg_speed_kmh, lap['id'])
        )
        updated_count += 1

    conn.commit()

    print(f"\n✅ Actualizadas: {updated_count} vueltas")

    # Paso 4: Verificar
    print("\n🔎 Verificación:")
    cursor.execute("""
        SELECT id, driver_id, lap_number, lap_seconds, avg_speed_kmh
        FROM laps
        WHERE avg_speed_kmh IS NOT NULL
        ORDER BY id DESC
        LIMIT 5
    """)
    verified_laps = cursor.fetchall()

    for lap in verified_laps:
        print(f"  - ID: {lap['id']} | Piloto: {lap['driver_id']} | Vuelta: {lap['lap_number']} | Velocidad: {lap['avg_speed_kmh']:.2f} km/h")

    print("\n" + "="*60)
    print("✅ Proceso completado!")
    print("="*60)

    conn.close()

if __name__ == "__main__":
    main()

