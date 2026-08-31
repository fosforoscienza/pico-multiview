import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VIDEO_MODES, avvioRiuscito, motivoAvvioFallito, picoStartCommand, playVideo } from '../src/main/apps.js';

// «Riparte dall'inizio» non è una speranza: sono tre cose fatte al visore, e
// se una manca il filmato riprende da dov'era. Qui si guarda cosa arriva
// davvero al visore.

/** Un visore finto che scrive su un file tutti i comandi che riceve. */
function visoreCheAnnota({
  lettore = 'com.pvr.filemanager/.VideoActivity',
  gestori = 'com.pvr.filemanager/.VideoActivity com.pvr.gallery/.Player',
} = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-avvio-'));
  const registro = path.join(base, 'comandi');
  fs.writeFileSync(registro, '');
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
echo "$4" >> ${registro}
case "$4" in
  "pm clear"*) echo "Success";;
  *category.HOME*) echo "com.pvr.shortcut/.Home";;
  *query-activities*) for g in ${gestori}; do echo "$g"; done;;
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

test('per ripartire dall\'inizio si chiude il lettore, non si complica il comando', async () => {
  // Chiudere il lettore è il mezzo che non tocca l'avvio: il comando che parte
  // resta quello semplice, cioè quello che ha sempre funzionato. I flag che
  // rifanno la schermata restano disponibili, ma solo come ripiego — provarli
  // per primi aveva smesso di far partire i filmati.
  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/Tra Borghi e Natura.mp4');
    const comandi = visore.comandi();
    // Si chiudono TUTTE le app di riproduzione, non una indovinata: chi apre
    // il filmato e chi lo riproduce possono essere app diverse, e quella viva
    // si terrebbe il suo «riprendi da dove eri».
    assert.match(comandi, /am force-stop com\.pvr\.filemanager/, 'il lettore va chiuso');
    assert.match(comandi, /am force-stop com\.pvr\.gallery/, 'e ogni altra app che riproduce video');
    assert.ok(!comandi.includes('force-stop com.pvr.shortcut'), 'ma mai la schermata iniziale');
    const avvio = comandi.split('\n').find((r) => r.startsWith('am start'));
    assert.ok(!avvio.includes('clear-task'), 'il primo tentativo è quello nudo');
    // Il nome con gli spazi arriva codificato, o il lettore riceve «Tra».
    assert.match(avvio, /Tra%20Borghi%20e%20Natura\.mp4/);
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

test('il lettore già visto in azione si chiude anche se il sistema non lo nomina', async () => {
  // Dalla seconda volta in poi sappiamo chi si è aperto davvero su questo
  // visore: va chiuso anche lui, in aggiunta a quelli che il sistema elenca —
  // è proprio quello che si terrebbe il «riprendi da dove eri».
  const visore = visoreCheAnnota({ gestori: 'com.pvr.filemanager/.VideoActivity' });
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { player: 'com.altro.lettore' });
    const comandi = visore.comandi();
    assert.match(comandi, /am force-stop com\.altro\.lettore/);
    assert.match(comandi, /am force-stop com\.pvr\.filemanager/);
  } finally {
    visore.pulisci();
  }
});

test('il selettore «apri con» non viene mai chiuso, nemmeno quando è l\'unico nome', async () => {
  // Chiuderlo non ha senso, e chiederlo significherebbe fermare un pezzo del
  // sistema del visore.
  const visore = visoreCheAnnota({
    lettore: 'android/com.android.internal.app.ResolverActivity',
    gestori: '',
  });
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

test('un lettore che rifiuta i flag non impedisce più l\'avvio', async () => {
  // Era il guasto: i flag venivano per primi, il lettore li rifiutava, e non
  // partiva niente. Ora il filmato parte al primo colpo e quei flag non
  // entrano nemmeno in scena.
  const visore = visoreCheRifiutaIFlag();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4');
    const comandi = visore.comandi().split('\n').filter((r) => r.startsWith('am start'));
    assert.equal(comandi.length, 1, 'un solo tentativo: quello semplice è bastato');
    assert.ok(!comandi[0].includes('clear-task'));
  } finally {
    visore.pulisci();
  }
});


test('la memoria del lettore viene azzerata, ed è quello il colpo decisivo', async () => {
  // Il «riprendi da dove eri» sta su disco: chiudere il lettore non lo tocca —
  // anzi lo congela, perché l\'app non salva più niente e riparte per sempre
  // dallo stesso punto. Era esattamente il sintomo: «da un punto sempre
  // uguale». pm clear lo cancella, e il lettore riparte come appena
  // installato.
  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { player: 'com.picovr.wing.videoplayer' });
    const comandi = visore.comandi();
    assert.match(comandi, /pm clear com\.picovr\.wing\.videoplayer/, 'il lettore visto in azione');
    assert.match(comandi, /pm clear com\.pvr\.filemanager/, 'e quello a cui il visore affiderebbe il filmato');
    assert.ok(!comandi.includes('pm clear com.pvr.shortcut'), 'mai la schermata iniziale');
    assert.ok(!comandi.includes('pm clear com.pvr.gallery'), 'e non ogni app che sa aprire video: solo chi riproduce');
  } finally {
    visore.pulisci();
  }
});

test('senza «dall\'inizio» la memoria dei lettori non si tocca', async () => {
  // Spegnere la spunta deve riportare all\'avvio più innocuo possibile.
  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { fromStart: false });
    assert.ok(!visore.comandi().includes('pm clear'));
  } finally {
    visore.pulisci();
  }
});

test('con la modalità scelta si parla direttamente al lettore PICO', async () => {
  // È la differenza fra un 360 che parte da 360 e uno che parte «al cinema»
  // su uno schermo piatto e si corregge dopo. Action ed extra vengono dal
  // codice pubblicato da PICO, non da tentativi: videoType 3 è «3D 360
  // sopra-sotto», e viaggia come stringa perché così lo passa PICO.
  const cmd = picoStartCommand('/sdcard/Movies/Tra Borghi e Natura.mp4', {
    videoType: VIDEO_MODES.deg360tb.code,
  });
  assert.match(cmd, /-a picovr\.intent\.action\.player/);
  assert.match(cmd, /--es videoType 3/);
  assert.match(cmd, /--es uri 'file:\/\/\/sdcard\/Movies\/Tra%20Borghi%20e%20Natura\.mp4'/);

  const visore = visoreCheAnnota();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { videoType: 3 });
    const avvii = visore.comandi().split('\n').filter((r) => r.startsWith('am start'));
    assert.match(avvii[0], /picovr\.intent\.action\.player/, 'il lancio PICO viene per primo');
    assert.equal(avvii.length, 1, 'e se apre, basta lui');
  } finally {
    visore.pulisci();
  }
});

test('un visore che non capisce la chiamata PICO scala sui tentativi soliti', async () => {
  const visore = visoreCheAnnota();
  try {
    // Il finto risponde con un errore alla chiamata PICO: come farebbe un
    // visore d\'altra marca.
    fs.appendFileSync(process.env.PICO_ADB, '');
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { videoType: null });
    const avvii = visore.comandi().split('\n').filter((r) => r.startsWith('am start'));
    assert.ok(!avvii[0].includes('picovr.intent.action.player'), 'senza modalità scelta niente chiamata PICO');
  } finally {
    visore.pulisci();
  }
});
