# Base con Node 20
FROM node:20-alpine

# ffmpeg para procesamiento de audio
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copiar dependencias (youtube-dl-exec descarga yt-dlp en postinstall)
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
