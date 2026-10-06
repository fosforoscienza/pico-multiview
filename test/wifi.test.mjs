import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// «Mi dà questo errore, se tolgo il cavo si scollega»: Adotta USB diceva
// «adb connect … fallito: Command failed: …/adb connect 192.168.1.26:5555» —
// il comando ripetuto, nessun motivo — e subito dopo «puoi staccare il cavo».
// Questi test tengono il motivo nel messaggio.

// Un adb finto, impostato prima che adb.js cerchi quello vero.
const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-finto-'));
const finto = path.join(cartella, 'adb');
fs.writeFileSync(
  finto,
  `#!/bin/sh
case "$1" in
  connect) echo "failed to connect to '$2': No route to host"; exit 1 ;;
  lento) sleep 3 ;;
esac
`,
  { mode: 0o755 },
);
process.env.PICO_ADB = finto;
const { adb, bussaPorta, connect, diagnosiScansione, diagnosiWifi } = await import('../src/main/adb.js');

test('l\'errore di adb porta il motivo scritto su stdout, non «Command failed»', async () => {
  await assert.rejects(adb(['connect', '192.168.1.26:5555']), (err) => {
    assert.match(err.message, /No route to host/);
    assert.doesNotMatch(err.message, /Command failed/);
    return true;
  });
  const res = await connect('192.168.1.26', 5555);
  assert.equal(res.ok, false);
  assert.match(res.message, /No route to host/);
});

test('un adb interrotto per tempo scaduto lo dice', async () => {
  await assert.rejects(adb(['lento'], { timeout: 300 }), (err) => {
    assert.equal(err.scaduto, true);
    assert.match(err.message, /nessuna risposta in/);
    return true;
  });
});

test('bussaPorta distingue porta aperta e porta che rifiuta', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  assert.equal((await bussaPorta('127.0.0.1', port, 1000)).esito, 'aperta');
  server.close();
  await new Promise((r) => server.once('close', r));
  const chiusa = await bussaPorta('127.0.0.1', port, 1000);
  assert.equal(chiusa.esito, 'rifiutata');
  assert.equal(chiusa.codice, 'ECONNREFUSED');
});

const reti = ['192.168.1'];

test('Mac e visore su reti diverse: lo si dice con gli indirizzi', () => {
  const d = diagnosiWifi({ ip: '192.168.1.26', esito: 'nessuna-risposta', retiMac: ['192.168.0', '10.0.0'] });
  assert.match(d, /reti diverse/);
  assert.match(d, /192\.168\.1\.26/);
  assert.match(d, /192\.168\.0\.x/);
});

test('irraggiungibile sulla stessa rete: è il permesso «Rete locale» di macOS', () => {
  const d = diagnosiWifi({ ip: '192.168.1.26', esito: 'irraggiungibile', codice: 'EHOSTUNREACH', retiMac: reti });
  assert.match(d, /Privacy e sicurezza → Rete locale/);
  assert.match(d, /EHOSTUNREACH/);
});

test('nessuna risposta sulla stessa rete: router che isola i dispositivi', () => {
  const d = diagnosiWifi({ ip: '192.168.1.26', esito: 'nessuna-risposta', retiMac: reti });
  assert.match(d, /isolamento client/);
  assert.match(d, /Rete locale/, 'e il permesso, come seconda cosa da guardare');
});

test('porta che rifiuta: il visore c\'è, va solo riprovato', () => {
  assert.match(diagnosiWifi({ ip: '192.168.1.26', esito: 'rifiutata', retiMac: reti }), /riprova/);
});

test('Mac senza rete', () => {
  assert.match(diagnosiWifi({ ip: '192.168.1.26', esito: 'nessuna-risposta', retiMac: [] }), /nessuna rete/);
});

test('scansione: quasi tutto «irraggiungibile» è il permesso, non la rete', () => {
  assert.match(
    diagnosiScansione({ conteggi: { irraggiungibile: 254 }, probed: 254, retiMac: reti }),
    /Rete locale/,
  );
  assert.equal(
    diagnosiScansione({ conteggi: { 'nessuna-risposta': 250, irraggiungibile: 4 }, probed: 254, retiMac: reti }),
    null,
    'una rete normale, dove quasi nessuno risponde, non è un divieto',
  );
});
