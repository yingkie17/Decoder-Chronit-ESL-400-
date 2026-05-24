
#!/usr/bin/env python3
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("="*60)
    print("Verificando datos de vueltas (avg_speed_kmh)")
    print("="*60)

    # Listar todas las vueltas (primeras 20)
    print("\nPrimeras 20 vueltas:")
    cursor.execute("SELECT id, driver_id, lap_number, lap_seconds, avg_speed_kmh FROM laps LIMIT 20")
    for lap in cursor.fetchall():
        print(f"ID: {lap['id']}, Driver: {lap['driver_id']}, Lap: {lap['lap_number']}, LapSec: {lap['lap_seconds']}, AvgSpeed: {lap['avg_speed_kmh']}")

    print("\n" + "="*60)
    print("Vueltas con avg_speed_kmh NOT NULL:")
    cursor.execute("SELECT COUNT(*) FROM laps WHERE avg_speed_kmh IS NOT NULL")
    count = cursor.fetchone()[0]
    print(f"Total: {count}")

    conn.close()

if __name__ == "__main__":
    main()

