// UI: postazioni (slot) nella schermata principale, anteprima grande a metà
// schermo con visuale libera, miniature sempre visibili nell'altra metà.

import { formattaTempo, riepilogo, statoBarra, stimaPosizione } from '../shared/playback.js';
import { TileRenderer } from './decoder.js';
import { Viewport } from './viewport.js';
import { attachPreviewInput, canvasPixelsPerClientPixel } from './pointer.js';

const $ = (id) => document.getElementById(id);

const state = {
  devices: new Map(), // serial -> json del visore
  cards: new Map(), // serial -> { el, canvas, renderer, refs }
  slots: [], // slots[i] = seriale o null
  slotCount: 10,
  unassigned: new Set(), // visori tolti dagli slot di proposito
  selected: new Set(), // selezione per i comandi di gruppo
  previewSerial: null,
  previewMode: 'view', // 'view' (guarda) | 'touch' (tocca)
  eyeMode: 'full', // 'full' (due occhi affiancati) | 'left' (un occhio solo)
  pointerMode: 'scrcpy', // 'scrcpy' | 'trackball' (visori PICO)
  lastTouch: null, // ultimo punto toccato: la diagnostica riprova lì
  videos: [], // filmati trovati sui visori, raggruppati per nome
  players: new Map(), // serial -> ultima lettura del lettore, con l'ora in cui è arrivata
  playerTimer: null,
  playerKeys: 'media', // con quali tasti si comanda il lettore del visore
  profiliLettore: {},
  player: 'sistema', // con quale lettore aprire i filmati
  lettori: {},
  viewport: new Viewport(),
  pendingSlot: null, // slot che ha aperto la modale "aggiungi"
  config: null,
  keycodes: {},
  remote: null, // stato del server telecomando (solo sul Mac)
  logs: [],
};

let previewCtx = null;

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
    $('log-text').textContent = state.logs.join('\n');
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

/** Visori su cui agiscono i comandi: la selezione, o tutte le postazioni. */
function targetSerials() {
  if (state.selected.size) return [...state.selected];
  return state.slots.filter(Boolean);
}

function reportBatch(results, verb) {
  if (!Array.isArray(results)) return;
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    log(
      `${verb}: ${results.length - failed.length}/${results.length} ok — errori: ${failed
        .map((f) => shortName(f.serial))
        .join(', ')}`,
      'error',
    );
  } else {
    setStatus(`${verb} su ${results.length} visore/i.`);
  }
}

/**
 * "Un occhio" ⇄ "Immagine intera", su tutte le postazioni piene.
 *
 * Il ritaglio lo fa il visore, non la finestra: così l'occhio singolo si vede
 * anche nelle miniature e sulla wifi viaggia metà dei dati. Ogni visore si
 * riavvia lo streaming, quindi ci mette un paio di secondi.
 */
async function toggleEyeMode() {
  const serials = state.slots.filter(Boolean);
  if (!serials.length) {
    log('Nessun visore collegato.', 'error');
    return;
  }
  const mode = state.eyeMode === 'left' ? 'full' : 'left';
  const button = $('btn-eye');
  button.disabled = true;
  setStatus(mode === 'left' ? 'Passo a un occhio solo…' : 'Torno all\'immagine intera…');
  const results = await run(window.pico.devices.eye(serials, mode));
  button.disabled = false;
  if (results === null) return;
  reportBatch(results, mode === 'left' ? 'Un occhio' : 'Immagine intera');
  // Se non ce l'ha fatta nessuno il pulsante deve restare com'era: mostrarlo
  // acceso su un ritaglio mai applicato sarebbe una bugia.
  if (!results.some((r) => r.ok)) return;
  state.eyeMode = mode;
  renderEyeMode();
}

/**
 * "Modo PICO": i visori PICO non hanno un touchscreen e scartano i tocchi che
 * dicono di venirne. Questo li manda dichiarandoli di un'altra periferica, che
 * loro accettano. Vale su tutte le postazioni piene.
 */
async function togglePointerMode() {
  const serials = state.slots.filter(Boolean);
  if (!serials.length) {
    log('Nessun visore collegato.', 'error');
    return;
  }
  const mode = state.pointerMode === 'trackball' ? 'scrcpy' : 'trackball';
  const button = $('btn-pointer-mode');
  button.disabled = true;
  const results = await run(window.pico.devices.pointerMode(serials, mode));
  button.disabled = false;
  if (results === null) return;
  state.pointerMode = mode;
  renderPointerMode();
  setStatus(
    mode === 'trackball'
      ? 'Modo PICO acceso: i tocchi vengono inviati in modo compatibile con i visori.'
      : 'Modo PICO spento: tocchi inviati per la via normale.',
  );
}

function renderPointerMode() {
  const pico = state.pointerMode === 'trackball';
  const button = $('btn-pointer-mode');
  button.classList.toggle('is-active', pico);
  // Hanno senso solo mentre si tocca: in Visuale non parte niente comunque.
  const inTocco = state.previewMode === 'touch';
  button.classList.toggle('hidden', !inTocco);
  $('btn-diagnose').classList.toggle('hidden', !inTocco);
}

/**
 * Tocca il centro dell'anteprima provando tutte le strade, una ogni due
 * secondi, scrivendo nel registro cosa sta per mandare. Serve a smettere di
 * indovinare quale periferica finta accetta questo modello di visore: si
 * guarda il visore e si vede a quale prova reagisce.
 */
async function diagnosePointer() {
  const serial = state.previewSerial;
  if (!serial) return;
  const punto = state.lastTouch ?? state.viewport.viewToFrame(0.5, 0.5);
  const button = $('btn-diagnose');
  button.disabled = true;
  if ($('log-panel').classList.contains('hidden')) $('btn-log').click();
  setStatus(
    state.lastTouch
      ? 'Diagnostica sull\'ultimo punto che hai cliccato: guarda il visore e segui il registro.'
      : 'Clicca prima il punto da provare, poi ripremi Diagnostica. Intanto provo il centro.',
  );
  await run(window.pico.device.diagnosePointer(serial, punto.nx, punto.ny));
  button.disabled = false;
}

function renderEyeMode() {
  const left = state.eyeMode === 'left';
  const button = $('btn-eye');
  button.classList.toggle('is-active', left);
  button.textContent = left ? 'Immagine intera' : 'Un occhio';
}

// ---------------------------------------------------------------------------
// Video sui visori
// ---------------------------------------------------------------------------

function openVideoModal() {
  $('video-modal').classList.remove('hidden');
  $('video-search').value = '';
  $('video-search').focus();
  renderVideoList();
  // Se non abbiamo ancora letto i file, li leggiamo ora: la ricerca su dieci
  // visori richiede qualche secondo, e farla all'avvio dell'app sarebbe tempo
  // sprecato per chi non usa i video.
  if (!state.videos.length) loadVideos();
}

async function loadVideos() {
  const serials = state.slots.filter(Boolean);
  if (!serials.length) {
    $('video-status').textContent = 'Nessun visore collegato.';
    return;
  }
  $('video-refresh').disabled = true;
  $('video-status').textContent = `Cerco nei file di ${serials.length} visore/i…`;
  const elenco = await run(window.pico.devices.videos(serials));
  $('video-refresh').disabled = false;
  if (elenco === null) {
    $('video-status').textContent = 'Ricerca non riuscita: guarda il registro.';
    return;
  }
  state.videos = elenco;
  renderVideoList();
}

function renderVideoList() {
  const cerca = $('video-search').value.trim().toLowerCase();
  const trovati = cerca
    ? state.videos.filter((v) => v.name.toLowerCase().includes(cerca))
    : state.videos;

  const lista = $('video-list');
  lista.replaceChildren();

  if (!state.videos.length) {
    $('video-status').textContent = $('video-refresh').disabled
      ? $('video-status').textContent
      : 'Nessun filmato trovato in Movies, Download, DCIM, Video o Pictures.';
    return;
  }

  $('video-status').textContent = cerca
    ? `${trovati.length} di ${state.videos.length} filmati`
    : `${state.videos.length} filmati trovati`;

  for (const video of trovati) {
    const riga = document.createElement('button');
    riga.className = 'video-row';
    riga.type = 'button';

    const nome = document.createElement('span');
    nome.className = 'video-name';
    nome.textContent = video.name;

    const quanti = document.createElement('span');
    quanti.className = `video-count${video.onAll ? ' tutti' : ''}`;
    quanti.textContent = video.onAll
      ? `su tutti (${video.count})`
      : `su ${video.count} di ${video.total}`;

    riga.append(nome, quanti);
    riga.addEventListener('click', () => playVideo(video));
    lista.append(riga);
  }
}

/**
 * Manda il filmato in riproduzione su tutti i visori che ce l'hanno.
 *
 * I comandi partono insieme, quindi i visori partono nello stesso momento —
 * ma non fotogramma per fotogramma: per quella servirebbe un'app dentro il
 * visore, e va detto invece di lasciarlo credere.
 */
async function playVideo(video) {
  // Un clic su un nome non è un ordine di far partire il filmato in sala: la
  // riga dell'elenco serve a scegliere, la conferma a lanciare. Senza, basta
  // sfiorare la voce sbagliata davanti al pubblico.
  const quanti = video.on.length;
  const ok = window.confirm(
    `Avviare «${video.name}» su ${quanti} visore${quanti > 1 ? 'i' : ''}?\n\n` +
      'Parte dall\'inizio su tutti, nello stesso momento.',
  );
  if (!ok) return;
  const results = await run(window.pico.devices.playVideo(video.on));
  if (results === null) return;
  reportBatch(results, `«${video.name}»`);
  $('video-modal').classList.add('hidden');
  // La barra deve comparire adesso, non al prossimo giro: il lettore ci mette
  // un momento ad aprirsi, e questa è l'attesa che serve.
  setTimeout(pollPlayers, 1500);
}

function persistSlots() {
  return window.pico.config
    .patch({ slots: state.slots, slotCount: state.slotCount, unassigned: [...state.unassigned] })
    .catch((err) => log(err.message, 'error'));
}

// ---------------------------------------------------------------------------
// Schede dei visori
// ---------------------------------------------------------------------------

function createCard(serial) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.serial = serial;
  el.innerHTML = `
    <div class="card-head">
      <input type="checkbox" class="sel" title="Seleziona per i comandi di gruppo" />
      <span class="dot"></span>
      <span class="card-name"></span>
      <span class="battery"></span>
      <button class="icon-btn js-settings" title="Impostazioni visore">⚙︎</button>
    </div>
    <div class="card-video">
      <canvas width="640" height="360"></canvas>
      <div class="tile-overlay">In attesa dell'immagine…</div>
      <div class="card-hint">Clicca per aprire l'anteprima</div>
    </div>
    <div class="card-foot">
      <span class="card-fg"></span>
      <button class="icon-btn js-home" title="Home">⌂</button>
      <button class="icon-btn js-back" title="Indietro">‹</button>
      <button class="icon-btn js-close" title="Chiudi l'app in primo piano">✕</button>
      <button class="icon-btn js-reconnect" title="Riconnetti">⟳</button>
    </div>`;

  const canvas = el.querySelector('canvas');
  const refs = {
    checkbox: el.querySelector('.sel'),
    dot: el.querySelector('.dot'),
    name: el.querySelector('.card-name'),
    battery: el.querySelector('.battery'),
    overlay: el.querySelector('.tile-overlay'),
    fg: el.querySelector('.card-fg'),
  };

  const renderer = new TileRenderer(canvas);
  renderer.clear();

  refs.checkbox.addEventListener('change', () => {
    if (refs.checkbox.checked) state.selected.add(serial);
    else state.selected.delete(serial);
    el.classList.toggle('selected', refs.checkbox.checked);
    updateSelectionCount();
  });

  el.querySelector('.card-video').addEventListener('click', () => selectForPreview(serial));
  el.querySelector('.js-settings').addEventListener('click', () => openDeviceModal(serial));
  el.querySelector('.js-home').addEventListener('click', () => run(window.pico.actions.home([serial])));
  el.querySelector('.js-back').addEventListener('click', () =>
    run(window.pico.actions.key([serial], state.keycodes.BACK)),
  );
  el.querySelector('.js-close').addEventListener('click', () => run(window.pico.actions.closeForeground([serial])));
  el.querySelector('.js-reconnect').addEventListener('click', () => run(window.pico.device.reconnect(serial)));

  const card = { el, canvas, renderer, refs };
  state.cards.set(serial, card);
  return card;
}

function destroyCard(serial) {
  const card = state.cards.get(serial);
  if (!card) return;
  card.renderer.destroy();
  card.el.remove();
  state.cards.delete(serial);
  state.selected.delete(serial);
}

function updateCard(device) {
  const card = state.cards.get(device.serial);
  if (!card) return;
  const { refs } = card;
  refs.name.textContent = device.displayName;
  refs.name.title = device.serial;
  refs.dot.className = `dot ${device.state}`;
  refs.dot.title = device.error ? `${device.state}: ${device.error}` : device.state;
  card.el.classList.toggle('previewing', state.previewSerial === device.serial);

  const battery = device.status?.battery;
  refs.battery.textContent = battery == null ? '' : `${battery}%`;
  refs.battery.classList.toggle('low', battery != null && battery <= 20);

  refs.fg.textContent = device.status?.foreground ?? '';
  refs.fg.title = device.status?.foreground ?? '';

  const message = stateMessage(device, card.renderer);
  refs.overlay.textContent = message ?? '';
  refs.overlay.classList.toggle('hidden', message === null);

  if (state.previewSerial === device.serial) updatePreviewChrome();
}

/** Messaggio da mostrare sopra l'immagine, o null se l'immagine basta da sola. */
function stateMessage(device, renderer) {
  if (device.state === 'connecting') return 'Connessione in corso…';
  if (device.state === 'error') return device.error ?? 'Errore';
  if (device.state === 'offline') return 'Non collegato';
  if (!renderer || renderer.size.width === 0) return 'In attesa dell\'immagine…';
  return null;
}

// ---------------------------------------------------------------------------
// Postazioni (slot)
// ---------------------------------------------------------------------------

/**
 * Allinea gli slot alla realtà: toglie i visori spariti e assegna i nuovi alla
 * prima postazione libera (o a quella da cui è stata aperta la modale).
 */
function syncSlots() {
  const before = JSON.stringify(state.slots);

  while (state.slots.length < state.slotCount) state.slots.push(null);
  if (state.slots.length > state.slotCount) state.slots = state.slots.slice(0, state.slotCount);
  for (let i = 0; i < state.slots.length; i++) {
    if (state.slots[i] && !state.devices.has(state.slots[i])) state.slots[i] = null;
  }

  for (const serial of state.devices.keys()) {
    if (state.slots.includes(serial) || state.unassigned.has(serial)) continue;
    const target =
      state.pendingSlot != null && state.slots[state.pendingSlot] == null
        ? state.pendingSlot
        : state.slots.indexOf(null);
    if (target === -1) {
      log(`${shortName(serial)} è collegato ma non ci sono postazioni libere.`, 'error');
      state.unassigned.add(serial);
      continue;
    }
    state.slots[target] = serial;
    state.pendingSlot = null;
  }

  if (JSON.stringify(state.slots) !== before) persistSlots();
  renderSlots();
}

function renderSlots() {
  const container = $('slots');

  // Un contenitore per slot, riusato: così le schede (e i loro decoder) restano vive.
  while (container.children.length < state.slots.length) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slot';
    container.append(wrapper);
  }
  while (container.children.length > state.slots.length) container.lastElementChild.remove();

  state.slots.forEach((serial, index) => {
    const wrapper = container.children[index];
    wrapper.dataset.index = String(index);
    const device = serial ? state.devices.get(serial) : null;

    if (!device) {
      if (wrapper.firstElementChild?.classList.contains('slot-empty')) return;
      wrapper.innerHTML = `
        <button class="slot-empty">
          <span class="plus">+</span>
          <span>Aggiungi visore</span>
          <span class="slot-index">Postazione ${index + 1}</span>
        </button>`;
      wrapper.querySelector('.slot-empty').addEventListener('click', () => openAddModal(index));
      return;
    }

    const card = state.cards.get(serial) ?? createCard(serial);
    if (card.el.parentElement !== wrapper) wrapper.replaceChildren(card.el);
    updateCard(device);
  });

  const filled = state.slots.filter(Boolean).length;
  $('wall-count').textContent = `${filled}/${state.slots.length} occupate`;
  $('btn-slot-remove').disabled = state.slots.length <= 1 || state.slots.at(-1) != null;
}

function renderDevices(list) {
  const seen = new Set();
  for (const device of list) {
    state.devices.set(device.serial, device);
    seen.add(device.serial);
  }
  for (const serial of [...state.devices.keys()]) {
    if (seen.has(serial)) continue;
    state.devices.delete(serial);
    state.unassigned.delete(serial);
    if (state.previewSerial === serial) closePreview();
    destroyCard(serial);
  }
  syncSlots();
  updateSummary();
  updateSelectionCount();
}

function updateSummary() {
  const filled = state.slots.filter(Boolean).length;
  const streaming = state.slots.filter((s) => s && state.devices.get(s)?.state === 'streaming').length;
  $('summary').textContent = filled
    ? `${streaming}/${filled} visori in streaming`
    : 'Nessun visore collegato — clicca una postazione per aggiungerlo';
}

function updateSelectionCount() {
  const n = state.selected.size;
  const total = state.slots.filter(Boolean).length;
  $('selection-count').textContent = n
    ? `${n} selezionat${n === 1 ? 'o' : 'i'}`
    : `nessuna selezione → i comandi valgono per tutti (${total})`;
}

// ---------------------------------------------------------------------------
// Anteprima grande
// ---------------------------------------------------------------------------

function selectForPreview(serial) {
  if (state.previewSerial === serial) return;

  const previous = state.previewSerial;
  if (previous) {
    const old = state.cards.get(previous);
    if (old) {
      old.renderer.onPaint = null;
      old.el.classList.remove('previewing');
    }
  }

  const card = state.cards.get(serial);
  if (!card) return;

  state.previewSerial = serial;
  state.previewMode = 'view'; // si riparte sempre dalla modalità sicura
  state.lastTouch = null;
  state.viewport = new Viewport();
  card.renderer.onPaint = drawPreview;
  card.el.classList.add('previewing');

  $('preview').classList.remove('hidden');
  $('stage').classList.add('split');
  updatePreviewChrome();
  drawPreview();

  // Dichiariamo cosa stiamo guardando: il Mac alza la qualità di questo visore
  // (e la tiene alta finché almeno un client lo sta guardando).
  run(window.pico.device.preview(serial));
}

function closePreview() {
  const serial = state.previewSerial;
  state.previewSerial = null;
  if (serial) {
    const card = state.cards.get(serial);
    if (card) {
      card.renderer.onPaint = null;
      card.el.classList.remove('previewing');
    }
    run(window.pico.device.preview(null));
  }
  $('preview').classList.add('hidden');
  $('stage').classList.remove('split');
}

/** Ridisegna l'anteprima prendendo l'inquadratura dal canvas della miniatura. */
function drawPreview() {
  const serial = state.previewSerial;
  if (!serial) return;
  const source = state.cards.get(serial)?.canvas;
  if (!source?.width || !source?.height) return;

  const canvas = $('preview-canvas');
  previewCtx ??= canvas.getContext('2d', { alpha: false });

  state.viewport.setFrameSize(source.width, source.height);
  const rect = state.viewport.rect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  previewCtx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
}

function updatePreviewChrome() {
  const serial = state.previewSerial;
  if (!serial) return;
  const device = state.devices.get(serial);
  if (!device) return;
  const card = state.cards.get(serial);

  $('preview-name').textContent = device.displayName;
  $('preview-dot').className = `dot ${device.state}`;
  const bits = [serial];
  if (device.status?.battery != null) bits.push(`${device.status.battery}%`);
  if (device.status?.foreground) bits.push(device.status.foreground);
  $('preview-meta').textContent = bits.join(' · ');

  const message = stateMessage(device, card?.renderer);
  $('preview-overlay').textContent = message ?? '';
  $('preview-overlay').classList.toggle('hidden', message === null);

  const touch = state.previewMode === 'touch';
  $('mode-view').classList.toggle('is-active', !touch);
  $('mode-touch').classList.toggle('is-active', touch);
  $('touch-warning').classList.toggle('hidden', !touch);
  renderPointerMode();
  $('preview').classList.toggle('mode-touch', touch);
  $('preview-hint').textContent = touch
    ? 'Il clic tocca lo schermo del visore · tasto destro = Indietro · rotellina = scorrimento'
    : 'Trascina per guardarti intorno · rotellina per zoomare · nessun tocco viene inviato al visore';

  const home = state.viewport.isHome;
  $('btn-recenter').classList.toggle('is-active', !home);
  const badge = $('view-badge');
  // Mentre è esposto l'avviso "il clic non arriva al visore" non lo copriamo:
  // trascinando, questa funzione viene richiamata di continuo.
  if (badge.classList.contains('avviso')) return;
  badge.classList.toggle('hidden', home);
  badge.textContent = `Visuale spostata · ${state.viewport.zoomLabel}`;
}

let clicIgnoratoTimer = null;

/**
 * Il clic in modalità Visuale non arriva al visore: è voluto, perché quella è
 * la modalità sicura mentre c'è qualcuno che indossa il visore. Ma se nessuno
 * lo dice, sembra che il programma sia rotto.
 */
function segnalaClicIgnorato() {
  const badge = $('view-badge');
  badge.classList.remove('hidden');
  badge.textContent = 'Sei in Visuale: il clic non arriva al visore — passa a Tocco';
  badge.classList.add('avviso');
  clearTimeout(clicIgnoratoTimer);
  clicIgnoratoTimer = setTimeout(scartaClicIgnorato, 2600);
}

function scartaClicIgnorato() {
  clearTimeout(clicIgnoratoTimer);
  clicIgnoratoTimer = null;
  const badge = $('view-badge');
  if (!badge.classList.contains('avviso')) return;
  badge.classList.remove('avviso');
  updatePreviewChrome();
}

function panPreview(dxClient, dyClient) {
  const scale = canvasPixelsPerClientPixel($('preview-canvas'));
  // Trascinando a destra si scopre quello che sta a sinistra: l'inquadratura si
  // muove al contrario del mouse, come quando si sposta una mappa.
  state.viewport.panByFramePixels(-dxClient * scale, -dyClient * scale);
  drawPreview();
  updatePreviewChrome();
}

function recenterPreview() {
  state.viewport.home();
  drawPreview();
  updatePreviewChrome();
}

function wirePreview() {
  attachPreviewInput($('preview-canvas'), {
    getMode: () => state.previewMode,
    onPan: panPreview,
    onZoom: (factor, nx, ny) => {
      state.viewport.zoomBy(factor, nx, ny);
      drawPreview();
      updatePreviewChrome();
    },
    onTouch: (type, nx, ny, button) => {
      if (!state.previewSerial) return;
      const point = state.viewport.viewToFrame(nx, ny);
      // La diagnostica riprova su quest'ultimo punto: è quello che l'operatore
      // stava cercando di premere, non il centro di un'inquadratura spostata.
      if (type === 'down') state.lastTouch = point;
      window.pico.pointer({ serial: state.previewSerial, type, nx: point.nx, ny: point.ny, button });
    },
    onScroll: (nx, ny, hscroll, vscroll) => {
      if (!state.previewSerial) return;
      const point = state.viewport.viewToFrame(nx, ny);
      window.pico.scroll({ serial: state.previewSerial, nx: point.nx, ny: point.ny, hscroll, vscroll });
    },
    onBack: () => {
      if (state.previewSerial) run(window.pico.actions.key([state.previewSerial], state.keycodes.BACK));
    },
    onIgnoredClick: segnalaClicIgnorato,
  });

  $('mode-view').addEventListener('click', () => {
    state.previewMode = 'view';
    scartaClicIgnorato();
    updatePreviewChrome();
  });
  $('mode-touch').addEventListener('click', () => {
    state.previewMode = 'touch';
    // L'avviso "sei in Visuale" non deve sopravvivere al passaggio a Tocco:
    // resterebbe a contraddire la modalità appena scelta.
    scartaClicIgnorato();
    updatePreviewChrome();
  });
  $('btn-recenter').addEventListener('click', recenterPreview);
  $('preview-close').addEventListener('click', closePreview);

  const onPreview = (fn) => () => state.previewSerial && run(fn(state.previewSerial));
  $('preview-home').addEventListener('click', onPreview((s) => window.pico.actions.home([s])));
  $('preview-back').addEventListener('click', onPreview((s) => window.pico.actions.key([s], state.keycodes.BACK)));
  $('preview-close-fg').addEventListener('click', onPreview((s) => window.pico.actions.closeForeground([s])));
  $('preview-vol-down').addEventListener('click', onPreview((s) => window.pico.actions.volume([s], -2)));
  $('preview-vol-up').addEventListener('click', onPreview((s) => window.pico.actions.volume([s], 2)));
}

// ---------------------------------------------------------------------------
// Modale "aggiungi visore"
// ---------------------------------------------------------------------------

function openAddModal(slotIndex) {
  state.pendingSlot = slotIndex;
  $('add-title').textContent = `Aggiungi un visore — postazione ${slotIndex + 1}`;
  $('add-progress').textContent = '';
  renderAvailable();
  $('add-modal').classList.remove('hidden');
  $('ip-host').focus();
}

function closeAddModal() {
  $('add-modal').classList.add('hidden');
  state.pendingSlot = null;
}

/** Visori collegati che non stanno in nessuna postazione. */
function availableDevices() {
  return [...state.devices.values()].filter((d) => !state.slots.includes(d.serial));
}

function renderAvailable() {
  const list = $('available-list');
  list.innerHTML = '';
  const available = availableDevices();
  if (!available.length) {
    list.innerHTML = '<li class="muted">Nessun visore libero: usa "Cerca in rete" o inserisci un IP.</li>';
    return;
  }
  for (const device of available) {
    const li = document.createElement('li');
    li.innerHTML = '<strong></strong><span class="pkg"></span><button class="btn btn-primary">Assegna</button>';
    li.querySelector('strong').textContent = device.displayName;
    li.querySelector('.pkg').textContent = device.serial;
    li.querySelector('button').addEventListener('click', () => {
      assignToSlot(device.serial, state.pendingSlot);
      closeAddModal();
    });
    list.append(li);
  }
}

function assignToSlot(serial, slotIndex) {
  const index = slotIndex != null && state.slots[slotIndex] == null ? slotIndex : state.slots.indexOf(null);
  if (index === -1) {
    log('Non ci sono postazioni libere: aggiungi uno slot.', 'error');
    return;
  }
  state.unassigned.delete(serial);
  state.slots[index] = serial;
  persistSlots();
  renderSlots();
  updateSummary();
}

function freeSlot(serial) {
  const index = state.slots.indexOf(serial);
  if (index === -1) return;
  state.slots[index] = null;
  state.unassigned.add(serial);
  if (state.previewSerial === serial) closePreview();
  state.cards.get(serial)?.el.remove(); // la scheda resta viva, pronta se la riassegni
  persistSlots();
  renderSlots();
  updateSummary();
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
  $('btn-launch').disabled = !apps.length;
  $('btn-stop').disabled = !apps.length;
}

function renderAppsList() {
  const list = $('apps-list');
  list.innerHTML = '';
  for (const [i, app] of (state.config?.apps ?? []).entries()) {
    const li = document.createElement('li');
    li.innerHTML = '<strong></strong><span class="pkg"></span><button class="icon-btn" title="Rimuovi">✕</button>';
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
    const known = state.devices.has(device.serial);
    state.devices.set(device.serial, device);
    if (!known) syncSlots();
    updateCard(device);
    updateSummary();
  });

  window.pico.on('device-status', ({ serial, status }) => {
    const device = state.devices.get(serial);
    if (!device) return;
    device.status = status;
    updateCard(device);
  });

  window.pico.on('device-codec', ({ serial, width, height, codecName }) => {
    log(`video ${codecName} ${width}×${height}`, 'info', serial);
  });

  window.pico.on('frame', (frame) => {
    const card = state.cards.get(frame.serial);
    if (!card) return;
    card.renderer.handleFrame(frame);
    if (state.devices.get(frame.serial)?.state === 'streaming') {
      card.refs.overlay.classList.add('hidden');
      if (state.previewSerial === frame.serial) $('preview-overlay').classList.add('hidden');
    }
  });

  window.pico.on('log', ({ serial, level, message }) => log(message, level, serial));

  window.pico.on('remote-status', renderRemoteStatus);

  // Solo da browser: il collegamento al Mac può cadere e va ripreso.
  if (window.pico.isRemote) {
    window.pico.on('connection', async ({ connected }) => {
      $('offline-banner').classList.toggle('hidden', connected);
      if (!connected) return;
      setStatus('Ricollegato al Mac.');
      renderDevices(await window.pico.devices.list().catch(() => []));
    });
  }

  window.pico.on('scan-progress', ({ done, total, found }) => {
    const text = `Scansione rete: ${done}/${total} indirizzi, ${found} candidati`;
    setStatus(text);
    if (!$('add-modal').classList.contains('hidden')) $('add-progress').textContent = text;
  });
}

async function doScan() {
  setStatus('Scansione della rete…');
  const res = await run(window.pico.devices.scan());
  const text = res
    ? `Scansione completata: ${res.connected.length} visori collegati su ${res.open.length} candidati.`
    : 'Scansione fallita.';
  setStatus(text);
  $('add-progress').textContent = text;
  renderAvailable();
}

async function doAdoptUsb() {
  setStatus('Passaggio dei visori USB al wifi…');
  const res = await run(window.pico.devices.adoptUsb());
  if (!res) return;
  const ok = res.filter((r) => r.ok);
  const text = `${ok.length}/${res.length} visori passati al wifi.`;
  setStatus(text);
  $('add-progress').textContent = text;
  for (const r of res.filter((x) => !x.ok)) log(`${r.usb}: ${r.error}`, 'error');
  renderAvailable();
}

function wireUi() {
  $('btn-scan').addEventListener('click', doScan);
  $('btn-usb').addEventListener('click', doAdoptUsb);
  $('btn-sync').addEventListener('click', () => run(window.pico.devices.sync(), 'Elenco aggiornato.'));
  $('btn-eye').addEventListener('click', toggleEyeMode);
  $('btn-pointer-mode').addEventListener('click', togglePointerMode);
  $('btn-diagnose').addEventListener('click', diagnosePointer);

  $('btn-video').addEventListener('click', openVideoModal);
  $('video-close').addEventListener('click', () => $('video-modal').classList.add('hidden'));
  $('video-refresh').addEventListener('click', loadVideos);
  $('video-search').addEventListener('input', renderVideoList);

  $('add-scan').addEventListener('click', doScan);
  $('add-usb').addEventListener('click', doAdoptUsb);
  $('add-close').addEventListener('click', closeAddModal);
  $('ip-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const host = $('ip-host').value.trim();
    const port = Number($('ip-port').value) || 5555;
    $('add-progress').textContent = `Collegamento a ${host}…`;
    const serial = await run(window.pico.devices.add(host, port));
    if (serial) {
      $('ip-host').value = '';
      $('add-progress').textContent = `Collegato ${serial}.`;
      closeAddModal();
    }
  });

  $('btn-slot-add').addEventListener('click', () => {
    state.slotCount = Math.min(24, state.slots.length + 1);
    syncSlots();
    persistSlots();
  });
  $('btn-slot-remove').addEventListener('click', () => {
    if (state.slots.at(-1) != null || state.slots.length <= 1) return;
    state.slotCount = state.slots.length - 1;
    syncSlots();
    persistSlots();
  });

  $('btn-select-all').addEventListener('click', () => {
    state.selected = new Set(state.slots.filter(Boolean));
    for (const [serial, card] of state.cards) {
      const on = state.selected.has(serial);
      card.refs.checkbox.checked = on;
      card.el.classList.toggle('selected', on);
    }
    updateSelectionCount();
  });

  $('btn-select-none').addEventListener('click', () => {
    state.selected.clear();
    for (const card of state.cards.values()) {
      card.refs.checkbox.checked = false;
      card.el.classList.remove('selected');
    }
    updateSelectionCount();
  });

  const selectedApp = () => {
    const opt = $('app-select').selectedOptions[0];
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

  $('btn-close-fg').addEventListener('click', async () =>
    reportBatch(await run(window.pico.actions.closeForeground(targetSerials())), 'Chiusura app attiva'),
  );
  $('btn-home').addEventListener('click', async () =>
    reportBatch(await run(window.pico.actions.home(targetSerials())), 'Home'),
  );
  $('btn-back').addEventListener('click', async () =>
    reportBatch(await run(window.pico.actions.key(targetSerials(), state.keycodes.BACK)), 'Indietro'),
  );
  $('btn-vol-up').addEventListener('click', () => run(window.pico.actions.volume(targetSerials(), 2)));
  $('btn-vol-down').addEventListener('click', () => run(window.pico.actions.volume(targetSerials(), -2)));

  $('btn-reboot').addEventListener('click', async () => {
    const serials = targetSerials();
    if (!serials.length) return;
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
  $('device-free').addEventListener('click', () => {
    $('device-modal').classList.add('hidden');
    if (deviceModalSerial) freeSlot(deviceModalSerial);
  });
  $('device-remove').addEventListener('click', async () => {
    const serial = deviceModalSerial;
    if (!serial || !confirm(`Rimuovere ${shortName(serial)}? Verrà scollegato e tolto dalla postazione.`)) return;
    $('device-modal').classList.add('hidden');
    await run(window.pico.devices.remove(serial, true));
  });

  $('btn-log').addEventListener('click', () => {
    const panel = $('log-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      $('log-text').textContent = state.logs.join('\n');
      panel.scrollTop = panel.scrollHeight;
    }
  });

  // Copiare a mano da un pannello che scorre è un supplizio, e questo registro
  // serve proprio a essere mandato a qualcuno.
  $('log-copy').addEventListener('click', async () => {
    const testo = state.logs.join('\n');
    if (!testo) {
      setStatus('Il registro è vuoto.');
      return;
    }
    try {
      await navigator.clipboard.writeText(testo);
      setStatus(`Registro copiato (${state.logs.length} righe): incollalo dove ti serve.`);
    } catch {
      // Senza permesso per gli appunti (capita nel browser via http) si
      // seleziona tutto, così basta ⌘C.
      const range = document.createRange();
      range.selectNodeContents($('log-text'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      setStatus('Registro selezionato: premi ⌘C per copiarlo.');
    }
  });

  $('log-clear').addEventListener('click', () => {
    state.logs.length = 0;
    $('log-text').textContent = '';
    setStatus('Registro svuotato: quello che fai adesso resta da solo.');
  });

  document.addEventListener('keydown', onKeyDown);
}

function onKeyDown(ev) {
  if (ev.target.matches('input, select, textarea')) return;

  const openModal = ['add-modal', 'apps-modal', 'device-modal', 'remote-modal', 'video-modal'].find(
    (id) => !$(id).classList.contains('hidden'),
  );
  if (ev.key === 'Escape') {
    if (openModal === 'add-modal') closeAddModal();
    else if (openModal) $(openModal).classList.add('hidden');
    else if (state.previewSerial) closePreview();
    return;
  }
  if (openModal || !state.previewSerial) return;

  const K = state.keycodes;
  if (state.previewMode === 'touch') {
    const keycode = {
      ArrowUp: K.DPAD_UP,
      ArrowDown: K.DPAD_DOWN,
      ArrowLeft: K.DPAD_LEFT,
      ArrowRight: K.DPAD_RIGHT,
      Enter: K.DPAD_CENTER,
      Backspace: K.BACK,
    }[ev.key];
    if (keycode != null) {
      ev.preventDefault();
      // Anche i tasti vanno tracciati: sono l'altra metà del comando a
      // distanza, e finora un tasto che non arrivava era indistinguibile da un
      // tasto che il visore ignora.
      log(`tasto ${ev.key} → keycode ${keycode}`, 'info', state.previewSerial);
      run(window.pico.actions.key([state.previewSerial], keycode));
    }
    return;
  }

  // Modalità visuale: le frecce spostano l'inquadratura, "0" torna sul visitatore.
  const step = 60;
  const pan = {
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
  }[ev.key];
  if (pan) {
    ev.preventDefault();
    panPreview(pan[0], pan[1]);
    return;
  }
  if (ev.key === '0') {
    ev.preventDefault();
    recenterPreview();
  }
}

// ---------------------------------------------------------------------------
// Telecomando da iPad (pannello visibile solo sul Mac)
// ---------------------------------------------------------------------------

function renderRemoteStatus(status) {
  if (!status) return;
  state.remote = status;

  $('remote-dot').className = `dot ${status.running ? 'streaming' : ''}`;
  $('remote-label').textContent = status.running
    ? `Acceso sulla porta ${status.port}`
    : 'Spento';
  $('remote-toggle').textContent = status.running ? 'Spegni' : 'Accendi';
  $('remote-pin').textContent = status.pin ?? '------';
  $('remote-clients').textContent = status.running
    ? `${status.clients} telecomando/i collegato/i in questo momento.`
    : '';

  const list = $('remote-urls');
  list.innerHTML = '';
  if (!status.running) {
    list.innerHTML = '<li class="muted">Accendi il telecomando per vedere l\'indirizzo.</li>';
    return;
  }
  if (!status.urls.length) {
    list.innerHTML = '<li class="muted">Il Mac non risulta collegato a nessuna rete.</li>';
    return;
  }
  for (const url of status.urls) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="pkg"></span><span class="muted">apre già sbloccato</span>';
    li.querySelector('.pkg').textContent = `${url}/?k=${status.pin}`;
    list.append(li);
  }
}

/** Crediti in fondo alla finestra: il logo compare solo se è stato caricato. */
function renderBrand(brand) {
  if (!brand) return;
  $('version').textContent = brand.version ? `v${brand.version}` : '';
  $('credit-text').textContent = brand.credit ?? '';
  const logo = $('credit-logo');
  if (brand.logo) {
    logo.src = brand.logo;
    logo.classList.remove('hidden');
  } else {
    logo.classList.add('hidden');
  }
}

function wireRemotePanel() {
  // Un telecomando non può accendere o spegnere il server che lo sta servendo.
  if (window.pico.isRemote) return;

  $('btn-remote').addEventListener('click', async () => {
    renderRemoteStatus(await run(window.pico.remote.status()));
    $('remote-modal').classList.remove('hidden');
  });
  $('remote-close').addEventListener('click', () => $('remote-modal').classList.add('hidden'));

  $('remote-toggle').addEventListener('click', async () => {
    const running = state.remote?.running;
    $('remote-toggle').disabled = true;
    const status = await run(running ? window.pico.remote.stop() : window.pico.remote.start());
    $('remote-toggle').disabled = false;
    if (status) {
      renderRemoteStatus(status);
      setStatus(status.running ? `Telecomando acceso sulla porta ${status.port}.` : 'Telecomando spento.');
    }
  });

  $('remote-newpin').addEventListener('click', async () => {
    if (!confirm('Cambiare il PIN? I telecomandi già collegati verranno disconnessi.')) return;
    renderRemoteStatus(await run(window.pico.remote.newPin(), 'PIN cambiato.'));
  });
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

async function boot() {
  wireEvents();
  wireUi();
  wirePreview();
  wireRemotePanel();

  const info = await window.pico.info();
  state.config = info.config;
  state.keycodes = info.keycodes;
  state.slotCount = info.config.slotCount ?? 10;
  state.slots = Array.isArray(info.config.slots) ? [...info.config.slots] : [];
  state.unassigned = new Set(info.config.unassigned ?? []);
  state.playerKeys = info.config.playerKeys ?? 'media';
  state.profiliLettore = info.playerProfiles ?? {};
  state.player = info.config.player ?? 'sistema';
  state.lettori = info.players ?? {};
  state.eyeMode = info.config.eyeMode === 'left' ? 'left' : 'full';
  state.pointerMode = info.config.pointerMode === 'trackball' ? 'trackball' : 'scrcpy';

  renderEyeMode();
  renderAppSelect();
  renderBrand(info.brand);
  renderRemoteStatus(info.remote);
  log(`adb: ${info.adbPath} · scrcpy-server v${info.scrcpyVersion} · reti: ${info.subnets.join(', ') || 'n/d'}`);
  for (const problem of info.problems) log(problem, 'error');

  if (!('VideoDecoder' in window)) {
    log('WebCodecs non disponibile: usa la modalità screencap dalle impostazioni del visore.', 'error');
  }

  renderDevices(await window.pico.devices.list());
  wirePlaybar();
  setStatus('Pronto.');
}

boot().catch((err) => {
  console.error(err);
  setStatus(`Errore di avvio: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Barra del filmato
// ---------------------------------------------------------------------------

/**
 * Chiede a ogni visore a che punto è il filmato.
 *
 * Ogni due secondi, non dieci volte al secondo: ogni lettura è un comando adb
 * per visore, e con dieci postazioni sarebbe un martellamento. Fra una lettura
 * e l'altra la barra si muove da sola, contando il tempo che passa.
 */
let tickLettore = 0;

/** Un filmato c'è se gliel'abbiamo mandato noi, o se ne stiamo già leggendo uno. */
function filmatoInGiro() {
  if (state.players.size) return true;
  return state.slots.filter(Boolean).some((s) => state.devices.get(s)?.playing);
}

async function pollPlayers() {
  const serials = state.slots.filter(Boolean);
  if (!serials.length) return;
  // Ogni lettura è un comando adb per visore. Quando non c'è nessun filmato in
  // giro si guarda molto più di rado: serve solo ad accorgersi di un filmato
  // avviato dal visore stesso, non a seguirlo secondo per secondo.
  tickLettore += 1;
  if (!filmatoInGiro() && tickLettore % 5 !== 0) return;
  const results = await window.pico.devices.playerState(serials).catch(() => null);
  if (!Array.isArray(results)) return;
  const adesso = Date.now();
  for (const r of results) {
    if (r.ok && r.value) state.players.set(r.serial, { ...r.value, letto: adesso });
    else state.players.delete(r.serial);
  }
  // I visori spariti dalle postazioni non devono restare nella media.
  for (const serial of [...state.players.keys()]) {
    if (!serials.includes(serial)) state.players.delete(serial);
  }
  drawPlaybar();
}

/** Le letture dei soli visori ancora in postazione. */
function lettureCorrenti() {
  return state.slots.filter(Boolean).map((s) => state.players.get(s)).filter(Boolean);
}

/** I filmati che abbiamo mandato noi e che risultano ancora in corso. */
function filmatiMandati() {
  return state.slots
    .filter(Boolean)
    .map((s) => state.devices.get(s)?.playing)
    .filter(Boolean);
}

/**
 * Disegna la barra.
 *
 * La barra c'è **sempre**, finché c'è un visore in postazione. Nascondere una
 * riga che a volte compare e a volte no non è discrezione: è un guasto, per chi
 * guarda. Quando manca qualcosa — il filmato, la durata, un lettore che si
 * lasci seguire — la barra resta e lo scrive. Cosa dire lo decide `statoBarra`,
 * qui si scrive soltanto.
 */
function drawPlaybar() {
  const barra = $('playbar');
  const visori = state.slots.filter(Boolean);
  if (!visori.length) {
    barra.classList.add('hidden');
    return;
  }
  barra.classList.remove('hidden');

  const sintesi = riepilogo(lettureCorrenti());
  const b = statoBarra(sintesi, filmatiMandati());

  $('playbar-name').textContent = b.nome;
  $('playbar-time').textContent = b.tempo;
  $('playbar-note').textContent = b.nota;
  $('playbar-fill').style.width = `${b.quota}%`;
  $('btn-play-pause').textContent = b.etichettaPausa;
  $('btn-play-pause').disabled = !b.pausaAttiva;
  $('btn-replay').disabled = !b.pausaAttiva;
  $('playbar-track').classList.toggle('is-off', !b.saltoAttivo);

  // La fascia rossa è la distanza fra il visore più avanti e quello più
  // indietro: mezzo secondo non si vede, mezzo minuto sì, ed è quello che
  // conta sapere prima di entrare in sala.
  const spread = $('playbar-spread');
  spread.classList.toggle('hidden', !b.distanti);
  if (b.distanti) {
    const quota = (ms) => Math.max(0, Math.min(100, (ms / sintesi.durationMs) * 100));
    spread.style.left = `${quota(sintesi.minMs)}%`;
    spread.style.width = `${Math.max(1, quota(sintesi.maxMs) - quota(sintesi.minMs))}%`;
  }

  for (const serial of visori) aggiornaRigaLettore(serial);
}

/** La posizione del singolo visore, sotto la sua miniatura. */
function aggiornaRigaLettore(serial) {
  const card = state.cards.get(serial);
  if (!card) return;
  let riga = card.el.querySelector('.card-player');
  const lettura = state.players.get(serial);
  if (!lettura) {
    riga?.remove();
    return;
  }
  if (!riga) {
    riga = document.createElement('div');
    riga.className = 'card-player';
    card.el.append(riga);
  }
  const posizione = formattaTempo(stimaPosizione(lettura));
  riga.textContent = lettura.durationMs
    ? `${posizione} / ${formattaTempo(lettura.durationMs)} · ${lettura.state}`
    : `${posizione} · ${lettura.state}`;
}

/** Il punto del filmato su cui si è cliccato, in millisecondi. */
function puntoCliccato(evento, elemento, durationMs) {
  const rect = elemento.getBoundingClientRect();
  const quota = Math.max(0, Math.min(1, (evento.clientX - rect.left) / rect.width));
  return Math.round(quota * durationMs);
}

function wirePlaybar() {
  $('btn-play-pause').addEventListener('click', async () => {
    const sintesi = riepilogo(lettureCorrenti());
    // Play e pausa espliciti, mai l'interruttore: se un visore fosse rimasto
    // indietro, il tasto unico lo farebbe ripartire mentre ferma gli altri.
    const azione = sintesi?.inRiproduzione ? 'pause' : 'play';
    const results = await run(window.pico.devices.media(targetSerials(), azione, state.playerKeys));
    reportBatch(results, azione === 'pause' ? 'pausa' : 'ripresa');
    setTimeout(pollPlayers, 400);
  });

  $('btn-replay').addEventListener('click', async () => {
    const results = await run(window.pico.devices.replay(targetSerials()));
    reportBatch(results, 'da capo');
    setTimeout(pollPlayers, 1500);
  });

  $('playbar-track').addEventListener('click', async (evento) => {
    const sintesi = riepilogo(lettureCorrenti());
    if (!sintesi?.durationMs) {
      log('Senza la durata non so dove sia il punto che hai indicato.', 'error');
      return;
    }
    const ms = puntoCliccato(evento, $('playbar-track'), sintesi.durationMs);
    setStatus(`Porto i visori a ${formattaTempo(ms)}…`);
    const results = await run(window.pico.devices.seek(targetSerials(), ms));
    reportBatch(results, `salto a ${formattaTempo(ms)}`);
    setTimeout(pollPlayers, 600);
  });

  // Con quale lettore aprire i filmati. VLC va scelto solo se c'è davvero sui
  // visori: sceglierlo dove manca vorrebbe dire un comando che non apre niente,
  // e un pubblico davanti a uno schermo fermo.
  const menuLettore = $('player-app');
  for (const [id, lettore] of Object.entries(state.lettori)) {
    const opzione = document.createElement('option');
    opzione.value = id;
    opzione.textContent = lettore.etichetta;
    menuLettore.append(opzione);
  }
  menuLettore.value = state.player;
  menuLettore.addEventListener('change', async () => {
    state.player = menuLettore.value;
    await window.pico.config.patch({ player: menuLettore.value }).catch((err) => log(err.message, 'error'));
    if (menuLettore.value === 'vlc') {
      await controllaVlc();
      // VLC apre una sessione multimediale, quindi i tasti media lo
      // raggiungono: è il modo giusto, ed è quello che quasi certamente non
      // funzionava con il lettore del visore.
      if (state.playerKeys !== 'media') log('con VLC conviene tornare ai «Tasti media».');
    } else {
      $('btn-install-vlc').classList.add('hidden');
    }
    log(`i filmati si apriranno con: ${menuLettore.options[menuLettore.selectedIndex].textContent}`);
  });

  $('btn-install-vlc').addEventListener('click', async () => {
    const serials = state.slots.filter(Boolean);
    setStatus('Scegli l\'apk di VLC scaricato da videolan.org…');
    const esito = await run(window.pico.devices.installVlc(serials));
    if (!esito || esito.annullato) {
      setStatus('Installazione annullata.');
      return;
    }
    reportBatch(esito.results, 'installazione di VLC');
    await controllaVlc();
  });

  const menu = $('player-keys');
  for (const [id, profilo] of Object.entries(state.profiliLettore ?? {})) {
    const opzione = document.createElement('option');
    opzione.value = id;
    opzione.textContent = profilo.etichetta;
    menu.append(opzione);
  }
  menu.value = state.playerKeys;
  menu.addEventListener('change', async () => {
    state.playerKeys = menu.value;
    await window.pico.config.patch({ playerKeys: menu.value }).catch((err) => log(err.message, 'error'));
    log(`comando del lettore: ${menu.options[menu.selectedIndex].textContent}`);
  });

  // La prova manda il tasto e basta: se il filmato si ferma, è quello giusto.
  // Nessuno può dirlo dal computer — il lettore non risponde — ma chi guarda
  // il visore lo vede in un istante.
  $('btn-try-keys').addEventListener('click', async () => {
    const results = await run(window.pico.devices.media(targetSerials(), 'pause', menu.value));
    reportBatch(results, 'prova del tasto');
    setStatus('Tasto mandato: se il filmato si è fermato, è quello giusto. Altrimenti prova il prossimo.');
    setTimeout(pollPlayers, 500);
  });

  if (state.player === 'vlc') controllaVlc();

  // Due orologi: uno chiede al visore, l'altro fa scorrere la barra fra una
  // domanda e l'altra. Senza il secondo la barra andrebbe a scatti di due
  // secondi; senza il primo si allontanerebbe dal vero.
  setInterval(pollPlayers, 2000);
  setInterval(drawPlaybar, 250);
}

/**
 * Guarda su quali visori c'è VLC, e lo dice.
 *
 * Il pulsante per installarlo compare solo dove serve: un pulsante che c'è
 * sempre invita a premerlo anche quando non c'è niente da fare.
 */
async function controllaVlc() {
  const serials = state.slots.filter(Boolean);
  if (!serials.length) return;
  const esiti = await run(window.pico.devices.vlcStatus(serials));
  if (!Array.isArray(esiti)) return;
  const senza = esiti.filter((e) => e.ok && !e.value).map((e) => e.serial);
  $('btn-install-vlc').classList.toggle('hidden', senza.length === 0);
  if (senza.length) {
    log(
      `VLC manca su ${senza.length} visore/i (${senza.join(', ')}): scaricalo da videolan.org ` +
        '(Android, arm64) e usa «Installa VLC…»',
      'error',
    );
  } else {
    setStatus('VLC c\'è su tutti i visori.');
  }
}
