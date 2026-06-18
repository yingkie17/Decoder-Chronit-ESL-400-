FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    coreutils \
    python3-dev \
    usbutils \
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pyserial flask flask-cors

# Instalar netifaces con build dependencies
RUN pip install --no-cache-dir netifaces

WORKDIR /app

COPY src/main.py .
COPY src/database.py .
COPY src/api.py .
COPY src/templates/ ./templates/

RUN mkdir -p /app/data

CMD ["python", "-u", "main.py"]