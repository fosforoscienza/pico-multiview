import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { avvioRiuscito, motivoAvvioFallito, playVideo } from '../src/main/apps.js';

// «Riparte dall'inizio» non è una speranza: sono tre cose fatte al visore, e
// se una manca il filmato riprende da dov'era. Qui si guarda cosa arriva
// davvero al visore.

/** Un visore finto che scrive su un file tutti i comandi che riceve. */
function visoreCheAnnota({ lettore = 'com.pvr.filemanager/.VideoActivity' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-avvio-'));
  const registro = path.join(base, 'comandi');
  fs.writeFileSync(registro, '');
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
echo "$4" >> ${registro}
case "$4" in
  *resolve-activity*) echo "${lettore}";;
esac
exit 0
`,
    { mode: 0o755 },
  );
  process.env.PICO_ADB = file;
  return {
    comandi: () => fs.readFileSync(registro, 'utf8'),
    pulisci: () => {
      delete process.env.PICO_ADB;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

test('mandare un filmato lo fa ripartire dall\'inizio', async () => {
  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/Tra Borghi e Natura.mp4');
    const comandi = visore.comandi();
    // 1. il lettore aperto viene chiuso: riaperto, riprenderebbe da dov'era.
    assert.match(comandi, /am force-stop com\.pvr\.filemanager/);
    // 2. la schermata viene rifatta da capo: senza questo, un lettore già
    //    aperto sullo stesso filmato riceve il comando dentro la schermata di
    //    prima, e riprende invece di ricominciare.
    assert.match(comandi, /--activity-clear-task/);
    // 3. e a chi la capisce si dice anche la posizione.
    assert.match(comandi, /--ei position 0/);
    // Il nome con gli spazi arriva codificato, o il lettore riceve «Tra».
    assert.match(comandi, /Tra%20Borghi%20e%20Natura\.mp4/);
  } finally {
    visore.pulisci();
  }
});

test('il file va passato quando si chiede chi aprirà il filmato', async () => {
  // Senza il file, su molti visori la domanda torna a mani vuote — e a mani
  // vuote il lettore non veniva chiuso. Era questa la ragione per cui
  // «dall'inizio» non ripartiva dall'inizio.
  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4');
    const risoluzione = visore.comandi().split('\n').find((r) => r.includes('resolve-activity'));
    assert.match(risoluzione, /-d 'file:\/\/\/sdcard\/Movies\/tour\.mp4'/);
  } finally {
    visore.pulisci();
  }
});

test('il lettore già conosciuto si chiude senza chiedere niente a nessuno', async () => {
  // Dalla seconda volta in poi sappiamo chi si è aperto davvero su questo
  // visore: è più affidabile di qualunque domanda al sistema.
  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { player: 'com.altro.lettore' });
    const comandi = visore.comandi();
    assert.match(comandi, /am force-stop com\.altro\.lettore/);
    assert.ok(!comandi.includes('resolve-activity'), 'niente domanda inutile');
  } finally {
    visore.pulisci();
  }
});

test('il selettore «apri con» non viene mai scambiato per un lettore', async () => {
  // Chiuderlo non ha senso, e chiederlo significherebbe fermare un pezzo del
  // sistema del visore.
  const visore = visoreCheAnnota({ lettore: 'android/com.android.internal.app.ResolverActivity' });
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4');
    assert.ok(!visore.comandi().includes('force-stop'), 'niente da chiudere');
  } finally {
    visore.pulisci();
  }
});

test('senza «dall\'inizio» non si chiude e non si azzera niente', async () => {
  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { fromStart: false });
    const comandi = visore.comandi();
    assert.ok(!comandi.includes('force-stop'));
    assert.ok(!comandi.includes('clear-task'));
  } finally {
    visore.pulisci();
  }
});

test('un avvio che non ha aperto niente non passa per riuscito', async () => {
  // `am` esce **sempre** con successo, anche quando scrive «Error: …». Era per
  // questo che un filmato che non partiva non produceva nessun messaggio:
  // l'app credeva di averlo avviato.
  assert.equal(avvioRiuscito('Starting: Intent { act=android.intent.action.VIEW }'), true);
  assert.equal(avvioRiuscito('Error: Activity class {org.videolan.vlc/.x} does not exist.'), false);
  assert.equal(avvioRiuscito('Error: Activity not started, unable to resolve Intent'), false);
  // Questo invece è un successo: l'app era già aperta ed è tornata davanti.
  assert.equal(
    avvioRiuscito('Warning: Activity not started, its current task has been brought to the front'),
    true,
  );
  assert.match(
    motivoAvvioFallito('Starting: …\nError: Activity class {x} does not exist.'),
    /does not exist/,
  );
});

/** Visore finto che rifiuta i flag di riavvio ma accetta il comando semplice. */
function visoreCheRifiutaIFlag() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-flag-'));
  const registro = path.join(base, 'comandi');
  fs.writeFileSync(registro, '');
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
echo "$4" >> ${registro}
case "$4" in
  *clear-task*) echo "Error: Activity not started, unable to resolve Intent";;
  *resolve-activity*) echo "com.pvr.filemanager/.VideoActivity";;
esac
exit 0
`,
    { mode: 0o755 },
  );
  process.env.PICO_ADB = file;
  return {
    comandi: () => fs.readFileSync(registro, 'utf8'),
    pulisci: () => {
      delete process.env.PICO_ADB;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

test('se il lettore rifiuta il riavvio pulito, il filmato parte lo stesso', async () => {
  // Davanti al pubblico la differenza fra «parte da metà» e «non parte» è
  // tutta. Il ripiego però va detto, non nascosto.
  const visore = visoreCheRifiutaIFlag();
  try {
    const err = await playVideo('finto:5555', '/sdcard/Movies/tour.mp4').then(
      () => null,
      (e) => e,
    );
    assert.ok(err, 'l\'esito non è un successo pieno');
    assert.equal(err.partito, true, 'ma il filmato è partito');
    assert.match(err.message, /non da capo/);
    const comandi = visore.comandi().split('\n').filter((r) => r.startsWith('am start'));
    assert.equal(comandi.length, 2, 'prima col riavvio pulito, poi senza');
    assert.ok(!comandi[1].includes('clear-task'), 'il secondo tentativo è quello semplice');
  } finally {
    visore.pulisci();
  }
});

test('VLC scelto ma non installato lo dice, e dice come tornare indietro', async () => {
  // Senza questo il comando non apriva niente in silenzio: lo schermo restava
  // fermo e il registro vuoto.
  const visore = visoreCheAnnota();
  try {
    await assert.rejects(
      () => playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { lettore: 'vlc' }),
      /VLC non è installato.*Lettore del visore/s,
    );
  } finally {
    visore.pulisci();
  }
});
