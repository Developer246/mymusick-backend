#!/bin/sh
set -e

echo "🔍 Arquitectura: $(uname -m)"

# Arrancar bgutil-pot si está disponible
if command -v bgutil-pot > /dev/null 2>&1; then
  echo "🔑 Arrancando bgutil-pot server en puerto 4416..."
  bgutil-pot server --host 127.0.0.1 --port 4416 &
  POT_PID=$!
  sleep 3

  # Verificar que sigue corriendo
  if kill -0 $POT_PID 2>/dev/null; then
    echo "✅ bgutil-pot arrancado (PID $POT_PID)"
  else
    echo "⚠️  bgutil-pot se cerró inesperadamente, continuando sin él"
  fi
else
  echo "⚠️  bgutil-pot no disponible, continuando sin POT server"
fi

# Arrancar el backend Node
echo "🚀 Arrancando Node.js..."
exec node server.js
