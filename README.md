# 🤖 Facebook Bot — Publicar en Grupos

Bot de automatización para publicar en múltiples grupos de Facebook de forma automática, usando Playwright y Node.js.

---

## ¿Qué hace este bot?

- Inicia sesión en Facebook con tu cuenta
- Recorre una lista de grupos configurada por ti o recopilada con "recolector.js"
- Publica automáticamente el texto que definas
- Lleva un registro de progreso para no repetir grupos entre ejecuciones
- Guarda un log con el resultado de cada publicación

---

## Requisitos

- [Node.js](https://nodejs.org/) v18 o superior
- Una cuenta de Facebook
- Ser miembro de los grupos donde quieres publicar

---

## Instalación

1. Clona este repositorio:
   ```
   git clone https://github.com/tu-usuario/facebook-bot-publicar-en-grupos.git
   ```

2. Entra a la carpeta:
   ```
   cd facebook-bot-publicar-en-grupos
   ```

3. Instala las dependencias:
   ```
   npm install
   ```

4. Instala los navegadores de Playwright:
   ```
   npx playwright install chromium
   ```

---

## Configuración

Antes de ejecutar el bot, edita estos archivos:

### `texto.js`
Escribe el texto que quieres publicar en los grupos.

### `grupos.js`
Agrega las URLs de los grupos donde quieres publicar. Debes ser miembro de cada uno.

### `progreso.json`
Controla desde qué grupo continúa el bot en la próxima ejecución.  
Si quieres reiniciar desde el principio, cambia el valor a `0`:

```json
{
  "ultimo": 0
}
```

---

## Uso

**Primera vez — guardar sesión de Facebook:**
```
node abrir-sesion.js
```
Esto abre el navegador para que inicies sesión manualmente. La sesión queda guardada localmente y no se sube a GitHub.

**Ejecutar el bot:**
```
node index.js
```

---

## Recolector de grupos

El archivo `recolector.js` es una herramienta opcional que genera tu lista de grupos automáticamente.

**¿Qué hace?**
- Abre tu perfil de Facebook y recorre todos los grupos a los que perteneces
- Verifica que cada grupo sea compatible con publicaciones de texto
- Genera el archivo `grupos.js` automáticamente con los grupos válidos

**¿Cuándo usarlo?**  
Úsalo una vez antes de ejecutar el bot por primera vez, o cada vez que te unas a grupos nuevos.

**Ejecutar el recolector:**
```
node recolector.js
```

> ⚠️ El recolector puede tardar varios minutos dependiendo de cuántos grupos tengas.

---

## ⚠️ Aviso importante

Este bot es una herramienta de automatización. Úsalo de forma responsable:
- No publiques contenido spam o engañoso
- Respeta las reglas de cada grupo
- Facebook puede restringir cuentas que publican de forma masiva

---

## Autor

Desarrollado por **Ricardo** — automatización y desarrollo web a medida.  
¿Necesitas un bot similar para tu negocio? Contáctame.
