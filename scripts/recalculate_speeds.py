#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../src'))
from database import get_db, get_track_length
import sqlite3

def recalculate_all_speeds():
    print("🔄 Recalculando velocidades para todas las vueltas...")
    
    track_length = get_track_length()
    print(f"📏 Largo de pista: {track_length} km")
    
    if track_length <= 0:
        print("❌ Error: Largo de pista no es válido (debe ser > 0)")
        return False
    
    updated_count = 0
    with get_db() as conn:
        try:
            laps = conn.execute('''
                SELECT id, lap_seconds FROM laps WHERE lap_seconds IS NOT NULL AND lap_seconds > 0
            ''').fetchall()
            
            for lap in laps:
                lap_id = lap['id']
                lap_seconds = lap['lap_seconds']
                
                avg_speed = (track_length / lap_seconds) * 3600
                
                conn.execute('''
                    UPDATE laps SET avg_speed_kmh = ? WHERE id = ?
                ''', (avg_speed, lap_id))
                
                updated_count += 1
            
            print(f"✅ Se actualizaron {updated_count} vueltas")
            return True
            
        except Exception as e:
            print(f"❌ Error: {e}")
            return False

if __name__ == "__main__":
    if recalculate_all_speeds():
        print("\n✅ Recálculo completado exitosamente!")
    else:
        print("\n❌ Falló el recálculo de velocidades")
