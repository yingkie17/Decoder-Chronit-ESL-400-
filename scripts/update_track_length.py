
#!/usr/bin/env python3
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'chronit.db')

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("="*60)
    print("Actualizando configuración de pista")
    print("="*60)

    # Valor realista para pista de kart (ej: 0.8 km = 800 metros)
    NEW_TRACK_LENGTH_KM = 0.8

    # Actualizar la configuración
    cursor.execute('''
        UPDATE circuit_config
        SET track_length_km = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
    ''', (NEW_TRACK_LENGTH_KM,))

    conn.commit()

    print(f"\n✅ Largo de pista actualizado a {NEW_TRACK_LENGTH_KM} km")

    # Verificar la actualización
    cursor.execute("SELECT track_length_km FROM circuit_config WHERE id = 1")
    config = cursor.fetchone()
    print(f"   Valor actual en BD: {config['track_length_km']} km")

    conn.close()

if __name__ == "__main__":
    main()

