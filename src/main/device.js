// Un visore: stato, mirroring (scrcpy oppure screencap), comandi e filmati.

import { EventEmitter } from 'node:events';

import * as apps from './apps.js';
import { adbTry, delay, shellBinary } from './adb.js';
import { ScrcpySession, dimenticaJar } from './scrcpy-session.js';
import { KEYCODE, encodeBackOrScreenOn, encodeKeyPress, leftEyeCrop } from '../shared/protocol.js';

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
  constructor(serial, { label = null, playerPackage = null, config = {} } = {}) {
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
    // chiuderlo e azzerarlo prima del prossimo avvio, e quindi di ripartire
    // dall'inizio. Arriva dalla configurazione, così vale già al primo lancio.
    this.playerPackage = playerPackage;
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
    this.connecting = false; // una connessione alla volta: due si pestano i piedi
    this.disposed = false;
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

  async setDisplayId(displayId) {
    this.displayId = displayId;
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

  async listDisplays() {
    return apps.listDisplays(this.serial);
  }

  /** Segna quale filmato gli abbiamo mandato, con la sua durata. */
  setPlaying(playing) {
    // startedAt/pausedAt/pausedMs sono l'orologio di bordo: il lettore PICO
    // non dice a che punto è, ma gli ordini di moto e di pausa glieli diamo
    // noi, e contando il tempo fra un ordine e l'altro la posizione si stima.
    this.playing = playing ? { pausedAt: null, pausedMs: 0, ...playing } : null;
    this.emit('state', this.toJSON());
  }

  /** L'orologio di bordo segna la pausa (o la ripresa) ordinata da qui. */
  segnaOrdineMedia(azione) {
    if (!this.playing) return;
    const now = Date.now();
    if (azione === 'pause' && !this.playing.pausedAt) {
      this.playing = { ...this.playing, pausedAt: now };
    } else if (azione === 'play' && this.playing.pausedAt) {
      this.playing = {
        ...this.playing,
        pausedAt: null,
        pausedMs: this.playing.pausedMs + (now - this.playing.pausedAt),
      };
    }
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

  async seekTo(ms, { profilo = 'media' } = {}) {
    return apps.seekTo(this.serial, ms, { profilo });
  }

  /** Guarda cosa si è aperto e se lo ricorda: sarà il lettore da chiudere. */
  async imparaLettore() {
    if (!this.homePackage) this.homePackage = await apps.resolveHomePackage(this.serial).catch(() => null);
    const fg = await apps.foregroundPackage(this.serial).catch(() => null);
    const candidato = apps.riconosciLettore(fg, this.homePackage);
    // Non basta che sia in primo piano: dev'essere un'app che i filmati li sa
    // aprire. Se il filmato non è partito, davanti c'è dell'altro — e
    // ricordarselo come lettore vorrebbe dire chiuderlo al prossimo avvio.
    if (candidato && (await apps.gestisceVideo(this.serial, candidato))) {
      this.playerPackage = candidato;
      return candidato;
    }
    return null;
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
