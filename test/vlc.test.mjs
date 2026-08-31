import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LETTORI, VLC, isInstalled, playVideo, seekTo, vlcStartCommand } from '../src/main/apps.js';

// Con VLC le due cose che il lettore del visore non sa fare — dire dov'è e
// partire da un punto — stanno dentro il comando di avvio. Qui si controlla
// che quel comando sia quello giusto.

test('VLC riceve il filmato e l\'ordine di partire dall\'inizio', () => {
  const cmd = vlcStartCommand('/sdcard/Movies/Tra Borghi e Natura.mp4');
  assert.ok(cmd.includes(`-n ${VLC.activity}`), 'intent esplicito: si apre VLC, non il selettore');
  assert.match(cmd, /--ez from_start true/);
  assert.match(cmd, /--el position 0/);
  // Il nome con gli spazi resta codificato anche qui.
  assert.match(cmd, /Tra%20Borghi%20e%20Natura\.mp4/);
});

test('un salto con VLC è un punto, non un inseguimento', () => {
  // Col lettore del visore il salto si insegue a colpi di avanti e indietro,
  // e si arriva «lì attorno». Qui il punto è quello, uguale su ogni visore.
  const cmd = vlcStartCommand('/sdcard/Movies/tour.mp4', { positionMs: 90000 });
  assert.match(cmd, /--el position 90000/);
  assert.match(cmd, /--ez from_start false/, 'senza questo VLC ripartirebbe da zero');
});

test('una posizione negativa non finisce nel comando', () => {
  assert.match(vlcStartCommand('/sdcard/a.mp4', { positionMs: -5000 }), /--el position 0/);
});

test('i lettori offerti sono quelli che l\'app sa comandare', () => {
  assert.deepEqual(Object.keys(LETTORI), ['sistema', 'vlc']);
  assert.equal(LETTORI.vlc.package, 'org.videolan.vlc');
});

/** Un visore finto che annota i comandi e sa dire quali pacchetti ha. */
function visoreFinto({ pacchetti = '' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-vlc-'));
  const registro = path.join(base, 'comandi');
  fs.writeFileSync(registro, '');
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
echo "$4" >> ${registro}
case "$4" in
  "pm list packages"*) printf '${pacchetti}';;
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

test('scegliendo VLC non si chiude più niente sul visore', async () => {
  // Col lettore di sistema bisogna chiuderlo prima, per non farlo riprendere
  // da dov'era. Con VLC la posizione sta nel comando: chiudere non serve, e
  // non chiudere significa partire prima.
  const visore = visoreFinto();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4', { lettore: 'vlc' });
    const comandi = visore.comandi();
    assert.ok(!comandi.includes('force-stop'), 'niente da chiudere');
    assert.ok(!comandi.includes('resolve-activity'), 'niente da chiedere');
    assert.match(comandi, /org\.videolan\.vlc/);
  } finally {
    visore.pulisci();
  }
});

test('il salto con VLC riapre il filmato al punto, e non tocca i tasti', async () => {
  const visore = visoreFinto();
  try {
    await seekTo('finto:5555', 45000, { lettore: 'vlc', percorso: '/sdcard/Movies/tour.mp4' });
    const comandi = visore.comandi();
    assert.match(comandi, /--el position 45000/);
    assert.ok(!comandi.includes('input keyevent'), 'nessun colpo di avanti/indietro');
  } finally {
    visore.pulisci();
  }
});

test('si riconosce dove VLC c\'è e dove manca', async () => {
  // Sceglierlo dove manca vorrebbe dire un comando che non apre niente, e un
  // pubblico davanti a uno schermo fermo.
  const conVlc = visoreFinto({ pacchetti: 'package:org.videolan.vlc\\n' });
  try {
    assert.equal(await isInstalled('finto:5555', VLC.package), true);
  } finally {
    conVlc.pulisci();
  }
  const senzaVlc = visoreFinto({ pacchetti: 'package:org.videolan.vlc.debug\\n' });
  try {
    // Un pacchetto che *comincia* con lo stesso nome non è lo stesso pacchetto.
    assert.equal(await isInstalled('finto:5555', VLC.package), false);
  } finally {
    senzaVlc.pulisci();
  }
});
