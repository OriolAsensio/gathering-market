# Gathering Market

App de Android personal (estética de fantasía medieval) para seguir el precio de mis cartas de
Magic, completar colecciones, ver el meta de Pauper y qué mazos puedo montar, crear mazos con mis
cartas y recibir avisos (baneos, colecciones nuevas, cambios de meta y de precio).

## Cómo funciona

```
GitHub Actions (cada día, gratis)                 Móvil (app de Android)
  pipeline/daily.py                                 app/ dentro del APK
   ├─ precios Scryfall, ediciones, meta MTGTop8      ├─ engine.js: toda la lógica (escáner,
   ├─ avisos generales → ntfy                        │  constructor, colecciones, mercado…)
   └─ export_pack.py → GitHub Pages  ───────────►    ├─ descarga el paquete diario (~250 KB)
      (version, cards, prices, sets, meta, events)   └─ tus cartas y carpetas: en el teléfono
```

- **La app no necesita ningún servidor propio**: descarga cada día un "paquete de datos" público y
  calcula todo en el móvil. Tus cartas se guardan en el teléfono (no se suben a ningún sitio).
- El APK lleva una copia del paquete, así que funciona aunque la primera vez no haya internet.
- La primera descarga completa son ~5 MB; después, ~250 KB al día (solo precios).

## Carpetas del proyecto

| Carpeta | Qué hay |
|---|---|
| `app/` | La app: `index.html`, `style.css`, `app.js` (pantallas), `engine.js` (lógica y datos), fuentes |
| `mobile/` | Proyecto Android (Capacitor) que empaqueta `app/` en un APK |
| `pipeline/` | Tarea diaria en Python: descarga datos y genera el paquete |
| `.github/workflows/daily.yml` | La tarea diaria en GitHub Actions |

## Generar el APK

Requisitos (ya instalados en este PC): Node.js, Android Studio (con el SDK) y Java 21 (Temurin).
Ojo: el Java que trae Android Studio es el 25 y Capacitor 7 no lo admite; hay que usar el 21.

```powershell
python pipeline/export_pack.py app/pack
cd mobile
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:GM_PACK_URL = "https://<usuario>.github.io/<repositorio>/"   # paquete diario en internet
npm run apk
```

El APK queda en `Gathering-Market.apk` (en la carpeta del proyecto). Para instalarlo:
pásalo al móvil (cable, Drive, Telegram…), ábrelo y permite "instalar apps de origen desconocido"
para esa app cuando Android lo pida.

## Tarea diaria en GitHub

1. Sube este proyecto a un repositorio de GitHub.
2. En el repositorio: Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → nuevo secreto `NTFY_TOPIC` con el tema de ntfy.
4. Actions → "Datos diarios" → Run workflow (la primera vez; luego va sola cada día a las 06:15 UTC).

La base de datos se guarda comprimida en la release "datos" del repositorio. Se conserva el precio
diario de los últimos 35 días y uno por semana de lo anterior.

## Probar en el PC

```powershell
python pipeline/server.py
```

Abre http://localhost:8000 (usa el paquete de `app/pack`, generado con `export_pack.py`).

Nota: `mobile/android` es generado, pero lleva cambios a mano en `AndroidManifest.xml` (permisos de
CÁMARA y VIBRATE para el escáner en vivo). Si se vuelve a crear con `npx cap add android`, hay que
añadirlos de nuevo.

## Datos que se descargan una vez por semana

- `pipeline/precons.py`: mazos preconstruidos de toda la historia (MTGJSON, ~260 MB, se queda solo la
  lista de cartas de cada mazo).
- `pipeline/foreign_names.py`: nombres impresos en español, francés y japonés (Scryfall "all_cards",
  ~400 MB) para que el escáner reconozca cartas en esos idiomas.

`daily.py` los lanza los lunes o si aún no existen.

## Qué hace la app

- **Carpetas**: "Mis cartas ▾" arriba para cambiar de carpeta o crear otra (p. ej. las cartas de un
  amigo). Solo "Mis cartas" genera avisos de precio.
- **Cartas**: valor total y cambio desde ayer; en qué mazos top de Pauper se juega cada carta.
  Añadir: botón de la cámara (sello rojo), escribir el nombre o **📥 Importar CSV**.
- **Importar**: CSV de ManaBox, Moxfield, Deckbox o Dragon Shield, o una lista de texto
  (`4 Lightning Bolt`, `2 Counterspell (MH2) 267`).
- **Colecciones** (ediciones): aparecen al registrar una carta; puedes seguir cualquiera y ver qué te
  falta, por rareza, cuánto cuesta completarla y copiar la lista. Avisa el día que sale una que sigues.
- **Lista Reservada y mazos preconstruidos**: en Colecciones, como cualquier otra colección (seguir,
  ver lo que falta, compartirlo). Vale cualquier edición de cada carta.
- **🔨 Crear mazo**: desde una o varias cartas (botón "Seleccionar" o manteniendo pulsada una carta) o
  desde un comandante. Formatos Pauper, Commander (100 cartas, 1 copia, identidad de color), Estándar y
  Casual. Construye un "plan" con los temas de las cartas base, elige cartas por encaje con todo el mazo
  (no por ser "meta"), cubre funciones (quitar amenazas, robar, acelerar maná, barridos), cuadra la curva
  y las tierras, y explica por qué está cada carta. Se puede guardar en Mis mazos.
- **Escáner en vivo**: apuntas con la cámara y lee la carta solo (sin foto); eliges el arte con imágenes.
  Idiomas: inglés, español, francés y japonés. Si no hay cámara en directo, se puede usar una foto.
- **Mazos**: Mis mazos (importar una lista o guardar uno del meta/constructor, con lo que te falta) y
  todo el meta de Pauper (MTGTop8, últimos 2 meses): de cada arquetipo, la lista mejor clasificada.
- **Mercado**: lo que más sube y baja (1, 7 o 30 días).
- **Avisos**: baneos, colecciones nuevas, meta y tus cartas que se mueven ≥10 %.

## Notificaciones

- Avisos de **tus cartas** (precio, colecciones que sigues): los genera la app al abrirla con
  precios nuevos, como notificación de Android.
- Avisos **generales** (baneos, colecciones nuevas, meta): los envía la tarea diaria por **ntfy**.
  En el móvil: app ntfy → suscribirse al tema de `data/config.json`. Prueba: `py pipeline/notify.py --test`.
