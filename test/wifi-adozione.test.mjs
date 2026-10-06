import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Il giro completo di «Adotta USB» contro un adb finto: un visore che dice di
// stare su 127.0.0.1, così la bussata del Mac arriva su questa macchina.
const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-adozione-'));
const finto = path.join(cartella, 'adb');
fs.writeFileSync(
  finto,
  `#!/bin/sh
if [ "$1" = connect ]; then echo "connected to $2"; exit 0; fi
case "$4" in
  "ip -f inet addr show wlan0") echo "    inet 127.0.0.1/8 scope host wlan0" ;;
  "getprop persist.adb.tcp.port") echo "" ;;
esac
exit 0
`,
  { mode: 0o755 },
);
process.env.PICO_ADB = finto;
const { enableWifiAdb } = await import('../src/main/adb.js');

test('il visore risponde sulla wifi: passaggio riuscito', async () => {
  const server = net.createServer((s) => s.destroy()).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  const res = await enableWifiAdb('SERIALE', port);
  server.close();
  assert.equal(res.serial, `127.0.0.1:${port}`);
  assert.equal(res.persistente, false, 'la proprietà persistente non ha attecchito: non lo si promette');
});

test('il visore rifiuta sempre: si riprova, poi si dice perché', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  server.close();
  await new Promise((r) => server.once('close', r));
  await assert.rejects(enableWifiAdb('SERIALE', port), (err) => {
    assert.match(err.message, /non accetta ancora il collegamento wifi/);
    assert.doesNotMatch(err.message, /Command failed/);
    return true;
  });
});
