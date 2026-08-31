import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROFILI_LETTORE,
  colpiPerSalto,
  profiloLettore,
  riconosciLettore,
  parseDurata,
  parsePlaybackState,
  parseResolvedActivity,
  parseUptimeMs,
  posizioneOra,
} from '../src/main/apps.js';

// Sapere a che punto è un filmato, da fuori, si può solo leggendo la sessione
// multimediale che il lettore pubblica. Qui si prova il parlato del visore.

/** Il dump come lo scrive un Pico con il suo lettore aperto. */
const DUMP = `Sessions Stack - have 2 sessions:
  com.pvr.filemanager/VideoPlayerSession (userId=0)
    ownerPid=4821, ownerUid=10087, userId=0
    package=com.pvr.filemanager
    launchIntent=null
    active=true
    flags=3
    metadata: size=4, description=Tra Borghi e Natura.mp4, null, null
    state=PlaybackState {state=3, position=126000, buffered position=0, speed=1.0, updated=845213, actions=823, custom actions=[], active item id=-1, error=null}
    audioAttrs=null
    volumeType=1, controlType=2, max=0, current=0
  com.android.bluetooth/AvrcpSession (userId=0)
    package=com.android.bluetooth
    state=PlaybackState {state=0, position=0, buffered position=0, speed=0.0, updated=12, actions=0}
---orologio---
846.71 3210.55
`;

test('si legge il lettore che sta suonando, non gli altri', () => {
  // Sul visore restano aperte sessioni ferme — il bluetooth, un'app in
  // sottofondo — e prendere la prima che capita significherebbe mostrare
  // all'operatore la posizione di qualcos'altro.
  const stato = parsePlaybackState(DUMP);
  assert.equal(stato.package, 'com.pvr.filemanager');
  assert.equal(stato.state, 'in riproduzione');
  assert.equal(stato.positionMs, 126000);
  assert.equal(stato.updatedMs, 845213);
  assert.equal(stato.speed, 1);
});

test('un lettore che non pubblica niente si riconosce', () => {
  // È un esito, non un guasto: vuol dire che quel lettore non si lascia
  // seguire, e l'operatore deve saperlo invece di vedere una barra ferma a zero.
  assert.equal(parsePlaybackState('Sessions Stack - have 0 sessions:'), null);
  assert.equal(parsePlaybackState(''), null);
  assert.equal(parsePlaybackState(null), null);
});

test('la posizione viene portata all\'istante di adesso', () => {
  // dumpsys fotografa il filmato a un istante dell'orologio interno del visore.
  // Fra quello e la risposta passa qualche decimo: senza rimettere in pari, la
  // barra andrebbe sempre a scatti all'indietro.
  const stato = parsePlaybackState(DUMP);
  const uptime = parseUptimeMs(DUMP);
  assert.equal(uptime, 846710);
  assert.equal(posizioneOra(stato, uptime), 126000 + (846710 - 845213));
});

test('da fermo la posizione è quella scritta, senza aggiunte', () => {
  const fermo = { state: 'in pausa', positionMs: 60000, updatedMs: 1000, speed: 1 };
  assert.equal(posizioneOra(fermo, 999999), 60000);
  assert.equal(posizioneOra(null, 999999), null);
});

test('a velocità doppia il conto raddoppia', () => {
  const veloce = { state: 'in riproduzione', positionMs: 10000, updatedMs: 1000, speed: 2 };
  assert.equal(posizioneOra(veloce, 3000), 10000 + 2000 * 2);
});

test('la durata si legge dall\'indice del visore', () => {
  assert.equal(parseDurata('Row: 0 duration=754000'), 754000);
  // Un file appena copiato può non essere ancora indicizzato: meglio nessuna
  // durata che una durata inventata.
  assert.equal(parseDurata('No result found.'), null);
});

test('il lettore predefinito si ricava dalla risposta del visore', () => {
  const out = `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
com.pvr.filemanager/.VideoPlayerActivity`;
  assert.deepEqual(parseResolvedActivity(out), {
    package: 'com.pvr.filemanager',
    activity: 'com.pvr.filemanager/.VideoPlayerActivity',
  });
  assert.equal(parseResolvedActivity('No activity found'), null);
});

test('i colpi di salto si contano sul passo misurato, non su uno indovinato', () => {
  // Ogni lettore salta di quanto gli pare: dieci secondi, quindici, trenta.
  assert.equal(colpiPerSalto(60000, 10000), 6);
  assert.equal(colpiPerSalto(-45000, 15000), -3);
  // Un passo mai misurato non autorizza nessun colpo.
  assert.equal(colpiPerSalto(60000, 0), 0);
  // E non si resta a martellare tasti per un salto di un'ora.
  assert.equal(colpiPerSalto(3600000, 10000), 40);
});

test('il lettore da chiudere non è mai la schermata iniziale', () => {
  // Ricordarsi la home come «lettore» vorrebbe dire chiuderla al prossimo
  // avvio: succede proprio quando il filmato non è partito, cioè quando meno
  // ci si può permettere di peggiorare le cose.
  assert.equal(riconosciLettore('com.pvr.shortcut', 'com.pvr.shortcut'), null);
  assert.equal(riconosciLettore('android', 'com.pvr.shortcut'), null, 'né il selettore «apri con»');
  assert.equal(riconosciLettore(null, 'com.pvr.shortcut'), null);
  assert.equal(riconosciLettore('com.pvr.filemanager', 'com.pvr.shortcut'), 'com.pvr.filemanager');
});

test('ogni modo di comandare il lettore ha i suoi tasti, anche per il salto', () => {
  // I tasti «media» sono gli unici standard e su molti visori non fanno
  // niente: Android li consegna alla sessione multimediale, e un lettore che
  // non ne apre una non li riceve mai. Con il pad si comanda come col
  // telecomando in mano — ed è così che lo usa chi ha il visore in testa.
  for (const [nome, profilo] of Object.entries(PROFILI_LETTORE)) {
    assert.ok(profilo.etichetta, `${nome} deve avere un nome leggibile`);
    // Chi parla via annuncio (il lettore PICO) non ha tasti di play/pausa:
    // per lui bastano le frecce del salto.
    const tasti = profilo.broadcast ? ['avanti', 'indietro'] : ['play', 'pause', 'avanti', 'indietro'];
    for (const tasto of tasti) {
      assert.equal(typeof profilo[tasto], 'number', `${nome}: manca ${tasto}`);
    }
  }
  // Col pad, avanti e indietro sono le frecce: i tasti media non arriverebbero.
  assert.equal(PROFILI_LETTORE.ok.avanti, 22);
  assert.equal(PROFILI_LETTORE.media.avanti, 90);
  // Un profilo sconosciuto non deve far saltare niente: si torna allo standard.
  assert.equal(profiloLettore('inventato'), PROFILI_LETTORE.media);
});

test('il profilo del lettore PICO manda l\'annuncio, non un tasto', async () => {
  // Il lettore PICO non apre una sessione multimediale: i tasti media non lo
  // raggiungono mai, ed era il motivo per cui «pausa» non faceva niente.
  // Il canale suo — documentato da PICO per G2 4K e Neo — è un annuncio con
  // l'operazione scritta per esteso: play e pausa espliciti, mai interruttore.
  const { default: fs } = await import('node:fs');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-broadcast-'));
  const registro = path.join(base, 'comandi');
  fs.writeFileSync(registro, '');
  fs.writeFileSync(path.join(base, 'adb'), `#!/bin/sh\necho "$4" >> ${registro}\nexit 0\n`, { mode: 0o755 });
  process.env.PICO_ADB = path.join(base, 'adb');
  try {
    const { mediaKey } = await import('../src/main/apps.js');
    await mediaKey('finto:5555', 'pause', 'pico');
    await mediaKey('finto:5555', 'play', 'pico');
    const comandi = fs.readFileSync(registro, 'utf8');
    assert.match(comandi, /am broadcast -a com\.picovr\.wing\.player\.PLAY_CONTROL/);
    assert.match(comandi, /--es operation pause/);
    assert.match(comandi, /--es operation play/);
    assert.ok(!comandi.includes('input keyevent'), 'nessun tasto: non arriverebbe');
  } finally {
    delete process.env.PICO_ADB;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
