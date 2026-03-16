# Partir de Node 20 (Alpine) — Railway lo soporta
FROM node:20-alpine

# Instalar dependencias del sistema
RUN apk add --no-cache python3 py3-pip ffmpeg curl unzip

# ── Instalar yt-dlp ────────────────────────────────────────────────────────
RUN pip3 install --no-cache-dir yt-dlp --break-system-packages

# ── Instalar el plugin POT para yt-dlp ────────────────────────────────────
RUN pip3 install --no-cache-dir bgutil-ytdlp-pot-provider --break-system-packages

# ── Descargar binario bgutil-pot según arquitectura ───────────────────────
RUN ARCH=$(uname -m) \
    && if [ "$ARCH" = "x86_64" ]; then \
         BINARY="bgutil-pot-linux-x86_64"; \
       elif [ "$ARCH" = "aarch64" ]; then \
         BINARY="bgutil-pot-linux-aarch64"; \
       else \
         echo "Arquitectura no soportada: $ARCH" && exit 1; \
       fi \
    && echo "Descargando binario para $ARCH: $BINARY" \
    && curl -L \
       "https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/${BINARY}" \
       -o /usr/local/bin/bgutil-pot \
    && chmod +x /usr/local/bin/bgutil-pot \
    && echo "bgutil-pot instalado OK"

WORKDIR /app

# Copiar dependencias Node
COPY package*.json ./
RUN npm install --omit=dev

# Copiar código
COPY . .

EXPOSE 8080

# Arrancar bgutil-pot solo si existe, luego lanzar el backend
CMD ["sh", "-c", "if command -v bgutil-pot > /dev/null 2>&1; then bgutil-pot server --host 127.0.0.1 --port 4416 & sleep 3 && echo '✅ bgutil-pot arrancado'; else echo '⚠️ bgutil-pot no disponible, continuando sin POT server'; fi && node server.js"]
