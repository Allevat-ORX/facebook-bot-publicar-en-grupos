# CHANGELOG — Publicación en Grupos de Facebook & Marketplace

**Proyecto:** `fb-group-poster` / Campañas Orgánicas OnRentX & TRAMA  
**Responsable Operativo:** Hermes Agent (Perfil Marketer) / Aleix Allevat  
**Repositorio:** `/home/aleix/Proyectos-Claude/fb-group-poster`  
**Jira de Referencia:** `MKT-91` (Bot publicador en grupos FB)

---

## Estructura de Trazabilidad
Para cada tanda y acción se registran los 4 pilares clave:
* **QUÉ:** Oferta concreta, precios, creativos/imágenes y copies utilizados.
* **DÓNDE:** Grupos de Facebook específicos (nombre y URL) o sección de Facebook (Marketplace / Feed).
* **CÓMO:** Motor de publicación (Playwright asistido / runner / manual), pausas anti-spam y configuración técnica (Desktop / Mobile).
* **QUIÉN:** Identidad activa con la que se firma y publica (Arturo Silva, Mateo Silva, Aleix Llevat personal, Fanpage Trama, Fanpage OnRentX).

---

## Registro de Ejecuciones

### [2026-10-12] — Sesión Maquinaria Ligera SLP (Barrido 12 Grupos)

#### 1. Campaña: OnRentX — Ofertas de la Semana (4 Equipos SLP, Sin Hidrolavadora)
* **QUÉ:** Álbum de 4 equipos oficiales de catálogo con tarifas formales en SLP:
  1. Cortadora de Concreto ($699/día, $2,998/sem con disco)
  2. Vibrador de Concreto a Gasolina ($470/día, $1,800/sem)
  3. Prensadora Compacta RIDGID RP 210 ($950/día, $3,800/sem)
  4. Prensadora Industrial RIDGID RP 340 ($1,350/día, $5,200/sem)
  * **CTA:** WhatsApp Comercial `wa.me/524428075711` + Mensaje Directo.
* **DÓNDE:** 12 grupos clave de construcción y contratistas en San Luis Potosí (`cola.json`):
  1. `Contratistas industrial y Residencial SLP`
  2. `Obras Contratistas Constructoras Remodelaciones`
  3. `PROVEEDORES ZONA INDUSTRIAL SLP`
  4. `contratistas y servicios en san Luis Potosí`
  5. `CONSTRUCTORAS, CONTRATISTAS Y PROVEDORES DE SLP`
  6. `Contratistas de San Luis Potosí SLP,MX`
  7. `Especialistas de la construcción arquitectos slp`
  8. `Contratistas constructoras y servicios para construcción en SLP`
  9. `Maquinaria ligera y Maquinaria Pesada en SLP`
  10. `VENTA MAQUINARIA INDUSTRIAL SAN LUIS POTOSI`
  11. `Constructores y Maestros de Obra en SLP`
  12. `Arquitectos Ingenieros Contratistas SLP`
* **CÓMO:** Playwright visible en monitor (`DISPLAY=:0`, context `sessions/session-aleix`), subida directa multi-imagen (`input[type="file"][multiple]`), selector estricto de botón de publicación (`div[aria-label="Publicar"][role="button"], div[aria-label="Publica"][role="button"]`), pausas anti-spam aleatorias de 35 a 49 segundos entre grupos. Script: `publicar_arturo_album_cola.js`. `cola.json` quedó **12/12 en estado `publicado`**.
* **QUIÉN:** **Arturo Silva** (Fanpage Comercial `61594919884581`), Asesor Comercial de Maquinaria OnRentX.

---

### [2026-10-06] — Sesión Vespertina

#### 1. Campaña: OnRentX — Álbum Ofertas de la Semana (5 Equipos SLP) — Tanda 2
* **QUÉ:** Álbum de 5 fotos del catálogo oficial de maquinaria ligera con tarifas formales en SLP:
  1. Cortadora de Concreto ($699/día, $2,998/sem)
  2. Vibrador de Concreto ($470/día, $1,800/sem)
  3. Prensadora Compacta RIDGID RP 210 ($950/día, $3,800/sem)
  4. Prensadora Industrial RIDGID RP 340 ($1,350/día, $5,200/sem)
  5. Hidrolavadora a Gasolina ($400/día, $1,600/sem)
  * **CTA:** WhatsApp Comercial `wa.me/524428075711` + Mensaje Directo.
* **DÓNDE:** 5 nuevos grupos clave de construcción en San Luis Potosí:
  1. `Especialistas de la construcción arquitectos slp` (https://www.facebook.com/groups/500149813497043/)
  2. `Contratistas constructoras y servicios para construcción en SLP` (https://www.facebook.com/groups/973021686464405/)
  3. `Maquinaria ligera y Maquinaria Pesada en SLP` (https://www.facebook.com/groups/721277314044164/)
  4. `VENTA MAQUINARIA INDUSTRIAL SAN LUIS POTOSI` (https://www.facebook.com/groups/576954209564809/)
  5. `Constructores y Maestros de Obra en SLP` (https://www.facebook.com/groups/737917374680527/)
  *(Nota: Los grupos "CONSTRUCTORES POTOSINOS" y "TODO PARA LA CONSTRUCCIÓN" tienen membresía pendiente de moderación).*
* **CÓMO:** Playwright Desktop Context (`sessions/session-aleix`), subida directa multi-imagen (`input[type="file"][multiple]`), pausas anti-spam aleatorias de 35 a 50 segundos entre grupos. Script: `ejecutar_tanda2_maquinaria_arturo.js`.
* **QUIÉN:** **Arturo Silva** (Fanpage Comercial `61594919884581`), Asesor Comercial de Maquinaria OnRentX.

---

#### 2. Campaña: TRAMA Instalaciones — Liquidación Lote Tubería & Soportería — Tanda 2
* **QUÉ:** Liquidación de sobrestock por finiquito de obra en SLP: Tubería PVC Sanitario/Ventilación (DWV), Tubería Multicapa (gas/agua), mangueras flexibles blanco/rojo/azul, tubería conduit y accesorios de fijación/soportería (unistrut, varillas, abrazaderas).
  * **Creativo:** Foto real de bodega mejorada con balance de blancos y contraste (`tuberia_59909_mejorada.jpg`).
  * **CTA:** WhatsApp Comercial `wa.me/524428075711` + Mensaje Directo.
* **DÓNDE:** 5 grupos de instalaciones y contratistas en San Luis Potosí:
  1. `Arquitectos Ingenieros Contratistas SLP` (https://www.facebook.com/groups/333582518398424/)
  2. `Especialistas de la construcción arquitectos slp` (https://www.facebook.com/groups/500149813497043/)
  3. `Contratistas constructoras y servicios para construcción en SLP` (https://www.facebook.com/groups/973021686464405/)
  4. `VENTA MAQUINARIA INDUSTRIAL SAN LUIS POTOSI` (https://www.facebook.com/groups/576954209564809/)
  5. `Constructores y Maestros de Obra en SLP` (https://www.facebook.com/groups/737917374680527/)
* **CÓMO:** Playwright Desktop Context (`sessions/session-aleix`), adjuntando imagen vía FileChooser nativo, pausas anti-spam de 40 a 48 segundos. Script: `ejecutar_tanda2_trama_lote.js`.
* **QUIÉN:** Perfil autenticado para contratistas (`sessions/session-aleix`).

---

#### 3. Marketplace: Remate Tubería, DWV, Multicapa & Soportería
* **QUÉ:** Publicación indexada en catálogo de Facebook Marketplace.
  * **Título:** `Remate Tubería PVC, DWV, Multicapa, Mangueras y Conexiones`
  * **Precio simbólico:** `$10 MXN` (estándar para remates de mayoreo/lote en SLP).
  * **Categoría:** Materiales de construcción / Plomería y tubería.
  * **Etiquetas (20/20 max):** `tuberia pvc`, `tuberia dwv`, `tuberia ventilacion`, `tuberia multicapa`, `manguera flexible`, `tubo conduit`, `conexiones pvc`, `material de plomeria`, `material electrico`, `lote tuberia`, `remate de material`, `liquidacion de obra`, `manguera para agua`, `plomeria san luis potosi`, `construccion slp`, `tubo sanitario`, `tubo hidraulico`, `material de construccion`, `fontaneria`, `conexiones conduit`.
  * **Creativo:** Foto real depurada de bodega.
* **DÓNDE:** Facebook Marketplace (Geolocalizado en San Luis Potosí y Bajío).
* **CÓMO:** Publicación directa desde la interfaz de vendedor de Marketplace.
* **QUIÉN:** Perfil Personal Aleix Llevat (`aleix.llevat`).
* **Tracción inicial:** Indexado con 4 clics en los primeros 10 minutos.

---

### [2026-10-06] — Sesión Matutina

#### 1. Campaña: OnRentX — Álbum Ofertas de la Semana (5 Equipos SLP) — Tanda 1
* **QUÉ:** Álbum de 5 equipos de maquinaria ligera con fotos oficiales de catálogo: Cortadora, Vibrador, RP 210, RP 340, Hidrolavadora.
* **DÓNDE:** 7 grupos de contratistas e industria en San Luis Potosí (`cola.json`):
  1. `Contratistas industrial y Residencial SLP` (https://m.facebook.com/groups/1619567534843703/)
  2. `Obras Contratistas Constructoras Remodelaciones` (https://m.facebook.com/groups/655829713298896/)
  3. `PROVEEDORES ZONA INDUSTRIAL SLP` (https://m.facebook.com/groups/406048096519723/)
  4. `contratistas y servicios en san Luis Potosí` (https://m.facebook.com/groups/1020158966498575/)
  5. `CONSTRUCTORAS, CONTRATISTAS Y PROVEDORES DE SLP` (https://m.facebook.com/groups/312948407788487/)
  6. `Contratistas de San Luis Potosí SLP,MX` (https://m.facebook.com/groups/1121166582819840/)
  7. `Arquitectos Ingenieros Contratistas SLP` (https://m.facebook.com/groups/333582518398424/)
* **CÓMO:** Playwright asistido y runner multi-imagen. Script: `publicar_arturo_album_cola.js`. `cola.json` quedó 7/7 en estado `"publicado"`.
* **QUIÉN:** **Arturo Silva** (Fanpage Comercial `61594919884581`).

---

#### 2. Campaña: TRAMA Instalaciones — Lote Tubería & Finiquito — Tanda 1
* **QUÉ:** Post de finiquito de obra con tubería PVC/CPVC, PPR y accesorios Contra Incendio (PCI). Foto de almacén: `lote_tuberia_pvc.png`.
* **DÓNDE:** 6 grupos industriales en SLP (`cola_trama_materiales.json`):
  1. `Contratistas industrial y Residencial SLP`
  2. `Obras Contratistas Constructoras Remodelaciones`
  3. `PROVEEDORES ZONA INDUSTRIAL SLP`
  4. `contratistas y servicios en san Luis Potosí`
  5. `CONSTRUCTORAS, CONTRATISTAS Y PROVEDORES DE SLP`
  6. `Contratistas de San Luis Potosí SLP,MX`
* **CÓMO:** Playwright automatizado en segundo plano (`proc_0f0dee2f9c50`). `cola_trama_materiales.json` quedó 6/6 en estado `"publicado"`.
* **QUIÉN:** Sesión contratistas (`sessions/session-aleix`).

---

## Resumen Acumulado de Cobertura en Grupos

| Categoría | Grupos Únicos Impactados | Total Publicaciones Lanzadas |
| :--- | :---: | :---: |
| **OnRentX Maquinaria Ligera** | 12 grupos SLP | 12 posts (Álbumes de 5 fotos) |
| **TRAMA Materiales / Lote** | 7 grupos SLP | 11 posts (Foto bodega + copy técnico) |
| **Facebook Marketplace Activo** | N/A (Catálogo general) | 4 productos activos (+35 clics acumulados) |

---
*Archivo mantenido automáticamente para auditoría y continuidad de campañas.*
