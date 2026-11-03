# PLAN — Automatización de publicación en grupos de Facebook (OnRentX)

> Estado: PLAN aprobado por Aleix (2026-09-23). Rumbo definido:
> **(1) español construcción · (2) parte de AIS-424 (router OnRentX) · (3) imágenes vía Dify/Bedrock (AIS-400)**.
> Este documento es el contrato del trabajo. Los tickets viven en Jira (ver sección "Jira").

---

## 1. Contexto y realidad técnica (verificado)

- Meta cerró la **Groups API** (abr-2024). **No hay publicación automática a grupos por API/token/n8n/Postiz** — solo Pages.
- Única vía para GRUPOS = **navegador con sesión** (Playwright). Ya montado: fork `Allevat-ORX/facebook-bot-publicar-en-grupos`, clon en `/home/aleix/Proyectos-Claude/fb-group-poster`.
- El bot corre en **máquina de Aleix con GUI** (no en EC2 → IP datacenter = baneo casi seguro).
- **Dify NO publica en grupos**; Dify PREPARA publicaciones (copy + creativo) y las deja en una cola. El bot es el único que publica.

## 2. Arquitectura (encaja en AIS-424 "router OnRentX")

```
DIFY (AIS-253 / AIS-400)        COLA (contrato router AIS-424)      BOT (máquina Aleix)
─────────────────────────       ──────────────────────────────      ────────────────────
- genera N variantes copy   ─┐   cola.json:                          - lee cola.json
- genera/elige imagen (AIS-400)├─▶ [{ id, grupo, copies[],           - elige variante (azar)
- decide grupo + tipo post  ─┘    imagen|link_marketplace,           - prepara post (texto+media)
                                   tipo, estado, permalink }]   ◀──   - [asistido] clic humano
        ▲                        /creativos/*.jpg                    - marca estado=publicado
        │                                                              + permalink + log
        └──────── VISOR aprobación (HTML local): ver copy+imagen, aprobar/rechazar ──────┘
```

## 3. Tipos de post soportados (según video NetworkingCode + comentarios)

Cada item de la cola puede ser de 3 tipos:
1. **`texto`** — solo copy (rota al AZAR entre variantes; FB suspende si detecta texto idéntico repetido).
2. **`imagen`** — copy + creativo subido (imagen generada por Dify/Bedrock, AIS-400).
3. **`link`** — copy + URL de aviso Marketplace/OnRentX → **Facebook genera mosaico de fotos automático** (truco del video: no hay que subir imagen, se ve como mosaico). Conecta con "lo de los links".

**Elección de versión (petición de Aleix):** Dify deja VARIAS variantes de copy y/o varias imágenes por item; se elige una al azar por publicación para no repetir.

## 4. Alcance del trabajo (qué se construye)

### A. Bot base (asistido) — CASI HECHO
- [x] Fork + rama `feat/onrentx-modo-asistido` (PR #1)
- [x] `MODO_ASISTIDO` (prepara, no publica; clic humano)
- [x] `LIMITE_TANDA` (5 arranque)
- [x] 5 variantes copy ES-MX construcción
- [ ] **Cambiar rotación secuencial → ALEATORIA** (recomendación del autor: FB checa texto repetido)
- [ ] Prueba real con login de Aleix (pendiente, requiere sus credenciales)

### B. Soporte media (imagen + link Marketplace) — PARCIAL (adelantado con C)
- [x] Adjuntar imagen local al post (subir archivo desde `creativos/`) → `publicarPost()` usa `input[type=file]`
- [x] Soportar `tipo:"link"` → el copy incluye la URL Marketplace y FB genera el mosaico
- [x] Imagen generada por **AIS-400 (Bedrock en Dify)**, el bot solo la consume (ruta en `cola.json`)
- [ ] Prueba real de adjuntado de imagen y de mosaico de link (requiere login de Aleix)

### C. Cola de aprobación + contrato (parte de AIS-424) — HECHO (código)
- [x] Definir esquema `cola.json` (contrato Dify ↔ bot ↔ router) → `cola.js` + `cola.ejemplo.json`
- [x] Adaptar `index.js` para leer la cola (solo publica `estado:"aprobado"`) → MODO COLA
- [x] Marcar `estado:"publicado"` + `permalink` tras publicar (permalink: captura real pendiente)
- [x] Validación del contrato (tipos, coherencia por tipo, existencia de imagen en disco)
- [x] Fallback MODO LISTA (grupos.js) si no hay `cola.json`
- [ ] Captura del permalink real del post publicado (iteración futura)

### D. Visor de aprobación (local) — HECHO
- [x] Página que lee `cola.json`, muestra copy+imagen/link por item, botones Aprobar/Rechazar/Pendiente
- [x] Servidor local mínimo `visor.js` (solo módulos nativos de Node, SIN dependencias nuevas)
- [x] Filtros por estado + validación visible + refresco automático (15s)
- [x] Sirve creativos locales con protección anti path-traversal
- [x] El visor solo aplica decisiones humanas (aprobado/rechazado/pendiente); `publicado`/`error` los pone el bot
- Uso: `node visor.js` → http://localhost:4599

### E. Conexión Dify → cola (parte de AIS-424) — HECHO
- [x] Script/endpoint para que Dify escriba items en la cola (con `correlation_id`, `owner`)
- [x] `dify-a-cola.js`: CLI (arg o stdin) y módulo (`encolarDesdeDify`) → escribe directo en `cola.json`
- [x] Endpoint HTTP `POST /api/enqueue` en `visor.js` (Dify hace POST con el contrato)
- [x] `cola.encolarItem()`: id autogenerado `orx-YYYY-MM-DD-XXXX`, estado inicial `pendiente`, valida antes de persistir
- [x] Documentado el contrato de entrada para el equipo que implemente AIS-424

## 5. Operación y límites (anti-baneo)

- Frecuencia: **Semana 1-2 → 5 grupos/día** (calentamiento, asistido). **Semana 3+ → 10/día** (cada grupo ~1x/semana).
- Espera entre posteos configurable (`esperaHumana`, hoy 10-20s; el autor sugiere hasta 1-4 min si hace falta).
- Nunca los 50 el mismo día ni texto idéntico (por eso variantes al azar).
- Clic final HUMANO hasta que la cuenta aguante 1-2 semanas sin warnings → luego evaluar `MODO_ASISTIDO=false`.

## 6. Seguridad

- **NUNCA** subir `facebook-session/` (cookies de la cuenta) — ya en `.gitignore`.
- Sesión y creativos viven solo en la máquina de Aleix.
- El bot no exfiltra sesión (auditado: 1 dependencia, sin red a terceros).

## 7. Jira (tickets)

- **AIS-401** (padre) — Publicación asistida en grupos. CORREGIR descripción: era "inglés/USA", el rumbo real es **español/construcción MX**.
- Subtareas de AIS-401, enlazadas al programa AIS-422 / router AIS-424 / imágenes AIS-400:
  - Bot base asistido (A)
  - Soporte media imagen+link (B) — enlaza AIS-400
  - Cola + contrato (C) — enlaza AIS-424
  - Visor aprobación (D)
  - Conexión Dify→cola (E) — enlaza AIS-424

## 8. Estado del proyecto para handoff

Repo listo, dependencias instaladas, Chromium headful OK.

**Hecho en código (rama `feat/onrentx-modo-asistido`):**
- A (AIS-434): rotación aleatoria de copy · `texto.js` + `index.js`
- B (AIS-435): soporte imagen local + tipo link (mosaico FB) · `index.js` `publicarPost()`
- C (AIS-436): contrato `cola.json` + MODO COLA · `cola.js` + `cola.ejemplo.json` + `index.js`
- D (AIS-437): visor de aprobación local · `visor.js` (http://localhost:4599)
- E (AIS-438): conexión Dify→cola · `dify-a-cola.js` (CLI/módulo) + `POST /api/enqueue`

**Flujo completo:** Dify encola (`dify-a-cola.js` / `/api/enqueue`, estado `pendiente`) →
humano aprueba en el visor (`node visor.js`) → bot publica los `aprobado`
(`MODO_ASISTIDO=true node index.js`, clic final humano) → marca `publicado`.

**Pendiente (requiere login de Aleix o iteración futura):**
- Prueba real end-to-end con la cuenta de Aleix (login + clic final humano).
- Captura del `permalink` real del post publicado (hoy queda `null`).

Cualquier agente que retome: leer este archivo + AIS-401 + AIS-424 + AIS-400.
Todo el contexto está en Jira y en este repo, no en memoria de sesión.
