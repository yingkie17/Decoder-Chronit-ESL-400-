#!/usr/bin/env python
# cleanup.py - Herramienta de mantenimiento para Chronit
# ---Para ejecutar --- docker exec hardware-1 python /app/src/cleanup.py --keep-last 30 --show-stats

import sqlite3
import argparse
import os
from datetime import datetime

DB_PATH = '/app/data/chronit.db'

def cleanup_old_races(keep_last):
    """Borra carreras antiguas manteniendo las últimas 'keep_last' carreras"""
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Obtener IDs de carreras a conservar
    cursor.execute('''
        SELECT id FROM race_sessions 
        ORDER BY id DESC 
        LIMIT ?
    ''', (keep_last,))
    
    kept_ids = [row[0] for row in cursor.fetchall()]
    
    if not kept_ids:
        print("❌ No hay carreras para conservar")
        return 0
    
    # Contar registros a borrar
    cursor.execute(f'''
        SELECT COUNT(*) FROM race_sessions 
        WHERE id NOT IN ({','.join('?' * len(kept_ids))})
    ''', kept_ids)
    to_delete = cursor.fetchone()[0]
    
    if to_delete == 0:
        print(f"✅ Ya solo hay {keep_last} carreras. Nada que borrar.")
        return 0
    
    print(f"📊 Se borrarán {to_delete} carreras antiguas")
    
    # Borrar vueltas de carreras antiguas
    cursor.execute(f'''
        DELETE FROM laps 
        WHERE session_id NOT IN ({','.join('?' * len(kept_ids))})
    ''', kept_ids)
    laps_deleted = cursor.rowcount
    
    # Borrar pilotos inscritos de carreras antiguas
    cursor.execute(f'''
        DELETE FROM race_drivers 
        WHERE session_id NOT IN ({','.join('?' * len(kept_ids))})
    ''', kept_ids)
    
    # Borrar las carreras antiguas
    cursor.execute(f'''
        DELETE FROM race_sessions 
        WHERE id NOT IN ({','.join('?' * len(kept_ids))})
    ''', kept_ids)
    races_deleted = cursor.rowcount
    
    conn.commit()
    conn.close()
    
    print(f"✅ Limpieza completada:")
    print(f"   - {laps_deleted} vueltas eliminadas")
    print(f"   - {races_deleted} carreras eliminadas")
    
    return races_deleted

def show_stats():
    """Muestra estadísticas de la base de datos"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('SELECT COUNT(*) FROM race_sessions')
    total_races = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(*) FROM laps')
    total_laps = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(*) FROM drivers')
    total_drivers = cursor.fetchone()[0]
    
    # Calcular tamaño de la BD
    size_bytes = os.path.getsize(DB_PATH)
    size_mb = size_bytes / (1024 * 1024)
    
    conn.close()
    
    print("\n📊 ESTADÍSTICAS DE LA BASE DE DATOS:")
    print(f"   - Carreras guardadas: {total_races}")
    print(f"   - Vueltas registradas: {total_laps}")
    print(f"   - Pilotos registrados: {total_drivers}")
    print(f"   - Tamaño: {size_mb:.2f} MB")
    
    if size_mb > 100:
        print("   ⚠️ ¡ATENCIÓN! La base está creciendo. Recomiendo limpieza pronto.")
    elif size_mb > 50:
        print("   🟡 La base tiene un tamaño considerable.")
    else:
        print("   🟢 Tamaño saludable.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Limpieza de carreras antiguas')
    parser.add_argument('--keep-last', type=int, default=30,
                        help='Número de últimas carreras a conservar (default: 30)')
    parser.add_argument('--stats', action='store_true',
                        help='Mostrar estadísticas sin hacer limpieza')
    
    args = parser.parse_args()
    
    if args.stats:
        show_stats()
    else:
        print(f"🧹 INICIANDO LIMPIEZA - Conservando últimas {args.keep_last} carreras")
        cleanup_old_races(args.keep_last)