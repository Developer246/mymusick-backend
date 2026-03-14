# Usa una imagen oficial de Node con FFmpeg disponible
FROM node:20-slim

# Instala FFmpeg y dependencias necesarias
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Configura variable de entorno para desactivar auto-update de ytdl-core
ENV YTDL_NO_UPDATE=1

# Crea directorio de trabajo
WORKDIR /usr/src/app

# Copia package.json y package-lock.json
COPY package*.json ./

# Instala dependencias
RUN npm install --production

# Copia el resto del código
COPY . .

# Expone el puerto (Render detecta automáticamente)
EXPOSE 3000

# Comando de inicio
CMD ["npm", "start"]
