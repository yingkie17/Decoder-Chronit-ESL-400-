
#!/usr/bin/env python3
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("="*60)
    print("Actualizando configuración de pista a 1.2 km (1200 metros)")
    print("="*60)

    NEW_TRACK_LENGTH_KM = 1.2

    # Paso 1: Actualizar la configuración
    cursor.execute('''
        UPDATE circuit_config
        SET track_length_km = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
    ''', (NEW_TRACK_LENGTH_KM,))
    conn.commit()
    print(f"\n✅ Largo de pista actualizado a {NEW_TRACK_LENGTH_KM} km")

    # Paso 2: Recalcular TODAS las velocidades
    print("\n⚙️ Recalculando velocidades para todas las vueltas...")
    cursor.execute("""
        SELECT id, lap_seconds
        FROM laps
        WHERE lap_seconds IS NOT NULL AND lap_seconds > 0
    """)
    all_laps = cursor.fetchall()

    for lap in all_laps:
        avg_speed_kmh = (NEW_TRACK_LENGTH_KM / lap['lap_seconds']) * 3600
        cursor.execute(
            "UPDATE laps SET avg_speed_kmh = ? WHERE id = ?",
            (avg_speed_kmh, lap['id'])
        )

    conn.commit()
    print(f"✅ Actualizadas {len(all_laps)} vueltas")

    # Paso 3: Verificar las vueltas de la sesión actual
    print("\n🔎 Verificación (sesión actual):")
    cursor.execute("SELECT value FROM settings WHERE key = 'current_session_id'")
    current_session_id = cursor.fetchone()
    if current_session_id:
        current_session_id = int(current_session_id['value'])
        cursor.execute("""
            SELECT id, driver_id, lap_number, lap_seconds, avg_speed_kmh
            FROM laps
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT 10
        """, (current_session_id,))
        for lap in cursor.fetchall():
            print(f"  - ID: {lap['id']} | Piloto: {lap['driver_id']} | Vuelta: {lap['lap_number']} | Tiempo: {lap['lap_seconds']:.2f}s | Velocidad: {lap['avg_speed_kmh']:.2f} km/h")

    print("\n" + "="*60)
    print("✅ Proceso completado!")
    print("="*60)

    conn.close()

if __name__ == "__main__":
    main()

