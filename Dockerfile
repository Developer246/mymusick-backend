# Base con Node 20
FROM node:20-alpine

# Solo ffmpeg es necesario (youtube-dl-exec descarga yt-dlp automáticamente)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copiar dependencias — el postinstall de youtube-dl-exec descarga el binario yt-dlp
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
