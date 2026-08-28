import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';

import {
  RemoteServer,
  decodeFrameMessage,
  encodeFrameMessage,
  generatePin,
  parseCookies,
} from '../src/main/server.js';

const PIN = 'ACDEF3';

function request(port, pathname, { cookie = null, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers: cookie ? { Cookie: cookie } : {} },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>interfaccia</h1>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const ciao = 1;');
  const server = new RemoteServer({ staticRoot: dir, pin: PIN, port: 0 });
  await server.start();
  try {
    await fn(server);
  } finally {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Fa il login e restituisce il cookie di sessione. */
async function login(port, pin = PIN) {
  const res = await request(port, `/?k=${pin}`);
  const setCookie = res.headers['set-cookie']?.[0];
  return { res, cookie: setCookie?.split(';')[0] ?? null };
}

function connectWs(port, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: cookie ? { Cookie: cookie } : {} });
    ws.binaryType = 'nodebuffer';
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

const nextMessage = (ws) => new Promise((resolve) => ws.once('message', (data) => resolve(data)));

// ---------------------------------------------------------------------------

test('il PIN evita i caratteri che si confondono leggendoli da uno schermo', () => {
  for (let i = 0; i < 200; i++) {
    const pin = generatePin();
    assert.equal(pin.length, 6);
    assert.doesNotMatch(pin, /[OIL01528BSZ]/, `PIN ambiguo: ${pin}`);
  }
});

test('parseCookies legge il cookie di sessione fra gli altri', () => {
  const cookies = parseCookies('altro=1; pico_session=abc.def; terzo=xyz');
  assert.equal(cookies.pico_session, 'abc.def');
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('i frame video sopravvivono al giro sul WebSocket', () => {
  const data = Buffer.from([0, 0, 0, 1, 0x65, 0xaa, 0xbb]);
  const frame = { serial: '192.168.1.51:5555', kind: 'h264', pts: 12345, config: false, keyFrame: true, data };
  const decoded = decodeFrameMessage(encodeFrameMessage(frame));
  assert.equal(decoded.serial, frame.serial);
  assert.equal(decoded.kind, 'h264');
  assert.equal(decoded.pts, 12345);
  assert.equal(decoded.keyFrame, true);
  assert.equal(decoded.config, false);
  assert.deepEqual([...decoded.data], [...data]);
});

test('senza PIN non si entra', async () => {
  await withServer(async (server) => {
    const root = await request(server.port, '/');
    assert.equal(root.status, 200);
    assert.match(root.body, /PIN/); // pagina di accesso, non l'interfaccia
    assert.doesNotMatch(root.body, /interfaccia/);

    const asset = await request(server.port, '/app.js');
    assert.equal(asset.status, 401);
  });
});

test('il PIN sbagliato non apre niente', async () => {
  await withServer(async (server) => {
    const { res, cookie } = await login(server.port, 'ZZZZZZ');
    assert.equal(res.status, 200);
    assert.equal(cookie, null);
    assert.match(res.body, /PIN non valido/);
  });
});

test('con il PIN giusto si entra e si ottiene l\'interfaccia', async () => {
  await withServer(async (server) => {
    const { res, cookie } = await login(server.port);
    assert.equal(res.status, 302);
    assert.ok(cookie, 'manca il cookie di sessione');

    const page = await request(server.port, '/', { cookie });
    assert.equal(page.status, 200);
    assert.match(page.body, /interfaccia/);

    const asset = await request(server.port, '/app.js', { cookie });
    assert.equal(asset.status, 200);
    assert.match(asset.body, /ciao/);
  });
});

test('non si può uscire dalla cartella dell\'interfaccia', async () => {
  await withServer(async (server) => {
    const { cookie } = await login(server.port);
    const res = await request(server.port, '/../../package.json', { cookie });
    assert.notEqual(res.status, 200);
  });
});

test('il WebSocket rifiuta chi non ha fatto il login', async () => {
  await withServer(async (server) => {
    await assert.rejects(() => connectWs(server.port, null), /401/);
  });
});

test('comando dal telecomando, risposta dal Mac', async () => {
  await withServer(async (server) => {
    server.on('command', (client, message) => {
      assert.equal(message.channel, 'action:home');
      assert.deepEqual(message.payload, { serials: ['a'] });
      server.send(client, 'reply', { id: message.id, ok: true, value: 'fatto' });
    });

    const { cookie } = await login(server.port);
    const ws = await connectWs(server.port, cookie);
    assert.equal(server.status.clients, 1);

    ws.send(JSON.stringify({ t: 'invoke', id: 7, channel: 'action:home', payload: { serials: ['a'] } }));
    const reply = JSON.parse((await nextMessage(ws)).toString());
    assert.equal(reply.t, 'reply');
    assert.deepEqual(reply.payload, { id: 7, ok: true, value: 'fatto' });

    ws.close();
  });
});

test('i frame arrivano al telecomando in forma binaria', async () => {
  await withServer(async (server) => {
    const { cookie } = await login(server.port);
    const ws = await connectWs(server.port, cookie);

    const payload = Buffer.from([1, 2, 3, 4, 5]);
    server.broadcastFrame({ serial: 'visore-1', kind: 'h264', pts: 99, keyFrame: true, data: payload });

    const decoded = decodeFrameMessage(await nextMessage(ws));
    assert.equal(decoded.serial, 'visore-1');
    assert.deepEqual([...decoded.data], [...payload]);

    ws.close();
  });
});

test('cambiare PIN stacca i telecomandi collegati', async () => {
  await withServer(async (server) => {
    const { cookie } = await login(server.port);
    const ws = await connectWs(server.port, cookie);
    const closed = new Promise((resolve) => ws.once('close', resolve));

    const nuovo = server.setPin('QRTUVW');
    assert.equal(nuovo, 'QRTUVW');
    await closed;
    assert.equal(server.status.clients, 0);

    // La vecchia sessione non vale più.
    const page = await request(server.port, '/', { cookie });
    assert.match(page.body, /PIN/);
    assert.doesNotMatch(page.body, /interfaccia/);
  });
});

// --- file serviti al telecomando ---
//
// La UI importa moduli che stanno fuori dalla sua cartella. Se il server non
// li serve, il browser non carica l'interfaccia e il telecomando resta bianco:
// sul Mac non si vede, perché lì i file si aprono dal disco.

test('i moduli condivisi sono raggiungibili dal telecomando', () => {
  const server = new RemoteServer({ staticRoot: '/app/renderer', sharedRoot: '/app/shared' });
  const { filePath, root } = server.resolveStatic('/shared/protocol.js');
  assert.equal(filePath, '/app/shared/protocol.js');
  assert.equal(root, '/app/shared');
  assert.ok(filePath.startsWith(root), 'sarebbe stato rifiutato');
});

test('gli altri file restano nella cartella della UI', () => {
  const server = new RemoteServer({ staticRoot: '/app/renderer', sharedRoot: '/app/shared' });
  const { filePath, root } = server.resolveStatic('/app.js');
  assert.equal(filePath, '/app/renderer/app.js');
  assert.equal(root, '/app/renderer');
});

test('non si esce dalle due radici con i puntini', () => {
  // Quello che conta non è il nome che esce, ma che resti dentro una delle due
  // radici: da lì in poi un file che non esiste è semplicemente un 404.
  const server = new RemoteServer({ staticRoot: '/app/renderer', sharedRoot: '/app/shared' });
  for (const richiesta of [
    '/../main/config.js',
    '/shared/../main/adb.js',
    '/../../etc/passwd',
    '/shared/../../main/server.js',
  ]) {
    const { filePath, root } = server.resolveStatic(richiesta);
    assert.ok(
      filePath.startsWith(`${root}/`),
      `${richiesta} è finito fuori dalla radice: ${filePath}`,
    );
  }
});

test('senza sharedRoot il comportamento resta quello di prima', () => {
  const server = new RemoteServer({ staticRoot: '/app/renderer' });
  const { root } = server.resolveStatic('/shared/protocol.js');
  assert.equal(root, '/app/renderer');
});
