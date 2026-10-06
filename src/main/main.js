// Processo principale Electron: crea la finestra, tiene il DeviceManager e fa
// da ponte verso le due interfacce possibili — la finestra sul Mac (IPC) e i
// telecomandi collegati via WebSocket (iPad, iPhone, altri portatili).
//
// I due canali usano gli stessi identici handler: cambia solo il trasporto.

import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';

import * as adb from './adb.js';
import * as apps from './apps.js';
import { Config } from './config.js';
import { brandForUi } from './brand.js';
import { DeviceManager } from './device-manager.js';
import { KEYCODE } from '../shared/protocol.js';
import { RemoteServer, generatePin } from './server.js';
import { SCRCPY_VERSION } from './scrcpy-session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

const isDev = process.argv.includes('--dev');
// Smoke test: "electron . --quit-after=8" apre la finestra, stampa gli errori
// della UI e chiude. Serve per verificare l'avvio senza visori collegati.
const quitAfter = Number(process.argv.find((a) => a.startsWith('--quit-after='))?.split('=')[1] ?? 0);
// Anteprima della UI senza visori: "npm start -- --demo=10".
const demoDevices = Number(process.argv.find((a) => a.startsWith('--demo='))?.split('=')[1] ?? 0);
// Accende subito il telecomando, senza passare dal pannello:
// "npm start -- --remote" oppure "--remote=8900" per scegliere la porta.
const remoteArg = process.argv.find((a) => a === '--remote' || a.startsWith('--remote='));
const forceRemote = !!remoteArg;
const forceRemotePort = Number(remoteArg?.split('=')[1]) || 0;

/** Identificativo della finestra sul Mac, per distinguerla dai telecomandi. */
const LOCAL = { clientId: 'local' };

// Cartella dei dati fissata a mano: senza questa riga l'app avviata da sorgente
// (nome "pico-multiview") e quella impacchettata nel .dmg (nome "Pico MultiView")
// userebbero due configurazioni diverse, e passando dall'una all'altra sembrerebbe
// di aver perso postazioni, nomi e libreria app.
app.setPath('userData', path.join(app.getPath('appData'), 'pico-multiview'));

let mainWindow = null;
let stopDemo = null;
let demoList = null; // elenco finto usato solo con --demo
let config = null;
let manager = null;
let remote = null;

/** Chi sta guardando cosa: clientId -> seriale in anteprima (o assente). */
const previewBy = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#101317',
    title: 'Pico MultiView',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  if (isDev || quitAfter) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[ui:${level}] ${message} (${source}:${line})`);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Diffusione degli eventi verso finestra e telecomandi
// ---------------------------------------------------------------------------

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function broadcast(channel, payload) {
  send(channel, payload);
  remote?.broadcast(channel, payload);
}

function broadcastFrame(frame) {
  const payload = {
    serial: frame.serial,
    kind: frame.kind,
    pts: frame.pts ?? 0,
    config: !!frame.config,
    keyFrame: !!frame.keyFrame,
    data: frame.data,
  };
  // Se la finestra è nascosta teniamo solo i frame indispensabili: così al
  // ritorno in primo piano l'immagine riparte subito senza aver sprecato CPU.
  const windowWants = mainWindow?.isVisible() || frame.config || frame.keyFrame || frame.kind !== 'h264';
  if (windowWants) send('frame', payload);
  remote?.broadcastFrame(payload);
}

function wireManager() {
  manager.on('devices', (list) => broadcast('devices', list));
  manager.on('device-state', (payload) => broadcast('device-state', payload));
  manager.on('device-status', (payload) => broadcast('device-status', payload));
  manager.on('device-codec', (payload) => broadcast('device-codec', payload));
  manager.on('log', (payload) => broadcast('log', payload));
  manager.on('scan-progress', (payload) => broadcast('scan-progress', payload));
  manager.on('config-changed', (data) => broadcast('config', data));
  manager.on('frame', broadcastFrame);
}

// ---------------------------------------------------------------------------
// Qualità: chi ha un visore in anteprima lo vuole a risoluzione piena
// ---------------------------------------------------------------------------

/**
 * Un visore va in alta qualità se ALMENO un client (finestra o telecomando) lo
 * sta guardando in anteprima. Senza questa mediazione due client che guardano
 * visori diversi si toglierebbero la qualità a vicenda.
 */
function applyQualityProfiles() {
  if (!manager) return;
  const focused = new Set([...previewBy.values()].filter(Boolean));
  for (const device of manager.devices.values()) {
    const profile = focused.has(device.serial) ? 'focus' : 'grid';
    device.setQuality(config.data.quality[profile] ?? config.data.quality.grid).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Handler condivisi fra IPC (finestra) e WebSocket (telecomandi)
// ---------------------------------------------------------------------------

const thumbCache = new Map(); // percorso video -> data URL della miniatura
const handlers = new Map(); // canale -> fn(payload, ctx) con risposta

function handle(channel, fn) {
  handlers.set(channel, fn);
  ipcMain.handle(channel, (_event, payload) => invokeHandler(channel, payload, LOCAL));
}

async function invokeHandler(channel, payload, ctx) {
  const fn = handlers.get(channel);
  if (!fn) return { ok: false, error: `canale sconosciuto: ${channel}` };
  try {
    return { ok: true, value: await fn(payload ?? {}, ctx) };
  } catch (err) {
    console.error(`[ipc] ${channel}:`, err);
    return { ok: false, error: err.message ?? String(err) };
  }
}

function registerHandlers() {
  handle('app:info', async () => ({
    adbPath: adb.adbPath(),
    scrcpyServer: adb.scrcpyServerPath(),
    scrcpyVersion: SCRCPY_VERSION,
    problems: await adb.checkPrerequisites(),
    subnets: adb.localSubnets(),
    config: config.data,
    keycodes: KEYCODE,
    playerProfiles: apps.PROFILI_LETTORE,
    videoModes: apps.VIDEO_MODES,
    remote: remote?.status ?? null,
    brand: brandForUi(),
  }));

  handle('config:get', () => config.data);
  handle('config:patch', (patch) => {
    const data = config.patch(patch);
    broadcast('config', data);
    return data;
  });

  handle('devices:list', () => demoList ?? manager.list());
  handle('devices:sync', () => manager.sync());
  handle('devices:scan', ({ subnets, port, timeout }) =>
    manager.scan({
      subnets: subnets ?? config.data.scan.subnets,
      port: port ?? config.data.scan.port,
      timeout: timeout ?? config.data.scan.timeout,
    }),
  );
  handle('devices:adoptUsb', () => manager.adoptUsbDevices());
  handle('devices:add', async ({ host, port = 5555 }) => {
    const target = host.includes(':') ? host : `${host}:${port}`;
    const [h, p] = target.split(':');
    const res = await adb.connect(h, Number(p) || 5555);
    if (!res.ok) throw new Error(res.message);
    manager.add(target);
    return target;
  });
  handle('devices:remove', ({ serial, forget }) => manager.remove(serial, { forget }));

  handle('device:reconnect', ({ serial }) => manager.get(serial)?.connect());
  handle('device:label', ({ serial, label }) => {
    const d = manager.get(serial);
    if (!d) throw new Error('visore sconosciuto');
    d.label = label || null;
    config.upsertDevice({ serial, label: d.label });
    broadcast('device-state', d.toJSON());
    return d.toJSON();
  });
  handle('device:mirror', async ({ serial, mode }) => {
    const d = manager.get(serial);
    if (!d) throw new Error('visore sconosciuto');
    config.upsertDevice({ serial, mirror: mode });
    await d.setMirrorMode(mode);
  });
  handle('device:crop', async ({ serial, crop }) => {
    const d = manager.get(serial);
    if (!d) throw new Error('visore sconosciuto');
    config.upsertDevice({ serial, crop: crop || null });
    await d.setCrop(crop);
  });
  handle('device:display', async ({ serial, displayId }) => {
    const d = manager.get(serial);
    if (!d) throw new Error('visore sconosciuto');
    config.upsertDevice({ serial, displayId });
    await d.setDisplayId(displayId);
  });
  // "Questo client sta guardando questo visore": da qui esce la qualità.
  handle('device:preview', ({ serial }, ctx) => {
    if (serial) previewBy.set(ctx.clientId, serial);
    else previewBy.delete(ctx.clientId);
    applyQualityProfiles();
    return serial ?? null;
  });
  handle('devices:eye', async ({ serials, mode }) => {
    const results = await manager.each(serials, async (d) => {
      const crop = await d.setEyeMode(mode);
      config.upsertDevice({ serial: d.serial, crop });
      return crop;
    });
    config.patch({ eyeMode: mode === 'left' ? 'left' : 'full' });
    return results;
  });
  handle('device:displays', ({ serial }) => manager.get(serial)?.listDisplays());
  handle('device:status', ({ serial }) => manager.get(serial)?.refreshStatus());
  handle('devices:videos', ({ serials }) => manager.videoLibrary(serials));
  handle('devices:playVideo', ({ entries, fromStart, videoType }) =>
    manager.playVideoEverywhere(entries ?? [], {
      fromStart: fromStart !== false,
      videoType: videoType ?? null,
    }),
  );
  handle('devices:playerState', ({ serials }) => manager.playersState(serials));
  handle('devices:media', ({ serials, action, profile }) =>
    manager.mediaEverywhere(serials, action, profile ?? config.data.playerKeys),
  );
  handle('devices:seek', ({ serials, ms }) => manager.seekEverywhere(serials, ms));
  handle('devices:replay', ({ serials }) => manager.replayEverywhere(serials));
  handle('devices:stopVideo', ({ serials }) => manager.stopVideoEverywhere(serials));
  // Il QR è l'indirizzo con il PIN dentro: la fotocamera dell'iPad lo apre
  // già sbloccato, senza copiare niente a mano. Chi vede il QR entra: va
  // mostrato sullo schermo del Mac, non stampato e lasciato sul tavolo.
  handle('remote:qr', async ({ url }) => {
    if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('indirizzo non valido');
    return QRCode.toDataURL(url, { margin: 1, width: 240 });
  });

  handle('device:videoThumb', async ({ serial }) => {
    const device = manager.get(serial);
    const path = device?.playing?.path;
    if (!path) return null;
    // In cache per percorso: la miniatura non cambia, e leggerla dal visore a
    // ogni giro della barra sarebbe un viaggio inutile.
    if (!thumbCache.has(path)) {
      thumbCache.set(path, await apps.videoThumbnail(serial, path).catch(() => null));
    }
    return thumbCache.get(path);
  });

  handle('action:closeForeground', ({ serials }) => manager.each(serials, (d) => d.closeForegroundApp()));
  handle('action:home', ({ serials }) => manager.each(serials, (d) => d.goHome()));
  handle('action:key', ({ serials, keycode }) => manager.each(serials, (d) => d.key(keycode)));
  handle('action:volume', ({ serials, steps }) => manager.each(serials, (d) => d.volume(steps)));
  handle('action:reboot', ({ serials }) => manager.each(serials, (d) => d.reboot()));

  // Telecomando
  handle('remote:status', () => remote.status);
  handle('remote:start', async ({ port }) => {
    if (port && port !== remote.port) remote.port = port;
    const status = await remote.start();
    config.patch({ remote: { enabled: true, port: remote.port, pin: remote.pin } });
    return status;
  });
  handle('remote:stop', async () => {
    await remote.stop();
    config.patch({ remote: { ...config.data.remote, enabled: false } });
    return remote.status;
  });
  handle('remote:newPin', () => {
    const pin = remote.setPin(generatePin());
    config.patch({ remote: { ...config.data.remote, pin } });
    return remote.status;
  });
}

function wireRemote() {
  remote.on('log', (payload) => broadcast('log', payload));
  remote.on('status', (status) => send('remote-status', status));

  remote.on('command', async (client, message) => {
    const ctx = { clientId: client.id };
    if (message?.t !== 'invoke') return;
    const result = await invokeHandler(message.channel, message.payload, ctx);
    remote.send(client, 'reply', { id: message.id, ...result });
  });

  remote.on('client-disconnected', (client) => {
    previewBy.delete(client.id);
    applyQualityProfiles();
  });
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  config = new Config(path.join(app.getPath('userData'), 'config.json'));
  console.log(`[config] ${config.filePath}`);
  manager = new DeviceManager(config);

  if (!config.data.remote.pin) config.patch({ remote: { ...config.data.remote, pin: generatePin() } });
  remote = new RemoteServer({
    staticRoot: RENDERER_DIR,
    sharedRoot: path.join(__dirname, '..', 'shared'),
    pin: config.data.remote.pin,
    port: forceRemotePort || config.data.remote.port,
  });

  wireManager();
  wireRemote();
  registerHandlers();
  createWindow();

  const problems = await adb.checkPrerequisites();
  if (problems.length) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Dipendenze mancanti',
      message: problems.join('\n'),
      detail: 'Esegui "npm run deps" (e "npm run deps:adb" se non hai adb installato) e riavvia l\'app.',
    });
  }

  manager.startStatusPolling();
  await manager.sync().catch((err) => console.error('[sync]', err.message));

  if (config.data.remote.enabled || forceRemote) {
    await remote
      .start()
      .then((status) => {
        const base = status.urls[0] ?? `http://localhost:${status.port}`;
        console.log(`[remote] telecomando pronto: ${base}/?k=${status.pin}`);
      })
      .catch((err) => {
        console.error('[remote]', err.message);
        broadcast('log', { level: 'error', message: `telecomando non avviato: ${err.message}` });
      });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (demoDevices) {
    const demo = await import('./demo.js');
    demoList = demo.buildDemoDevices(demoDevices);
    broadcast('devices', demoList);
    stopDemo = demo.startDemoFrames(demoDevices, (channel, payload) =>
      channel === 'frame' ? broadcastFrame(payload) : broadcast(channel, payload),
    );
  }
  if (quitAfter) setTimeout(() => app.quit(), quitAfter * 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  stopDemo?.();
  stopDemo = null;
  if (!manager || (manager.devices.size === 0 && !remote?.running)) return;
  event.preventDefault();
  await remote?.stop().catch(() => {});
  await manager.disposeAll();
  manager = null;
  app.quit();
});
