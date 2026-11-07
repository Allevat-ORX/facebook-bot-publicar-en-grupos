# 🤖 Facebook Bot — Publicar en Grupos

Bot de automatización para publicar en múltiples grupos de Facebook de forma automática, usando Playwright y Node.js.

---

## ¿Qué hace este bot?

- Inicia sesión en Facebook con tu cuenta.
- Recorre una lista de grupos configurada por ti o recopilada con `recolector.js`.
- Publica automáticamente el texto que definas.
- Lleva un registro de progreso para no repetir grupos entre ejecuciones.
- Expone el servidor de captación para recibir lotes firmados desde Odoo.
- Guarda un log con el resultado de cada publicación.

## Requisitos

- Node.js v18 o superior.
- Docker Engine y Docker Compose v2 para el despliegue en contenedor.
- Una cuenta de Facebook.
- Ser miembro de los grupos donde quieres publicar.

## Instalación y ejecución local

```bash
npm ci
npm run lint
npm test
npx playwright install chromium
```

Para guardar la sesión de Facebook por primera vez:

```bash
node abrir-sesion.js
```

La sesión queda en `facebook-session/` y no se sube a Git. Para ejecutar el bot legacy fuera del servidor HTTP:

```bash
node index.js
```

## Configuración de producción

El servicio usa un único proceso escritor para los archivos JSON. No ejecutes simultáneamente el worker con `node servidor_captacion.js`, otro contenedor Compose o una segunda unidad systemd. Compose y systemd son alternativas de despliegue, no servicios que deban estar activos al mismo tiempo.

Las rutas `COLA_PATH` y `CATALOGO_PATH` deben estar dentro de un directorio de datos montado. La cola se guarda con `fsync` y rename atómico; un bind mount de un archivo individual rompería esa garantía.

| Variable | Valor de producción | Uso |
| --- | --- | --- |
| `ONRENTX_HMAC_SECRET` | Obligatorio, solo fuera de Git | Firma HMAC de las rutas `/api` |
| `HMAC_MAX_SKEW_SECONDS` | `300` | Ventana máxima de timestamp de la firma |
| `REQUEST_BODY_LIMIT_BYTES` | `2097152` | Límite de cuerpo HTTP |
| `MAX_GROUPS_PER_BATCH` | `30` | Límite operativo por lote |
| `COLA_PATH` | `/app/data/cola.json` en Docker | Cola JSON operativa |
| `CATALOGO_PATH` | `/app/data/catalogo_grupos.json` en Docker | Catálogo operativo |
| `ENABLE_LEGACY_GROUP_SELECTION` | `true` durante rollout | Compatibilidad con clientes legacy |
| `CORS_ALLOWED_ORIGINS` | Orígenes HTTPS explícitos, opcional | Preflight desde un cliente web |

No uses `*` como origen CORS. El health check `GET /health` es público. Las rutas `/api` de lectura y escritura requieren `X-OnRentX-Timestamp`, `X-OnRentX-Nonce` y `X-OnRentX-Signature`; el servidor rechaza nonces repetidos y timestamps fuera de cinco minutos.

### Migración del catálogo

Haz una copia de la cola antes de reemplazar o migrar datos. El directorio `data/` está ignorado por Git y debe existir en el host:

```bash
mkdir -p data
node scripts/migrar-catalogo.js --output data/catalogo_grupos.json --odoo-output data/catalogo_grupos_odoo.json
```

`--odoo-output` es obligatorio porque el script produce también el seed de catálogo para Odoo. No subas ninguno de esos archivos operativos al repositorio.

### Verificación antes de desplegar

Ejecuta estos comandos desde la raíz del repositorio. `ONRENTX_HMAC_SECRET` debe estar definido en el entorno para que Compose resuelva la variable obligatoria. Para una comprobación local usa un valor efímero que no sea un secreto de producción y no compartas la salida de `docker compose config` si contiene el valor.

```bash
npm ci
npm run lint
npm test
npm run test:integration
export ONRENTX_HMAC_SECRET="validation-only-not-production"
docker compose config
docker compose build
```

`docker compose config` verifica la configuración renderizada, incluidos `./data:/app/data`, `COLA_PATH`, `CATALOGO_PATH` y los límites. No permite verificar el `FROM` del Dockerfile. Comprueba la versión declarada en el Dockerfile con una inspección separada y después valida el build:

```bash
node -e "const p=require('./package-lock.json'); const v=p.packages['node_modules/playwright'].version; const d=require('fs').readFileSync('Dockerfile','utf8'); if(!d.includes(v)) process.exit(1)"
ONRENTX_HMAC_SECRET="validation-only-not-production" docker compose build
```

El chequeo anterior inspecciona el `Dockerfile`; `docker compose build` confirma que la imagen se puede construir desde ese Dockerfile. La imagen y la librería usan Playwright `1.60.0`.

### Docker Compose

Genera un secreto fuera del repositorio y expórtalo solo para la sesión que vaya a iniciar Compose:

```bash
export ONRENTX_HMAC_SECRET="$(openssl rand -hex 32)"
export CORS_ALLOWED_ORIGINS="https://portal.onrentx.com"
mkdir -p data facebook-session
docker compose up -d
curl --fail http://127.0.0.1:4599/health
```

No guardes el secreto en `.env`, en el compose, en una imagen ni en logs. El volumen `./data:/app/data` contiene `cola.json` y `catalogo_grupos.json`; el volumen de sesión contiene las cookies de Facebook.

### Unidad systemd

La unidad `onrentx-captacion.service` espera el despliegue en `/opt/onrentx-captacion-facebook` y el secreto en `/etc/onrentx/captacion.env`. No crees ese archivo dentro de este repositorio. En el servidor, crea el archivo con permisos restringidos:

```bash
sudo install -d -o root -g root -m 750 /etc/onrentx
sudo sh -c 'umask 077; printf "ONRENTX_HMAC_SECRET=%s\nCORS_ALLOWED_ORIGINS=%s\n" "$(openssl rand -hex 32)" "https://portal.onrentx.com" > /etc/onrentx/captacion.env'
sudo chmod 600 /etc/onrentx/captacion.env
sudo install -m 644 onrentx-captacion.service /etc/systemd/system/onrentx-captacion.service
```

El archivo debe permanecer con modo `600` y ser legible únicamente por root. `EnvironmentFile=/etc/onrentx/captacion.env` inyecta el secreto sin embebérselo en la unidad versionada. Las rutas de cola y catálogo de systemd son `/opt/onrentx-captacion-facebook/data/cola.json` y `/opt/onrentx-captacion-facebook/data/catalogo_grupos.json`.

Valida el servicio sin exponer la cola sin firma:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onrentx-captacion.service
curl --fail http://127.0.0.1:4599/health
sudo systemctl status --no-pager onrentx-captacion.service
```

No actives Compose y systemd para el mismo directorio de datos. Antes de cambiar de runtime, detén el escritor anterior y comprueba que no quede otro proceso usando la cola.

### Backup de cola y rollout compatible

Haz el backup con el servicio detenido o coordinando una ventana sin escrituras. El proceso systemd corre como `ubuntu`; crea el directorio de datos con ese propietario y modo `0700`, y conserva la copia junto con la unidad anterior:

```bash
sudo install -d -o ubuntu -g ubuntu -m 0700 /opt/onrentx-captacion-facebook/data
sudo install -d -o ubuntu -g ubuntu -m 0700 /opt/onrentx-captacion-facebook/backups
backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -o ubuntu -g ubuntu -m 0600 /opt/onrentx-captacion-facebook/data/cola.json "/opt/onrentx-captacion-facebook/backups/cola.json.${backup_timestamp}"
sudo install -o ubuntu -g ubuntu -m 0600 /opt/onrentx-captacion-facebook/data/catalogo_grupos.json "/opt/onrentx-captacion-facebook/backups/catalogo_grupos.json.${backup_timestamp}"
sudo install -o ubuntu -g ubuntu -m 0644 /etc/systemd/system/onrentx-captacion.service "/opt/onrentx-captacion-facebook/backups/onrentx-captacion.service.${backup_timestamp}"
sudo -u ubuntu test -r "/opt/onrentx-captacion-facebook/backups/cola.json.${backup_timestamp}"
sudo -u ubuntu test -r "/opt/onrentx-captacion-facebook/backups/catalogo_grupos.json.${backup_timestamp}"
```

El rollout recomendado mantiene `ENABLE_LEGACY_GROUP_SELECTION=true`: despliega el servidor, valida `/health`, cambia los clientes al contrato v2 y confirma que no quedan consumidores legacy. Solo después desactiva el contrato antiguo de forma coordinada. Las versiones anteriores del cliente siguen firmando con el mismo HMAC durante la transición.

Para desactivar legacy en systemd, usa un override y luego reinicia durante una ventana coordinada:

```bash
sudo systemctl edit onrentx-captacion.service
```

Contenido del override:

```ini
[Service]
Environment=ENABLE_LEGACY_GROUP_SELECTION=false
```

Después aplica el cambio:

```bash
sudo systemctl daemon-reload
sudo systemctl restart onrentx-captacion.service
curl --fail http://127.0.0.1:4599/health
```

En Compose, cambia `ENABLE_LEGACY_GROUP_SELECTION` a `"false"` en `docker-compose.yml`, valida con `docker compose config` y recrea el único contenedor escritor. No hagas ese cambio hasta terminar la migración coordinada.

### Rollback

Si el health check falla o el cliente compatible no puede completar el rollout, detén el servicio nuevo y restaura la unidad previamente respaldada. Ejecuta la restauración de los JSON solo si la unidad anterior necesita esos bytes y siempre con todos los escritores detenidos:

```bash
sudo systemctl stop onrentx-captacion.service
sudo install -o root -g root -m 0644 /opt/onrentx-captacion-facebook/backups/onrentx-captacion.service.PREVIOUS /etc/systemd/system/onrentx-captacion.service

restore_json() {
  local backup="$1"
  local target="$2"
  local temporary
  temporary="$(sudo mktemp "${target}.rollback.XXXXXX")"
  sudo install -o ubuntu -g ubuntu -m 0600 "$backup" "$temporary"
  sudo chown ubuntu:ubuntu "$temporary"
  sudo -u ubuntu test -r "$temporary"
  sudo -u ubuntu node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$temporary"
  sudo mv -f "$temporary" "$target"
  sudo chown ubuntu:ubuntu "$target"
  sudo chmod 0600 "$target"
  sudo -u ubuntu test -r "$target"
  sudo -u ubuntu node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$target"
}

restore_json \
  /opt/onrentx-captacion-facebook/backups/cola.json.TIMESTAMP \
  /opt/onrentx-captacion-facebook/data/cola.json
restore_json \
  /opt/onrentx-captacion-facebook/backups/catalogo_grupos.json.TIMESTAMP \
  /opt/onrentx-captacion-facebook/data/catalogo_grupos.json
sudo systemctl daemon-reload
sudo systemctl start onrentx-captacion.service
curl --fail http://127.0.0.1:4599/health
```

`PREVIOUS` y `TIMESTAMP` son marcadores que debes sustituir por nombres reales. La copia temporal se crea en el mismo directorio, se asigna a `ubuntu:ubuntu`, se verifica como legible y se mueve de forma atómica. No borres los JSON actuales ni fuerces un rename sin conservar primero la copia. El rollback vuelve al contrato y a la unidad anteriores; no debe ejecutarse junto con el despliegue nuevo.

## Configuración legacy local

### `texto.js`

Escribe el texto que quieres publicar en los grupos.

### `grupos.js`

Agrega las URLs de los grupos donde quieres publicar. Debes ser miembro de cada uno.

### `progreso.json`

Controla desde qué grupo continúa el bot en la próxima ejecución. Si quieres reiniciar desde el principio, cambia el valor a `0`:

```json
{
  "ultimo": 0
}
```

## Recolector de grupos

El archivo `recolector.js` es una herramienta opcional que genera tu lista de grupos automáticamente.

**Ejecutar el recolector:**

```bash
node recolector.js
```

El recolector puede tardar varios minutos dependiendo de cuántos grupos tengas.

## Aviso importante

Esta herramienta automatiza publicaciones en Facebook. Úsala de forma responsable, no publiques spam o contenido engañoso y respeta las reglas de cada grupo. Facebook puede restringir cuentas que publican de forma masiva.

## Autor

Desarrollado por **Ricardo** — automatización y desarrollo web a medida.
