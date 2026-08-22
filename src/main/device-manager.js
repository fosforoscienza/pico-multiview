// Registro dei visori: sincronizza l'elenco con adb, propaga gli eventi verso
// la UI e offre le operazioni "su tutti" / "sui selezionati".

import { EventEmitter } from 'node:events';

import * as adb from './adb.js';
import { Device, STATE } from './device.js';

const STATUS_POLL_MS = 12000;

export class DeviceManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.devices = new Map(); // serial -> Device
    this.statusTimer = null;
  }

  list() {
    return [...this.devices.values()].map((d) => d.toJSON());
  }

  get(serial) {
    return this.devices.get(serial) ?? null;
  }

  #wire(device) {
    device.on('state', (payload) => this.emit('device-state', payload));
    device.on('status', (payload) => this.emit('device-status', payload));
    device.on('codec', (payload) => this.emit('device-codec', payload));
    device.on('frame', (payload) => this.emit('frame', payload));
    device.on('log', (payload) => this.emit('log', payload));
  }

  add(serial, { label = null, connect = true } = {}) {
    let device = this.devices.get(serial);
    if (device) return device;

    const entry = this.config.deviceEntry(serial) ?? {};
    device = new Device(serial, {
      label: label ?? entry.label ?? null,
      config: {
        mirror: entry.mirror ?? 'scrcpy',
        crop: entry.crop ?? null,
        displayId: entry.displayId ?? 0,
        quality: this.config.data.quality.grid,
        autoReconnect: this.config.data.autoReconnect,
        screencapIntervalMs: this.config.data.screencapIntervalMs,
      },
    });
    this.#wire(device);
    this.devices.set(serial, device);
    this.config.upsertDevice({
      serial,
      label: device.label,
      mirror: device.mirror,
      crop: device.crop,
      displayId: device.displayId,
    });
    this.emit('devices', this.list());
    if (connect) device.connect();
    return device;
  }

  async remove(serial, { forget = false } = {}) {
    const device = this.devices.get(serial);
    if (device) {
      await device.dispose();
      this.devices.delete(serial);
    }
    if (forget) {
      this.config.removeDevice(serial);
      await adb.disconnect(serial);
    }
    this.emit('devices', this.list());
  }

  /**
   * Allinea il registro a quello che vede adb: aggiunge i nuovi dispositivi
   * online e prova a ricollegare quelli salvati in configurazione.
   */
  async sync({ autoConnect = this.config.data.autoConnect } = {}) {
    const seen = await adb.listDevices();
    const online = new Set(seen.filter((d) => d.state === 'device').map((d) => d.serial));

    if (autoConnect) {
      for (const entry of this.config.data.devices) {
        if (!online.has(entry.serial) && entry.serial.includes(':')) {
          const [host, port] = entry.serial.split(':');
          const res = await adb.connect(host, Number(port) || 5555);
          if (res.ok) online.add(entry.serial);
        }
      }
    }

    for (const serial of online) {
      if (!this.devices.has(serial)) this.add(serial, { connect: autoConnect });
    }

    // Aggiorna gli stati "non autorizzato / offline" per dare un feedback utile.
    for (const d of seen) {
      const dev = this.devices.get(d.serial);
      if (!dev) continue;
      if (d.state !== 'device' && dev.state === STATE.STREAMING) {
        dev.log('error', `dispositivo in stato "${d.state}"`);
      }
    }

    this.emit('devices', this.list());
    return { seen, online: [...online] };
  }

  /** Scansione della rete + aggiunta di tutto ciò che risponde. */
  async scan({ subnets = null, port = 5555, timeout = 400 } = {}) {
    const result = await adb.scanNetwork({
      subnets: subnets?.length ? subnets : adb.localSubnets(),
      port,
      timeout,
      onProgress: (p) => this.emit('scan-progress', p),
    });
    for (const serial of result.connected) this.add(serial);
    await this.sync();
    return result;
  }

  /** Prende i visori collegati via USB e li passa al controllo wifi. */
  async adoptUsbDevices() {
    const seen = await adb.listDevices();
    const usb = seen.filter((d) => d.transport === 'usb' && d.state === 'device');
    const results = [];
    for (const d of usb) {
      try {
        const serial = await adb.enableWifiAdb(d.serial);
        this.add(serial);
        results.push({ usb: d.serial, wifi: serial, ok: true });
      } catch (err) {
        results.push({ usb: d.serial, ok: false, error: err.message });
      }
    }
    await this.sync();
    return results;
  }

  targets(serials) {
    if (!serials || serials === 'all' || (Array.isArray(serials) && serials.length === 0)) {
      return [...this.devices.values()];
    }
    return serials.map((s) => this.devices.get(s)).filter(Boolean);
  }

  /** Esegue un'azione su più visori in parallelo, senza far fallire il gruppo. */
  async each(serials, fn, { concurrency = 10 } = {}) {
    const list = this.targets(serials);
    const results = [];
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= list.length) return;
        const device = list[i];
        try {
          results.push({ serial: device.serial, ok: true, value: await fn(device) });
        } catch (err) {
          results.push({ serial: device.serial, ok: false, error: err.message });
          device.log('error', err.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return results;
  }

  /** Pacchetti presenti su TUTTI i visori indicati (utile per la libreria app). */
  async commonPackages(serials) {
    const perDevice = await this.each(serials, (d) => d.listPackages());
    const ok = perDevice.filter((r) => r.ok).map((r) => r.value);
    if (!ok.length) return [];
    const counts = new Map();
    for (const list of ok) for (const pkg of new Set(list)) counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
    return [...counts.entries()]
      .map(([pkg, n]) => ({ package: pkg, onAll: n === ok.length, count: n, total: ok.length }))
      .sort((a, b) => Number(b.onAll) - Number(a.onAll) || a.package.localeCompare(b.package));
  }

  startStatusPolling() {
    this.stopStatusPolling();
    this.statusTimer = setInterval(() => {
      for (const d of this.devices.values()) {
        if (d.state === STATE.STREAMING) d.refreshStatus().catch(() => {});
      }
    }, STATUS_POLL_MS);
  }

  stopStatusPolling() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
  }

  async disposeAll() {
    this.stopStatusPolling();
    await Promise.all([...this.devices.values()].map((d) => d.dispose()));
    this.devices.clear();
  }
}
