# Partir de Node 20 (Alpine) — Railway lo soporta
FROM node:20-alpine

# Instalar dependencias del sistema
RUN apk add --no-cache python3 py3-pip ffmpeg curl

# ── Instalar yt-dlp ────────────────────────────────────────────────────────
RUN pip3 install --no-cache-dir yt-dlp --break-system-packages

# ── Instalar el plugin POT para yt-dlp ────────────────────────────────────
# Descarga el zip del plugin desde GitHub y lo instala en el directorio de plugins de yt-dlp
RUN mkdir -p /root/yt-dlp-plugins \
    && curl -L \
       https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-ytdlp-pot-provider-rs.zip \
       -o /tmp/pot-plugin.zip \
    && unzip /tmp/pot-plugin.zip -d /root/yt-dlp-plugins/bgutil-ytdlp-pot-provider \
    && rm /tmp/pot-plugin.zip

# ── Descargar binario bgutil-pot según arquitectura ───────────────────────
# Railway puede ser x86_64 o aarch64 dependiendo del plan
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
    && echo "bgutil-pot instalado correctamente"

WORKDIR /app

# Copiar dependencias Node
COPY package*.json ./
RUN npm install --omit=dev

# Copiar código
COPY . .

EXPOSE 8080

# 1. Arrancar bgutil-pot server en background (puerto 4416)
# 2. Esperar 3s a que inicialice
# 3. Lanzar el backend Node
CMD ["sh", "-c", "bgutil-pot server --host 127.0.0.1 --port 4416 & sleep 3 && node server.js"]
