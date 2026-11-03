# TANDA MAÑANA 8AM — Instrucciones (modo asistido)

## Qué está preparado
- `cola.json` con **8 publicaciones aprobadas** (imagen + copy de Marketing + link `onrentx.com/demo`):
  - **6 clientes → grupos SLP** (creativos post01/05/09/11 rotados)
  - **2 proveedores → grupos QRO** (post06 "maquinaria disponible", post07 "tu flotilla")
- Bot corregido y verificado: imagen + texto en UN solo post, multi-idioma (catalán), editor correcto.

## Requisito ANTES de lanzar
El navegador con la sesión de OnRentX debe estar **abierto y logueado como OnRentX** (i_user), con CDP en el puerto 9222.

Si el navegador se cerró anoche, reabrirlo así (en la carpeta del proyecto):
```
/home/aleix/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome \
  --user-data-dir="$PWD/facebook-session" \
  --remote-debugging-port=9222 --no-first-run --no-default-browser-check \
  --start-maximized --no-sandbox "https://www.facebook.com" &
```
Luego: entrar como personal → cambiar a perfil OnRentX. Verificar con:
```
curl -s "http://[::1]:9222/json/version"
```

## Lanzar la tanda (modo asistido — tú das el clic final en cada post)
```
cd /home/aleix/Proyectos-Claude/fb-group-poster
CDP_URL="http://[::1]:9222" MODO_ASISTIDO=true node index.js
```

El bot, por cada uno de los 8 grupos:
1. Abre el grupo y el modal de publicación.
2. Adjunta la imagen + pega el copy + link (todo en UN post).
3. **Se detiene**: tú revisas y pulsas "Publica".
4. Vuelves a la terminal y pulsas **ENTER** para pasar al siguiente grupo.

## Espaciado anti-baneo
El bot ya espera entre grupos. Como es asistido, el ritmo lo marcas tú al dar ENTER.
Recomendado: no ir a toda prisa; deja ~1-3 min entre publicaciones.

## Si algo falla
- Verifica que el post lleva imagen + texto juntos ANTES de publicar (mirar el modal).
- Si un grupo no deja publicar, el bot lo marca como error y sigue con el siguiente.
- El estado de cada item queda en `cola.json` (publicado/error) y en `log.txt`.

## Pendiente (no bloquea mañana)
- "Add groups" (publicar en hasta 9 grupos de golpe): función real de FB verificada,
  pero automatizar su selector quedó frágil. Se automatiza con Aleix delante otro día.
