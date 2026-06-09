/* ============================================================================
 *  Camera Director — Slopsmith plugin runtime
 *  ----------------------------------------------------------------------------
 *  A floating, bilingual control panel that authors the 3D Highway camera and
 *  lets users save / export / import their view configurations as shareable
 *  JSON.
 *
 *  ARCHITECTURE
 *  ------------
 *  This plugin is a thin OVERLAY layer over the main highway canvas. It never
 *  reaches into the renderer's internals. Instead it reads/writes a single
 *  shared bridge object, `window.__h3dCamCtl`, which the bundled `highway_3d`
 *  renderer consumes inside its `camUpdate()` each frame:
 *
 *      window.__h3dCamCtl = {
 *        enabled,        // master switch — when false the renderer auto-frames
 *        heightMul,      // camera height multiplier
 *        distMul,        // dolly / zoom multiplier
 *        yaw,            // orbit around the look target (radians)
 *        pitch,          // tilt offset (highway K-units)
 *        panX, panY      // look-target pan (highway K-units)
 *      }
 *
 *  Decoupling through one plain object keeps the plugin replaceable and avoids
 *  any hard dependency on the renderer's closure (no memory leaks, no patching).
 *
 *  The whole file is wrapped in an IIFE and is fully IDEMPOTENT: Slopsmith may
 *  re-inject the script on every `loadPlugins()` pass, so we tear down any prior
 *  instance (DOM + listeners + rAF) before mounting a fresh one.
 *
 *  Code comments are in English; all user-facing copy lives in locale files
 *  (assets/locales/*.json) with an embedded fallback below.
 * ==========================================================================*/
(function () {
  'use strict';

  const PLUGIN_ID = 'camera_director';
  const ASSET_BASE = `/api/plugins/${PLUGIN_ID}/assets`;

  // localStorage keys. `LIVE` mirrors the bridge object so a reload restores the
  // last live camera; `PRESETS` holds the user's named, shareable views; `LANG`
  // remembers the chosen interface language.
  const LS_LIVE = 'camera_director.live';
  const LS_PRESETS = 'camera_director.presets';
  const LS_LANG = 'camera_director.lang';

  // Exchange-format marker written into every exported JSON so an imported file
  // can be validated and so the format can evolve without breaking old shares.
  const EXPORT_KIND = 'slopsmith.camera-director.preset';
  const EXPORT_VERSION = 1;

  // ── Bridge defaults + per-axis slider ranges ────────────────────────────────
  // [key, min, max, step] — neutral defaults keep the camera identical to the
  // renderer's own auto-framing until the user enables and adjusts it.
  const AXES = [
    ['heightMul', 0.2, 3, 0.01],
    ['distMul', 0.3, 3, 0.01],
    ['yaw', -1.2, 1.2, 0.01],
    ['pitch', -120, 120, 1],
    ['panX', -200, 200, 1],
    ['panY', -200, 200, 1],
  ];
  const DEFAULTS = Object.freeze({
    enabled: false, heightMul: 1, distMul: 1, yaw: 0, pitch: 0, panX: 0, panY: 0,
  });

  // Idempotent teardown of a previous mount, if any.
  if (window.__camDir && typeof window.__camDir.destroy === 'function') {
    try { window.__camDir.destroy(); } catch (e) { /* ignore */ }
  }

  // ── Shared camera bridge ────────────────────────────────────────────────────
  // Create (or reuse) the object the renderer reads. We hydrate it from the last
  // saved live state so the user's view survives reloads.
  let savedLive = {};
  try { savedLive = JSON.parse(localStorage.getItem(LS_LIVE) || '{}'); } catch (e) { /* corrupt — ignore */ }
  const ctl = window.__h3dCamCtl = Object.assign(
    window.__h3dCamCtl || {}, DEFAULTS, savedLive
  );
  const persistLive = () => {
    try { localStorage.setItem(LS_LIVE, JSON.stringify(stripLive(ctl))); } catch (e) { /* quota — ignore */ }
  };
  // Only persist the camera fields (never stray properties another module may
  // have hung off the shared object).
  function stripLive(o) {
    const out = { enabled: !!o.enabled };
    for (const [k] of AXES) out[k] = clampAxis(k, Number(o[k]) || 0);
    return out;
  }
  function clampAxis(key, v) {
    const spec = AXES.find((a) => a[0] === key);
    if (!spec) return v;
    return Math.max(spec[1], Math.min(spec[2], v));
  }

  // ── Internationalisation (i18n) ─────────────────────────────────────────────
  // Embedded fallback dictionary. The canonical copies live in
  // assets/locales/{en,es}.json and are fetched at mount; if the fetch fails
  // (offline, older core) we still render with these.
  const FALLBACK_I18N = {
    en: {
      title: 'Camera Director', master: 'Free camera', on: 'ON', off: 'OFF',
      heightMul: 'Height', distMul: 'Zoom', yaw: 'Orbit', pitch: 'Tilt',
      panX: 'Pan X', panY: 'Pan Y', reset: 'Reset', close: 'Close',
      presets: 'Presets', save: 'Save view', load: 'Load', del: 'Delete',
      export: 'Export', exportAll: 'Export all', import: 'Import',
      savePrompt: 'Name this camera view:', noPresets: 'No saved views yet.',
      importErr: 'Invalid camera file.', dragHint: 'Drag the highway to orbit · press ` to toggle',
      language: 'Language',
    },
    es: {
      title: 'Director de Cámara', master: 'Cámara libre', on: 'SÍ', off: 'NO',
      heightMul: 'Altura', distMul: 'Zoom', yaw: 'Órbita', pitch: 'Inclinación',
      panX: 'Pan X', panY: 'Pan Y', reset: 'Restablecer', close: 'Cerrar',
      presets: 'Presets', save: 'Guardar vista', load: 'Cargar', del: 'Borrar',
      export: 'Exportar', exportAll: 'Exportar todo', import: 'Importar',
      savePrompt: 'Nombrá esta vista de cámara:', noPresets: 'Todavía no hay vistas guardadas.',
      importErr: 'Archivo de cámara inválido.', dragHint: 'Arrastrá el highway para orbitar · tecla ` para mostrar/ocultar',
      language: 'Idioma',
    },
  };
  const i18n = JSON.parse(JSON.stringify(FALLBACK_I18N));
  let lang = (localStorage.getItem(LS_LANG) || (navigator.language || 'en').slice(0, 2));
  if (!i18n[lang]) lang = 'en';
  const t = (key) => (i18n[lang] && i18n[lang][key]) || FALLBACK_I18N.en[key] || key;

  // Pull the up-to-date dictionaries from the plugin's asset route. Merges over
  // the fallback so a partial/old file can't blank out a string.
  async function loadLocales() {
    await Promise.all(['en', 'es'].map(async (code) => {
      try {
        const r = await fetch(`${ASSET_BASE}/locales/${code}.json`, { cache: 'no-cache' });
        if (r.ok) Object.assign(i18n[code], await r.json());
      } catch (e) { /* keep fallback */ }
    }));
  }

  // ── Tiny tween engine (GSAP-aware) ──────────────────────────────────────────
  // Preset loads animate the camera for a cinematic transition. If the host has
  // GSAP vendored (window.gsap) we defer to it; otherwise a self-contained rAF
  // eased lerp does the job with zero external dependencies.
  let _tweenRAF = 0;
  function tweenCamera(target, onUpdate, dur = 0.6) {
    cancelAnimationFrame(_tweenRAF);
    if (window.gsap) {
      const proxy = {};
      for (const [k] of AXES) proxy[k] = Number(ctl[k]) || 0;
      window.gsap.to(proxy, {
        ...target, duration: dur, ease: 'power2.out',
        onUpdate: () => { for (const [k] of AXES) ctl[k] = proxy[k]; onUpdate(); },
      });
      return;
    }
    const from = {}; for (const [k] of AXES) from[k] = Number(ctl[k]) || 0;
    const start = performance.now();
    const ease = (x) => 1 - Math.pow(1 - x, 3); // easeOutCubic
    const step = (now) => {
      const p = Math.min(1, (now - start) / (dur * 1000));
      const e = ease(p);
      for (const [k] of AXES) {
        if (k in target) ctl[k] = from[k] + (target[k] - from[k]) * e;
      }
      onUpdate();
      if (p < 1) _tweenRAF = requestAnimationFrame(step);
    };
    _tweenRAF = requestAnimationFrame(step);
  }

  // ── Inline SVG icon set ─────────────────────────────────────────────────────
  // Inline (not an icon font / CDN) so the plugin has no external dependency and
  // can't break on a Slopsmith update. 24×24, stroke-based, currentColor.
  const ICONS = {
    heightMul: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    distMul: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
    yaw: '<path d="M12 5a7 7 0 1 1-6.9 8M12 5V2M12 5l3 2"/>',
    pitch: '<path d="M3 12h18M12 3a9 9 0 0 1 0 18M12 3a9 9 0 0 0 0 18"/>',
    panX: '<path d="M2 12h20M6 8l-4 4 4 4M18 8l4 4-4 4"/>',
    panY: '<path d="M12 2v20M8 6l4-4 4 4M8 18l4 4 4-4"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    camera: '<path d="M3 7h4l2-2h6l2 2h4v12H3zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  };
  const svg = (name, size = 16) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // ── DOM scaffolding ─────────────────────────────────────────────────────────
  const listeners = []; // tracked for clean removal on destroy()
  const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); listeners.push([el, ev, fn, opts]); };

  const root = document.createElement('div');
  root.id = 'camdir-root';

  // Launcher chip (always present; opens the panel).
  const chip = document.createElement('button');
  chip.id = 'camdir-chip';
  chip.className = 'camdir-chip';
  chip.innerHTML = svg('camera', 18);
  chip.title = t('title');

  // Main panel.
  const panel = document.createElement('div');
  panel.id = 'camdir-panel';
  panel.className = 'camdir-panel';
  panel.hidden = true;

  root.appendChild(chip);
  root.appendChild(panel);

  // Slider/value handles, keyed by axis.
  const sliders = {};
  const valLabels = {};

  function buildPanel() {
    panel.innerHTML = '';

    // Header: title + master toggle + language switch + close.
    const head = el('div', 'camdir-head');
    const title = el('div', 'camdir-title');
    title.innerHTML = svg('camera', 18) + `<span>${t('title')}</span>`;
    const tools = el('div', 'camdir-tools');

    const langBtn = el('button', 'camdir-lang');
    langBtn.textContent = lang.toUpperCase();
    langBtn.title = t('language');
    on(langBtn, 'click', () => { setLang(lang === 'en' ? 'es' : 'en'); });

    const closeBtn = el('button', 'camdir-icon-btn');
    closeBtn.innerHTML = svg('close', 16);
    closeBtn.title = t('close');
    on(closeBtn, 'click', togglePanel);

    tools.append(langBtn, closeBtn);
    head.append(title, tools);
    panel.appendChild(head);

    // Master switch.
    const masterRow = el('label', 'camdir-master');
    const masterChk = el('input');
    masterChk.type = 'checkbox';
    masterChk.checked = !!ctl.enabled;
    on(masterChk, 'change', () => { ctl.enabled = masterChk.checked; persistLive(); refreshMaster(); });
    const masterTxt = el('span');
    masterTxt.textContent = t('master');
    const masterState = el('span', 'camdir-master-state');
    masterRow.append(masterChk, masterTxt, masterState);
    panel.appendChild(masterRow);
    panel._masterState = masterState;

    // Axis sliders.
    const grid = el('div', 'camdir-grid');
    for (const [key, min, max, step] of AXES) {
      const row = el('div', 'camdir-row');
      const label = el('div', 'camdir-label');
      label.innerHTML = svg(key, 15) + `<span>${t(key)}</span>`;
      const val = el('span', 'camdir-val');
      label.appendChild(val);

      const slider = el('input', 'camdir-slider');
      slider.type = 'range';
      slider.min = min; slider.max = max; slider.step = step;
      slider.value = Number(ctl[key]) || 0;
      on(slider, 'input', () => {
        ctl[key] = parseFloat(slider.value);
        val.textContent = fmtAxis(key, ctl[key]);
        persistLive();
      });

      row.append(label, slider);
      grid.appendChild(row);
      sliders[key] = slider;
      valLabels[key] = val;
      val.textContent = fmtAxis(key, ctl[key]);
    }
    panel.appendChild(grid);

    // Action row: reset + export + import.
    const actions = el('div', 'camdir-actions');
    actions.append(
      mkBtn('reset', t('reset'), () => resetCamera()),
      mkBtn('export', t('export'), () => exportPreset(currentView('live'))),
      mkBtn('import', t('import'), () => importPicker.click()),
    );
    panel.appendChild(actions);

    // Presets section.
    const presetHead = el('div', 'camdir-section-title');
    presetHead.textContent = t('presets');
    panel.appendChild(presetHead);

    const saveRow = el('div', 'camdir-actions');
    saveRow.append(
      mkBtn('save', t('save'), () => savePreset(), true),
      mkBtn('export', t('exportAll'), () => exportPreset(allPresetsBundle())),
    );
    panel.appendChild(saveRow);

    const list = el('div', 'camdir-presets');
    list.id = 'camdir-preset-list';
    panel.appendChild(list);
    panel._presetList = list;

    const hint = el('div', 'camdir-hint');
    hint.textContent = t('dragHint');
    panel.appendChild(hint);

    refreshMaster();
    renderPresets();
  }

  // Small DOM helpers.
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function mkBtn(icon, text, fn, primary) {
    const b = el('button', 'camdir-btn' + (primary ? ' camdir-btn--primary' : ''));
    b.innerHTML = svg(icon, 14) + `<span>${text}</span>`;
    on(b, 'click', fn);
    return b;
  }
  function fmtAxis(key, v) {
    if (key === 'yaw') return (v * 57.2958).toFixed(0) + '°';
    if (key === 'heightMul' || key === 'distMul') return v.toFixed(2) + '×';
    return v.toFixed(0);
  }

  function refreshMaster() {
    panel.classList.toggle('camdir-armed', !!ctl.enabled);
    if (panel._masterState) panel._masterState.textContent = ctl.enabled ? t('on') : t('off');
  }

  // Push the current `ctl` values back onto the sliders (after a preset load,
  // reset, or drag).
  function syncSliders() {
    for (const [key] of AXES) {
      if (sliders[key]) sliders[key].value = Number(ctl[key]) || 0;
      if (valLabels[key]) valLabels[key].textContent = fmtAxis(key, ctl[key]);
    }
    const m = panel.querySelector('.camdir-master input');
    if (m) m.checked = !!ctl.enabled;
    refreshMaster();
  }

  // ── Presets / persistence ───────────────────────────────────────────────────
  function readPresets() {
    try { return JSON.parse(localStorage.getItem(LS_PRESETS) || '[]'); } catch (e) { return []; }
  }
  function writePresets(arr) {
    try { localStorage.setItem(LS_PRESETS, JSON.stringify(arr)); } catch (e) { /* quota */ }
  }
  function currentView(name) {
    const cam = {};
    for (const [k] of AXES) cam[k] = clampAxis(k, Number(ctl[k]) || 0);
    return { name: name || 'view', cam, savedAt: new Date().toISOString() };
  }
  function savePreset() {
    const name = window.prompt(t('savePrompt'));
    if (!name) return;
    const arr = readPresets().filter((p) => p.name !== name);
    arr.push(currentView(name.trim()));
    writePresets(arr);
    renderPresets();
  }
  function applyPreset(preset) {
    if (!preset || !preset.cam) return;
    ctl.enabled = true;
    const target = {};
    for (const [k] of AXES) target[k] = clampAxis(k, Number(preset.cam[k]) || 0);
    tweenCamera(target, syncSliders);
    persistLive();
    syncSliders();
  }
  function deletePreset(name) {
    writePresets(readPresets().filter((p) => p.name !== name));
    renderPresets();
  }
  function resetCamera() {
    const target = {};
    for (const [k] of AXES) target[k] = DEFAULTS[k];
    tweenCamera(target, () => { syncSliders(); persistLive(); });
  }
  function renderPresets() {
    const list = panel._presetList;
    if (!list) return;
    const arr = readPresets();
    list.innerHTML = '';
    if (!arr.length) {
      const empty = el('div', 'camdir-empty');
      empty.textContent = t('noPresets');
      list.appendChild(empty);
      return;
    }
    for (const p of arr) {
      const item = el('div', 'camdir-preset');
      const nm = el('span', 'camdir-preset-name');
      nm.textContent = p.name;
      const load = mkBtn('reset', t('load'), () => applyPreset(p));
      load.querySelector('svg').remove(); // text-only for compactness
      const exp = el('button', 'camdir-icon-btn');
      exp.innerHTML = svg('export', 14); exp.title = t('export');
      on(exp, 'click', () => exportPreset({ kind: EXPORT_KIND, version: EXPORT_VERSION, preset: p }));
      const del = el('button', 'camdir-icon-btn camdir-danger');
      del.innerHTML = svg('close', 14); del.title = t('del');
      on(del, 'click', () => deletePreset(p.name));
      item.append(nm, load, exp, del);
      list.appendChild(item);
    }
  }

  // ── Export / import (shareable JSON) ────────────────────────────────────────
  function allPresetsBundle() {
    return { kind: EXPORT_KIND, version: EXPORT_VERSION, presets: readPresets() };
  }
  function exportPreset(payload) {
    // Wrap a bare live view into the exchange envelope if needed.
    let body = payload;
    if (payload && payload.cam && !payload.kind) {
      body = { kind: EXPORT_KIND, version: EXPORT_VERSION, preset: payload };
    }
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = body.preset ? body.preset.name : 'camera-views';
    a.href = url;
    a.download = `slopsmith-${String(base).replace(/[^\w.-]+/g, '_')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const importPicker = document.createElement('input');
  importPicker.type = 'file';
  importPicker.accept = 'application/json,.json';
  importPicker.style.display = 'none';
  on(importPicker, 'change', async () => {
    const file = importPicker.files && importPicker.files[0];
    importPicker.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.kind !== EXPORT_KIND) throw new Error('bad kind');
      if (Array.isArray(data.presets)) {
        // Bundle import: merge by name (incoming wins).
        const byName = new Map(readPresets().map((p) => [p.name, p]));
        for (const p of data.presets) if (p && p.name && p.cam) byName.set(p.name, p);
        writePresets([...byName.values()]);
        renderPresets();
      } else if (data.preset && data.preset.cam) {
        const arr = readPresets().filter((p) => p.name !== data.preset.name);
        arr.push(data.preset);
        writePresets(arr);
        renderPresets();
        applyPreset(data.preset);
      } else {
        throw new Error('no payload');
      }
    } catch (e) {
      window.alert(t('importErr'));
    }
  });

  // ── Language switch ─────────────────────────────────────────────────────────
  function setLang(next) {
    lang = i18n[next] ? next : 'en';
    try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* ignore */ }
    buildPanel(); // rebuild copy in the new language (cheap; preserves ctl state)
  }

  // ── Panel visibility + global hotkey ────────────────────────────────────────
  function togglePanel() {
    panel.hidden = !panel.hidden;
    chip.hidden = !panel.hidden;
    if (!panel.hidden) syncSliders();
  }
  function onKey(e) {
    if (e.key !== '`') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    togglePanel(); e.preventDefault();
  }
  on(chip, 'click', togglePanel);
  on(window, 'keydown', onKey);

  // ── Drag-to-orbit over the highway canvas ───────────────────────────────────
  let dragging = false, lastX = 0, lastY = 0;
  on(window, 'pointerdown', (e) => {
    if (!ctl.enabled) return;
    if (root.contains(e.target)) return;
    const tgt = e.target;
    if (tgt && (tgt.id === 'highway' || tgt.tagName === 'CANVAS')) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
    }
  });
  on(window, 'pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    ctl.yaw = clampAxis('yaw', ctl.yaw + dx * 0.005);
    ctl.pitch = clampAxis('pitch', ctl.pitch - dy * 0.6);
    syncSliders(); persistLive();
  });
  on(window, 'pointerup', () => { dragging = false; });

  // ── Mount ───────────────────────────────────────────────────────────────────
  document.body.appendChild(root);
  document.body.appendChild(importPicker);
  buildPanel();
  loadLocales().then(() => buildPanel()); // re-render once fresh copy arrives

  // ── Public lifecycle handle (idempotent teardown) ───────────────────────────
  // Stored on window so the next script injection can cleanly dispose this one,
  // preventing duplicate panels and leaked listeners/rAF.
  window.__camDir = {
    version: '1.0.0',
    destroy() {
      cancelAnimationFrame(_tweenRAF);
      for (const [el2, ev, fn, opts] of listeners) {
        try { el2.removeEventListener(ev, fn, opts); } catch (e) { /* ignore */ }
      }
      listeners.length = 0;
      root.remove();
      importPicker.remove();
      // Leave window.__h3dCamCtl in place (the renderer owns reading it); just
      // hand the camera back to auto-framing so a stale disable doesn't stick.
      if (window.__h3dCamCtl) window.__h3dCamCtl.enabled = window.__h3dCamCtl.enabled;
    },
  };
})();
