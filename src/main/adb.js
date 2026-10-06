// Wrapper minimale attorno ad adb: esecuzione comandi, scoperta dispositivi in
// rete, port forwarding. Nessuna dipendenza esterna.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Dentro l'app impacchettata i file stanno in "app.asar", che è un archivio:
 * da lì un binario non si può eseguire, e adb non può leggere il server scrcpy
 * per spingerlo sul visore. electron-builder li tira fuori in
 * "app.asar.unpacked" (vedi "asarUnpack" nel package.json): qui riscriviamo il
 * percorso perché punti alla copia vera su disco.
 *
 * Fuori dal pacchetto — cioè quando si lancia con "npm start" — non c'è nessun
 * app.asar nel percorso e la funzione non tocca niente.
 */
export function unpackedPath(filePath) {
  const dentro = `${path.sep}app.asar${path.sep}`;
  const fuori = `${path.sep}app.asar.unpacked${path.sep}`;
  return filePath.includes(dentro) ? filePath.replace(dentro, fuori) : filePath;
}

const VENDOR = unpackedPath(path.join(ROOT, 'vendor'));

let cachedAdbPath = null;

const CANDIDATE_ADB_PATHS = [
  path.join(VENDOR, 'platform-tools', 'adb'),
  '/opt/homebrew/bin/adb',
  '/usr/local/bin/adb',
  path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
  '/usr/bin/adb',
];

export function adbPath() {
  // PICO_ADB si rilegge ogni volta, prima della cache: è un'indicazione
  // esplicita di chi lancia l'app, e deve poter cambiare senza riavviarla.
  if (process.env.PICO_ADB && fs.existsSync(process.env.PICO_ADB)) return process.env.PICO_ADB;
  if (cachedAdbPath) return cachedAdbPath;
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
  return path.join(VENDOR, 'scrcpy-server');
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
  constructor(message, { args, stdout, stderr, code, scaduto = false } = {}) {
    super(message);
    this.name = 'AdbError';
    this.args = args;
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
    this.scaduto = scaduto;
  }
}

/** Esegue adb e restituisce stdout (stringa) o lancia AdbError. */
export function adb(args, { timeout = 15000, encoding = 'utf8', maxBuffer = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(adbPath(), args, { timeout, encoding, maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        // Il motivo va cercato dove adb lo scrive: `adb connect`, per esempio,
        // lo mette su stdout. Il solo messaggio di Node («Command failed: …»)
        // ripete il comando e non dice niente del perché.
        const scaduto = Boolean(err.killed || err.signal);
        const motivo = scaduto
          ? `nessuna risposta in ${Math.round(timeout / 1000)} secondi`
          : (stderr || stdout || err.message || '').toString().trim();
        reject(
          new AdbError(`adb ${args.join(' ')}: ${motivo}`, { args, stdout, stderr, code: err.code, scaduto }),
        );
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

/**
 * Prova a collegarsi a un visore in rete.
 *
 * Non lancia mai: un indirizzo che non risponde è la normalità — un visore
 * spento, o salvato su una rete che non c'è più — e farne un'eccezione
 * significava interrompere a metà il giro di aggiornamento che la conteneva,
 * lasciando fuori anche i visori attaccati al cavo.
 */
export async function connect(host, port = 5555) {
  const res = await adbTry(['connect', `${host}:${port}`], { timeout: 8000 });
  const out = (res.ok ? res.out : res.err?.scaduto ? res.err.message : res.out || res.err?.message || '').trim();
  const ok = res.ok && /connected to/i.test(out) && !/failed|cannot|refused/i.test(out);
  return { ok, message: out || 'nessuna risposta da adb' };
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
 *
 * Se il collegamento in rete non riesce, l'errore dice **perché**: «adb
 * connect fallito» e basta lasciava l'operatore con un cavo in mano e nessuna
 * idea di cosa cambiare. Prima di ogni tentativo il Mac bussa da sé alla porta
 * del visore, e il modo in cui la porta non risponde distingue i casi.
 */
export async function enableWifiAdb(serial, port = 5555) {
  const ip = await deviceIp(serial);
  if (!ip) throw new Error(`Non riesco a leggere l'IP wifi di ${serial}: il visore è connesso alla rete?`);
  // `adb tcpip` si spegne quando il visore si riavvia: da lì in poi servirebbe
  // di nuovo il cavo. La proprietà persistente lo evita — ma solo i visori
  // che la lasciano scrivere (molti a uso aziendale sì): si prova, si
  // controlla se ha attecchito, e non si promette niente che non sia vero.
  await adbTry(['-s', serial, 'shell', `setprop persist.adb.tcp.port ${port}`]);
  const fissata = (await adbTry(['-s', serial, 'shell', 'getprop persist.adb.tcp.port'])).out?.trim();
  await adb(['-s', serial, 'tcpip', String(port)], { timeout: 15000 });

  // Dopo `tcpip` il visore riavvia il suo lato di adb: per un paio di secondi
  // la porta rifiuta. Si riprova finché rifiuta; se invece non risponde
  // affatto, o la rete non lo raggiunge, insistere non cambia niente.
  let bussata = null;
  let ultimo = null;
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    await delay(tentativo === 0 ? 1500 : 1000);
    bussata = await bussaPorta(ip, port, 2500);
    if (bussata.esito === 'aperta') {
      ultimo = await connect(ip, port);
      if (ultimo.ok) return { serial: `${ip}:${port}`, persistente: fissata === String(port) };
    } else if (bussata.esito !== 'rifiutata' && tentativo >= 1) {
      break;
    }
  }
  const spiegazione = diagnosiWifi({ ip, esito: bussata?.esito, codice: bussata?.codice, retiMac: localSubnets() });
  const dettaglio = ultimo ? ` (adb: ${ultimo.message})` : '';
  throw new Error(`il passaggio al wifi non è riuscito: ${spiegazione}${dettaglio}`);
}

/**
 * Cosa dire quando il Mac non riesce a parlare col visore in rete.
 *
 * Le cause hanno sintomi diversi, ed è per questo che si bussa alla porta da
 * sé invece di fidarsi del solo `adb connect`:
 *  - reti diverse: si vede confrontando gli indirizzi;
 *  - «irraggiungibile» subito: macOS non lascia uscire il programma sulla
 *    rete locale (il permesso «Rete locale», da macOS 15) — o non c'è strada;
 *  - nessuna risposta: i pacchetti spariscono, tipico del router che isola
 *    i dispositivi fra loro (rete ospiti, «isolamento client»);
 *  - rifiutata: il visore c'è, ma adb non è in ascolto sulla wifi.
 */
export function diagnosiWifi({ ip, esito, codice = null, retiMac = [] }) {
  const reteVisore = ip.split('.').slice(0, 3).join('.');
  const RETE_LOCALE =
    'macOS non lascia il programma parlare con la rete locale: apri Impostazioni di Sistema → ' +
    'Privacy e sicurezza → Rete locale, attiva Pico MultiView, poi chiudi e riapri il programma';
  if (esito === 'aperta') return 'il visore risponde, ma adb non è riuscito a collegarsi: riprova';
  if (esito === 'rifiutata') {
    return 'il visore è raggiungibile ma non accetta ancora il collegamento wifi: aspetta qualche secondo e riprova';
  }
  if (retiMac.length && !retiMac.includes(reteVisore)) {
    return (
      `il Mac e il visore sembrano su reti diverse (visore ${ip}, Mac su ${retiMac.map((r) => `${r}.x`).join(', ')}): ` +
      'collega il Mac alla stessa wifi del visore'
    );
  }
  if (!retiMac.length) return 'il Mac non è collegato a nessuna rete: collegalo alla stessa wifi del visore';
  if (esito === 'irraggiungibile') return `${RETE_LOCALE}${codice ? ` [${codice}]` : ''}`;
  return (
    `il visore ${ip} non risponde sulla wifi. Di solito è il router che isola i dispositivi fra loro ` +
    '(rete ospiti, «isolamento client» o «AP isolation»): disattivalo o usa un\'altra rete. ' +
    `Se la rete è quella giusta, controlla anche il permesso: ${RETE_LOCALE}`
  );
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

/**
 * Bussa alla porta adb di un indirizzo, senza scomodare adb.
 *
 * `adb connect` verso un indirizzo morto costa fino a otto secondi; questa
 * porta chiusa si scopre in una frazione di secondo, ed è la differenza fra un
 * elenco che si aggiorna subito e uno che sembra bloccato.
 */
export function isPortOpen(host, port = 5555, timeout = 1500) {
  return probePort(host, port, timeout);
}

/**
 * Bussa alla porta e dice **come** è andata, non solo se è aperta: il modo in
 * cui una porta non risponde è la diagnosi (vedi diagnosiWifi).
 *
 * @returns {Promise<{ esito: 'aperta'|'rifiutata'|'nessuna-risposta'|'irraggiungibile'|'errore', codice: string|null }>}
 */
export function bussaPorta(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (esito, codice = null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ esito, codice });
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish('aperta'));
    socket.once('timeout', () => finish('nessuna-risposta'));
    socket.once('error', (err) => {
      if (err.code === 'ECONNREFUSED') return finish('rifiutata', err.code);
      // EHOSTDOWN: a quell'indirizzo non c'è nessuno. Durante una scansione è
      // la risposta di quasi tutta la rete, non un divieto.
      if (err.code === 'ETIMEDOUT' || err.code === 'EHOSTDOWN') return finish('nessuna-risposta', err.code);
      if (['EHOSTUNREACH', 'ENETUNREACH', 'EPERM', 'EACCES', 'EADDRNOTAVAIL'].includes(err.code)) {
        return finish('irraggiungibile', err.code);
      }
      finish('errore', err.code ?? null);
    });
    socket.connect(port, host);
  });
}

function probePort(host, port, timeout) {
  return bussaPorta(host, port, timeout).then((r) => r.esito === 'aperta');
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
  const conteggi = {};
  let done = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const idx = cursor++;
      if (idx >= hosts.length) return;
      const host = hosts[idx];
      const { esito } = await bussaPorta(host, port, timeout);
      conteggi[esito] = (conteggi[esito] ?? 0) + 1;
      if (esito === 'aperta') open.push(host);
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
  const diagnosi = connected.length ? null : diagnosiScansione({ conteggi, probed: hosts.length, retiMac: subnets });
  return { probed: hosts.length, open, connected, conteggi, diagnosi };
}

/**
 * Perché una scansione non ha trovato niente, quando lo si può dire.
 *
 * Su una rete normale quasi tutti gli indirizzi semplicemente non rispondono.
 * Se invece quasi tutti risultano «irraggiungibili» all'istante, non è la
 * rete: è macOS che non lascia uscire il programma (permesso «Rete locale»).
 */
export function diagnosiScansione({ conteggi = {}, probed = 0, retiMac = [] }) {
  if (!retiMac.length) return 'Il Mac non è collegato a nessuna rete: collegalo alla stessa wifi dei visori.';
  if (probed && (conteggi.irraggiungibile ?? 0) >= probed * 0.9) {
    return (
      'macOS non lascia il programma parlare con la rete locale. Apri Impostazioni di Sistema → ' +
      'Privacy e sicurezza → Rete locale, attiva Pico MultiView, poi chiudi e riapri il programma.'
    );
  }
  return null;
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
