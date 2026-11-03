# ============================================================
# DOCKERFILE — ONRENTX CAPTACIÓN & SONDEO WORKER
# ============================================================
FROM mcr.microsoft.com/playwright:v1.48.0-focal

WORKDIR /app

# Copiar manifiestos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar el código fuente
COPY . .

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=4599
ENV HEADLESS=true
ENV MODO_ASISTIDO=false
ENV LIMITE_TANDA=5
ENV FB_SESSION_DIR=/app/facebook-session

# Exponer el puerto de la API y Visor
EXPOSE 4599

# Punto de entrada
CMD ["node", "servidor_captacion.js"]
