# node:20-slim es Debian — compatible con el binario glibc de bgutil-pot
# Alpine usa musl y NO es compatible con ese binario
FROM node:20-slim

# Instalar dependencias del sistema (apt en lugar de apk)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
         echo "⚠️ Arquitectura no soportada: $ARCH" && exit 1; \
       fi \
    && echo "📦 Descargando $BINARY para $ARCH..." \
    && curl -fL \
       "https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/${BINARY}" \
       -o /usr/local/bin/bgutil-pot \
    && chmod +x /usr/local/bin/bgutil-pot \
    && bgutil-pot --version \
    && echo "✅ bgutil-pot instalado correctamente"

WORKDIR /app

# Copiar dependencias Node
COPY package*.json ./
RUN npm install --omit=dev

# Copiar código y script de arranque
COPY . .
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080

ENTRYPOINT ["/start.sh"]
