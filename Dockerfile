# Imagen base con yt-dlp + POT provider ya integrado
# Evita el bot detection de YouTube en IPs de nube como Railway
FROM ghcr.io/jim60105/yt-dlp:pot

# Instalar Node.js 20 + ffmpeg
RUN apk add --no-cache nodejs npm ffmpeg

WORKDIR /app

# Copiar dependencias
COPY package*.json ./
RUN npm install --omit=dev

# Copiar código
COPY . .

# Arrancar el servidor POT en background y luego el backend
# El POT server escucha en localhost:4416
# yt-dlp lo detecta automáticamente gracias al plugin instalado
CMD ["sh", "-c", "pot-provider & sleep 2 && node server.js"]

EXPOSE 8080
