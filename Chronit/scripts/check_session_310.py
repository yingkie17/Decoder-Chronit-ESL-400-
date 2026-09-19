
#!/usr/bin/env python3
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("="*60)
    print("Verificando vueltas de la sesión actual (ID 310)")
    print("="*60)

    session_id = 310

    # Obtener todas las vueltas de la sesión 310
    cursor.execute("""
        SELECT id, driver_id, lap_number, lap_seconds, avg_speed_kmh
        FROM laps
        WHERE session_id = ?
        ORDER BY id DESC
    """, (session_id,))
    laps = cursor.fetchall()
    print(f"\nTotal de vueltas en sesión {session_id}: {len(laps)}")
    for lap in laps:
        print(f"  ID: {lap['id']} | Driver: {lap['driver_id']} | Lap: {lap['lap_number']} | LapSec: {lap['lap_seconds']} | AvgSpeed: {lap['avg_speed_kmh']}")

    # Obtener los pilotos de la sesión 310
    print("\nPilotos en la sesión 310:")
    cursor.execute("SELECT driver_id FROM race_drivers WHERE session_id = ?", (session_id,))
    drivers = cursor.fetchall()
    for d in drivers:
        print(f"  Driver ID: {d['driver_id']}")

    conn.close()

if __name__ == "__main__":
    main()

