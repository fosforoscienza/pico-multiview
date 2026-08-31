import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { connect, isPortOpen } from '../src/main/adb.js';
import {
  DeviceManager,
  attesaRiprova,
  daRiconnettere,
  diagnosiCollegamento,
} from '../src/main/device-manager.js';

// Un visore attaccato al cavo non compariva in elenco finché c'erano indirizzi
// salvati che non rispondevano. Qui si sorveglia il perché, pezzo per pezzo.

/** Un finto adb: risponde come quello vero nei modi in cui sa fallire. */
function adbFinto() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-adb-'));
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
case "$FINTO_ESITO" in
  successo) echo "connected to 10.0.0.9:5555"; exit 0;;
  rifiutato) echo "failed to connect to 10.0.0.9:5555"; exit 1;;
  muto) echo "failed to connect to '10.0.0.9:5555': Operation timed out" >&2; exit 1;;
  bugiardo) echo "failed to connect to 10.0.0.9:5555"; exit 0;;
esac
`,
    { mode: 0o755 },
  );
  process.env.PICO_ADB = file;
  return () => fs.rmSync(base, { recursive: true, force: true });
}

test('un indirizzo che non risponde non fa saltare il giro di aggiornamento', async () => {
  // Il difetto sorvegliato: adb usciva con errore, connect() lanciava, e
  // l'eccezione interrompeva sync() **prima** che i visori già visti da adb —
  // quelli al cavo — venissero messi in elenco. Il registro mostrava solo
  // "Command failed", e l'operatore un elenco vuoto con il cavo in mano.
  const pulisci = adbFinto();
  try {
    for (const esito of ['rifiutato', 'muto', 'bugiardo']) {
      process.env.FINTO_ESITO = esito;
      const res = await connect('10.0.0.9', 5555);
      assert.equal(res.ok, false, `${esito}: deve fallire, non lanciare`);
      assert.ok(res.message, `${esito}: il motivo va riportato`);
    }
    process.env.FINTO_ESITO = 'successo';
    assert.equal((await connect('10.0.0.9', 5555)).ok, true);
  } finally {
    delete process.env.FINTO_ESITO;
    delete process.env.PICO_ADB;
    pulisci();
  }
});

test('la porta si prova senza scomodare adb', async () => {
  // È la scorciatoia che rende immediato l'aggiornamento: "adb connect" verso
  // un indirizzo morto costa fino a otto secondi, questa prova una frazione.
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.equal(await isPortOpen('127.0.0.1', port, 1000), true);
  } finally {
    server.close();
  }
  const inizio = Date.now();
  assert.equal(await isPortOpen('127.0.0.1', port, 600), false, 'porta chiusa');
  assert.ok(Date.now() - inizio < 3000, 'e lo deve scoprire in fretta');
});

test('si ribussa agli indirizzi salvati, non a quelli già collegati', () => {
  const salvati = [{ serial: '192.168.1.58:5555' }, { serial: '192.168.1.59:5555' }, { serial: 'PA7B10' }];
  const piano = daRiconnettere({ salvati, online: new Set(['192.168.1.59:5555']) });
  // Il seriale del cavo non è un indirizzo: non c'è niente a cui bussare.
  assert.deepEqual(piano, ['192.168.1.58:5555']);
});

test('un indirizzo muto non viene ritentato a ogni aggiornamento', () => {
  // Ritentarlo ogni volta significava pagarne l'attesa ogni volta, ed era la
  // ragione per cui l'app sembrava ferma.
  const salvati = [{ serial: '192.168.1.58:5555' }];
  const irraggiungibili = new Map([['192.168.1.58:5555', { tentativi: 1, prossimo: 1000 }]]);
  assert.deepEqual(daRiconnettere({ salvati, irraggiungibili, now: 999 }), [], 'non ancora');
  assert.deepEqual(
    daRiconnettere({ salvati, irraggiungibili, now: 1000 }),
    ['192.168.1.58:5555'],
    'ma quando scade sì: il visore può essere tornato acceso',
  );
});

test('le attese crescono ma non oltre il tetto', () => {
  assert.ok(attesaRiprova(1) < attesaRiprova(2), 'la seconda attesa è più lunga della prima');
  assert.equal(attesaRiprova(1), 30000);
  assert.equal(attesaRiprova(99), 300000, 'cinque minuti al massimo: un visore riacceso va ritrovato');
});

test('un cavo attaccato ma inutile ora lo dice', () => {
  // Prima non produceva nessuna riga nel registro: l'operatore vedeva un
  // elenco vuoto senza sapere che il visore era lì e cosa mancasse.
  const avvisi = diagnosiCollegamento([
    { serial: 'PA7B10', state: 'unauthorized' },
    { serial: 'PA7B11', state: 'offline' },
    { serial: 'PA7B12', state: 'device' },
  ]);
  assert.equal(avvisi.length, 2, 'il visore pronto non ha niente da spiegare');
  assert.match(avvisi[0].message, /Consenti debug USB/);
  assert.match(avvisi[1].message, /riattacca il cavo/);
});

/** Un adb finto completo: un visore al cavo, e la rete che non risponde. */
function adbConCavo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-adb-'));
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
case "$1" in
  devices) printf 'List of devices attached\\nPA7B10\\tdevice product:A8150 model:Pico_A8150\\n';;
  connect) echo "failed to connect to $2"; exit 1;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  process.env.PICO_ADB = file;
  return () => {
    delete process.env.PICO_ADB;
    fs.rmSync(base, { recursive: true, force: true });
  };
}

/** Configurazione ridotta all'osso: due visori salvati su una rete che non c'è. */
function configFinta() {
  return {
    data: {
      autoConnect: true,
      devices: [{ serial: '192.168.1.58:5555' }, { serial: '172.20.10.3:5555' }],
    },
    deviceEntry: () => ({}),
    upsertDevice: () => {},
    removeDevice: () => {},
  };
}

test('il visore al cavo entra in elenco anche con indirizzi salvati morti', async () => {
  // Il guasto raccontato dal registro: due indirizzi salvati su una rete
  // abbandonata, e nessuna postazione — né via wifi né via cavo. I tentativi
  // verso la rete venivano prima, uno alla volta, e il primo che falliva con
  // un errore interrompeva tutto il giro.
  const pulisci = adbConCavo();
  try {
    const manager = new DeviceManager(configFinta());
    const messi = [];
    manager.add = (serial) => messi.push(serial); // niente sessioni vere in un test
    const inizio = Date.now();
    const { online } = await manager.sync();
    assert.deepEqual(messi, ['PA7B10'], 'il visore del cavo deve arrivare in elenco');
    assert.deepEqual(online, ['PA7B10']);
    // I due indirizzi morti vengono provati insieme e senza scomodare adb:
    // in fila, con "adb connect", erano una quindicina di secondi.
    assert.ok(Date.now() - inizio < 8000, 'e senza far aspettare l\'operatore');
  } finally {
    pulisci();
  }
});

test('il secondo aggiornamento non ripaga l\'attesa degli indirizzi morti', async () => {
  const pulisci = adbConCavo();
  try {
    const manager = new DeviceManager(configFinta());
    manager.add = () => {};
    const avvisi = [];
    manager.on('log', (l) => avvisi.push(l));
    await manager.sync();
    await manager.sync();
    // Due indirizzi, due spiegazioni: alla seconda passata non si ritenta e
    // non si ripete niente.
    assert.equal(avvisi.filter((a) => /non risponde/.test(a.message)).length, 2);
    assert.equal(manager.unreachable.get('192.168.1.58:5555').tentativi, 1, 'non ritentato subito');
  } finally {
    pulisci();
  }
});

test('cambiando rete si riprova subito, senza aspettare il tetto', async () => {
  const pulisci = adbConCavo();
  try {
    const manager = new DeviceManager(configFinta());
    manager.add = () => {};
    await manager.sync();
    assert.ok(manager.unreachable.size, 'le attese si accumulano');
    // Le reti locali dell'ultimo giro non sono più quelle: gli indirizzi
    // salvati vanno riprovati adesso, non fra cinque minuti.
    manager.reti = 'una.rete.diversa';
    await manager.sync();
    assert.equal(manager.unreachable.get('192.168.1.58:5555').tentativi, 1, 'contatore azzerato e riprovato');
  } finally {
    pulisci();
  }
});
