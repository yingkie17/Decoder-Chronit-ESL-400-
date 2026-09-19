#!/bin/bash
echo "🔄 Reiniciando servidor CHRONIT..."
curl -X POST http://localhost:5000/api/restart
echo ""
echo "✅ Servidor reiniciado"
