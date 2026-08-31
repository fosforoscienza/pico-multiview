// Un visore: stato, mirroring (scrcpy oppure screencap), puntatore, comandi app.

import { EventEmitter } from 'node:events';

import * as apps from './apps.js';
import { adbTry, delay, shellBinary } from './adb.js';
import { ScrcpySession, dimenticaJar } from './scrcpy-session.js';
import {
  ACTION,
  BUTTON,
  KEYCODE,
  POINTER_ID_MOUSE,
  encodeBackOrScreenOn,
  encodeKeyPress,
  encodeScroll,
  encodeTouch,
  framePointToScreen,
  leftEyeCrop,
  visiblePoint,
} from '../shared/protocol.js';

// La periferica finta da cui dichiariamo di far arrivare i tocchi sui PICO.
const TRACKBALL = 'trackball';

/**
 * Traduce i messaggi di scrcpy che l'operatore può incontrare davvero, perché
 * arrivano nel pannello Log in mezzo al resto e in inglese non dicono niente a
 * chi sta gestendo una sala.
 */
export function spiegaLogScrcpy(message) {
  const testo = String(message ?? '');
  if (testo === 'Aborted' || testo.startsWith('Aborted ')) {
    return (
      'il server sul visore è morto sul nascere (Aborted): di solito significa che un server ' +
      'precedente teneva ancora occupato lo schermo. Alla prossima partenza viene chiuso prima.'
    );
  }
  if (testo.includes('it was generated for a different device size')) {
    return (
      'il visore ha rifiutato il tocco: la misura dell\'immagine non combacia con quella ' +
      'del suo schermo. Succede se la risoluzione è appena cambiata — premi ⟳ sulla ' +
      `miniatura per riavviare lo streaming. (${testo})`
    );
  }
  return testo;
}

export const STATE = {
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  STREAMING: 'streaming',
  ERROR: 'error',
};

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

export class Device extends EventEmitter {
  constructor(serial, { label = null, config = {} } = {}) {
    super();
    this.serial = serial;
    this.label = label;
    this.state = STATE.OFFLINE;
    this.error = null;
    this.info = {};
    this.status = { battery: null, foreground: null, updatedAt: 0 };
    // Il filmato che gli abbiamo mandato noi: il visore non sa dire quale file
    // stia guardando, ma noi sì, ed è l'unico modo di conoscerne la durata.
    this.playing = null;
    // Il lettore visto in azione l'ultima volta: è il dato che permette di
    // chiuderlo prima del prossimo avvio, e quindi di ripartire dall'inizio.
    this.playerPackage = null;
    this.homePackage = null;
    this.videoSize = null;
    this.session = null;
    this.mirror = config.mirror ?? 'scrcpy';
    this.crop = config.crop ?? null;
    this.displayId = config.displayId ?? 0;
    this.quality = config.quality ?? { maxSize: 800, bitRate: 2_000_000, maxFps: 20 };
    this.autoReconnect = config.autoReconnect ?? true;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.screencapTimer = null;
    this.screencapIntervalMs = config.screencapIntervalMs ?? 700;
    this.pointerDown = false;
    // Come far arrivare il tocco: 'scrcpy' (canale di controllo) oppure
    // 'trackball' (comando `input`, dichiarando un'altra periferica). Serve
    // perché i visori PICO non hanno un touchscreen e scartano gli eventi che
    // dicono di venirne.
    this.pointerMode = config.pointerMode ?? 'scrcpy';
    this.screen = null; // dimensione vera dello schermo, letta alla bisogna
    this.connecting = false; // una connessione alla volta: due si pestano i piedi
    this.disposed = false;
  }

  /** Dimensione dello schermo del visore, chiesta una volta e tenuta da parte. */
  async screenSize() {
    if (this.screen) return this.screen;
    this.screen = await apps.displaySize(this.serial, this.displayId);
    return this.screen;
  }

  get displayName() {
    return this.label || this.info.name || this.info.model || this.serial;
  }

  toJSON() {
    return {
      serial: this.serial,
      label: this.label,
      displayName: this.displayName,
      state: this.state,
      error: this.error,
      info: this.info,
      status: this.status,
      videoSize: this.videoSize,
      mirror: this.mirror,
      crop: this.crop,
      displayId: this.displayId,
      quality: this.quality,
      pointerMode: this.pointerMode,
      playing: this.playing,
    };
  }

  #setState(state, error = null) {
    this.state = state;
    this.error = error ? String(error.message ?? error) : null;
    this.emit('state', this.toJSON());
  }

  log(level, message) {
    this.emit('log', { serial: this.serial, level, message });
  }

  // -------------------------------------------------------------------------
  // Ciclo di vita
  // -------------------------------------------------------------------------

  async connect() {
    if (this.disposed) return;
    // Due connessioni sovrapposte — il pulsante ⟳ mentre gira la riconnessione
    // automatica, un cambio di qualità nel mezzo — si fermano la sessione a
    // vicenda e avviano due server sullo stesso visore. Nel registro si vedeva
    // come due conteggi di tentativi che correvano insieme.
    if (this.connecting) return;
    this.connecting = true;
    this.#clearReconnect();
    this.#setState(STATE.CONNECTING);
    try {
      this.info = await apps.deviceInfo(this.serial);
      if (this.mirror === 'screencap') await this.#startScreencap();
      else await this.#startScrcpy();
      this.reconnectAttempt = 0;
      this.#setState(STATE.STREAMING);
      this.refreshStatus();
    } catch (err) {
      this.#setState(STATE.ERROR, err);
      this.log('error', err.message);
      this.#scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  async #startScrcpy() {
    await this.#stopMirror();
    const session = new ScrcpySession(this.serial, {
      maxSize: this.quality.maxSize,
      bitRate: this.quality.bitRate,
      maxFps: this.quality.maxFps,
      displayId: this.displayId,
      crop: this.crop,
    });
    this.session = session;

    session.on('codec', (meta) => {
      this.videoSize = { width: meta.width, height: meta.height };
      this.emit('codec', { serial: this.serial, ...meta });
      this.emit('state', this.toJSON());
    });
    session.on('frame', (frame) => {
      this.emit('frame', {
        serial: this.serial,
        kind: 'h264',
        data: frame.data,
        pts: frame.pts,
        config: frame.config,
        keyFrame: frame.keyFrame,
      });
    });
    session.on('log', ({ level, message }) => this.log(level, spiegaLogScrcpy(message)));
    session.on('error', (err) => {
      // Una morte violenta (SIGABRT, kill) può voler dire che il file del
      // server sul visore non è più integro: alla prossima partenza lo
      // ricopiamo, tanto il processo che lo usava non c'è più.
      if (/terminato \(codice/.test(err.message)) dimenticaJar(this.serial);
      this.#setState(STATE.ERROR, err);
      this.log('error', err.message);
    });
    session.on('closed', () => {
      if (this.session === session) this.session = null;
      if (!this.disposed && this.state !== STATE.CONNECTING) this.#scheduleReconnect();
    });

    await session.start();
  }

  async #startScreencap() {
    await this.#stopMirror();
    const tick = async () => {
      if (this.disposed || this.mirror !== 'screencap') return;
      try {
        const png = await shellBinary(this.serial, 'screencap -p', { timeout: 10000 });
        if (png?.length > 24 && png.readUInt32BE(0) === 0x89504e47) {
          this.videoSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
          this.emit('frame', { serial: this.serial, kind: 'png', data: png });
          if (this.state !== STATE.STREAMING) this.#setState(STATE.STREAMING);
        }
      } catch (err) {
        this.log('error', `screencap: ${err.message}`);
        this.#setState(STATE.ERROR, err);
      }
      if (!this.disposed && this.mirror === 'screencap') {
        this.screencapTimer = setTimeout(tick, this.screencapIntervalMs);
      }
    };
    tick();
  }

  async #stopMirror() {
    if (this.screencapTimer) {
      clearTimeout(this.screencapTimer);
      this.screencapTimer = null;
    }
    if (this.session) {
      const s = this.session;
      this.session = null;
      await s.stop('riavvio mirroring');
    }
  }

  #scheduleReconnect() {
    if (!this.autoReconnect || this.disposed || this.reconnectTimer) return;
    const wait = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;
    this.log('info', `riconnessione tra ${Math.round(wait / 1000)}s (tentativo ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  #clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async setMirrorMode(mode) {
    if (mode === this.mirror) return;
    this.mirror = mode;
    await this.connect();
  }

  async setQuality(quality) {
    const same =
      quality.maxSize === this.quality.maxSize &&
      quality.bitRate === this.quality.bitRate &&
      quality.maxFps === this.quality.maxFps;
    this.quality = quality;
    if (same || this.mirror !== 'scrcpy' || this.state !== STATE.STREAMING) return;
    await this.connect();
  }

  async setCrop(crop) {
    this.crop = crop || null;
    if (this.mirror === 'scrcpy') await this.connect();
  }

  /**
   * "Un occhio solo" o immagine intera.
   *
   * Un visore disegna due immagini affiancate, una per occhio, e a guardarle
   * insieme non si capisce niente. Il ritaglio si fa **sul visore**, non qui:
   * così l'occhio singolo si vede anche nelle miniature, e sulla wifi viaggia
   * metà dei dati — con dieci visori è la differenza fra scorrevole e a scatti.
   *
   * I clic continuano a funzionare: scrcpy riporta da sé le coordinate del
   * video dentro la porzione ritagliata dello schermo.
   *
   * @returns il ritaglio applicato, o null se si è tornati all'immagine intera
   */
  async setEyeMode(mode) {
    if (mode !== 'left') {
      await this.setCrop(null);
      return null;
    }
    const size = await apps.displaySize(this.serial, this.displayId);
    const crop = leftEyeCrop(size);
    if (!crop) throw new Error('non riesco a leggere la dimensione dello schermo del visore');
    await this.setCrop(crop);
    return crop;
  }

  /**
   * Prova a toccare lo stesso punto per tutte le strade possibili, una alla
   * volta, annunciando ognuna **prima** di mandarla.
   *
   * Serve perché un visore non ha un touchscreen e ogni modello scarta o
   * accetta cose diverse: invece di indovinare la periferica giusta, si guarda
   * il visore mentre l'app le prova tutte e si vede a quale reagisce.
   *
   * Prova anche gli altri schermi: su un visore ce n'è più d'uno — quello
   * stereo che si vede e quelli virtuali su cui girano i pannelli 2D — e un
   * tocco mandato allo schermo sbagliato non raggiunge nessuna finestra.
   */
  async diagnosePointer(nx, ny) {
    const screen = await this.screenSize();
    const punto = framePointToScreen(nx, ny, screen, this.crop);
    if (!punto) throw new Error('non riesco a leggere la dimensione dello schermo del visore');

    const displays = await apps.listDisplays(this.serial).catch(() => []);
    this.log(
      'info',
      `— diagnostica tocco — schermo ${screen.width}×${screen.height}, ritaglio ${this.crop ?? 'nessuno'}, ` +
        `punto ${punto.x},${punto.y}, schermi visti: ${displays.join(', ') || 'nessuno'}`,
    );

    // Le prove sullo schermo catturato usano il punto già calcolato. Quelle su
    // un ALTRO schermo no: lì le coordinate dello schermo stereo non hanno
    // senso, e riusarle vorrebbe dire cadere fuori dal pannello senza che
    // nessuno se ne accorga — la prova sembrerebbe fallita per la periferica.
    const prove = [
      { source: '', displayId: null, punto },
      { source: TRACKBALL, displayId: null, punto },
      { source: 'touchpad', displayId: null, punto },
      { source: 'touchnavigation', displayId: null, punto },
      { source: 'mouse', displayId: null, punto },
    ];

    const visibile = visiblePoint(nx, ny, screen, this.crop);
    for (const id of displays.filter((d) => d !== this.displayId)) {
      const misura = await apps.displaySize(this.serial, id);
      if (!misura) {
        this.log('info', `schermo ${id}: non riesco a leggerne la misura, lo salto`);
        continue;
      }
      this.log('info', `schermo ${id}: ${misura.width}×${misura.height}`);
      prove.push({
        source: '',
        displayId: id,
        punto: framePointToScreen(visibile.nx, visibile.ny, misura),
      });
    }

    this.log('info', 'guarda il visore: ti dirò cosa sto per mandare, una prova ogni due secondi');

    const esiti = [];
    for (const [i, prova] of prove.entries()) {
      const comando = apps.tapCommand(prova.punto.x, prova.punto.y, prova.source, prova.displayId);
      this.log('info', `prova ${i + 1}/${prove.length}: ${comando}`);
      try {
        await apps.inputTap(this.serial, prova.punto.x, prova.punto.y, prova.source, prova.displayId);
        esiti.push({ comando, ok: true });
      } catch (err) {
        // Un comando rifiutato è un'informazione, non un guasto: si prosegue.
        this.log('error', `prova ${i + 1}: ${err.message}`);
        esiti.push({ comando, ok: false, error: err.message });
      }
      await delay(2000);
    }

    const passate = esiti.filter((e) => e.ok).length;
    this.log(
      'info',
      `— fine diagnostica — ${passate}/${esiti.length} comandi accettati dal visore. ` +
        'Se il visore ha reagito a una di queste, dimmi il numero della prova.',
    );
    return { screen, crop: this.crop, punto, displays, esiti };
  }

  /** Come far arrivare il tocco: 'scrcpy' oppure 'trackball' (visori PICO). */
  setPointerMode(mode) {
    this.pointerMode = mode === 'trackball' ? 'trackball' : 'scrcpy';
    this.pointerDown = false;
    this.emit('state', this.toJSON());
    return this.pointerMode;
  }

  async setDisplayId(displayId) {
    this.displayId = displayId;
    // Cambiando display cambia anche la dimensione dello schermo: la misura
    // tenuta da parte non vale più.
    this.screen = null;
    if (this.mirror === 'scrcpy') await this.connect();
  }

  async dispose() {
    this.disposed = true;
    // Togliendo un visore dall'elenco dimentichiamo anche di avergli copiato il
    // server: se torna, meglio ricopiarlo che dare per buona una copia vecchia.
    dimenticaJar(this.serial);
    this.#clearReconnect();
    await this.#stopMirror();
    this.#setState(STATE.OFFLINE);
  }

  // -------------------------------------------------------------------------
  // Puntatore
  // -------------------------------------------------------------------------

  #frameSize() {
    return this.videoSize ?? { width: 1920, height: 1080 };
  }

  /**
   * Tocco per i visori PICO, che non hanno un touchscreen e scartano gli eventi
   * che dicono di venirne. Lo stesso gesto, dichiarato come **trackball**,
   * viene invece accettato.
   *
   * Qui le coordinate vanno in pixel dello schermo, non del video: il comando
   * `input` non sa niente né del rimpicciolimento né del ritaglio, quindi la
   * conversione la facciamo noi.
   */
  async #pointerViaInput(nx, ny, type) {
    const screen = await this.screenSize();
    const punto = framePointToScreen(nx, ny, screen, this.crop);
    if (!punto) {
      this.log('error', 'non riesco a leggere la dimensione dello schermo: tocco non inviato');
      return;
    }

    if (type === 'down') {
      this.pointerDown = true;
      this._dragStart = { ...punto, at: Date.now() };
      return;
    }
    if (type !== 'up' || !this.pointerDown) return;
    this.pointerDown = false;

    const start = this._dragStart ?? { ...punto, at: Date.now() };
    const dist = Math.hypot(punto.x - start.x, punto.y - start.y);
    // Sotto una decina di pixel è un clic, non un trascinamento: distinguerli
    // evita che un tremolio del mouse diventi uno swipe involontario.
    if (dist < 12) {
      await apps.inputTap(this.serial, punto.x, punto.y, TRACKBALL);
      // Il comando esatto va nel log: se il visore non reagisce, è la prima
      // cosa da riprovare a mano con adb per capire dove si perde.
      this.log('info', `input ${TRACKBALL} tap ${punto.x} ${punto.y}`);
      return;
    }
    await apps.inputSwipe(
      this.serial,
      start.x,
      start.y,
      punto.x,
      punto.y,
      Math.max(80, Date.now() - start.at),
      TRACKBALL,
    );
    this.log('info', `input ${TRACKBALL} swipe ${start.x} ${start.y} ${punto.x} ${punto.y}`);
  }

  /**
   * Evento di puntatore con coordinate normalizzate 0..1 rispetto all'immagine.
   * type: 'down' | 'move' | 'up' | 'cancel'
   */
  async pointer({ type, nx, ny, button = BUTTON.PRIMARY }) {
    const { width, height } = this.#frameSize();
    const x = Math.max(0, Math.min(1, nx)) * width;
    const y = Math.max(0, Math.min(1, ny)) * height;

    if (this.pointerMode === 'trackball') return this.#pointerViaInput(nx, ny, type);

    if (this.session && this.mirror === 'scrcpy') {
      const action =
        type === 'down' ? ACTION.DOWN : type === 'up' ? ACTION.UP : type === 'cancel' ? ACTION.CANCEL : ACTION.MOVE;
      if (action === ACTION.MOVE && !this.pointerDown) return; // niente hover: non serve
      const msg = encodeTouch({
        action,
        pointerId: POINTER_ID_MOUSE,
        x,
        y,
        width,
        height,
        pressure: action === ACTION.UP || action === ACTION.CANCEL ? 0 : 1,
        actionButton: button,
        buttons: action === ACTION.UP || action === ACTION.CANCEL ? 0 : button,
      });
      const inviato = this.session.sendControl(msg);
      // Solo l'inizio e la fine del gesto: i movimenti intermedi sono decine al
      // secondo e sommergerebbero il registro proprio quando serve leggerlo.
      if (action === ACTION.DOWN || action === ACTION.UP) {
        const verso = action === ACTION.DOWN ? 'premuto' : 'rilasciato';
        this.log(
          inviato === false ? 'error' : 'info',
          inviato === false
            ? `${verso} in ${Math.round(x)},${Math.round(y)} ma il canale di controllo non lo ha accettato`
            : `${verso} in ${Math.round(x)},${Math.round(y)} su ${width}×${height} (via scrcpy)`,
        );
      }
      if (action === ACTION.DOWN) this.pointerDown = true;
      if (action === ACTION.UP || action === ACTION.CANCEL) this.pointerDown = false;
      return;
    }

    // Modalità screencap: emuliamo tap e swipe con "input".
    if (type === 'down') {
      this.pointerDown = true;
      this._dragStart = { x, y, at: Date.now() };
      return;
    }
    if (type === 'up' && this.pointerDown) {
      this.pointerDown = false;
      const start = this._dragStart ?? { x, y, at: Date.now() };
      const dist = Math.hypot(x - start.x, y - start.y);
      if (dist < 12) await apps.inputTap(this.serial, x, y);
      else await apps.inputSwipe(this.serial, start.x, start.y, x, y, Math.max(80, Date.now() - start.at));
    }
  }

  async scroll({ nx, ny, hscroll = 0, vscroll = 0 }) {
    const { width, height } = this.#frameSize();
    const x = Math.max(0, Math.min(1, nx)) * width;
    const y = Math.max(0, Math.min(1, ny)) * height;
    if (this.pointerMode !== 'trackball' && this.session && this.mirror === 'scrcpy') {
      this.session.sendControl(encodeScroll({ x, y, width, height, hscroll, vscroll }));
      return;
    }
    const dy = vscroll > 0 ? -300 : 300;
    await apps.inputSwipe(this.serial, x, y, x, y + dy, 150);
  }

  /** Invia un keycode Android (pressione + rilascio). */
  async key(keycode) {
    if (this.session && this.mirror === 'scrcpy') {
      if (keycode === KEYCODE.BACK) {
        this.session.sendControl(encodeBackOrScreenOn(0));
        this.session.sendControl(encodeBackOrScreenOn(1));
        return;
      }
      this.session.sendControl(encodeKeyPress(keycode));
      return;
    }
    await apps.inputKeyevent(this.serial, keycode);
  }

  // -------------------------------------------------------------------------
  // Comandi
  // -------------------------------------------------------------------------

  async launchApp(pkg, activity = null) {
    const out = await apps.launchApp(this.serial, pkg, activity);
    this.refreshStatus(1500);
    return out;
  }

  async stopApp(pkg) {
    const out = await apps.stopApp(this.serial, pkg);
    this.refreshStatus(1500);
    return out;
  }

  async closeForegroundApp() {
    const pkg = this.status.foreground ?? (await apps.foregroundPackage(this.serial));
    if (!pkg) return null;
    await apps.stopApp(this.serial, pkg);
    this.refreshStatus(1500);
    return pkg;
  }

  async goHome() {
    await apps.goHome(this.serial);
    this.refreshStatus(1500);
  }

  async volume(steps) {
    return apps.changeVolume(this.serial, steps);
  }

  async reboot() {
    await this.#stopMirror();
    return apps.reboot(this.serial);
  }

  async listPackages(includeSystem = false) {
    return apps.listPackages(this.serial, { includeSystem });
  }

  async listDisplays() {
    return apps.listDisplays(this.serial);
  }

  /** Segna quale filmato gli abbiamo mandato, con la sua durata. */
  setPlaying(playing) {
    this.playing = playing;
    this.emit('state', this.toJSON());
  }

  /** A che punto è il filmato, secondo il lettore del visore. */
  async playerState() {
    const stato = await apps.playerState(this.serial);
    if (!stato) return null;
    return {
      ...stato,
      durationMs: this.playing?.durationMs ?? null,
      name: this.playing?.name ?? null,
    };
  }

  async mediaKey(azione, profilo = 'media') {
    return apps.mediaKey(this.serial, azione, profilo);
  }

  async seekTo(ms, { profilo = 'media', lettore = 'sistema' } = {}) {
    return apps.seekTo(this.serial, ms, { profilo, lettore, percorso: this.playing?.path ?? null });
  }

  /** Guarda cosa si è aperto e se lo ricorda: sarà il lettore da chiudere. */
  async imparaLettore() {
    if (!this.homePackage) this.homePackage = await apps.resolveHomePackage(this.serial).catch(() => null);
    const fg = await apps.foregroundPackage(this.serial).catch(() => null);
    const lettore = apps.riconosciLettore(fg, this.homePackage);
    if (lettore) this.playerPackage = lettore;
    return lettore;
  }

  async refreshStatus(afterMs = 0) {
    if (afterMs) await delay(afterMs);
    if (this.disposed) return this.status;
    const [battery, foreground] = await Promise.all([
      apps.batteryLevel(this.serial).catch(() => null),
      apps.foregroundPackage(this.serial).catch(() => null),
    ]);
    this.status = { battery, foreground, updatedAt: Date.now() };
    this.emit('status', { serial: this.serial, status: this.status });
    return this.status;
  }

  async isReachable() {
    const res = await adbTry(['-s', this.serial, 'get-state'], { timeout: 5000 });
    return res.ok && res.out.trim() === 'device';
  }
}
