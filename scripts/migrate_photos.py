#!/usr/bin/env python
# scripts/migrate_photos.py - Migrar fotos de base64 a archivos

import sqlite3
import os
import base64
import uuid
from PIL import Image
import io

DB_PATH = '/app/data/chronit.db'
UPLOAD_DIR = '/app/static/uploads/drivers'
THUMB_DIR = os.path.join(UPLOAD_DIR, 'thumbnails')

def ensure_dirs():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(THUMB_DIR, exist_ok=True)

def migrate_photos():
    """Migra fotos de base64 a archivos físicos"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Obtener pilotos con foto en base64
    cursor.execute("""
        SELECT id, photo FROM drivers 
        WHERE photo IS NOT NULL AND photo LIKE 'data:image%'
    """)
    
    drivers = cursor.fetchall()
    print(f"📸 Encontrados {len(drivers)} pilotos con fotos en base64")
    
    for driver_id, photo_data in drivers:
        try:
            # Extraer el base64
            if ',' in photo_data:
                photo_data = photo_data.split(',')[1]
            
            # Decodificar
            image_bytes = base64.b64decode(photo_data)
            
            # Generar nombre
            filename = f"driver_{driver_id}_{uuid.uuid4()[:8]}.jpg"
            filepath = os.path.join(UPLOAD_DIR, filename)
            
            # Guardar archivo
            with open(filepath, 'wb') as f:
                f.write(image_bytes)
            
            # Crear thumbnail
            thumb_filename = f"thumb_{filename}"
            thumb_path = os.path.join(THUMB_DIR, thumb_filename)
            
            with Image.open(io.BytesIO(image_bytes)) as img:
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')
                img.thumbnail((80, 80), Image.Resampling.LANCZOS)
                img.save(thumb_path, 'JPEG', quality=85, optimize=True)
            
            # Actualizar BD
            cursor.execute(
                "UPDATE drivers SET photo = ? WHERE id = ?",
                (filename, driver_id)
            )
            conn.commit()
            
            print(f"✅ Piloto {driver_id}: foto migrada a {filename}")
            
        except Exception as e:
            print(f"❌ Error migrando piloto {driver_id}: {e}")
    
    conn.close()
    print("🎯 Migración completada")

if __name__ == "__main__":
    ensure_dirs()
    migrate_photos()