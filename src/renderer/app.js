// UI: postazioni (slot) nella schermata principale, anteprima grande a metà
// schermo con visuale libera, miniature sempre visibili nell'altra metà.

import { formattaTempo, letturaStimata, riepilogo, statoBarra, stimaPosizione } from '../shared/playback.js';
import { descriviRicerca } from '../shared/ricerca-video.js';
import { TileRenderer } from './decoder.js';
import { avviaTutorial } from './tutorial.js';
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
  eyeMode: 'full', // 'full' (due occhi affiancati) | 'left' (un occhio solo)
  videos: [], // filmati trovati sui visori, raggruppati per nome
  esitiVideo: [], // com'è andata la ricerca, visore per visore
  players: new Map(), // serial -> ultima lettura del lettore, con l'ora in cui è arrivata
  playerTimer: null,
  playerKeys: 'media', // con quali tasti si comanda il lettore del visore
  profiliLettore: {},
  // Ricominciare da capo è il default a ogni avvio dell'app, di proposito: è
  // quello che si vuole in sala, e una scelta diversa fatta ieri non deve
  // sorprendere oggi. La spunta serve per l'eccezione, non per la regola.
  fromStart: true,
  videoMode: 'auto', // come proiettare i filmati (auto = lascia riconoscere)
  videoModes: {},
  prossimaAzioneMedia: 'pause', // quando il lettore non si legge, si alterna
  thumbPer: null, // percorso del filmato di cui la barra mostra la miniatura
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

function renderEyeMode() {
  const left = state.eyeMode === 'left';
  const button = $('btn-eye');
  button.classList.toggle('is-active', left);
  // Si tocca solo l'etichetta: il testo intero cancellerebbe l'icona accanto.
  $('btn-eye-label').textContent = left ? 'Immagine intera' : 'Un occhio';
}

// ---------------------------------------------------------------------------
// Guida
// ---------------------------------------------------------------------------

function openGuide() {
  $('guide-modal').classList.remove('hidden');
  $('guide-modal').querySelector('.modal-card').scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Video sui visori
// ---------------------------------------------------------------------------

function openVideoModal() {
  $('video-modal').classList.remove('hidden');
  $('video-search').value = '';
  $('video-search').focus();
  wireVideoMode();
  renderVideoList();
  // Se non abbiamo ancora letto i file, li leggiamo ora: la ricerca su dieci
  // visori richiede qualche secondo, e farla all'avvio dell'app sarebbe tempo
  // sprecato per chi non usa i video.
  if (!state.videos.length) loadVideos();
}

function wireVideoMode() {
  const menu = $('video-mode');
  if (menu.options.length) return;
  for (const [id, modo] of Object.entries(state.videoModes)) {
    const opzione = document.createElement('option');
    opzione.value = id;
    opzione.textContent = modo.etichetta;
    menu.append(opzione);
  }
  menu.value = state.videoMode;
  menu.addEventListener('change', async () => {
    state.videoMode = menu.value;
    await window.pico.config.patch({ videoMode: menu.value }).catch((err) => log(err.message, 'error'));
  });
}

async function loadVideos() {
  const serials = state.slots.filter(Boolean);
  state.esitiVideo = [];
  mostraEsitiVideo(null);
  if (!serials.length) {
    // Visori collegati ma lasciati fuori dalle postazioni non vengono
    // interrogati: va detto, se no sembra che non abbiano filmati.
    $('video-status').textContent = state.devices.size
      ? 'Nessun visore nelle postazioni: clicca una postazione vuota e assegnagli un visore.'
      : 'Nessun visore collegato.';
    return;
  }
  $('video-refresh').disabled = true;
  $('video-status').textContent = `Cerco nei file di ${serials.length} visore/i…`;
  const risposta = await run(window.pico.devices.videos(serials));
  $('video-refresh').disabled = false;
  if (risposta === null) {
    $('video-status').textContent = 'Ricerca non riuscita: guarda il registro.';
    return;
  }
  state.videos = risposta.filmati;
  // Il nome della postazione dice di più dell'indirizzo: è quello scritto
  // sull'etichetta del visore.
  state.esitiVideo = risposta.esiti.map((e) => ({ ...e, nome: shortName(e.serial) }));
  renderVideoList();
}

/** Sotto il titolo: i visori da guardare, e cosa fare se non c'è niente. */
function mostraEsitiVideo(descrizione) {
  const lista = $('video-esiti');
  lista.replaceChildren();
  for (const riga of descrizione?.righe ?? []) {
    const li = document.createElement('li');
    li.textContent = riga;
    lista.append(li);
  }
  lista.classList.toggle('hidden', !lista.children.length);
  $('video-consiglio').textContent = descrizione?.consiglio ?? '';
  $('video-consiglio').classList.toggle('hidden', !descrizione?.consiglio);
}

function renderVideoList() {
  const cerca = $('video-search').value.trim().toLowerCase();
  const trovati = cerca
    ? state.videos.filter((v) => v.name.toLowerCase().includes(cerca))
    : state.videos;

  const lista = $('video-list');
  lista.replaceChildren();

  // Mentre la ricerca è in corso il titolo dice «Cerco…»: non va coperto.
  if ($('video-refresh').disabled) return;

  const descrizione = descriviRicerca(state.videos.length, state.esitiVideo);
  mostraEsitiVideo(descrizione);
  if (!state.videos.length) {
    $('video-status').textContent = descrizione.titolo;
    return;
  }

  $('video-status').textContent = cerca
    ? `${trovati.length} di ${state.videos.length} filmati`
    : descrizione.titolo;

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
  // riga dell'elenco serve a scegliere, la conferma a lanciare. E nella
  // conferma si scelgono i visori: tutti spuntati di default — è il caso
  // normale — e si toglie chi non deve, senza dover sapere prima che esiste
  // una selezione da qualche altra parte.
  const modo = state.videoModes[state.videoMode];
  const comeProiettato = modo?.code != null ? ` Proiettato: ${modo.etichetta}.` : '';
  // La selezione delle postazioni, se c'è, pre-spunta: due modi di dire la
  // stessa cosa non devono litigare.
  const preSelezione = state.selected.size ? state.selected : null;
  const destinatari = await chiediConferma({
    titolo: `Avviare «${video.name}»?`,
    testo:
      `Parte insieme sui visori spuntati` +
      (state.fromStart ? ', dall\'inizio.' : ', da dove era rimasto.') +
      comeProiettato,
    conferma: 'Avvia',
    scelte: video.on.map((voce) => ({
      valore: voce,
      etichetta: state.devices.get(voce.serial)?.displayName ?? voce.serial,
      spuntato: preSelezione ? preSelezione.has(voce.serial) : true,
    })),
  });
  if (!destinatari || !destinatari.length) return;
  const results = await run(
    window.pico.devices.playVideo(destinatari, { fromStart: state.fromStart, videoType: modo?.code ?? null }),
  );
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
          <img class="slot-visore" src="visore.png" alt="" />
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

  $('preview-hint').textContent =
    'Trascina per guardarti intorno · rotellina per zoomare · niente arriva al visore';

  const home = state.viewport.isHome;
  $('btn-recenter').classList.toggle('is-active', !home);
  const badge = $('view-badge');
  badge.classList.toggle('hidden', home);
  badge.textContent = `Visuale spostata · ${state.viewport.zoomLabel}`;
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
    onPan: panPreview,
    onZoom: (factor, nx, ny) => {
      state.viewport.zoomBy(factor, nx, ny);
      drawPreview();
      updatePreviewChrome();
    },
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

  window.pico.on('config', (data) => {
    // Il processo principale può cambiare da solo il canale dei comandi (lo
    // fa quando scopre che ad aprire il filmato è il lettore PICO): lo stato
    // locale deve seguirlo, o il prossimo clic partirebbe col canale vecchio.
    if (data.playerKeys) state.playerKeys = data.playerKeys;
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

  // Schermo intero e ricarica esistono solo sull'iPad: sul Mac c'è la
  // finestra, e l'interfaccia nuova arriva col riavvio dell'app.
  $('btn-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => setStatus('Questo browser non permette lo schermo intero.'));
  });
  $('btn-reload').addEventListener('click', () => location.reload());

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
  // L'esito va detto in faccia, non nel registro: chi ha appena attaccato un
  // cavo sta guardando lo schermo, e la cosa che vuole sapere — «posso
  // staccarlo? e al prossimo riavvio?» — merita più di una riga in fondo.
  if (!res.length) {
    await mostraAvviso({
      titolo: 'Nessun visore via cavo',
      testo: 'Non vedo visori collegati via USB. Attacca il cavo, accetta «Consenti debug USB» dentro il visore, e riprova.',
    });
    return;
  }
  const righe = res.map((r) => {
    if (!r.ok) return `✗ ${r.usb}: ${r.error}`;
    return r.persistente
      ? `✓ ${r.wifi} — wifi fissato: raggiungibile anche dopo un riavvio, senza cavo`
      : `✓ ${r.wifi} — wifi attivo fino al prossimo riavvio del visore: dopo, servirà di nuovo il cavo`;
  });
  await mostraAvviso({
    titolo: ok.length === res.length ? 'Visori passati al wifi' : 'Adozione completata a metà',
    testo: `${righe.join('\n')}\n\nPuoi staccare il cavo dei visori passati al wifi.`,
  });
}

/** Un avviso da leggere e chiudere: il modale di conferma, senza domanda. */
function mostraAvviso({ titolo, testo }) {
  return chiediConferma({ titolo, testo, conferma: 'Ok', soloOk: true });
}

function wireUi() {
  $('btn-scan').addEventListener('click', doScan);
  $('btn-usb').addEventListener('click', doAdoptUsb);
  $('btn-sync').addEventListener('click', () => run(window.pico.devices.sync(), 'Elenco aggiornato.'));
  $('btn-eye').addEventListener('click', toggleEyeMode);

  // Il giro guidato: i passi stanno qui, accanto ai pulsanti che raccontano,
  // così quando un pulsante cambia si vede subito che va cambiato anche il
  // suo racconto.
  $('btn-tutorial').addEventListener('click', () =>
    avviaTutorial([
      {
        selettore: '#btn-scan',
        titolo: 'Cerca in rete',
        testo:
          'Cerca i visori sulla rete wifi a cui è collegato il computer e aggiunge quelli che rispondono. ' +
          'Serve la stessa rete, non serve internet.',
      },
      {
        selettore: '#btn-usb',
        titolo: 'Adotta USB',
        testo:
          'La prima volta un visore va collegato col cavo: questo pulsante lo autorizza a lavorare via wifi. ' +
          'L\'esito compare in un avviso: dice se puoi staccare il cavo e se servirà di nuovo al prossimo riavvio.',
      },
      {
        selettore: '#btn-sync',
        titolo: 'Aggiorna',
        testo: 'Rilegge l\'elenco dei visori: quelli nuovi compaiono, quelli salvati vengono ricollegati.',
      },
      {
        selettore: '.selection',
        titolo: 'Su chi agiscono i comandi',
        testo:
          'Nessuna selezione = i comandi valgono per tutti i visori. Spuntando le caselle sulle postazioni, ' +
          'valgono solo per quelle. «Tutti» e «Nessuno» fanno in fretta.',
      },
      {
        selettore: '#btn-video',
        titolo: 'Video…',
        testo:
          'Il mestiere principale: cerca i filmati nei file dei visori e li manda in riproduzione, ' +
          'dall\'inizio, tutti nello stesso momento. Nella conferma scegli su quali visori partire ' +
          'e la modalità di proiezione (per i 360 immersivi: «3D 360° sopra-sotto»).',
      },
      {
        selettore: '#playbar',
        titolo: 'La barra del filmato',
        testo:
          'Il filmato in corso: miniatura, tempo e conto alla rovescia, pausa e ripresa per tutti, ' +
          '«Da capo», «Stop». La spunta «dall\'inizio» governa se un filmato riparte da zero.',
      },
      {
        selettore: '#slots',
        titolo: 'Le postazioni',
        testo:
          'Ogni visore ha la sua scheda: batteria, anteprima, e — con un filmato in corso — tempo e ' +
          'comandi per quel visore soltanto. Clic sulla miniatura per l\'anteprima grande.',
      },
      {
        selettore: '#btn-remote',
        titolo: 'Telecomando',
        testo:
          'La stessa interfaccia su iPad, via wifi: accendi, inquadra il QR con la fotocamera ' +
          'dell\'iPad, e comandi la sala camminando fra le postazioni.',
      },
      {
        selettore: '#btn-guide',
        titolo: 'Guida',
        testo:
          'Come installare il programma su un Mac nuovo, preparare i visori e usare tutto su una wifi ' +
          'senza internet. È scritta dentro l\'app: si legge anche quando internet non c\'è.',
      },
      {
        selettore: '#btn-log',
        titolo: 'Il registro',
        testo:
          'Cosa è successo, visore per visore: è la prima cosa da guardare quando qualcosa non va, ' +
          'e la prima cosa da copiare quando chiedi aiuto.',
      },
    ]),
  );

  $('btn-video').addEventListener('click', openVideoModal);
  $('video-close').addEventListener('click', () => $('video-modal').classList.add('hidden'));
  $('video-refresh').addEventListener('click', loadVideos);
  $('video-search').addEventListener('input', renderVideoList);

  $('btn-guide').addEventListener('click', openGuide);
  $('guide-close').addEventListener('click', () => $('guide-modal').classList.add('hidden'));
  // L'indice scorre dentro la guida invece di cambiare l'indirizzo della pagina.
  $('guide-modal').querySelector('.guide-toc').addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href^="#"]');
    if (!link) return;
    ev.preventDefault();
    document.querySelector(link.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

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

  const openModal = ['add-modal', 'device-modal', 'remote-modal', 'video-modal', 'guide-modal'].find(
    (id) => !$(id).classList.contains('hidden'),
  );
  if (ev.key === 'Escape') {
    if (openModal === 'add-modal') closeAddModal();
    else if (openModal) $(openModal).classList.add('hidden');
    else if (state.previewSerial) closePreview();
    return;
  }
  if (openModal || !state.previewSerial) return;

  // Le frecce spostano l'inquadratura, "0" torna sul visitatore.
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
  for (const [i, url] of status.urls.entries()) {
    const completo = `${url}/?k=${status.pin}`;
    const li = document.createElement('li');
    li.innerHTML = '<span class="pkg"></span><span class="muted">clicca per il QR</span>';
    li.querySelector('.pkg').textContent = completo;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => mostraQr(completo));
    list.append(li);
    // Il primo indirizzo è la rete locale, quella dell'iPad in sala: il suo
    // QR compare da solo, gli altri con un clic.
    if (i === 0) mostraQr(completo);
  }
}

/** Il QR dell'indirizzo col PIN dentro: la fotocamera dell'iPad lo apre già sbloccato. */
async function mostraQr(url) {
  const img = $('remote-qr');
  const dataUrl = await window.pico.remoteQr?.(url).catch(() => null);
  if (dataUrl) {
    img.src = dataUrl;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
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
  state.videoMode = info.config.videoMode ?? 'auto';
  state.videoModes = info.videoModes ?? {};
  state.eyeMode = info.config.eyeMode === 'left' ? 'left' : 'full';

  renderEyeMode();
  renderBrand(info.brand);
  renderRemoteStatus(info.remote);
  log(`adb: ${info.adbPath} · scrcpy-server v${info.scrcpyVersion} · reti: ${info.subnets.join(', ') || 'n/d'}`);
  for (const problem of info.problems) log(problem, 'error');

  if (!('VideoDecoder' in window)) {
    log('WebCodecs non disponibile: usa la modalità screencap dalle impostazioni del visore.', 'error');
  }

  renderDevices(await window.pico.devices.list());
  wirePlaybar();
  wirePreviewPlayer();
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
  // La parola del lettore quando c'è; l'orologio di bordo quando il lettore
  // tace ma il filmato gliel'abbiamo mandato noi, con la sua durata.
  return state.slots
    .filter(Boolean)
    .map((s) => state.players.get(s) ?? letturaStimata(state.devices.get(s)?.playing))
    .filter(Boolean);
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
  const b = statoBarra(sintesi, filmatiMandati(), {
    prossimaAzione: state.prossimaAzioneMedia,
    scelti: state.selected.size,
  });

  $('playbar-name').textContent = b.nome;
  $('playbar-time').textContent = b.tempo;
  aggiornaMiniatura();
  $('playbar-note').textContent = b.nota;
  $('playbar-fill').style.width = `${b.quota}%`;
  $('btn-play-pause').textContent = b.etichettaPausa;
  $('btn-play-pause').disabled = !b.pausaAttiva;
  $('btn-replay').disabled = !b.pausaAttiva;
  $('btn-stop-video').disabled = !b.pausaAttiva;
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
  aggiornaPreviewPlayer();
}

/**
 * La riga del filmato sotto la miniatura del visore: posizione, e i comandi
 * per **questo** visore soltanto.
 *
 * I comandi della barra agiscono su tutti (o sui selezionati); questi sul
 * singolo, senza dover selezionare niente. È la differenza fra «fermate la
 * sala» e «ferma la postazione 3» — e la seconda serve mentre si cammina fra
 * le postazioni, quando aprire menù è l'ultima cosa che si vuole fare.
 */
function aggiornaRigaLettore(serial) {
  const card = state.cards.get(serial);
  if (!card) return;
  let riga = card.el.querySelector('.card-player');
  const lettura = state.players.get(serial) ?? letturaStimata(state.devices.get(serial)?.playing);
  if (!lettura) {
    riga?.remove();
    return;
  }
  if (!riga) {
    riga = document.createElement('div');
    riga.className = 'card-player';
    const tempo = document.createElement('span');
    tempo.className = 'card-player-time';
    // I bottoni si costruiscono una volta sola: rifarli a ogni giro della
    // barra vorrebbe dire ricrearli sotto il mouse mentre uno li clicca.
    const bottone = (testo, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card-player-btn';
      b.textContent = testo;
      b.title = title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    riga.append(
      tempo,
      bottone('⏯', 'Ferma o riprende solo questo visore', async () => {
        const ora = state.players.get(serial) ?? letturaStimata(state.devices.get(serial)?.playing);
        const azione = ora?.state === 'in pausa' ? 'play' : 'pause';
        await run(window.pico.devices.media([serial], azione, state.playerKeys));
        setTimeout(pollPlayers, 400);
      }),
      bottone('↺', 'Rimanda dall\'inizio solo questo visore', async () => {
        await run(window.pico.devices.replay([serial]));
        setTimeout(pollPlayers, 1500);
      }),
      bottone('⏹', 'Chiude il filmato solo su questo visore', async () => {
        await run(window.pico.devices.stopVideo([serial]));
        setTimeout(pollPlayers, 800);
      }),
    );
    card.el.append(riga);
  }
  const posizione = formattaTempo(stimaPosizione(lettura));
  riga.querySelector('.card-player-time').textContent = lettura.durationMs
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
    // Quando il lettore non si legge, si alterna ricordando l'ultimo ordine.
    const azione = sintesi ? (sintesi.inRiproduzione ? 'pause' : 'play') : state.prossimaAzioneMedia;
    state.prossimaAzioneMedia = azione === 'pause' ? 'play' : 'pause';
    const results = await run(window.pico.devices.media(targetSerials(), azione, state.playerKeys));
    reportBatch(results, azione === 'pause' ? 'pausa' : 'ripresa');
    setTimeout(pollPlayers, 400);
  });

  $('btn-replay').addEventListener('click', async () => {
    const results = await run(window.pico.devices.replay(targetSerials()));
    reportBatch(results, 'da capo');
    setTimeout(pollPlayers, 1500);
  });

  $('btn-stop-video').addEventListener('click', async () => {
    const results = await run(window.pico.devices.stopVideo(targetSerials()));
    reportBatch(results, 'stop');
    setTimeout(pollPlayers, 800);
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

  // La spunta «dall'inizio» è stato di sessione, non configurazione: a ogni
  // avvio torna accesa. (Il collegamento era sparito in una pulizia: la
  // casella mostrava il segno ma non parlava più con nessuno — e il config
  // conservava un vecchio «no» che nessuno vedeva.)
  const daCapo = $('from-start');
  daCapo.checked = state.fromStart;
  daCapo.addEventListener('change', () => {
    state.fromStart = daCapo.checked;
    log(
      daCapo.checked
        ? 'i filmati ripartiranno dall\'inizio'
        : 'i filmati ripartiranno da dove erano rimasti (fino al prossimo avvio dell\'app)',
    );
  });

  // Niente menù dei tasti: il canale giusto per comandare il lettore lo
  // scopre l'app da sola (quando ad aprire il filmato è il lettore PICO, i
  // comandi passano al suo canale diretto). Un menù di tentativi era un esame
  // a chi guarda, e la risposta la conosceva solo il codice.

  // Due orologi: uno chiede al visore, l'altro fa scorrere la barra fra una
  // domanda e l'altra. Senza il secondo la barra andrebbe a scatti di due
  // secondi; senza il primo si allontanerebbe dal vero.
  setInterval(pollPlayers, 2000);
  setInterval(drawPlaybar, 250);
}

/**
 * Chiede conferma con un modale dell'app.
 *
 * Non `window.confirm`: dentro Electron quel dialogo può non comparire, e un
 * dialogo che non compare vale come un «no» che nessuno ha detto — il comando
 * non parte e non lascia traccia, che è il modo peggiore in cui una cosa possa
 * non funzionare.
 */
function chiediConferma({ titolo, testo, conferma = 'Avvia', scelte = null, soloOk = false }) {
  const modale = $('confirm-modal');
  $('confirm-title').textContent = titolo;
  $('confirm-text').textContent = testo;
  $('confirm-yes').textContent = conferma;
  $('confirm-no').classList.toggle('hidden', soloOk);

  // L'elenco delle scelte: caselle tutte gestibili col pollice, e la risposta
  // sono i valori spuntati (o true/false quando l'elenco non c'è).
  const lista = $('confirm-list');
  lista.replaceChildren();
  lista.classList.toggle('hidden', !scelte);
  const caselle = [];
  for (const scelta of scelte ?? []) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = scelta.spuntato !== false;
    caselle.push({ box, valore: scelta.valore });
    label.append(box, document.createTextNode(scelta.etichetta));
    li.append(label);
    lista.append(li);
  }

  modale.classList.remove('hidden');
  $('confirm-yes').focus();

  return new Promise((resolve) => {
    const chiudi = (risposta) => {
      modale.classList.add('hidden');
      $('confirm-yes').removeEventListener('click', si);
      $('confirm-no').removeEventListener('click', no);
      document.removeEventListener('keydown', tasto);
      resolve(risposta);
    };
    const esito = () => (scelte ? caselle.filter((c) => c.box.checked).map((c) => c.valore) : true);
    const si = () => chiudi(esito());
    const no = () => chiudi(scelte ? null : false);
    const tasto = (e) => {
      if (e.key === 'Escape') chiudi(scelte ? null : false);
      if (e.key === 'Enter') chiudi(esito());
    };
    $('confirm-yes').addEventListener('click', si);
    $('confirm-no').addEventListener('click', no);
    document.addEventListener('keydown', tasto);
  });
}

/**
 * La miniatura del filmato in corso, chiesta al visore una volta per filmato.
 *
 * È il fotogramma che il visore usa nelle sue gallerie: si chiede al primo
 * visore che ha il filmato, e si tiene finché il filmato non cambia.
 */
async function aggiornaMiniatura() {
  const img = $('playbar-thumb');
  const conFilmato = state.slots.filter(Boolean).find((s) => state.devices.get(s)?.playing?.path);
  const path = conFilmato ? state.devices.get(conFilmato).playing.path : null;
  if (!path) {
    img.classList.add('hidden');
    state.thumbPer = null;
    return;
  }
  if (state.thumbPer === path) return;
  state.thumbPer = path;
  const dataUrl = await window.pico.devices.videoThumb(conFilmato).catch(() => null);
  // Nel frattempo il filmato può essere cambiato: una miniatura vecchia su un
  // filmato nuovo è peggio di nessuna miniatura.
  if (state.thumbPer !== path) return;
  if (dataUrl) {
    img.src = dataUrl;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }
}

/**
 * I comandi del filmato per il visore in anteprima.
 *
 * Stessa logica dei bottoncini sulla scheda — agiscono su questo visore
 * soltanto — ma a portata di mano mentre si guarda cosa vede il visitatore:
 * è lì che ci si accorge che a QUESTA persona il filmato va fermato.
 */
function aggiornaPreviewPlayer() {
  const riga = $('preview-player');
  const serial = state.previewSerial;
  const lettura = serial
    ? state.players.get(serial) ?? letturaStimata(state.devices.get(serial)?.playing)
    : null;
  if (!serial || !lettura) {
    riga.classList.add('hidden');
    return;
  }
  riga.classList.remove('hidden');
  const posizione = formattaTempo(stimaPosizione(lettura));
  $('preview-player-time').textContent = lettura.durationMs
    ? `${posizione} / ${formattaTempo(lettura.durationMs)} · ${lettura.state}`
    : `${posizione} · ${lettura.state}`;
  $('preview-play-pause').textContent = lettura.state === 'in pausa' ? 'Riprendi' : 'Pausa';
}

function wirePreviewPlayer() {
  $('preview-play-pause').addEventListener('click', async () => {
    const serial = state.previewSerial;
    if (!serial) return;
    const ora = state.players.get(serial) ?? letturaStimata(state.devices.get(serial)?.playing);
    await run(window.pico.devices.media([serial], ora?.state === 'in pausa' ? 'play' : 'pause', state.playerKeys));
    setTimeout(pollPlayers, 400);
  });
  $('preview-replay').addEventListener('click', async () => {
    if (!state.previewSerial) return;
    await run(window.pico.devices.replay([state.previewSerial]));
    setTimeout(pollPlayers, 1500);
  });
  $('preview-stop').addEventListener('click', async () => {
    if (!state.previewSerial) return;
    await run(window.pico.devices.stopVideo([state.previewSerial]));
    setTimeout(pollPlayers, 800);
  });
}
