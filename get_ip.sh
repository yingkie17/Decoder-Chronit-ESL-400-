#!/bin/bash
# ============================================================
# Obtener IP real de la PC (no la de Docker)
# ============================================================

# Obtener la IP de la interfaz activa (no localhost, no Docker)
HOST_IP=$(hostname -I | grep -oE '192\.168\.[0-9]+\.[0-9]+' | head -n 1)

# Si no hay IP 192.168.x.x, intentar con cualquier IP que no sea 127.0.0.1 ni 172.x.x.x
if [ -z "$HOST_IP" ]; then
    HOST_IP=$(hostname -I | awk '{for(i=1;i<=NF;i++) if($i!~/^127\./ && $i!~/^172\./ && $i!~/^10\./) print $i}' | head -n 1)
fi

# Si aún no hay IP, usar 192.168.1.100 como fallback
if [ -z "$HOST_IP" ]; then
    HOST_IP="192.168.1.100"
fi

echo "========================================"
echo "🌐 IP REAL DETECTADA: $HOST_IP"
echo "========================================"
echo ""

export HOST_IP=$HOST_IP

# Mostrar cómo iniciar Docker con la IP
echo "📌 Para iniciar Docker con esta IP, ejecuta:"
echo ""
echo "   source get_ip.sh && docker compose up --build"
echo ""
echo "O directamente:"
echo ""
echo "   HOST_IP=$HOST_IP docker compose up --build"
echo ""