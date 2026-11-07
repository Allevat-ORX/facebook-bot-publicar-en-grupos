# ============================================================
# DOCKERFILE — ONRENTX CAPTACIÓN & SONDEO WORKER
# ============================================================
FROM mcr.microsoft.com/playwright:v1.60.0-noble

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
ENV COLA_PATH=/app/data/cola.json
ENV CATALOGO_PATH=/app/data/catalogo_grupos.json
ENV HMAC_MAX_SKEW_SECONDS=300
ENV REQUEST_BODY_LIMIT_BYTES=2097152
ENV MAX_GROUPS_PER_BATCH=30
ENV ENABLE_LEGACY_GROUP_SELECTION=true

# Exponer el puerto de la API y Visor
EXPOSE 4599

# Punto de entrada
CMD ["node", "servidor_captacion.js"]
