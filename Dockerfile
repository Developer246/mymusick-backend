# Base con Node 20
FROM node:20-alpine

# Instalar Python, pip, ffmpeg y yt-dlp
RUN apk add --no-cache python3 py3-pip ffmpeg curl \
    && pip3 install --no-cache-dir yt-dlp --break-system-packages \
    && yt-dlp --version

WORKDIR /app

# Copiar dependencias primero (mejor cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar el resto del código
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
