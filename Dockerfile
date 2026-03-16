# Partir de Node 20 (Alpine)
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
         echo "⚠️ Arquitectura no soportada: $ARCH, omitiendo bgutil-pot"; \
         exit 0; \
       fi \
    && echo "📦 Descargando $BINARY..." \
    && curl -fL \
       "https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/${BINARY}" \
       -o /usr/local/bin/bgutil-pot \
    && chmod +x /usr/local/bin/bgutil-pot \
    && echo "✅ bgutil-pot instalado ($(bgutil-pot --version 2>&1 || echo 'versión desconocida'))"

WORKDIR /app

# Copiar dependencias Node
COPY package*.json ./
RUN npm install --omit=dev

# Copiar código y script de arranque
COPY . .
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080

# Usar script dedicado en lugar de CMD inline
ENTRYPOINT ["/start.sh"]
