import assert from 'node:assert/strict';
import test from 'node:test';

import { VIDEO_EXTENSIONS, fileName, findVideosCommand } from '../src/main/apps.js';

// La ricerca gira dentro `adb shell`: la sintassi è il punto delicato, ed è
// l'unica parte che si può provare senza un visore attaccato.

test('il comando cerca in tutta la memoria, per tutte le estensioni', () => {
  // Indovinare le cartelle giuste era già costato un "non trova il file":
  // i filmati stavano fuori dall'elenco delle cartelle previste.
  const cmd = findVideosCommand();
  assert.ok(cmd.includes('find /sdcard '), 'deve partire dalla radice della memoria condivisa');
  for (const ext of VIDEO_EXTENSIONS) assert.ok(cmd.includes(`'*.${ext}'`), `manca ${ext}`);
});

test('la cartella Android viene potata, non attraversata', () => {
  // Sono i dati privati delle app: decine di migliaia di file dove un filmato
  // dell'operatore non sta comunque. Attraversarla costerebbe minuti.
  const cmd = findVideosCommand('/sdcard', ['mp4', 'mkv']);
  assert.equal(
    cmd,
    "find /sdcard -maxdepth 6 -type d -name Android -prune -o " +
      "-type f \\( -iname '*.mp4' -o -iname '*.mkv' \\) -print 2>/dev/null",
  );
});

test('gli errori delle cartelle mancanti non finiscono nell\'elenco', () => {
  // Su un visore quasi tutte queste cartelle non esistono: senza 2>/dev/null
  // ogni riga di errore diventerebbe un finto risultato.
  assert.ok(findVideosCommand().includes('2>/dev/null'));
});

test('la ricerca non scende all\'infinito', () => {
  // Su una memoria piena una ricerca senza limite di profondità costa decine
  // di secondi, moltiplicati per dieci visori.
  assert.match(findVideosCommand(), /-maxdepth \d+/);
});

test('il nome si ricava dal percorso', () => {
  assert.equal(fileName('/sdcard/Movies/Il mio video.mp4'), 'Il mio video.mp4');
  assert.equal(fileName('/sdcard/Movies/'), 'Movies');
  assert.equal(fileName(''), '');
  assert.equal(fileName(null), '');
});

test('lo stesso file in cartelle diverse ha lo stesso nome', () => {
  // È il motivo per cui l'elenco raggruppa per nome e non per percorso: lo
  // stesso filmato può stare in Movies su un visore e in Download su un altro.
  assert.equal(
    fileName('/sdcard/Movies/tour.mp4'),
    fileName('/sdcard/Download/tour.mp4'),
  );
});
