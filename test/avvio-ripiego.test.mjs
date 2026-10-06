import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { playVideo } from '../src/main/apps.js';

// Il difetto che questi test sorvegliano: l'avvio del filmato — la cosa che
// funzionava — era stato fatto dipendere da aggiunte pensate per farlo
// ripartire dall'inizio. Quando quelle non piacevano al lettore, non partiva
// niente. Ora il comando che ha sempre funzionato viene per primo, e ogni
// tentativo viene verificato guardando se il visore ha aperto qualcosa.

/**
 * Un visore finto che apre il filmato solo con certi comandi.
 *
 * `apreCon` è l'elenco dei pezzi di comando che questo visore accetta: tutto
 * il resto lo lascia sulla home, esattamente come fa un lettore che rifiuta un
 * flag senza dirlo.
 */
function visore({ apreCon = ['am start -a'], home = 'com.pvr.shortcut', lettore = 'com.pvr.filemanager/.VideoActivity' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-ripiego-'));
  const registro = path.join(base, 'comandi');
  const stato = path.join(base, 'foreground');
  fs.writeFileSync(registro, '');
  fs.writeFileSync(stato, home);
  const condizioni = apreCon
    .map((frammento) => `  *"${frammento}"*) echo '${lettore.split('/')[0]}' > ${stato};;`)
    .join('\n');
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
echo "$4" >> ${registro}
case "$4" in
  *resolve-activity*HOME*) echo "${home}/.Home"; exit 0;;
  *resolve-activity*) echo "${lettore}"; exit 0;;
  *dumpsys\\ activity*) printf '  mResumedActivity: ActivityRecord{1 u0 %s/.Main t1}\\n' "$(cat ${stato})"; exit 0;;
esac
case "$4" in
${condizioni}
esac
exit 0
`,
    { mode: 0o755 },
  );
  process.env.PICO_ADB = file;
  return {
    comandi: () => fs.readFileSync(registro, 'utf8').split('\n').filter((r) => r.startsWith('am start')),
    pulisci: () => {
      delete process.env.PICO_ADB;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

test('il comando che ha sempre funzionato viene provato per primo', async () => {
  const v = visore();
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4');
    const comandi = v.comandi();
    assert.equal(comandi.length, 1, 'uno solo: il primo è bastato');
    assert.ok(!comandi[0].includes('clear-task'), 'niente flag al primo colpo');
    assert.ok(!comandi[0].includes(' -n '), 'e niente lettore imposto');
  } finally {
    v.pulisci();
  }
});

test('se il comando semplice non apre niente, si nomina il lettore', async () => {
  // È il caso che si presenta proprio dopo aver chiuso il lettore: un'app
  // appena fermata può restare fuori dalla scelta automatica di Android, e
  // l'unico modo di riaprirla è chiamarla per nome.
  const v = visore({ apreCon: ['am start -n'] });
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4');
    const comandi = v.comandi();
    assert.equal(comandi.length, 2);
    assert.match(comandi[1], /am start -n com\.pvr\.filemanager\/\.VideoActivity/);
  } finally {
    v.pulisci();
  }
});

test('i flag di riavvio pulito sono l\'ultima spiaggia, non la prima', async () => {
  // Sono quelli che avevano smesso di far partire i filmati: restano utili,
  // ma solo dove nient'altro apre il filmato.
  const v = visore({ apreCon: ['clear-task'] });
  try {
    await playVideo('finto:5555', '/sdcard/Movies/tour.mp4');
    const comandi = v.comandi();
    assert.equal(comandi.length, 3);
    assert.match(comandi[2], /--activity-clear-task/);
  } finally {
    v.pulisci();
  }
});

test('se non apre niente in nessun modo, lo dice con tutti i tentativi', async () => {
  // Il silenzio era il difetto peggiore: schermo fermo e registro vuoto.
  const v = visore({ apreCon: [] });
  try {
    await assert.rejects(
      () => playVideo('finto:5555', '/sdcard/Movies/tour.mp4'),
      (err) => {
        assert.match(err.message, /comando semplice: il visore non ha aperto niente/);
        assert.match(err.message, /lettore esplicito/);
        assert.match(err.message, /riavvio pulito/);
        return true;
      },
    );
  } finally {
    v.pulisci();
  }
});
