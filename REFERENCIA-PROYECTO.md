# fb-group-poster — Referencia maestra del proyecto

Bot de publicación en grupos de Facebook para OnRentX. Jira: **MKT-91**.

## Dónde vive
- **Repo local:** `/home/aleix/Proyectos-Claude/fb-group-poster`
- **Repo remoto:** https://github.com/Allevat-ORX/facebook-bot-publicar-en-grupos.git (fork de un bot base)
- **Rama de trabajo:** `feat/onrentx-modo-asistido` (sin push; solo Aleix mergea)
- **Sesión FB / creativos:** locales, NO se versionan (`.gitignore`)

## Qué es y cómo funciona
Meta cerró la Groups API (2024): la única vía para publicar en GRUPOS es navegador con sesión (Playwright). El bot corre en la máquina de Aleix (no EC2, evita baneo por IP datacenter).

- Aleix entra con su cuenta personal (Aleix Llevat) y **opera como PÁGINA OnRentX** (`i_user 61566579235450`). Publica como Onrentx.
- La cuenta FB está en **catalán** (caja "Escriu alguna cosa", botón "Publica").
- El bot se conecta por **CDP** a un navegador ya abierto y logueado: Chromium de Playwright con `--remote-debugging-port=9222`, accesible en **`http://[::1]:9222`** (IPv6).
- Publica **imagen + copy + link en UN solo post** (bug de posts separados ya corregido).
- **Add groups**: Facebook permite publicar en hasta **9 grupos** por publicación (función nativa; automatización del selector aún frágil, se hace manual).

## Archivos clave
| Archivo | Qué hace |
|---|---|
| `index.js` | Bot principal. `publicarPost()` (imagen+texto multi-idioma), MODO COLA (lee cola.json, publica aprobados) y MODO LISTA (grupos.js). Soporta `CDP_URL` para reusar navegador abierto. |
| `cola.js` | Contrato de cola Dify↔bot↔router (AIS-424). leer/validar/marcar/encolar. |
| `cola.ejemplo.json` | Contrato de referencia de la cola. |
| `cola.json` | Cola operativa real (NO versionada). |
| `texto.js` | Variantes de copy con selección aleatoria (anti-shadowban). |
| `visor.js` | Visor local de aprobación (http://localhost:4599) + endpoint `/api/enqueue`. |
| `dify-a-cola.js` | Conexión Dify→cola (CLI/módulo). |
| `recolector.js` / `_recolector-cdp.js` | Recolectan los grupos de la cuenta (el CDP se conecta al navegador abierto). |
| `_clasificar-grupos.js` | Clasifica los grupos por ciudad/temática. |
| `abrir-sesion.js` | Abre navegador Playwright para login manual una vez. |
| `GRUPOS-CLASIFICADOS.md` | Los 106 grupos clasificados (legible). |
| `_grupos-detectados.json` / `_grupos-clasificados.json` | Datos crudos de grupos. |
| `MAÑANA-8AM-INSTRUCCIONES.md` | Cómo lanzar una tanda asistida. |
| `PLAN-AUTOMATIZACION.md` | Plan/contrato original del proyecto. |
| `creativos/` | Imágenes de Marketing (NO versionadas). Originales + `fb/` optimizadas 1350px. |

## Creativos disponibles (creativos/fb/)
De Marketing (Google Sheet "Agosto_OnRentX", gid 968061633):
- **Cliente:** post01 (a la antigua), post05 (varias llamadas), post09 (precio desde inicio), post11 (busca-reserva-recibe)
- **Proveedor:** post06 (maquinaria disponible/parada), post07 (tu flotilla)

## Grupos (106 total, barrido 2026-09-24)
46 SLP · 2 QRO · 58 otras/sin-ciudad · 66 con maquinaria · 24 de empleo.
- **CLIENTES→SLP** (19 maquinaria/construcción): campaña demanda
- **PROVEEDORES→QRO** (2): campaña oferta
- **Maquinaria genérica otras ciudades** (~44): reserva expansión
- **Empleo** (24): captación de operadores/vacantes, NO renta
(Detalle en GRUPOS-CLASIFICADOS.md)

## CTAs / enlaces
- Landing: `onrentx.com` (home, clientes) / `onrentx.com/demo` (bifurca cliente/proveedor). **`/clientes` y `/proveedores` están VACÍAS** (ticket O2BF-1497).
- WhatsApp comercial/CTA: `wa.me/524428075711` (lada 442 = Querétaro).
- WhatsApp reclutamiento (distinto): `+524443015205` (bot RRHH; ver AIS-439).

## Cómo lanzar una tanda (modo asistido)
1. Navegador abierto y logueado como OnRentX con CDP 9222 (si se cerró, reabrir — ver MAÑANA-8AM-INSTRUCCIONES.md).
2. `cd /home/aleix/Proyectos-Claude/fb-group-poster && CDP_URL="http://[::1]:9222" MODO_ASISTIDO=true node index.js`
3. El bot prepara cada post; Aleix da "Publica"; ENTER en terminal para el siguiente.

## Estado (2026-09-24)
- Tanda 1 publicada: 8 posts (6 clientes SLP + 2 proveedores QRO).
- Aprendizajes: quitar hashtags en grupos, imágenes no clicables (links en texto), WhatsApp buen CTA para proveedores.

## Tickets relacionados
- **MKT-91**: este bot publicador (In Progress).
- **MKT-86** (demanda SLP/QRO), **MKT-85/87** (proveedores), **MKT-9** (prospector FB scraping), **MKT-5** (token FB), **MKT-4** (Postiz).
- **O2BF-1497**: landing /clientes y /proveedores vacías + /demo pesada.
- **AIS-439**: bot RRHH captación en frío por WhatsApp (para publicar vacantes en grupos).
- **AIS-401/424/400**: contrato Dify→cola, router, imágenes Bedrock.

## Cómo consultar al Hermes marketer
`hermes -p marketer -z "prompt"` (perfil en `~/.hermes/profiles/marketer`, tiene contexto Jira MKT + GraphRAG). También existe perfil `proveedor-maquinaria-onrentx`.
