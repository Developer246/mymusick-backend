#!/bin/sh

echo "🔍 Arquitectura: $(uname -m)"
echo "🔍 OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2)"
echo "🔍 Buscando bgutil-pot..."

# Verificar si el archivo existe
if [ -f "/usr/local/bin/bgutil-pot" ]; then
  echo "✅ Archivo existe en /usr/local/bin/bgutil-pot"
  echo "🔍 Permisos: $(ls -la /usr/local/bin/bgutil-pot)"
  echo "🔍 Tipo de archivo: $(file /usr/local/bin/bgutil-pot)"

  # Intentar ejecutar y capturar error
  /usr/local/bin/bgutil-pot --version 2>&1 && echo "✅ Ejecutable correctamente" || echo "❌ Error al ejecutar: $?"

  echo "🔑 Arrancando bgutil-pot server en puerto 4416..."
  /usr/local/bin/bgutil-pot server --host 127.0.0.1 --port 4416 &
  POT_PID=$!
  sleep 3

  if kill -0 $POT_PID 2>/dev/null; then
    echo "✅ bgutil-pot arrancado (PID $POT_PID)"
  else
    echo "⚠️  bgutil-pot se cerró, revisando dependencias faltantes..."
    ldd /usr/local/bin/bgutil-pot 2>&1 || echo "ldd no disponible"
  fi
else
  echo "❌ bgutil-pot NO encontrado en /usr/local/bin/"
  echo "🔍 Contenido de /usr/local/bin/: $(ls /usr/local/bin/)"
fi

echo "🚀 Arrancando Node.js..."
exec node /app/server.js
