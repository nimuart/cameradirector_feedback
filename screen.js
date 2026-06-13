/* ============================================================================
 *  Camera Director — Slopsmith plugin runtime
 *  ----------------------------------------------------------------------------
 *  Floating, bilingual control panel that authors the 3D Highway camera:
 *    • Per-player profiles (Player 1 / Player 2) — each keeps its own live
 *      camera AND its own preset library; switching the tab swaps everything.
 *    • Blender-style navigation while dragging the highway (free cam on):
 *        drag = orbit · Shift = pan · Ctrl = zoom/dolly · Alt = height ·
 *        mouse-wheel / trackpad = zoom.
 *    • Editable values (tap a number to type an exact value / angle).
 *    • Preset library: create (named), load, save (overwrite), download, delete,
 *      import.
 *    • Draggable launcher chip (drop it wherever is comfortable).
 *
 *  ARCHITECTURE
 *  ------------
 *  Thin OVERLAY over the highway canvas. It never reaches into the renderer's
 *  internals; it reads/writes one shared bridge object, `window.__h3dCamCtl`,
 *  which the bundled `highway_3d` renderer consumes inside its `camUpdate()`:
 *
 *      window.__h3dCamCtl = {
 *        enabled, heightMul, distMul, yaw, pitch, panX, panY
 *      }
 *
 *  PERFORMANCE: drag/wheel mutate the bridge object directly (the renderer reads
 *  it each rAF, so motion is as smooth as the renderer); localStorage writes are
 *  debounced so a high-frequency drag never blocks the frame.
 *
 *  Fully IDEMPOTENT: tears down any prior mount (DOM + listeners + rAF + timers)
 *  before mounting fresh. Comments in English; UI copy lives in assets/locales.
 * ==========================================================================*/
(function () {
  'use strict';

  const PLUGIN_ID = 'camera_director';
  const ASSET_BASE = `/api/plugins/${PLUGIN_ID}/assets`;

  const LS_PROFILES = 'camera_director.profiles.v2';
  const LS_LIVE = 'camera_director.live';       // legacy v1 → migrated into Player 1
  const LS_PRESETS = 'camera_director.presets'; // legacy v1 → migrated into Player 1
  const LS_LANG = 'camera_director.lang';

  const EXPORT_KIND = 'slopsmith.camera-director.preset';
  const EXPORT_VERSION = 1;

  // [key, min, max, step] — neutral defaults match the renderer's auto-framing.
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

  // ── Per-player profiles ─────────────────────────────────────────────────────
  const PLAYER_KEYS = ['A', 'B'];
  const PLAYER_COLORS = { A: '#4080e0', B: '#e8742c' }; // P1 blue · P2 orange
  function loadProfiles() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_PROFILES) || 'null'); } catch (e) { /* corrupt */ }
    if (s && s.players && s.players.A && s.players.B && PLAYER_KEYS.includes(s.active)) return s;
    const fresh = { active: 'A', players: { A: { live: {}, presets: [] }, B: { live: {}, presets: [] } } };
    try { const l = JSON.parse(localStorage.getItem(LS_LIVE) || 'null'); if (l) fresh.players.A.live = l; } catch (e) { /* ignore */ }
    try { const p = JSON.parse(localStorage.getItem(LS_PRESETS) || 'null'); if (Array.isArray(p)) fresh.players.A.presets = p; } catch (e) { /* ignore */ }
    return fresh;
  }
  const profiles = loadProfiles();
  function activeP() { return profiles.players[profiles.active]; }
  function saveProfiles() { try { localStorage.setItem(LS_PROFILES, JSON.stringify(profiles)); } catch (e) { /* quota */ } }

  // ── Shared camera bridge (mirrors the ACTIVE player's live camera) ──────────
  const ctl = window.__h3dCamCtl = Object.assign(window.__h3dCamCtl || {}, DEFAULTS, activeP().live);
  function clampAxis(key, v) {
    const spec = AXES.find((a) => a[0] === key);
    if (!spec) return v;
    return Math.max(spec[1], Math.min(spec[2], v));
  }
  function stripLive(o) {
    const out = { enabled: !!o.enabled };
    for (const [k] of AXES) out[k] = clampAxis(k, Number(o[k]) || 0);
    return out;
  }
  function persistLive() { activeP().live = stripLive(ctl); saveProfiles(); }
  // Debounced persist for high-frequency drag/wheel (no localStorage per frame).
  let _persistT = 0;
  function persistSoon() { clearTimeout(_persistT); _persistT = setTimeout(persistLive, 250); }

  function switchPlayer(key) {
    if (!PLAYER_KEYS.includes(key) || key === profiles.active) return;
    persistLive();
    profiles.active = key;
    saveProfiles();
    const live = Object.assign({}, DEFAULTS, activeP().live);
    for (const k in live) ctl[k] = live[k];
    buildPanel();
    syncSliders();
  }

  // ── Internationalisation ────────────────────────────────────────────────────
  const FALLBACK_I18N = {
    en: {
      title: 'Camera Director', master: 'Free camera', on: 'ON', off: 'OFF',
      heightMul: 'Height', distMul: 'Zoom', yaw: 'Orbit', pitch: 'Tilt',
      panX: 'Pan X', panY: 'Pan Y', reset: 'Reset', close: 'Close',
      presets: 'Presets', create: 'Create preset', save: 'Save preset', load: 'Load',
      del: 'Delete', export: 'Export', download: 'Download', import: 'Import preset',
      savePrompt: 'Name this preset:', noPresets: 'No presets yet.',
      importErr: 'Invalid camera file.', editValue: 'Edit value',
      dragHint: 'Drag = orbit · Shift = pan · Ctrl = zoom · Alt = height · wheel = zoom · ` toggles',
      language: 'Language', player: 'Player',
    },
    es: {
      title: 'Director de Cámara', master: 'Cámara libre', on: 'SÍ', off: 'NO',
      heightMul: 'Altura', distMul: 'Zoom', yaw: 'Órbita', pitch: 'Inclinación',
      panX: 'Pan X', panY: 'Pan Y', reset: 'Restablecer', close: 'Cerrar',
      presets: 'Presets', create: 'Crear preset', save: 'Guardar preset', load: 'Cargar',
      del: 'Borrar', export: 'Exportar', download: 'Descargar', import: 'Importar preset',
      savePrompt: 'Nombrá este preset:', noPresets: 'Todavía no hay presets.',
      importErr: 'Archivo de cámara inválido.', editValue: 'Editar valor',
      dragHint: 'Arrastrar = órbita · Shift = paneo · Ctrl = zoom · Alt = altura · rueda = zoom · ` muestra/oculta',
      language: 'Idioma', player: 'Jugador',
    },
  };
  const i18n = JSON.parse(JSON.stringify(FALLBACK_I18N));
  let lang = (localStorage.getItem(LS_LANG) || (navigator.language || 'en').slice(0, 2));
  if (!i18n[lang]) lang = 'en';
  const t = (key) => (i18n[lang] && i18n[lang][key]) || FALLBACK_I18N.en[key] || key;
  async function loadLocales() {
    await Promise.all(['en', 'es'].map(async (code) => {
      try {
        const r = await fetch(`${ASSET_BASE}/locales/${code}.json`, { cache: 'no-cache' });
        if (r.ok) Object.assign(i18n[code], await r.json());
      } catch (e) { /* keep fallback */ }
    }));
  }

  // ── Tween engine (GSAP-aware) — cinematic preset loads / reset ──────────────
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
      for (const [k] of AXES) { if (k in target) ctl[k] = from[k] + (target[k] - from[k]) * e; }
      onUpdate();
      if (p < 1) _tweenRAF = requestAnimationFrame(step);
    };
    _tweenRAF = requestAnimationFrame(step);
  }

  // ── Inline SVG icon set ─────────────────────────────────────────────────────
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
    save: '<path d="M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7"/>',
    import: '<path d="M12 3v12M8 11l4 4 4-4M4 21h16"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    download: '<path d="M12 4v10M8 10l4 4 4-4M5 19h14"/>',
  };
  const svg = (name, size = 16) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // ── DOM scaffolding ─────────────────────────────────────────────────────────
  const listeners = [];
  const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); listeners.push([el, ev, fn, opts]); };

  const root = document.createElement('div');
  root.id = 'camdir-root';

  const chip = document.createElement('button');
  chip.id = 'camdir-chip';
  chip.className = 'camdir-chip';
  chip.innerHTML = svg('camera', 18);
  chip.title = t('title');

  const panel = document.createElement('div');
  panel.id = 'camdir-panel';
  panel.className = 'camdir-panel';
  panel.hidden = true;

  root.appendChild(chip);
  root.appendChild(panel);

  const sliders = {};
  const valLabels = {};

  function buildPanel() {
    panel.innerHTML = '';

    // Accent follows the active player (P1 blue · P2 orange) — used on the
    // outer panel border only.
    root.style.setProperty('--cd-accent', PLAYER_COLORS[profiles.active] || PLAYER_COLORS.A);

    // Player tabs at the very top — switching swaps camera + presets.
    const tabs = el('div', 'camdir-tabs');
    PLAYER_KEYS.forEach((k, i) => {
      const tab = el('button', 'camdir-tab' + (k === profiles.active ? ' is-active' : ''));
      tab.textContent = `${t('player')} ${i + 1}`;
      tab.style.setProperty('--tab', PLAYER_COLORS[k]);
      on(tab, 'click', () => switchPlayer(k));
      tabs.appendChild(tab);
    });
    panel.appendChild(tabs);

    // Header: title + language + close.
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

    // Master switch (Free camera).
    const masterRow = el('label', 'camdir-master');
    const masterChk = el('input');
    masterChk.type = 'checkbox';
    masterChk.checked = !!ctl.enabled;
    on(masterChk, 'change', () => { ctl.enabled = masterChk.checked; persistLive(); refreshMaster(); });
    const masterTxt = el('span', 'camdir-master-txt');
    masterTxt.textContent = t('master');
    const masterState = el('span', 'camdir-master-state');
    masterRow.append(masterChk, masterTxt, masterState);
    panel.appendChild(masterRow);
    panel._masterState = masterState;

    // Axis sliders (tap a value to type it exactly).
    const grid = el('div', 'camdir-grid');
    for (const [key, min, max, step] of AXES) {
      const row = el('div', 'camdir-row');
      const label = el('div', 'camdir-label');
      label.innerHTML = svg(key, 15) + `<span>${t(key)}</span>`;
      const val = el('span', 'camdir-val');
      val.title = t('editValue');
      on(val, 'click', () => openValueEditor(key));
      label.appendChild(val);

      const slider = el('input', 'camdir-slider');
      slider.type = 'range';
      slider.min = min; slider.max = max; slider.step = step;
      slider.value = Number(ctl[key]) || 0;
      on(slider, 'input', () => {
        ctl[key] = parseFloat(slider.value);
        val.textContent = fmtAxis(key, ctl[key]);
        persistSoon();
      });

      row.append(label, slider);
      grid.appendChild(row);
      sliders[key] = slider;
      valLabels[key] = val;
      val.textContent = fmtAxis(key, ctl[key]);
    }
    panel.appendChild(grid);

    // Presets — the whole library lives here.
    const presetHead = el('div', 'camdir-section-title');
    presetHead.textContent = t('presets');
    panel.appendChild(presetHead);

    const createRow = el('div', 'camdir-presets-top');
    const createBtn = mkBtn('save', t('create'), () => savePreset(), true);
    createBtn.classList.add('camdir-create');
    createRow.append(createBtn);
    panel.appendChild(createRow);

    const importRow = el('div', 'camdir-presets-import');
    const importBtn = el('button', 'camdir-import-link');
    importBtn.innerHTML = svg('import', 13) + `<span>${t('import')}</span>`;
    on(importBtn, 'click', () => importPicker.click());
    importRow.append(importBtn);
    panel.appendChild(importRow);

    const list = el('div', 'camdir-presets');
    list.id = 'camdir-preset-list';
    panel.appendChild(list);
    panel._presetList = list;

    const hint = el('div', 'camdir-hint');
    hint.textContent = t('dragHint');
    panel.appendChild(hint);

    const resetLink = el('button', 'camdir-reset-link');
    resetLink.textContent = t('reset');
    on(resetLink, 'click', () => resetCamera());
    panel.appendChild(resetLink);

    refreshMaster();
    renderPresets();
  }

  // ── Small helpers ───────────────────────────────────────────────────────────
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

  // Tap a value → popover to type an exact number / angle.
  let _valPopover = null;
  function closeValueEditor() { if (_valPopover) { _valPopover.remove(); _valPopover = null; } }
  function openValueEditor(key) {
    closeValueEditor();
    const scale = key === 'yaw' ? 57.2958 : 1;
    const cur = (Number(ctl[key]) || 0) * scale;
    const pop = el('div', 'camdir-valedit');
    const input = el('input'); input.type = 'text'; input.inputMode = 'decimal';
    input.value = (Math.round(cur * 100) / 100).toString();
    const unit = el('span', 'camdir-valedit-unit');
    unit.textContent = key === 'yaw' ? '°' : (key === 'heightMul' || key === 'distMul' ? '×' : '');
    const ok = el('button', 'camdir-valedit-ok'); ok.textContent = '✓';
    const commit = () => {
      const raw = parseFloat(String(input.value).replace(/[^0-9.\-]/g, ''));
      if (isFinite(raw)) {
        ctl[key] = clampAxis(key, raw / scale);
        if (sliders[key]) sliders[key].value = ctl[key];
        if (valLabels[key]) valLabels[key].textContent = fmtAxis(key, ctl[key]);
        persistLive();
      }
      closeValueEditor();
    };
    on(input, 'keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') closeValueEditor(); });
    on(ok, 'click', commit);
    pop.append(input, unit, ok);
    document.body.appendChild(pop); _valPopover = pop;
    const r = valLabels[key].getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, r.right - 140) + 'px';
    input.focus(); input.select();
    setTimeout(() => {
      const onDoc = (e) => { if (_valPopover && !_valPopover.contains(e.target)) { closeValueEditor(); window.removeEventListener('pointerdown', onDoc, true); } };
      window.addEventListener('pointerdown', onDoc, true);
    }, 0);
  }

  function refreshMaster() {
    panel.classList.toggle('camdir-armed', !!ctl.enabled);
    const row = panel.querySelector('.camdir-master');
    if (row) row.classList.toggle('is-on', !!ctl.enabled);
    if (panel._masterState) panel._masterState.textContent = ctl.enabled ? t('on') : t('off');
  }

  function syncSliders() {
    for (const [key] of AXES) {
      if (sliders[key]) sliders[key].value = Number(ctl[key]) || 0;
      if (valLabels[key]) valLabels[key].textContent = fmtAxis(key, ctl[key]);
    }
    const m = panel.querySelector('.camdir-master input');
    if (m) m.checked = !!ctl.enabled;
    refreshMaster();
  }

  // ── Presets / persistence (per active player) ───────────────────────────────
  function readPresets() { return Array.isArray(activeP().presets) ? activeP().presets : []; }
  function writePresets(arr) { activeP().presets = arr; saveProfiles(); }
  function currentView(name) {
    const cam = {};
    for (const [k] of AXES) cam[k] = clampAxis(k, Number(ctl[k]) || 0);
    // Tag with the player who made it, so its name carries that player colour.
    return { name: name || 'view', cam, color: PLAYER_COLORS[profiles.active], savedAt: new Date().toISOString() };
  }
  // Electron's renderer has no window.prompt() (returns null), so ask for the
  // name with our own inline field.
  function askName(initial, onOk) {
    closeValueEditor();
    const pop = el('div', 'camdir-valedit camdir-nameedit');
    const input = el('input'); input.type = 'text';
    input.placeholder = t('savePrompt'); input.value = initial || '';
    const ok = el('button', 'camdir-valedit-ok'); ok.textContent = '✓';
    const done = () => { const name = input.value.trim(); closeValueEditor(); if (name) onOk(name); };
    on(input, 'keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') closeValueEditor(); });
    on(ok, 'click', done);
    pop.append(input, ok);
    document.body.appendChild(pop); _valPopover = pop;
    // Anchor just under the "Create preset" button (not at the top of the panel).
    const anchor = panel.querySelector('.camdir-create') || panel;
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.left = (r.left + r.width / 2) + 'px';
    pop.style.transform = 'translateX(-50%)';
    input.focus();
    setTimeout(() => {
      const onDoc = (e) => { if (_valPopover && !_valPopover.contains(e.target)) { closeValueEditor(); window.removeEventListener('pointerdown', onDoc, true); } };
      window.addEventListener('pointerdown', onDoc, true);
    }, 0);
  }
  function savePreset() {
    askName('', (name) => {
      const arr = readPresets().filter((p) => p.name !== name);
      arr.push(currentView(name));
      writePresets(arr);
      renderPresets();
    });
  }
  function updatePreset(name) {
    const arr = readPresets();
    const i = arr.findIndex((p) => p.name === name);
    if (i < 0) return;
    const cam = {};
    for (const [k] of AXES) cam[k] = clampAxis(k, Number(ctl[k]) || 0);
    arr[i] = { name, cam, color: arr[i].color || PLAYER_COLORS[profiles.active], savedAt: new Date().toISOString() };
    writePresets(arr);
    renderPresets();
  }
  function applyPreset(preset) {
    if (!preset || !preset.cam) return;
    ctl.enabled = true;
    const target = {};
    for (const [k] of AXES) target[k] = clampAxis(k, Number(preset.cam[k]) || 0);
    tweenCamera(target, () => { syncSliders(); });
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
      on(item, 'dblclick', () => applyPreset(p));
      const nm = el('div', 'camdir-preset-name');
      nm.textContent = p.name;
      nm.title = t('load');
      // Background tint in the colour of the player who made the preset.
      const col = p.color || PLAYER_COLORS[profiles.active];
      nm.style.background = `color-mix(in srgb, ${col} 32%, transparent)`;
      nm.style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, ${col} 55%, transparent)`;

      const acts = el('div', 'camdir-preset-acts');
      const play = el('button', 'camdir-icon-btn camdir-act-play');
      play.innerHTML = svg('play', 14); play.title = t('load');
      on(play, 'click', () => applyPreset(p));
      const dl = el('button', 'camdir-icon-btn');
      dl.innerHTML = svg('download', 15); dl.title = t('download');
      on(dl, 'click', () => exportPreset({ kind: EXPORT_KIND, version: EXPORT_VERSION, preset: p }));
      const del = el('button', 'camdir-icon-btn camdir-danger');
      del.innerHTML = svg('close', 14); del.title = t('del');
      on(del, 'click', () => deletePreset(p.name));
      acts.append(play, dl, del);

      // Inverted order ONLY here (the preset row renders under a reversed rule):
      // appending acts-then-name yields name-left / icons-right visually.
      item.append(acts, nm);
      list.appendChild(item);
    }
  }

  // ── Export / import (shareable preset JSON) ─────────────────────────────────
  function exportPreset(payload) {
    let body = payload;
    if (payload && payload.cam && !payload.kind) {
      body = { kind: EXPORT_KIND, version: EXPORT_VERSION, preset: payload };
    }
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = body.preset ? body.preset.name : 'camera-preset';
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
      const incoming = Array.isArray(data.presets) ? data.presets : (data.preset ? [data.preset] : []);
      if (!incoming.length) throw new Error('no payload');
      const byName = new Map(readPresets().map((p) => [p.name, p]));
      for (const p of incoming) {
        if (p && p.name && p.cam) byName.set(p.name, { name: p.name, cam: p.cam, color: p.color || PLAYER_COLORS[profiles.active], savedAt: p.savedAt || new Date().toISOString() });
      }
      writePresets([...byName.values()]);
      renderPresets();
      if (incoming.length === 1) applyPreset(incoming[0]);
    } catch (e) {
      window.alert(t('importErr'));
    }
  });

  // ── Language switch ─────────────────────────────────────────────────────────
  function setLang(next) {
    lang = i18n[next] ? next : 'en';
    try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* ignore */ }
    buildPanel();
  }

  // ── Panel visibility + hotkey ───────────────────────────────────────────────
  function togglePanel() {
    panel.hidden = !panel.hidden;
    chip.hidden = !panel.hidden;
    if (!panel.hidden) {
      panel.classList.remove('camdir-pop');
      void panel.offsetWidth; // restart the pop-in animation
      panel.classList.add('camdir-pop');
      syncSliders();
    }
  }
  function onKey(e) {
    if (e.key !== '`') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    togglePanel(); e.preventDefault();
  }
  // Draggable launcher chip — drop it anywhere; a tap (no drag) opens the panel.
  const LS_CHIP = 'camera_director.chippos';
  function saveChipPos() {
    try { localStorage.setItem(LS_CHIP, JSON.stringify({ left: chip.style.left, top: chip.style.top })); } catch (e) { /* ignore */ }
  }
  function restoreChipPos() {
    try {
      const p = JSON.parse(localStorage.getItem(LS_CHIP) || 'null');
      if (p && p.left && p.top) { chip.style.left = p.left; chip.style.top = p.top; chip.style.right = 'auto'; }
    } catch (e) { /* ignore */ }
  }
  let chipDrag = null;
  on(chip, 'pointerdown', (e) => {
    const r = chip.getBoundingClientRect();
    chipDrag = { x0: e.clientX, y0: e.clientY, left: r.left, top: r.top, moved: false };
    try { chip.setPointerCapture(e.pointerId); } catch (e2) { /* ignore */ }
    e.preventDefault();
  });
  on(chip, 'pointermove', (e) => {
    if (!chipDrag) return;
    const dx = e.clientX - chipDrag.x0, dy = e.clientY - chipDrag.y0;
    if (!chipDrag.moved && Math.hypot(dx, dy) > 4) chipDrag.moved = true;
    if (!chipDrag.moved) return;
    const nx = Math.max(2, Math.min(window.innerWidth - chip.offsetWidth - 2, chipDrag.left + dx));
    const ny = Math.max(2, Math.min(window.innerHeight - chip.offsetHeight - 2, chipDrag.top + dy));
    chip.style.left = nx + 'px'; chip.style.top = ny + 'px'; chip.style.right = 'auto';
  });
  on(chip, 'pointerup', (e) => {
    if (!chipDrag) return;
    const moved = chipDrag.moved;
    chipDrag = null;
    try { chip.releasePointerCapture(e.pointerId); } catch (e2) { /* ignore */ }
    if (moved) saveChipPos(); else togglePanel(); // tap (not a drag) opens the panel
  });
  on(window, 'keydown', onKey);

  // ── Blender-style navigation over the highway canvas ────────────────────────
  let dragging = false, lastX = 0, lastY = 0;
  const overCanvas = (tgt) => tgt && (tgt.id === 'highway' || tgt.tagName === 'CANVAS');
  on(window, 'pointerdown', (e) => {
    if (!ctl.enabled || root.contains(e.target)) return;
    if (overCanvas(e.target)) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
  });
  on(window, 'pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (e.shiftKey) {
      ctl.panX = clampAxis('panX', (Number(ctl.panX) || 0) + dx * 0.5);
      ctl.panY = clampAxis('panY', (Number(ctl.panY) || 0) - dy * 0.5);
    } else if (e.ctrlKey) {
      ctl.distMul = clampAxis('distMul', (Number(ctl.distMul) || 1) * (1 + dy * 0.004));
    } else if (e.altKey) {
      ctl.heightMul = clampAxis('heightMul', (Number(ctl.heightMul) || 1) - dy * 0.004);
    } else {
      ctl.yaw = clampAxis('yaw', (Number(ctl.yaw) || 0) + dx * 0.005);
      ctl.pitch = clampAxis('pitch', (Number(ctl.pitch) || 0) - dy * 0.6);
    }
    syncSliders(); persistSoon();
  });
  on(window, 'pointerup', () => { if (dragging) { dragging = false; persistLive(); } });

  // Trackpad / mouse-wheel zoom (dolly) while hovering the highway.
  on(window, 'wheel', (e) => {
    if (!ctl.enabled || root.contains(e.target) || !overCanvas(e.target)) return;
    e.preventDefault();
    ctl.distMul = clampAxis('distMul', (Number(ctl.distMul) || 1) * (1 + (e.deltaY > 0 ? 0.06 : -0.06)));
    syncSliders(); persistSoon();
  }, { passive: false });

  // ── Mount ───────────────────────────────────────────────────────────────────
  document.body.appendChild(root);
  document.body.appendChild(importPicker);
  restoreChipPos();
  buildPanel();
  loadLocales().then(() => buildPanel());

  // ── Public lifecycle handle (idempotent teardown) ───────────────────────────
  window.__camDir = {
    version: '2.0.0',
    destroy() {
      cancelAnimationFrame(_tweenRAF);
      clearTimeout(_persistT);
      closeValueEditor();
      for (const [el2, ev, fn, opts] of listeners) {
        try { el2.removeEventListener(ev, fn, opts); } catch (e) { /* ignore */ }
      }
      listeners.length = 0;
      root.remove();
      importPicker.remove();
      if (window.__h3dCamCtl) window.__h3dCamCtl.enabled = window.__h3dCamCtl.enabled;
    },
  };
})();
