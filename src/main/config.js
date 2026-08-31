// Configurazione persistente (JSON nella cartella dati dell'app).

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  // Visori noti: vengono ricollegati automaticamente all'avvio.
  devices: [
    // { serial: "192.168.1.51:5555", label: "Visore 1", crop: null, displayId: 0, mirror: "scrcpy" }
  ],
  // Postazioni della schermata principale: slots[i] = seriale o null.
  // Sono la mappa fisica dell'evento, quindi l'ordine conta e va conservato.
  slotCount: 10,
  slots: [null, null, null, null, null, null, null, null, null, null],
  // Visori collegati che l'operatore ha tolto da uno slot: restano raggiungibili
  // ma non vengono riassegnati da soli alla prima postazione libera.
  unassigned: [],
  // Libreria app mostrata nella barra comandi.
  apps: [
    // { id, name, package, activity }
  ],
  quality: {
    grid: { maxSize: 800, bitRate: 2_000_000, maxFps: 20 },
    focus: { maxSize: 1280, bitRate: 6_000_000, maxFps: 30 },
  },
  // 'left'  = ai visori si chiede solo la metà sinistra, cioè un occhio
  // 'full'  = immagine intera, con i due occhi affiancati
  // Il ritaglio vero sta poi in ogni visore (devices[].crop): questo serve solo
  // a ricordare come sta il pulsante.
  eyeMode: 'full',
  // Come far arrivare il tocco al visore:
  // 'scrcpy'    = canale di controllo, quello normale di Android
  // 'trackball' = comando `input`, dichiarando un'altra periferica. Sui visori
  //               PICO serve questo: non hanno un touchscreen e scartano gli
  //               eventi che dicono di venirne.
  pointerMode: 'scrcpy',
  // Con quali tasti si comanda il lettore video del visore. Non è una
  // preferenza di gusto: i lettori dei visori rispondono a tasti diversi, e
  // quelli «media» — gli unici standard — su molti non fanno proprio niente.
  // Si sceglie dalla barra del filmato, provandoli.
  playerKeys: 'media',
  // Con quale lettore aprire i filmati sui visori:
  // 'sistema' = quello del visore, che però da fuori è cieco e sordo
  // 'vlc'     = VLC, che pubblica il suo stato e accetta la posizione di
  //             partenza nel comando di avvio (va installato sui visori)
  player: 'sistema',
  // Se un filmato mandato da qui debba ricominciare da capo. Si può spegnere:
  // farlo ripartire dall'inizio richiede di chiudere prima il lettore, e su un
  // visore che facesse storie è meglio un filmato che parte da metà che uno
  // che non parte.
  fromStart: true,
  // Telecomando da iPad: server spento finché non lo accendi tu.
  remote: { enabled: false, port: 8788, pin: null },
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
