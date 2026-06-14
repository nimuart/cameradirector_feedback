# 🎥 Camera Director — Slopsmith plugin · **v0.1**

> 🇬🇧 English · [🇪🇸 Español](./README.es.md)

Floating panel to control the **3D Highway** camera in real time: orbit, pan,
zoom, tilt, height — with **per-player cameras in split-screen**, a **preset
library**, and bilingual EN/ES UI.

## Install

1. Copy this folder into your Slopsmith plugins directory:
   - Windows: `%APPDATA%\slopsmith-desktop\plugins\camera_director`
   - macOS: `~/Library/Application Support/slopsmith-desktop/plugins/camera_director`
   - Linux: `~/.config/slopsmith-desktop/plugins/camera_director`
2. **Slopsmith 0.2.x only:** run `bridge/install_modded_screen.bat` (Windows,
   app closed). On 0.3+ this is not needed.
3. Restart Slopsmith, open a song with the **3D Highway**, click the 🎥 chip
   (or press `` ` ``).

## Use

Toggle **Free camera** ON, then drag the highway: **drag** = orbit · **Shift** =
pan · **Ctrl** = zoom · **Alt** = height · **wheel** = zoom. Tap any value to type
it. Save/load/download/import camera **presets**. In split-screen, **Player 1/2**
tabs control each panel's camera independently.

## Changelog

### v0.1
- **Architecture split into brain + UI** — `camera-controller.js` (the brain:
  camera, presets, persistence, split logic; exposes `window.__camDir`) and
  `assets/ui-panel.js` (all the UI). The UI can be updated without touching the
  brain. (Plugin entry renamed from `screen.js` so it no longer clashes with
  Slopsmith's `highway_3d/screen.js`.)
- **Split-screen per-player cameras** — each panel gets its own live camera
  (`window.__h3dCamCtlPanels`); Player tabs appear only in split, and dragging a
  panel controls that player. (Needs the renderer patch in `DEVELOPERS.md`.)
- **Blender-style navigation** — Shift/Ctrl/Alt modifiers + mouse-wheel zoom.
- **Preset library** — create (named), load (or double-click), save, download
  and import; names tinted with the player's colour.
- **Editable values** — tap a number to type an exact value/angle.
- **Draggable launcher chip** — drop it anywhere; position is remembered.
- **Metal theme** — brushed-metal panel + buttons, accent only on the border.


## License

AGPL-3.0-only, matching Slopsmith.
