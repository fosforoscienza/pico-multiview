import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { seekTo } from '../src/main/apps.js';

// Da fuori non esiste un «vai al minuto due»: esistono i tasti avanti e
// indietro, e ogni lettore salta di quanto gli pare. Qui si prova l'inseguimento
// contro un lettore finto che si comporta come uno vero — e contro uno che ai
// tasti non risponde affatto, che è il caso da riconoscere e dire.

/**
 * Un visore finto con un lettore dentro: tiene la posizione su un file, la
 * sposta quando riceve i tasti, e la racconta come fa `dumpsys media_session`.
 * `PASSO` è di quanto salta ogni colpo; a 0 il lettore ignora i tasti.
 */
function visoreConLettore({ passoMs = 10000 } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-lettore-'));
  const stato = path.join(base, 'posizione');
  fs.writeFileSync(stato, '0');
  const file = path.join(base, 'adb');
  fs.writeFileSync(
    file,
    `#!/bin/sh
POS=$(cat ${stato})
case "$4" in
  *"dumpsys media_session"*)
    printf 'Sessions Stack - have 1 sessions:\\n  package=com.pvr.filemanager\\n'
    printf '    state=PlaybackState {state=3, position=%s, speed=1.0, updated=1000}\\n' "$POS"
    printf -- '---orologio---\\n1.0 1.0\\n'
    ;;
  "input keyevent"*)
    for k in $4; do
      case "$k" in
        90) POS=$((POS + ${passoMs}));;
        89) POS=$((POS - ${passoMs})); [ "$POS" -lt 0 ] && POS=0;;
      esac
    done
    echo "$POS" > ${stato}
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  process.env.PICO_ADB = file;
  return {
    posizione: () => Number(fs.readFileSync(stato, 'utf8')),
    pulisci: () => {
      delete process.env.PICO_ADB;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

test('il salto misura il passo del lettore e ci arriva', async () => {
  // Il passo non lo decidiamo noi: si dà un colpo, si guarda quanto è valso, e
  // si fa il conto dei colpi che mancano. Indovinarlo vorrebbe dire finire
  // altrove — e su dieci visori, altrove ciascuno.
  const visore = visoreConLettore({ passoMs: 10000 });
  try {
    const finale = await seekTo('finto:5555', 120000);
    assert.ok(Math.abs(finale.positionMs - 120000) <= 2000, `arrivato a ${finale.positionMs}`);
    assert.equal(visore.posizione(), 120000);
  } finally {
    visore.pulisci();
  }
});

test('funziona anche con un lettore dal passo lungo', async () => {
  // Trenta secondi a colpo: se il passo fosse dato per scontato a dieci, il
  // filmato finirebbe tre volte più avanti del punto chiesto.
  const visore = visoreConLettore({ passoMs: 30000 });
  try {
    const finale = await seekTo('finto:5555', 90000);
    assert.ok(Math.abs(finale.positionMs - 90000) <= 2000, `arrivato a ${finale.positionMs}`);
  } finally {
    visore.pulisci();
  }
});

test('si torna anche indietro', async () => {
  const visore = visoreConLettore({ passoMs: 10000 });
  try {
    await seekTo('finto:5555', 60000);
    const finale = await seekTo('finto:5555', 20000);
    assert.ok(Math.abs(finale.positionMs - 20000) <= 2000, `arrivato a ${finale.positionMs}`);
  } finally {
    visore.pulisci();
  }
});

test('un lettore che ignora i tasti lo dice, invece di far finta', async () => {
  // È l'esito da riconoscere: senza, l'app resterebbe a martellare tasti e
  // l'operatore aspetterebbe un salto che non avverrà.
  const visore = visoreConLettore({ passoMs: 0 });
  try {
    await assert.rejects(() => seekTo('finto:5555', 60000), /non risponde ai tasti/);
    assert.equal(visore.posizione(), 0);
  } finally {
    visore.pulisci();
  }
});
