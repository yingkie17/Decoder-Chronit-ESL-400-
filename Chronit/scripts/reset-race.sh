#!/bin/bash
echo "🔄 Reiniciando carrera actual..."
curl -X POST http://localhost:5000/api/session/start -H "Content-Type: application/json" -d '{"name":"Nueva Carrera"}'
echo ""
echo "✅ Carrera reiniciada - Las vueltas empezarán desde 0"
