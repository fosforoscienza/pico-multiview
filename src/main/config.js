// Configurazione persistente (JSON nella cartella dati dell'app).

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  // Visori noti: vengono ricollegati automaticamente all'avvio.
  devices: [
    // { serial: "192.168.1.51:5555", label: "Visore 1", crop: null, displayId: 0, mirror: "scrcpy" }
  ],
  // Libreria app mostrata nella barra comandi.
  apps: [
    // { id, name, package, activity }
  ],
  quality: {
    grid: { maxSize: 800, bitRate: 2_000_000, maxFps: 20 },
    focus: { maxSize: 1280, bitRate: 6_000_000, maxFps: 30 },
  },
  // Il puntatore parte disattivato: durante un evento non vuoi cliccare per sbaglio.
  pointerEnabled: false,
  autoConnect: true,
  autoReconnect: true,
  screencapIntervalMs: 700,
  scan: { port: 5555, timeout: 400, subnets: null },
};

export class Config {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = structuredClone(DEFAULT_CONFIG);
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.data = mergeDeep(structuredClone(DEFAULT_CONFIG), raw);
      }
    } catch (err) {
      console.error('[config] file non leggibile, uso i valori di default:', err.message);
    }
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    return this.data;
  }

  patch(partial) {
    this.data = mergeDeep(this.data, partial);
    return this.save();
  }

  deviceEntry(serial) {
    return this.data.devices.find((d) => d.serial === serial) ?? null;
  }

  upsertDevice(entry) {
    const existing = this.deviceEntry(entry.serial);
    if (existing) Object.assign(existing, entry);
    else this.data.devices.push({ label: null, crop: null, displayId: 0, mirror: 'scrcpy', ...entry });
    return this.save();
  }

  removeDevice(serial) {
    this.data.devices = this.data.devices.filter((d) => d.serial !== serial);
    return this.save();
  }
}

function mergeDeep(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (patch === null || typeof patch !== 'object') return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? mergeDeep(base[k], v)
      : v;
  }
  return out;
}
