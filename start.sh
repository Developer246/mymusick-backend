#!/bin/sh

echo "🔍 Arquitectura: $(uname -m)"

# ── Registrar Node.js como runtime JS para yt-dlp ─────────────────────────
NODE_BIN=$(which node)
echo "🟢 Node.js encontrado en: ${NODE_BIN}"

# Crear config global de yt-dlp con el runtime de Node
mkdir -p /root/.config/yt-dlp
echo "--js-runtimes node:${NODE_BIN}" > /root/.config/yt-dlp/config
echo "✅ yt-dlp configurado con runtime: nodejs:${NODE_BIN}"

# ── Arrancar bgutil-pot si está disponible ─────────────────────────────────
if [ -f "/usr/local/bin/bgutil-pot" ]; then
  echo "🔑 Arrancando bgutil-pot server en puerto 4416..."
  /usr/local/bin/bgutil-pot server --host 127.0.0.1 --port 4416 &
  POT_PID=$!
  sleep 3

  if kill -0 $POT_PID 2>/dev/null; then
    echo "✅ bgutil-pot arrancado (PID $POT_PID)"
  else
    echo "⚠️  bgutil-pot se cerró inesperadamente"
  fi
else
  echo "⚠️  bgutil-pot no encontrado, continuando sin POT server"
fi

# ── Arrancar Node.js ───────────────────────────────────────────────────────
echo "🚀 Arrancando Node.js..."
exec node /app/server.js
