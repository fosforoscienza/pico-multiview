// Telecomando da iPad (o da qualsiasi altro dispositivo sulla stessa wifi).
//
// Il Mac resta il cervello: è lui che parla ai visori via adb. Questo modulo
// espone la stessa interfaccia via HTTP + WebSocket, protetta da un PIN, così
// da un iPad in Safari si comanda tutto senza stare davanti al portatile.
//
// La pagina servita è la STESSA della finestra Electron: cambia solo il
// trasporto (vedi src/renderer/pico-remote.js).

import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WebSocketServer } from 'ws';

export const DEFAULT_PORT = 8788;
const SESSION_COOKIE = 'pico_session';
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 5 * 60 * 1000;
/** Oltre questa coda sul socket saltiamo i frame non indispensabili. */
const BACKPRESSURE_BYTES = 2 * 1024 * 1024;

// Niente 0/O, 1/I/L: il PIN va letto da uno schermo e digitato su un iPad.
const PIN_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function generatePin(length = 6) {
  let pin = '';
  for (let i = 0; i < length; i++) {
    pin += PIN_ALPHABET[crypto.randomInt(0, PIN_ALPHABET.length)];
  }
  return pin;
}

/** Indirizzi IPv4 su cui il Mac è raggiungibile dalla rete locale. */
export function localAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Impacchetta un frame video: [4 byte lunghezza header][header JSON][payload].
 * L'header porta seriale, tipo e flag; il payload è il frame così com'è.
 */
export function encodeFrameMessage(frame) {
  const header = Buffer.from(
    JSON.stringify({
      serial: frame.serial,
      kind: frame.kind,
      pts: frame.pts ?? 0,
      config: !!frame.config,
      keyFrame: !!frame.keyFrame,
    }),
    'utf8',
  );
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(header.length, 0);
  return Buffer.concat([prefix, header, frame.data]);
}

export function decodeFrameMessage(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const headerLength = buf.readUInt32BE(0);
  const header = JSON.parse(buf.subarray(4, 4 + headerLength).toString('utf8'));
  return { ...header, data: buf.subarray(4 + headerLength) };
}

export class RemoteServer extends EventEmitter {
  /**
   * @param opts.staticRoot cartella con index.html e i moduli della UI
   * @param opts.pin PIN di accesso (se manca ne genera uno)
   * @param opts.port porta TCP
   */
  constructor({ staticRoot, sharedRoot = null, pin = null, port = DEFAULT_PORT } = {}) {
    super();
    this.staticRoot = path.resolve(staticRoot);
    // I moduli condivisi stanno fuori dalla cartella della UI, e la UI li
    // importa: senza servirli, il browser non riesce a caricare l'interfaccia
    // e il telecomando resta bianco. Sul Mac non si vedeva, perché lì i file
    // si aprono direttamente dal disco.
    this.sharedRoot = sharedRoot ? path.resolve(sharedRoot) : null;
    this.pin = pin || generatePin();
    this.port = port;
    this.http = null;
    this.wss = null;
    this.sessions = new Map(); // token -> { createdAt, ip }
    this.attempts = new Map(); // ip -> { count, until }
    this.clients = new Map(); // id -> { socket, ip, previewSerial }
    this.nextClientId = 1;
    this.running = false;
  }

  get status() {
    return {
      running: this.running,
      port: this.port,
      pin: this.pin,
      clients: this.clients.size,
      urls: localAddresses().map((ip) => `http://${ip}:${this.port}`),
    };
  }

  async start() {
    if (this.running) return this.status;

    this.http = createServer((req, res) => this.#onRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => this.#onUpgrade(req, socket, head));

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      this.http.once('error', onError);
      this.http.listen(this.port, '0.0.0.0', () => {
        this.http.removeListener('error', onError);
        // Con porta 0 la sceglie il sistema: rileggiamola per poterla mostrare.
        this.port = this.http.address().port;
        resolve();
      });
    });

    this.http.on('error', (err) => this.emit('log', { level: 'error', message: `server: ${err.message}` }));
    this.running = true;
    this.emit('status', this.status);
    return this.status;
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    for (const client of this.clients.values()) {
      try {
        client.socket.close(1001, 'server in chiusura');
      } catch {
        /* ignora */
      }
    }
    this.clients.clear();
    this.wss?.close();
    await new Promise((resolve) => this.http.close(resolve));
    this.http = null;
    this.wss = null;
    this.emit('status', this.status);
  }

  /** Cambia il PIN e butta fuori tutte le sessioni aperte. */
  setPin(pin) {
    this.pin = pin || generatePin();
    this.sessions.clear();
    for (const client of this.clients.values()) client.socket.close(4001, 'PIN cambiato');
    this.clients.clear();
    this.emit('status', this.status);
    return this.pin;
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  #ipOf(req) {
    return req.socket.remoteAddress ?? 'sconosciuto';
  }

  #locked(ip) {
    const record = this.attempts.get(ip);
    if (!record) return false;
    if (Date.now() > record.until) {
      this.attempts.delete(ip);
      return false;
    }
    return record.count >= MAX_FAILED_ATTEMPTS;
  }

  #registerFailure(ip) {
    const record = this.attempts.get(ip) ?? { count: 0, until: 0 };
    record.count++;
    record.until = Date.now() + LOCKOUT_MS;
    this.attempts.set(ip, record);
    this.emit('log', { level: 'error', message: `PIN sbagliato da ${ip} (tentativo ${record.count})` });
  }

  #createSession(ip) {
    const token = crypto.randomBytes(24).toString('base64url');
    this.sessions.set(token, { createdAt: Date.now(), ip });
    return token;
  }

  #sessionOf(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return token && this.sessions.has(token) ? token : null;
  }

  #onRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const ip = this.#ipOf(req);

    if (url.pathname === '/login' && req.method === 'POST') return this.#handleLogin(req, res, url);

    // Accesso rapido: l'indirizzo con ?k=PIN entra senza passare dal modulo.
    // La pagina si serve SUBITO, col cookie nella stessa risposta: con il
    // redirect di prima c'era un viaggio in più in cui certi browser
    // perdevano il cookie, e le risorse successive uscivano «Non autorizzato».
    const key = url.searchParams.get('k');
    if (key) {
      if (this.#locked(ip)) return this.#sendLogin(res, 'Troppi tentativi: riprova fra qualche minuto.');
      if (key.toUpperCase() !== this.pin) {
        this.#registerFailure(ip);
        return this.#sendLogin(res, 'PIN non valido.');
      }
      this.attempts.delete(ip);
      return this.#sendStatic('/index.html', res, {
        'Set-Cookie': this.#cookieDiSessione(this.#createSession(ip)),
      });
    }

    if (!this.#sessionOf(req)) {
      if (url.pathname === '/' || url.pathname === '/index.html') return this.#sendLogin(res);
      res.writeHead(401).end('Non autorizzato');
      return;
    }

    this.#sendStatic(url.pathname === '/' ? '/index.html' : url.pathname, res);
  }

  #handleLogin(req, res, url) {
    const ip = this.#ipOf(req);
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024) req.destroy();
    });
    req.on('end', () => {
      if (this.#locked(ip)) return this.#sendLogin(res, 'Troppi tentativi: riprova fra qualche minuto.');
      const pin = new URLSearchParams(body).get('pin')?.trim().toUpperCase();
      if (!pin || pin !== this.pin) {
        this.#registerFailure(ip);
        return this.#sendLogin(res, 'PIN non valido.');
      }
      this.attempts.delete(ip);
      this.#sendSessionRedirect(res, this.#createSession(ip), url.searchParams.get('next') ?? '/');
    });
  }

  /**
   * `SameSite=Lax`, non Strict: il collegamento arriva da fuori — un QR
   * inquadrato con la fotocamera, un link toccato in un'app — e per Strict
   * quelle navigazioni sono «di un altro sito», cookie non inviato, pagina
   * «Non autorizzato». Lax li ammette sulle navigazioni vere e nega il resto,
   * che per un pannello in rete locale protetto da PIN è il punto giusto.
   */
  #cookieDiSessione(token) {
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}`;
  }

  #sendSessionRedirect(res, token, location = '/') {
    res.writeHead(302, {
      'Set-Cookie': this.#cookieDiSessione(token),
      Location: location,
    });
    res.end();
  }

  #sendStatic(pathname, res, extraHeaders = {}) {
    const { filePath, root } = this.resolveStatic(pathname);
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Vietato');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404).end('Non trovato');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        ...extraHeaders,
      });
      res.end(data);
    });
  }

  /**
   * Il file su disco che corrisponde a un percorso richiesto, e la radice
   * entro cui deve restare. Esposto perché è la parte che decide cosa è
   * raggiungibile dalla rete, e va provata.
   */
  resolveStatic(pathname) {
    const pulito = path.normalize(pathname);
    if (this.sharedRoot && (pulito === '/shared' || pulito.startsWith('/shared/'))) {
      return {
        filePath: path.join(this.sharedRoot, pulito.slice('/shared'.length)),
        root: this.sharedRoot,
      };
    }
    return { filePath: path.join(this.staticRoot, pulito), root: this.staticRoot };
  }

  #sendLogin(res, error = null) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(loginPage(error));
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  #onUpgrade(req, socket, head) {
    if (!this.#sessionOf(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.#onConnection(ws, this.#ipOf(req)));
  }

  #onConnection(ws, ip) {
    const id = `remote-${this.nextClientId++}`;
    const client = { id, socket: ws, ip, previewSerial: null };
    this.clients.set(id, client);
    this.emit('log', { level: 'info', message: `telecomando collegato da ${ip} (${this.clients.size} attivi)` });
    this.emit('status', this.status);
    this.emit('client-connected', client);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // dal client arrivano solo comandi JSON
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.emit('command', client, message);
    });

    ws.on('close', () => {
      this.clients.delete(id);
      this.emit('log', { level: 'info', message: `telecomando ${ip} disconnesso` });
      this.emit('client-disconnected', client);
      this.emit('status', this.status);
    });

    ws.on('error', () => ws.terminate());
  }

  /** Manda un messaggio JSON a un client solo. */
  send(client, type, payload) {
    if (client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify({ t: type, payload }));
  }

  /** Manda un messaggio JSON a tutti i telecomandi collegati. */
  broadcast(type, payload) {
    const text = JSON.stringify({ t: type, payload });
    for (const client of this.clients.values()) {
      if (client.socket.readyState === client.socket.OPEN) client.socket.send(text);
    }
  }

  /**
   * Inoltra un frame video. Se la coda del socket si allunga (wifi lenta,
   * iPad che non tiene il passo) saltiamo i frame "delta": meglio un'immagine
   * che riparte pulita che un ritardo che cresce senza fine.
   */
  broadcastFrame(frame) {
    if (!this.clients.size) return;
    let message = null;
    for (const client of this.clients.values()) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      const congested = client.socket.bufferedAmount > BACKPRESSURE_BYTES;
      if (congested && frame.kind === 'h264' && !frame.config && !frame.keyFrame) continue;
      message ??= encodeFrameMessage(frame);
      client.socket.send(message, { binary: true });
    }
  }
}

function loginPage(error) {
  const message = error
    ? `<p class="err">${error.replace(/[<>&]/g, '')}</p>`
    : '<p class="hint">Inserisci il PIN che vedi sul Mac, in Telecomando.</p>';
  return `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Pico MultiView — accesso</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0d1014; color:#e7edf3;
         font:16px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  form { background:#161b21; border:1px solid #2a323c; border-radius:16px; padding:28px;
         width:min(360px, 90vw); text-align:center; }
  h1 { font-size:18px; margin:0 0 6px; }
  .hint, .err { font-size:13px; margin:0 0 18px; }
  .hint { color:#8b97a5; }
  .err { color:#ff5f56; }
  input { width:100%; padding:14px; font-size:26px; letter-spacing:6px; text-align:center;
          text-transform:uppercase; background:#12171d; color:#e7edf3;
          border:1px solid #2a323c; border-radius:10px; }
  button { width:100%; margin-top:14px; padding:14px; font-size:16px; font-weight:600;
           background:#4ea3ff; color:#07121f; border:none; border-radius:10px; }
</style></head>
<body>
  <form method="POST" action="/login">
    <h1>Pico MultiView</h1>
    ${message}
    <input name="pin" autocapitalize="characters" autocomplete="one-time-code"
           autocorrect="off" spellcheck="false" maxlength="6" autofocus />
    <button type="submit">Entra</button>
  </form>
</body></html>`;
}
