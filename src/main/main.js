// Processo principale Electron: crea la finestra, tiene il DeviceManager e fa
// da ponte IPC con la UI.

import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as adb from './adb.js';
import { Config } from './config.js';
import { DeviceManager } from './device-manager.js';
import { KEYCODE } from '../shared/protocol.js';
import { SCRCPY_VERSION } from './scrcpy-session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
// Smoke test: "electron . --quit-after=8" apre la finestra, stampa gli errori
// della UI e chiude. Serve per verificare l'avvio senza visori collegati.
const quitAfter = Number(process.argv.find((a) => a.startsWith('--quit-after='))?.split('=')[1] ?? 0);
// Anteprima della UI senza visori: "npm start -- --demo=10".
const demoDevices = Number(process.argv.find((a) => a.startsWith('--demo='))?.split('=')[1] ?? 0);

let mainWindow = null;
let stopDemo = null;
let demoList = null; // elenco finto usato solo con --demo
let config = null;
let manager = null;

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

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
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

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function wireManager() {
  manager.on('devices', (list) => send('devices', list));
  manager.on('device-state', (payload) => send('device-state', payload));
  manager.on('device-status', (payload) => send('device-status', payload));
  manager.on('device-codec', (payload) => send('device-codec', payload));
  manager.on('log', (payload) => send('log', payload));
  manager.on('scan-progress', (payload) => send('scan-progress', payload));

  manager.on('frame', (frame) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Se la finestra è nascosta teniamo solo i frame indispensabili: così al
    // ritorno in primo piano l'immagine riparte subito senza aver sprecato CPU.
    if (!mainWindow.isVisible() && frame.kind === 'h264' && !frame.config && !frame.keyFrame) return;
    mainWindow.webContents.send('frame', {
      serial: frame.serial,
      kind: frame.kind,
      pts: frame.pts ?? 0,
      config: !!frame.config,
      keyFrame: !!frame.keyFrame,
      data: frame.data,
    });
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, value: await fn(payload ?? {}) };
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err);
      return { ok: false, error: err.message ?? String(err) };
    }
  });
}

function registerIpc() {
  handle('app:info', async () => ({
    adbPath: adb.adbPath(),
    scrcpyServer: adb.scrcpyServerPath(),
    scrcpyVersion: SCRCPY_VERSION,
    problems: await adb.checkPrerequisites(),
    subnets: adb.localSubnets(),
    config: config.data,
    keycodes: KEYCODE,
  }));

  handle('config:get', () => config.data);
  handle('config:patch', (patch) => config.patch(patch));

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
    send('device-state', d.toJSON());
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
  // La qualità è una preferenza di visualizzazione: se il visore non c'è più
  // non è un errore da mostrare all'operatore.
  handle('device:quality', async ({ serial, profile }) => {
    const d = manager.get(serial);
    if (!d) return null;
    await d.setQuality(config.data.quality[profile] ?? config.data.quality.grid);
    return profile;
  });
  handle('device:packages', ({ serial, includeSystem }) => manager.get(serial)?.listPackages(includeSystem));
  handle('device:displays', ({ serial }) => manager.get(serial)?.listDisplays());
  handle('device:status', ({ serial }) => manager.get(serial)?.refreshStatus());
  handle('devices:commonPackages', ({ serials }) => manager.commonPackages(serials));

  handle('action:launch', ({ serials, package: pkg, activity }) =>
    manager.each(serials, (d) => d.launchApp(pkg, activity)),
  );
  handle('action:stop', ({ serials, package: pkg }) => manager.each(serials, (d) => d.stopApp(pkg)));
  handle('action:closeForeground', ({ serials }) => manager.each(serials, (d) => d.closeForegroundApp()));
  handle('action:home', ({ serials }) => manager.each(serials, (d) => d.goHome()));
  handle('action:key', ({ serials, keycode }) => manager.each(serials, (d) => d.key(keycode)));
  handle('action:volume', ({ serials, steps }) => manager.each(serials, (d) => d.volume(steps)));
  handle('action:reboot', ({ serials }) => manager.each(serials, (d) => d.reboot()));

  // Eventi ad alta frequenza: send() invece di invoke(), niente risposta.
  ipcMain.on('pointer', (_e, { serial, type, nx, ny, button }) => {
    manager.get(serial)?.pointer({ type, nx, ny, button }).catch(() => {});
  });
  ipcMain.on('scroll', (_e, { serial, nx, ny, hscroll, vscroll }) => {
    manager.get(serial)?.scroll({ nx, ny, hscroll, vscroll }).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  config = new Config(path.join(app.getPath('userData'), 'config.json'));
  manager = new DeviceManager(config);
  wireManager();
  registerIpc();
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (demoDevices) {
    const demo = await import('./demo.js');
    demoList = demo.buildDemoDevices(demoDevices);
    send('devices', demoList);
    stopDemo = demo.startDemoFrames(demoDevices, send);
  }
  if (quitAfter) setTimeout(() => app.quit(), quitAfter * 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  stopDemo?.();
  stopDemo = null;
  if (!manager || manager.devices.size === 0) return;
  event.preventDefault();
  await manager.disposeAll();
  manager = null;
  app.quit();
});
