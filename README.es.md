# 🎥 Camera Director — plugin para Slopsmith

> 🇪🇸 Español · [🇬🇧 English](./README.md)

Un panel de control flotante y **bilingüe (EN/ES)** que te deja dirigir la cámara
del **3D Highway** en tiempo real — **Órbita, Paneo, Zoom, Inclinación y
Altura** — y **guardar, exportar e importar** tus vistas favoritas como archivos
JSON que se pueden compartir.

Está hecho como una **capa de overlay** limpia sobre el canvas del highway. Se
comunica con el renderer a través de un único objeto puente compartido
(`window.__h3dCamCtl`) y nunca toca las tripas del renderer, así que **no genera
fugas de memoria** y se puede actualizar o quitar de forma independiente.

![panel](./assets/screenshot.png)

## Funciones

- **Controles de cámara en vivo** — Altura, Zoom, Órbita (yaw), Inclinación
  (pitch), Pan X / Pan Y.
- **Arrastrá para orbitar** — con la cámara libre activada, arrastrá sobre el
  highway para orbitar e inclinar.
- **Presets con nombre** — guardá cualquier vista y volvé a cargarla después con
  una transición animada suave (usa **GSAP** si está disponible; si no, un tween
  interno).
- **Compartí tus vistas** — exportá una sola vista o toda tu colección a un
  archivo `.json`, e importá los que te pasen otros.
- **Interfaz bilingüe** — cambiá inglés ⇄ español al vuelo; todos los textos
  viven en diccionarios de idioma, nada está hardcodeado.
- Tema minimalista **gótico-chic** de alto contraste.
- **Persistente** — tu cámara en vivo y tus presets sobreviven a los reinicios
  de la app vía `localStorage`.

## Requisitos

- Slopsmith con la visualización **3D Highway** (`highway_3d`) activa. El
  `highway_3d` que viene de fábrica ya lee el puente `window.__h3dCamCtl` dentro
  de su `camUpdate()`; este plugin lo maneja. (Si usás un `highway_3d` viejo sin
  el puente, el panel igual abre pero no mueve la cámara — actualizá el plugin
  del highway.)

## Instalación (desde GitHub)

Tanto la app de escritorio como la web descubren plugins desde tu carpeta local
de plugins. Cloná este repo adentro:

| Plataforma | Carpeta de plugins |
|------------|--------------------|
| Windows    | `%APPDATA%\slopsmith-desktop\plugins\` |
| macOS      | `~/Library/Application Support/slopsmith-desktop/plugins/` |
| Linux      | `~/.config/slopsmith-desktop/plugins/` |

```bash
# Windows (PowerShell)
git clone https://github.com/your-user/slopsmith-plugin-camera-director `
  "$env:APPDATA\slopsmith-desktop\plugins\camera_director"

# macOS / Linux
git clone https://github.com/your-user/slopsmith-plugin-camera-director \
  ~/.config/slopsmith-desktop/plugins/camera_director   # ajustá la ruta según la tabla
```

Después **reiniciá Slopsmith**. El nombre de la carpeta no importa, pero el `id`
del manifiesto (`camera_director`) sí — mantenelo único.

## Uso

1. Abrí una canción y asegurate de que la visualización sea **3D Highway**.
2. Hacé clic en el **chip 🎥** (arriba a la derecha) o apretá la tecla **`` ` ``**.
3. Activá **Cámara libre** para tomar el control del encuadre.
4. Movés los sliders — o arrastrás el highway directamente — hasta que quede hermoso.
5. **Guardar vista**, le ponés un nombre, y aparece en la lista de Presets.
6. **Exportar** para compartir el `.json`; los demás lo **Importan** y obtienen la vista exacta.

Apagá **Cámara libre** cuando quieras para devolverle el control a la cámara
automática de Slopsmith.

## Formato de archivo compartible

Las exportaciones usan un sobre chico y compatible hacia adelante:

```json
{
  "kind": "slopsmith.camera-director.preset",
  "version": 1,
  "preset": {
    "name": "Frente de escenario",
    "cam": { "heightMul": 1.2, "distMul": 0.9, "yaw": -0.3, "pitch": 14, "panX": 0, "panY": -8 },
    "savedAt": "2026-06-09T16:00:00.000Z"
  }
}
```

Una exportación de toda la colección reemplaza `preset` por un array `presets`.
Las importaciones validan el marcador `kind` antes de aplicar, así que se pueden
intercambiar archivos con seguridad.

## Estructura del proyecto

```
camera_director/
├── plugin.json            # manifiesto de Slopsmith (id, script, styles)
├── screen.js              # runtime: puente + UI overlay + i18n + persistencia
├── assets/
│   ├── plugin.css         # tema gótico-chic (se sirve como stylesheet del plugin)
│   └── locales/           # diccionarios servidos en runtime (en.json, es.json)
├── src/
│   └── locales/           # fuente canónica de los diccionarios (editá acá)
├── scripts/
│   └── sync-assets.mjs    # copia src/locales -> assets/locales
├── package.json
├── README.md / README.es.md
```

> **Para editar traducciones:** cambiá `src/locales/*.json` y después corré
> `npm run build` para sincronizarlos a `assets/locales/` (el único lugar desde
> donde el runtime puede servirlos).

## Cómo funciona el puente

El renderer (`highway_3d`) lee este objeto en cada frame dentro de `camUpdate()`:

```js
window.__h3dCamCtl = {
  enabled,     // interruptor maestro (false → el renderer encuadra solo)
  heightMul,   // multiplicador de altura
  distMul,     // multiplicador de dolly / zoom
  yaw,         // órbita alrededor del objetivo (radianes)
  pitch,       // offset de inclinación (unidades del highway)
  panX, panY   // paneo del objetivo (unidades del highway)
};
```

Camera Director simplemente escribe en él. Ese contrato de un solo objeto es toda
la superficie de integración — sin globales más allá de `window.__h3dCamCtl` (el
puente) y `window.__camDir` (el handle de teardown idempotente de este plugin).

## Licencia

AGPL-3.0-only, igual que Slopsmith.
