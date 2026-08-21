// UI: mosaico dei visori, barra comandi, focus a schermo intero, modali.

import { TileRenderer } from './decoder.js';
import { attachPointer } from './pointer.js';

const $ = (id) => document.getElementById(id);

const state = {
  devices: new Map(), // serial -> json del visore
  tiles: new Map(), // serial -> { el, canvas, renderer, detach, refs }
  selected: new Set(),
  pointerEnabled: false,
  focusSerial: null,
  config: null,
  keycodes: {},
  logs: [],
};

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

function log(message, level = 'info', serial = null) {
  const time = new Date().toLocaleTimeString('it-IT');
  const prefix = serial ? `${shortName(serial)} · ` : '';
  state.logs.push(`[${time}] ${level === 'error' ? '⚠︎ ' : ''}${prefix}${message}`);
  if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
  const panel = $('log-panel');
  if (!panel.classList.contains('hidden')) {
    const box = $('log-text');
    box.textContent = state.logs.join('\n');
    panel.scrollTop = panel.scrollHeight;
  }
  if (level === 'error') setStatus(`${prefix}${message}`);
}

function shortName(serial) {
  return state.devices.get(serial)?.displayName ?? serial;
}

function setStatus(text) {
  $('status-line').textContent = text ?? '';
}

async function run(promise, okMessage = null) {
  try {
    const value = await promise;
    if (okMessage) setStatus(okMessage);
    return value;
  } catch (err) {
    log(err.message, 'error');
    return null;
  }
}

/** Visori su cui agiscono i comandi: la selezione, o tutti se non c'è selezione. */
function targetSerials() {
  if (state.selected.size) return [...state.selected];
  return [...state.devices.keys()];
}

function reportBatch(results, verb) {
  if (!Array.isArray(results)) return;
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    log(`${verb}: ${results.length - failed.length}/${results.length} ok — errori: ${failed.map((f) => shortName(f.serial)).join(', ')}`, 'error');
  } else {
    setStatus(`${verb} su ${results.length} visore/i.`);
  }
}

// ---------------------------------------------------------------------------
// Mosaico
// ---------------------------------------------------------------------------

function createTile(serial) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.serial = serial;
  el.innerHTML = `
    <div class="tile-head">
      <input type="checkbox" class="sel" />
      <span class="dot"></span>
      <span class="tile-name"></span>
      <span class="battery"></span>
      <button class="icon-btn js-settings" title="Impostazioni visore">⚙︎</button>
      <button class="icon-btn js-focus" title="Ingrandisci">⤢</button>
    </div>
    <div class="tile-video">
      <canvas width="640" height="360"></canvas>
      <div class="tile-overlay">In attesa dell'immagine…</div>
    </div>
    <div class="tile-foot">
      <span class="tile-fg"></span>
      <button class="icon-btn js-home" title="Home">⌂</button>
      <button class="icon-btn js-back" title="Indietro">‹</button>
      <button class="icon-btn js-close" title="Chiudi l'app in primo piano">✕</button>
      <button class="icon-btn js-reconnect" title="Riconnetti">⟳</button>
    </div>`;

  const canvas = el.querySelector('canvas');
  const refs = {
    checkbox: el.querySelector('.sel'),
    dot: el.querySelector('.dot'),
    name: el.querySelector('.tile-name'),
    battery: el.querySelector('.battery'),
    overlay: el.querySelector('.tile-overlay'),
    fg: el.querySelector('.tile-fg'),
    videoBox: el.querySelector('.tile-video'),
  };

  const renderer = new TileRenderer(canvas);
  renderer.clear(); // il messaggio lo mostra l'overlay sopra il canvas

  const detach = attachPointer(canvas, {
    serial,
    isEnabled: () => state.pointerEnabled,
    onBack: () => window.pico.actions.key([serial], state.keycodes.BACK),
  });

  refs.checkbox.addEventListener('change', () => {
    if (refs.checkbox.checked) state.selected.add(serial);
    else state.selected.delete(serial);
    el.classList.toggle('selected', refs.checkbox.checked);
    updateSelectionCount();
  });

  el.querySelector('.js-focus').addEventListener('click', () => enterFocus(serial));
  el.querySelector('.js-settings').addEventListener('click', () => openDeviceModal(serial));
  el.querySelector('.js-home').addEventListener('click', () => run(window.pico.actions.home([serial])));
  el.querySelector('.js-back').addEventListener('click', () =>
    run(window.pico.actions.key([serial], state.keycodes.BACK)),
  );
  el.querySelector('.js-close').addEventListener('click', () =>
    run(window.pico.actions.closeForeground([serial])),
  );
  el.querySelector('.js-reconnect').addEventListener('click', () => run(window.pico.device.reconnect(serial)));

  const tile = { el, canvas, renderer, detach, refs };
  state.tiles.set(serial, tile);
  $('grid').append(el);
  return tile;
}

function removeTile(serial) {
  const tile = state.tiles.get(serial);
  if (!tile) return;
  tile.detach();
  tile.renderer.destroy();
  tile.el.remove();
  state.tiles.delete(serial);
  state.selected.delete(serial);
}

function updateTile(device) {
  const tile = state.tiles.get(device.serial) ?? createTile(device.serial);
  const { refs } = tile;
  refs.name.textContent = device.displayName;
  refs.name.title = device.serial;
  refs.dot.className = `dot ${device.state}`;
  refs.dot.title = device.error ? `${device.state}: ${device.error}` : device.state;
  tile.el.classList.toggle('pointer-armed', state.pointerEnabled);

  const battery = device.status?.battery;
  refs.battery.textContent = battery == null ? '' : `${battery}%`;
  refs.battery.classList.toggle('low', battery != null && battery <= 20);

  refs.fg.textContent = device.status?.foreground ?? '';
  refs.fg.title = device.status?.foreground ?? '';

  let overlay = null;
  if (device.state === 'connecting') overlay = 'Connessione in corso…';
  else if (device.state === 'error') overlay = device.error ?? 'Errore';
  else if (device.state === 'offline') overlay = 'Non collegato';
  else if (tile.renderer.size.width === 0) overlay = 'In attesa dell\'immagine…';
  refs.overlay.textContent = overlay ?? '';
  refs.overlay.classList.toggle('hidden', overlay === null);
}

function renderDevices(list) {
  const seen = new Set();
  for (const device of list) {
    state.devices.set(device.serial, device);
    seen.add(device.serial);
    updateTile(device);
  }
  for (const serial of [...state.tiles.keys()]) {
    if (!seen.has(serial)) {
      if (state.focusSerial === serial) exitFocus();
      removeTile(serial);
      state.devices.delete(serial);
    }
  }
  updateSummary();
  updateSelectionCount();
}

function updateSummary() {
  const total = state.devices.size;
  const online = [...state.devices.values()].filter((d) => d.state === 'streaming').length;
  $('summary').textContent = total
    ? `${online}/${total} visori in streaming`
    : 'Nessun visore collegato';
  $('empty').classList.toggle('hidden', total > 0);
  $('grid').classList.toggle('hidden', total === 0);
}

function updateSelectionCount() {
  const n = state.selected.size;
  $('selection-count').textContent = n
    ? `${n} selezionat${n === 1 ? 'o' : 'i'}`
    : `nessuna selezione → i comandi valgono per tutti (${state.devices.size})`;
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

function enterFocus(serial) {
  const tile = state.tiles.get(serial);
  if (!tile) return;
  if (state.focusSerial) exitFocus();

  state.focusSerial = serial;
  // Spostiamo il canvas: il decoder continua a lavorare, niente ripartenze.
  $('focus-canvas').replaceWith(tile.canvas);
  tile.canvas.id = 'focus-canvas';
  $('focus-title').textContent = `${shortName(serial)} — ${serial}`;
  $('focus').classList.remove('hidden');
  $('focus').classList.toggle('pointer-armed', state.pointerEnabled);
  run(window.pico.device.setQuality(serial, 'focus'));
}

function exitFocus() {
  const serial = state.focusSerial;
  if (!serial) return;
  const tile = state.tiles.get(serial);
  state.focusSerial = null;
  $('focus').classList.add('hidden');

  if (tile) {
    tile.canvas.removeAttribute('id');
    tile.refs.videoBox.prepend(tile.canvas);
    run(window.pico.device.setQuality(serial, 'grid'));
  }
  // Rimettiamo un canvas segnaposto nel contenitore del focus.
  if (!$('focus-canvas')) {
    const placeholder = document.createElement('canvas');
    placeholder.id = 'focus-canvas';
    document.querySelector('.focus-video').append(placeholder);
  }
}

// ---------------------------------------------------------------------------
// Libreria app
// ---------------------------------------------------------------------------

function renderAppSelect() {
  const select = $('app-select');
  const apps = state.config?.apps ?? [];
  const previous = select.value;
  select.innerHTML = '';
  if (!apps.length) {
    const opt = document.createElement('option');
    opt.textContent = '— libreria vuota, aggiungi un\'app —';
    opt.value = '';
    select.append(opt);
  }
  for (const app of apps) {
    const opt = document.createElement('option');
    opt.value = app.package;
    opt.dataset.activity = app.activity ?? '';
    opt.textContent = app.name;
    select.append(opt);
  }
  if (previous) select.value = previous;
  const hasApp = apps.length > 0;
  $('btn-launch').disabled = !hasApp;
  $('btn-stop').disabled = !hasApp;
}

function renderAppsList() {
  const list = $('apps-list');
  list.innerHTML = '';
  for (const [i, app] of (state.config?.apps ?? []).entries()) {
    const li = document.createElement('li');
    li.innerHTML = `<strong></strong><span class="pkg"></span><button class="icon-btn" title="Rimuovi">✕</button>`;
    li.querySelector('strong').textContent = app.name;
    li.querySelector('.pkg').textContent = app.activity ? `${app.package}/${app.activity}` : app.package;
    li.querySelector('button').addEventListener('click', async () => {
      const apps = [...state.config.apps];
      apps.splice(i, 1);
      state.config = await window.pico.config.patch({ apps });
      renderAppsList();
      renderAppSelect();
    });
    list.append(li);
  }
  if (!list.children.length) list.innerHTML = '<li class="muted">Nessuna app in libreria.</li>';
}

async function detectApps() {
  const box = $('detect-result');
  box.textContent = 'Rilevamento in corso…';
  const found = await run(window.pico.devices.commonPackages(targetSerials()));
  if (!found) return;
  box.innerHTML = '';
  if (!found.length) {
    box.textContent = 'Nessun pacchetto trovato.';
    return;
  }
  const title = document.createElement('p');
  title.className = 'muted';
  title.textContent = 'Clicca un pacchetto per aggiungerlo alla libreria (✓ = presente su tutti i visori):';
  box.append(title);
  for (const item of found) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = `${item.onAll ? '✓ ' : `(${item.count}/${item.total}) `}${item.package}`;
    btn.addEventListener('click', () => {
      $('app-package').value = item.package;
      $('app-name').value = item.package.split('.').pop();
      $('app-name').focus();
    });
    box.append(btn);
  }
}

// ---------------------------------------------------------------------------
// Modale impostazioni visore
// ---------------------------------------------------------------------------

let deviceModalSerial = null;

async function openDeviceModal(serial) {
  const device = state.devices.get(serial);
  if (!device) return;
  deviceModalSerial = serial;
  $('device-modal-title').textContent = `${device.displayName} — ${serial}`;
  $('device-label').value = device.label ?? '';
  $('device-mirror').value = device.mirror;
  $('device-crop').value = device.crop ?? '';

  const select = $('device-display');
  select.innerHTML = '<option value="0">0 (predefinito)</option>';
  $('device-modal').classList.remove('hidden');

  const displays = await window.pico.device.displays(serial).catch(() => []);
  if (displays?.length) {
    select.innerHTML = '';
    for (const id of displays) {
      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = id === 0 ? '0 (schermo principale)' : String(id);
      select.append(opt);
    }
  }
  select.value = String(device.displayId ?? 0);
}

async function saveDeviceModal() {
  const serial = deviceModalSerial;
  if (!serial) return;
  const device = state.devices.get(serial);
  const label = $('device-label').value.trim();
  const mirror = $('device-mirror').value;
  const crop = $('device-crop').value.trim();
  const displayId = Number($('device-display').value) || 0;

  $('device-modal').classList.add('hidden');
  if (label !== (device.label ?? '')) await run(window.pico.device.setLabel(serial, label));
  if (crop !== (device.crop ?? '')) await run(window.pico.device.setCrop(serial, crop));
  if (displayId !== device.displayId) await run(window.pico.device.setDisplay(serial, displayId));
  if (mirror !== device.mirror) await run(window.pico.device.setMirror(serial, mirror));
  renderDevices(await window.pico.devices.list());
}

// ---------------------------------------------------------------------------
// Eventi dal processo principale
// ---------------------------------------------------------------------------

function wireEvents() {
  window.pico.on('devices', (list) => renderDevices(list));

  window.pico.on('device-state', (device) => {
    state.devices.set(device.serial, device);
    updateTile(device);
    updateSummary();
  });

  window.pico.on('device-status', ({ serial, status }) => {
    const device = state.devices.get(serial);
    if (!device) return;
    device.status = status;
    updateTile(device);
  });

  window.pico.on('device-codec', ({ serial, width, height, codecName }) => {
    log(`video ${codecName} ${width}×${height}`, 'info', serial);
  });

  window.pico.on('frame', (frame) => {
    const tile = state.tiles.get(frame.serial);
    if (!tile) return;
    tile.renderer.handleFrame(frame);
    // Arrivano immagini: via il velo "in attesa", a meno che il visore non sia
    // in uno stato che merita comunque un messaggio (errore, riconnessione).
    if (state.devices.get(frame.serial)?.state === 'streaming') {
      tile.refs.overlay.classList.add('hidden');
    }
  });

  window.pico.on('log', ({ serial, level, message }) => log(message, level, serial));

  window.pico.on('scan-progress', ({ done, total, found }) => {
    setStatus(`Scansione rete: ${done}/${total} indirizzi, ${found} candidati`);
  });
}

function wireUi() {
  $('btn-scan').addEventListener('click', async () => {
    setStatus('Scansione della rete…');
    const res = await run(window.pico.devices.scan());
    if (res) setStatus(`Scansione completata: ${res.connected.length} visori collegati su ${res.open.length} candidati.`);
  });

  $('btn-sync').addEventListener('click', () => run(window.pico.devices.sync(), 'Elenco aggiornato.'));

  $('btn-usb').addEventListener('click', async () => {
    setStatus('Passaggio dei visori USB al wifi…');
    const res = await run(window.pico.devices.adoptUsb());
    if (!res) return;
    const ok = res.filter((r) => r.ok);
    setStatus(`${ok.length}/${res.length} visori passati al wifi.`);
    for (const r of res.filter((x) => !x.ok)) log(`${r.usb}: ${r.error}`, 'error');
  });

  $('btn-add').addEventListener('click', () => $('ip-modal').classList.remove('hidden'));
  $('ip-close').addEventListener('click', () => $('ip-modal').classList.add('hidden'));
  $('ip-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const host = $('ip-host').value.trim();
    const port = Number($('ip-port').value) || 5555;
    const serial = await run(window.pico.devices.add(host, port));
    if (serial) {
      $('ip-modal').classList.add('hidden');
      $('ip-host').value = '';
      setStatus(`Collegato ${serial}.`);
    }
  });

  $('pointer-toggle').addEventListener('change', (ev) => {
    state.pointerEnabled = ev.target.checked;
    $('pointer-warning').classList.toggle('hidden', !state.pointerEnabled);
    $('focus').classList.toggle('pointer-armed', state.pointerEnabled);
    for (const tile of state.tiles.values()) tile.el.classList.toggle('pointer-armed', state.pointerEnabled);
    window.pico.config.patch({ pointerEnabled: state.pointerEnabled });
  });

  $('btn-select-all').addEventListener('click', () => {
    state.selected = new Set(state.devices.keys());
    for (const [serial, tile] of state.tiles) {
      tile.refs.checkbox.checked = state.selected.has(serial);
      tile.el.classList.add('selected');
    }
    updateSelectionCount();
  });

  $('btn-select-none').addEventListener('click', () => {
    state.selected.clear();
    for (const tile of state.tiles.values()) {
      tile.refs.checkbox.checked = false;
      tile.el.classList.remove('selected');
    }
    updateSelectionCount();
  });

  const selectedApp = () => {
    const select = $('app-select');
    const opt = select.selectedOptions[0];
    if (!opt?.value) return null;
    return { package: opt.value, activity: opt.dataset.activity || null };
  };

  $('btn-launch').addEventListener('click', async () => {
    const app = selectedApp();
    if (!app) return;
    const serials = targetSerials();
    setStatus(`Avvio ${app.package} su ${serials.length} visore/i…`);
    reportBatch(await run(window.pico.actions.launch(serials, app.package, app.activity)), 'Avvio app');
  });

  $('btn-stop').addEventListener('click', async () => {
    const app = selectedApp();
    if (!app) return;
    reportBatch(await run(window.pico.actions.stop(targetSerials(), app.package)), 'Chiusura app');
  });

  $('btn-close-fg').addEventListener('click', async () => {
    reportBatch(await run(window.pico.actions.closeForeground(targetSerials())), 'Chiusura app attiva');
  });

  $('btn-home').addEventListener('click', async () => {
    reportBatch(await run(window.pico.actions.home(targetSerials())), 'Home');
  });

  $('btn-back').addEventListener('click', async () => {
    reportBatch(await run(window.pico.actions.key(targetSerials(), state.keycodes.BACK)), 'Indietro');
  });

  $('btn-vol-up').addEventListener('click', () => run(window.pico.actions.volume(targetSerials(), 2)));
  $('btn-vol-down').addEventListener('click', () => run(window.pico.actions.volume(targetSerials(), -2)));

  $('btn-reboot').addEventListener('click', async () => {
    const serials = targetSerials();
    if (!confirm(`Riavviare ${serials.length} visore/i? Torneranno disponibili dopo circa un minuto.`)) return;
    reportBatch(await run(window.pico.actions.reboot(serials)), 'Riavvio');
  });

  $('btn-apps').addEventListener('click', () => {
    renderAppsList();
    $('detect-result').innerHTML = '';
    $('apps-modal').classList.remove('hidden');
  });
  $('apps-close').addEventListener('click', () => $('apps-modal').classList.add('hidden'));
  $('btn-detect').addEventListener('click', detectApps);

  $('app-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const app = {
      id: crypto.randomUUID(),
      name: $('app-name').value.trim(),
      package: $('app-package').value.trim(),
      activity: $('app-activity').value.trim() || null,
    };
    state.config = await window.pico.config.patch({ apps: [...(state.config.apps ?? []), app] });
    $('app-name').value = '';
    $('app-package').value = '';
    $('app-activity').value = '';
    renderAppsList();
    renderAppSelect();
  });

  $('device-save').addEventListener('click', saveDeviceModal);
  $('device-cancel').addEventListener('click', () => $('device-modal').classList.add('hidden'));
  $('device-remove').addEventListener('click', async () => {
    const serial = deviceModalSerial;
    if (!serial || !confirm(`Rimuovere ${shortName(serial)} dall'elenco?`)) return;
    $('device-modal').classList.add('hidden');
    await run(window.pico.devices.remove(serial, true));
  });

  $('focus-exit').addEventListener('click', exitFocus);
  $('focus-home').addEventListener('click', () =>
    state.focusSerial && run(window.pico.actions.home([state.focusSerial])),
  );
  $('focus-back').addEventListener('click', () =>
    state.focusSerial && run(window.pico.actions.key([state.focusSerial], state.keycodes.BACK)),
  );
  $('focus-close-fg').addEventListener('click', () =>
    state.focusSerial && run(window.pico.actions.closeForeground([state.focusSerial])),
  );

  $('btn-log').addEventListener('click', () => {
    const panel = $('log-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      $('log-text').textContent = state.logs.join('\n');
      panel.scrollTop = panel.scrollHeight;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.key === 'Escape' && !state.focusSerial) {
      for (const id of ['apps-modal', 'device-modal', 'ip-modal']) $(id).classList.add('hidden');
      return;
    }
    if (!state.focusSerial) return;

    const K = state.keycodes;
    const map = {
      ArrowUp: K.DPAD_UP,
      ArrowDown: K.DPAD_DOWN,
      ArrowLeft: K.DPAD_LEFT,
      ArrowRight: K.DPAD_RIGHT,
      Enter: K.DPAD_CENTER,
      Backspace: K.BACK,
    };
    if (ev.key === 'Escape') {
      ev.preventDefault();
      exitFocus();
      return;
    }
    const keycode = map[ev.key];
    if (keycode != null) {
      ev.preventDefault();
      window.pico.actions.key([state.focusSerial], keycode).catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

async function boot() {
  wireEvents();
  wireUi();

  const info = await window.pico.info();
  state.config = info.config;
  state.keycodes = info.keycodes;
  state.pointerEnabled = !!info.config.pointerEnabled;
  $('pointer-toggle').checked = state.pointerEnabled;
  $('pointer-warning').classList.toggle('hidden', !state.pointerEnabled);

  renderAppSelect();
  log(`adb: ${info.adbPath} · scrcpy-server v${info.scrcpyVersion} · reti: ${info.subnets.join(', ') || 'n/d'}`);
  for (const problem of info.problems) log(problem, 'error');

  if (!('VideoDecoder' in window)) {
    log('WebCodecs non disponibile: usa la modalità screencap dalle impostazioni del visore.', 'error');
  }

  renderDevices(await window.pico.devices.list());
  setStatus('Pronto.');
}

boot().catch((err) => {
  console.error(err);
  setStatus(`Errore di avvio: ${err.message}`);
});
