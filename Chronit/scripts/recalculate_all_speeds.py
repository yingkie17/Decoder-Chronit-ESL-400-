
#!/usr/bin/env python3
import sqlite3
import os

# Ruta de la base de datos (para ejecutar en el host)
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    print("="*60)
    print("CHRONIT: Actualizar TODAS las velocidades con nuevo largo de pista")
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
        print("\n❌ ERROR: El largo de pista es 0 o negativo.")
        conn.close()
        return

    # Paso 2: Listar todas las vueltas (con lap_seconds válido)
    cursor.execute("""
        SELECT id, session_id, driver_id, lap_number, lap_seconds, avg_speed_kmh
        FROM laps
        WHERE lap_seconds IS NOT NULL AND lap_seconds > 0
    """)
    all_laps = cursor.fetchall()

    print(f"\n📊 Total de vueltas a actualizar: {len(all_laps)}")

    if len(all_laps) == 0:
        print("\n✅ No hay vueltas para actualizar.")
        conn.close()
        return

    # Paso 3: Actualizar TODAS las vueltas
    print(f"\n⚙️ Actualizando {len(all_laps)} vueltas...")
    updated_count = 0

    for lap in all_laps:
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

