
#!/usr/bin/env python3
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("="*60)
    print("Verificando session actual y endpoint /api/laps/speed")
    print("="*60)

    # Obtener la sesión actual
    cursor.execute("SELECT value FROM settings WHERE key = 'current_session_id'")
    current_session_id = cursor.fetchone()
    if current_session_id:
        current_session_id = int(current_session_id['value'])
        print(f"\nSession ID actual: {current_session_id}")

        # Obtener los pilotos en esta sesión
        cursor.execute("SELECT driver_id FROM race_drivers WHERE session_id = ?", (current_session_id,))
        drivers = cursor.fetchall()
        print(f"\nPilotos en la sesión: {[d['driver_id'] for d in drivers]}")

        # Probar la consulta que usa el endpoint /api/laps/speed
        for driver in drivers:
            driver_id = driver['driver_id']
            print(f"\n--- Piloto {driver_id} ---")
            cursor.execute('''
                SELECT lap_number, lap_seconds, avg_speed_kmh
                FROM laps
                WHERE session_id = ? AND driver_id = ? AND lap_number > 0
                ORDER BY lap_number ASC
            ''', (current_session_id, driver_id))
            laps = cursor.fetchall()
            print(f"Vueltas encontradas: {len(laps)}")
            for lap in laps:
                print(f"  Lap {lap['lap_number']}: {lap['lap_seconds']}s | {lap['avg_speed_kmh']} km/h")

    conn.close()

if __name__ == "__main__":
    main()

