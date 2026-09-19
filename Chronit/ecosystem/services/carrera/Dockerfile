FROM python:3.11-slim

# Evitar la advertencia de pip al instalar como root
ENV PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1

# ============================================
# 1. INSTALAR DEPENDENCIAS DEL SISTEMA
# ============================================
RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update && apt-get install -y --no-install-recommends \
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
# 2. CONFIGURAR DIRECTORIO DE TRABAJO Y ESTRUCTURA
# ============================================
WORKDIR /app

# Crear las carpetas de datos y uploads antes de copiar o ejecutar la app
RUN mkdir -p /app/static/uploads/drivers/thumbnails /app/data

# ============================================
# 3. INSTALAR DEPENDENCIAS DE PYTHON
# ============================================
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    pyserial \
    flask \
    flask-cors \
    netifaces \
    Pillow \
    Werkzeug \
    psycopg2-binary \
    # Tiempo real (WebSocket) para la pantalla en pista.
    # Se usa el backend 'threading' + simple-websocket para NO parchear el
    # sistema (eventlet/gevent monkey-patch) y no arriesgar el hilo serial.
    flask-socketio \
    simple-websocket

# ============================================
# 4. COPIAR ARCHIVOS DEL PROYECTO
# ============================================
# Copiamos exactamente tus archivos y carpetas
COPY src/main.py .
COPY src/database.py .
COPY src/api.py .
COPY src/pg_db.py .
COPY src/cleanup.py .
COPY src/decoder_modes.py .
COPY src/users_db.py .
COPY src/templates/ ./templates/
COPY src/static/ ./static/

# ============================================
# 5. EXPONER PUERTO Y COMANDO DE INICIO
# ============================================
EXPOSE 5000

CMD ["python", "-u", "main.py"]