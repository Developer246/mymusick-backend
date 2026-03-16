# Partir de Node 20 (Alpine) — Railway lo soporta perfectamente
FROM node:20-alpine

# Instalar dependencias del sistema
RUN apk add --no-cache python3 py3-pip ffmpeg curl

# ── Instalar yt-dlp ────────────────────────────────────────────────────────
RUN pip3 install --no-cache-dir yt-dlp --break-system-packages

# ── Instalar el plugin POT (Python) para yt-dlp ───────────────────────────
RUN pip3 install --no-cache-dir bgutil-ytdlp-pot-provider --break-system-packages

# ── Descargar el binario bgutil-pot (servidor POT en Rust, sin dependencias) 
RUN curl -L \
    https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64 \
    -o /usr/local/bin/bgutil-pot \
    && chmod +x /usr/local/bin/bgutil-pot \
    && bgutil-pot --version

WORKDIR /app

# Copiar dependencias Node
COPY package*.json ./
RUN npm install --omit=dev

# Copiar código
COPY . .

EXPOSE 8080

# Arrancar el servidor POT en background (puerto 4416) y luego el backend
CMD ["sh", "-c", "bgutil-pot server --host 127.0.0.1 --port 4416 & sleep 3 && node server.js"]
