import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { attachVideoStream } from '../src/main/scrcpy-session.js';

// Il difetto che questo test sorveglia: dopo l'handshake il socket video resta
// in pausa, e attaccargli un listener 'data' non lo rimette in moto. La
// sessione risultava avviata — dummy byte ricevuto, "in streaming" nella
// finestra — e nell'anteprima restava per sempre "In attesa dell'immagine…".
//
// Si prova con un socket vero, non finto: è proprio il comportamento di Node
// sugli stream in pausa a essere in gioco, e un finto lo mancherebbe.

/** Server che manda il dummy byte e poi finge lo stream video. */
async function serverFinto() {
  const server = net.createServer((sock) => {
    sock.write(Buffer.from([0x00]));
    const timer = setInterval(() => sock.write(Buffer.alloc(64, 7)), 10);
    sock.on('close', () => clearInterval(timer));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

/** Riproduce l'handshake: connette e mette in pausa al primo byte. */
async function socketDopoHandshake(server) {
  const socket = net.connect({ host: '127.0.0.1', port: server.address().port });
  await new Promise((r) => socket.once('connect', r));
  await new Promise((r) => socket.once('data', () => { socket.pause(); r(); }));
  return socket;
}

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

test('il flusso video riparte dopo la pausa dell\'handshake', async () => {
  const server = await serverFinto();
  const socket = await socketDopoHandshake(server);
  try {
    let ricevuti = 0;
    attachVideoStream(socket, (chunk) => { ricevuti += chunk.length; });
    await attesa(150);
    assert.ok(ricevuti > 0, 'nessun byte dopo l\'handshake: il socket è rimasto in pausa');
  } finally {
    socket.destroy();
    server.close();
  }
});

test('il solo listener, senza risveglio, non basta', async () => {
  // Questa è la forma sbagliata, tenuta qui per fissare il motivo della riga
  // di correzione: se un domani Node cambiasse comportamento, questo test lo
  // direbbe invece di lasciarci il dubbio.
  const server = await serverFinto();
  const socket = await socketDopoHandshake(server);
  try {
    let ricevuti = 0;
    socket.on('data', (chunk) => { ricevuti += chunk.length; });
    await attesa(150);
    assert.equal(ricevuti, 0, 'uno stream in pausa non dovrebbe consegnare niente');
  } finally {
    socket.destroy();
    server.close();
  }
});
