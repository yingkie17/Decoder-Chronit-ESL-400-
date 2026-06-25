FROM python:3.11-slim

# ============================================
# INSTALAR DEPENDENCIAS DEL SISTEMA
# ============================================
RUN apt-get update && apt-get install -y \
    coreutils \
    python3-dev \
    usbutils \
    gcc \
    musl-dev \
    libffi-dev \
    # Dependencias para Pillow (procesamiento de imágenes)
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# INSTALAR DEPENDENCIAS DE PYTHON
# ============================================
RUN pip install --no-cache-dir \
    pyserial \
    flask \
    flask-cors \
    netifaces \
    # Pillow para procesar imágenes
    Pillow \
    # Otras dependencias útiles
    Werkzeug

# ============================================
# CONFIGURAR DIRECTORIO DE TRABAJO
# ============================================
WORKDIR /app

# ============================================
# COPIAR ARCHIVOS DEL PROYECTO
# ============================================
COPY src/main.py .
COPY src/database.py .
COPY src/api.py .
COPY src/cleanup.py .
COPY src/decoder_modes.py .
COPY src/users_db.py .
COPY src/templates/ ./templates/
COPY src/static/ ./static/

# ============================================
# CREAR CARPETAS PARA FOTOS Y DATOS
# ============================================
RUN mkdir -p /app/static/uploads/drivers/thumbnails
RUN mkdir -p /app/data
RUN pip install --no-cache-dir Pillow

# ============================================
# EXPONER PUERTO
# ============================================
EXPOSE 5000

# ============================================
# COMANDO DE INICIO
# ============================================
CMD ["python", "-u", "main.py"]