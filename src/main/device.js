// Un visore: stato, mirroring (scrcpy oppure screencap), puntatore, comandi app.

import { EventEmitter } from 'node:events';

import * as apps from './apps.js';
import { adbTry, delay, shellBinary } from './adb.js';
import { ScrcpySession } from './scrcpy-session.js';
import {
  ACTION,
  BUTTON,
  KEYCODE,
  POINTER_ID_MOUSE,
  encodeBackOrScreenOn,
  encodeKeyPress,
  encodeScroll,
  encodeTouch,
} from '../shared/protocol.js';

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
    session.on('log', ({ level, message }) => this.log(level, message));
    session.on('error', (err) => {
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

  async setDisplayId(displayId) {
    this.displayId = displayId;
    if (this.mirror === 'scrcpy') await this.connect();
  }

  async dispose() {
    this.disposed = true;
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
   * Evento di puntatore con coordinate normalizzate 0..1 rispetto all'immagine.
   * type: 'down' | 'move' | 'up' | 'cancel'
   */
  async pointer({ type, nx, ny, button = BUTTON.PRIMARY }) {
    const { width, height } = this.#frameSize();
    const x = Math.max(0, Math.min(1, nx)) * width;
    const y = Math.max(0, Math.min(1, ny)) * height;

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
      this.session.sendControl(msg);
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
    if (this.session && this.mirror === 'scrcpy') {
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
