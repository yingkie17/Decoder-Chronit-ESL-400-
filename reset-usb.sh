#!/bin/bash
echo "🔌 Reiniciando puerto USB..."
curl -X POST http://localhost:5000/api/usb/reset
echo ""
echo "✅ USB reiniciado"
