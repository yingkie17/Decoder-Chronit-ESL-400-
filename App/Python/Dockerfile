FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    coreutils \
    python3-dev \
    usbutils \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pyserial flask flask-cors

WORKDIR /app

COPY main.py .
COPY database.py .
COPY api.py .
COPY templates/ ./templates/

RUN mkdir -p /app/data

CMD ["python", "-u", "main.py"]
