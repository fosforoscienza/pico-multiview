// Wrapper minimale attorno ad adb: esecuzione comandi, scoperta dispositivi in
// rete, port forwarding. Nessuna dipendenza esterna.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let cachedAdbPath = null;

const CANDIDATE_ADB_PATHS = [
  path.join(ROOT, 'vendor', 'platform-tools', 'adb'),
  '/opt/homebrew/bin/adb',
  '/usr/local/bin/adb',
  path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
  '/usr/bin/adb',
];

export function adbPath() {
  if (cachedAdbPath) return cachedAdbPath;
  if (process.env.PICO_ADB && fs.existsSync(process.env.PICO_ADB)) {
    cachedAdbPath = process.env.PICO_ADB;
    return cachedAdbPath;
  }
  for (const p of CANDIDATE_ADB_PATHS) {
    if (fs.existsSync(p)) {
      cachedAdbPath = p;
      return cachedAdbPath;
    }
  }
  cachedAdbPath = 'adb'; // ultima spiaggia: quello nel PATH
  return cachedAdbPath;
}

export function scrcpyServerPath() {
  return path.join(ROOT, 'vendor', 'scrcpy-server');
}

/** Verifica che adb sia eseguibile e che il server scrcpy sia stato scaricato. */
export async function checkPrerequisites() {
  const problems = [];
  try {
    await adb(['version'], { timeout: 8000 });
  } catch {
    problems.push(`adb non eseguibile (${adbPath()}): lancia "npm run deps:adb" oppure installa le platform-tools`);
  }
  if (!fs.existsSync(scrcpyServerPath())) {
    problems.push('vendor/scrcpy-server mancante: lancia "npm run deps"');
  }
  return problems;
}

export class AdbError extends Error {
  constructor(message, { args, stdout, stderr, code } = {}) {
    super(message);
    this.name = 'AdbError';
    this.args = args;
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
  }
}

/** Esegue adb e restituisce stdout (stringa) o lancia AdbError. */
export function adb(args, { timeout = 15000, encoding = 'utf8', maxBuffer = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(adbPath(), args, { timeout, encoding, maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').toString().trim();
        reject(new AdbError(`adb ${args.join(' ')}: ${msg}`, { args, stdout, stderr, code: err.code }));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : stdout.toString());
    });
  });
}

/** Come adb() ma non lancia: restituisce { ok, out, err }. */
export async function adbTry(args, opts) {
  try {
    return { ok: true, out: await adb(args, opts), err: null };
  } catch (e) {
    return { ok: false, out: e.stdout ?? '', err: e };
  }
}

export function adbSpawn(args, opts = {}) {
  return spawn(adbPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

export function shell(serial, command, opts) {
  return adb(['-s', serial, 'shell', command], opts);
}

/** shell "binario" (niente conversione CRLF): usato per screencap. */
export function shellBinary(serial, command, opts = {}) {
  return adb(['-s', serial, 'exec-out', command], { encoding: 'buffer', ...opts });
}

export async function listDevices() {
  const out = await adb(['devices', '-l']);
  const devices = [];
  for (const line of out.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [serial, state, ...rest] = trimmed.split(/\s+/);
    if (!serial || !state) continue;
    const props = {};
    for (const kv of rest) {
      const i = kv.indexOf(':');
      if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
    }
    devices.push({
      serial,
      state, // device | offline | unauthorized
      model: props.model?.replace(/_/g, ' ') ?? null,
      transport: serial.includes(':') ? 'tcp' : 'usb',
    });
  }
  return devices;
}

export async function connect(host, port = 5555) {
  const out = await adb(['connect', `${host}:${port}`], { timeout: 8000 });
  const ok = /connected to/i.test(out) && !/failed|cannot|refused/i.test(out);
  return { ok, message: out.trim() };
}

export async function disconnect(serial) {
  return adbTry(['disconnect', serial]);
}

export async function forward(serial, localPort, remote) {
  await adb(['-s', serial, 'forward', `tcp:${localPort}`, remote]);
}

export async function forwardRemove(serial, localPort) {
  return adbTry(['-s', serial, 'forward', '--remove', `tcp:${localPort}`]);
}

export async function push(serial, local, remote) {
  await adb(['-s', serial, 'push', local, remote], { timeout: 60000 });
}

export async function getProp(serial, prop) {
  return (await shell(serial, `getprop ${prop}`)).trim();
}

/**
 * Legge l'IP del visore sulla wifi. Prova wlan0 e poi qualunque interfaccia.
 */
export async function deviceIp(serial) {
  const out = await adbTry(['-s', serial, 'shell', 'ip -f inet addr show wlan0']);
  const text = out.ok ? out.out : (await adbTry(['-s', serial, 'shell', 'ip -f inet addr'])).out;
  const m = /inet\s+(\d+\.\d+\.\d+\.\d+)/.exec(text || '');
  return m ? m[1] : null;
}

/**
 * Prepara un visore collegato via USB al controllo wifi:
 * legge l'IP, attiva adb tcpip 5555 e si riconnette via rete.
 */
export async function enableWifiAdb(serial, port = 5555) {
  const ip = await deviceIp(serial);
  if (!ip) throw new Error(`Non riesco a leggere l'IP wifi di ${serial}: il visore è connesso alla rete?`);
  await adb(['-s', serial, 'tcpip', String(port)], { timeout: 15000 });
  await delay(1500);
  const res = await connect(ip, port);
  if (!res.ok) throw new Error(`adb connect ${ip}:${port} fallito: ${res.message}`);
  return `${ip}:${port}`;
}

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Scoperta in rete
// ---------------------------------------------------------------------------

/** Sottoreti /24 delle interfacce locali (utile per la scansione). */
export function localSubnets() {
  const subnets = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      subnets.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...subnets];
}

function probePort(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * Scansiona una o più /24 cercando la porta adb aperta, poi prova adb connect.
 * onProgress({done, total, found}) viene chiamato durante la scansione.
 */
export async function scanNetwork({
  subnets = localSubnets(),
  port = 5555,
  timeout = 400,
  concurrency = 64,
  onProgress = null,
} = {}) {
  const hosts = [];
  for (const s of subnets) {
    for (let i = 1; i <= 254; i++) hosts.push(`${s}.${i}`);
  }

  const open = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const idx = cursor++;
      if (idx >= hosts.length) return;
      const host = hosts[idx];
      if (await probePort(host, port, timeout)) open.push(host);
      done++;
      if (onProgress && done % 8 === 0) onProgress({ done, total: hosts.length, found: open.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  if (onProgress) onProgress({ done: hosts.length, total: hosts.length, found: open.length });

  const connected = [];
  for (const host of open) {
    const res = await connect(host, port);
    if (res.ok) connected.push(`${host}:${port}`);
  }
  return { probed: hosts.length, open, connected };
}

/** Porta TCP locale libera, cercata a partire da `start`. */
export function findFreePort(start = 27183) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > 65000) return reject(new Error('nessuna porta libera'));
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.once('listening', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
      srv.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}
