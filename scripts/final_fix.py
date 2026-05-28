
#!/usr/bin/env python3
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("="*60)
    print("Actualizando configuración de pista a 0.1 km (100 metros)")
    print("="*60)

    NEW_TRACK_LENGTH_KM = 0.1

    cursor.execute('''
        UPDATE circuit_config
        SET track_length_km = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
    ''', (NEW_TRACK_LENGTH_KM,))
    conn.commit()
    print(f"\n✅ Largo de pista actualizado a {NEW_TRACK_LENGTH_KM} km")

    # Recalcular todas las velocidades
    print("\nRecalculando velocidades...")
    cursor.execute("""
        SELECT id, lap_seconds
        FROM laps
        WHERE lap_seconds IS NOT NULL AND lap_seconds > 0
    """)
    all_laps = cursor.fetchall()
    for lap in all_laps:
        avg_speed_kmh = (NEW_TRACK_LENGTH_KM / lap['lap_seconds']) * 3600
        cursor.execute("UPDATE laps SET avg_speed_kmh = ? WHERE id = ?", (avg_speed_kmh, lap['id']))
    conn.commit()
    print(f"✅ Actualizadas {len(all_laps)} vueltas")

    # Verificar
    print("\n🔎 Verificación:")
    cursor.execute("""
        SELECT id, driver_id, lap_number, lap_seconds, avg_speed_kmh
        FROM laps
        WHERE session_id = 310
        ORDER BY id DESC
    """)
    for lap in cursor.fetchall():
        print(f"  ID: {lap['id']} | Velocidad: {lap['avg_speed_kmh']:.2f} km/h")

    conn.close()

if __name__ == "__main__":
    main()

