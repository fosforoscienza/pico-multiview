import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  RADICE_PREFISSO,
  VIDEO_EXTENSIONS,
  VIDEO_ROOTS,
  fileName,
  fileUri,
  findVideosCommand,
} from '../src/main/apps.js';

const esegui = promisify(execFile);

// La ricerca gira dentro `adb shell`: la sintassi è il punto delicato, ed è
// l'unica parte che si può provare senza un visore attaccato. Qui si prova due
// volte: leggendo il comando, e facendolo girare davvero su un albero finto.

/**
 * Un albero come quello del visore: la radice è un **collegamento**, non una
 * cartella, ed è quello il dettaglio che faceva uscire l'elenco vuoto.
 */
async function memoriaFinta() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pico-video-'));
  await fs.mkdir(path.join(base, 'reale', 'Movies'), { recursive: true });
  await fs.mkdir(path.join(base, 'reale', 'Android', 'data', 'app'), { recursive: true });
  await fs.writeFile(path.join(base, 'reale', 'Movies', 'Tra Borghi e Natura.mp4'), '');
  await fs.writeFile(path.join(base, 'reale', 'Android', 'data', 'app', 'cache.mp4'), '');
  await fs.symlink(path.join(base, 'reale'), path.join(base, 'sdcard'));
  // Una microSD montata a parte, e il nome della memoria interna che sotto
  // /storage compare una seconda volta.
  await fs.mkdir(path.join(base, 'storage', '1A2B-3C4D', 'DCIM'), { recursive: true });
  await fs.mkdir(path.join(base, 'storage', 'emulated'), { recursive: true });
  await fs.writeFile(path.join(base, 'storage', '1A2B-3C4D', 'DCIM', 'dalla-scheda.mp4'), '');
  await fs.writeFile(path.join(base, 'storage', 'emulated', 'copia-fantasma.mp4'), '');
  return {
    base,
    sdcard: path.join(base, 'sdcard'),
    montaggi: path.join(base, 'storage', '*'),
    pulisci: () => fs.rm(base, { recursive: true, force: true }),
  };
}

const righe = (testo) => testo.split('\n').map((r) => r.trim()).filter(Boolean);

test('la ricerca attraversa la radice anche se è un collegamento', async () => {
  // Il difetto sorvegliato: `/sdcard` non è una cartella ma un collegamento a
  // `/storage/self/primary`, e `find` non lo attraversa se non glielo si
  // chiede. La ricerca finiva senza risultati e senza errori — "0 file
  // trovati" su un visore pieno di filmati.
  const memoria = await memoriaFinta();
  try {
    const cmd = findVideosCommand([memoria.sdcard], ['mp4'], { montaggi: '' });
    const { stdout } = await esegui('sh', ['-c', cmd]);
    const trovati = righe(stdout).filter((r) => r.startsWith('/'));
    assert.deepEqual(trovati.map(fileName), ['Tra Borghi e Natura.mp4']);
  } finally {
    await memoria.pulisci();
  }
});

test('la cartella Android viene potata, non attraversata', async () => {
  // Sono i dati privati delle app: decine di migliaia di file dove un filmato
  // dell'operatore non sta comunque. Attraversarla costerebbe minuti.
  const memoria = await memoriaFinta();
  try {
    const { stdout } = await esegui('sh', ['-c', findVideosCommand([memoria.sdcard], ['mp4'], { montaggi: '' })]);
    assert.ok(!stdout.includes('cache.mp4'), 'i file dentro Android non devono comparire');
  } finally {
    await memoria.pulisci();
  }
});

test('le radici si provano in fila, e si trova ogni filmato una volta sola', async () => {
  // /sdcard, /storage/emulated/0 e /storage/self/primary sono tre nomi della
  // stessa memoria: cercarle tutte vorrebbe dire tre copie dello stesso file.
  const memoria = await memoriaFinta();
  try {
    const cmd = findVideosCommand(
      [path.join(memoria.base, 'inesistente'), memoria.sdcard, path.join(memoria.base, 'reale')],
      ['mp4'],
      { montaggi: '' },
    );
    const { stdout } = await esegui('sh', ['-c', cmd]);
    const trovati = righe(stdout).filter((r) => r.startsWith('/'));
    assert.equal(trovati.length, 1, 'un solo risultato, dalla prima radice buona');
    const radici = righe(stdout).filter((r) => r.startsWith(RADICE_PREFISSO));
    assert.deepEqual(radici, [`${RADICE_PREFISSO}${memoria.sdcard}`], 'le radici inesistenti si saltano');
  } finally {
    await memoria.pulisci();
  }
});

test('la radice viene dichiarata anche quando non trova niente', async () => {
  // "0 file trovati" è una risposta che si capisce solo sapendo dove ha
  // guardato: senza, non si distingue un visore vuoto da una ricerca cieca.
  const memoria = await memoriaFinta();
  try {
    const { stdout } = await esegui('sh', ['-c', findVideosCommand([memoria.sdcard], ['insv'], { montaggi: '' })]);
    assert.deepEqual(righe(stdout), [`${RADICE_PREFISSO}${memoria.sdcard}`]);
  } finally {
    await memoria.pulisci();
  }
});

test('anche una scheda esterna viene guardata, e la memoria interna una volta sola', async () => {
  // Un filmato copiato su una microSD non sta sotto /sdcard: è un altro posto,
  // non un altro nome. Ma `emulated` sotto /storage è la memoria interna già
  // guardata, e ripassarci vorrebbe dire elencare ogni filmato due volte.
  const memoria = await memoriaFinta();
  try {
    const cmd = findVideosCommand([memoria.sdcard], ['mp4'], { montaggi: memoria.montaggi });
    const { stdout } = await esegui('sh', ['-c', cmd]);
    const trovati = righe(stdout).filter((r) => r.startsWith('/')).map(fileName);
    assert.deepEqual(trovati.sort(), ['Tra Borghi e Natura.mp4', 'dalla-scheda.mp4']);
    assert.ok(!stdout.includes('copia-fantasma'), 'la memoria interna non va guardata due volte');
  } finally {
    await memoria.pulisci();
  }
});

test('si cerca in tutta la memoria, per tutte le estensioni', () => {
  // Indovinare le cartelle giuste era già costato un "non trova il file":
  // i filmati stavano fuori dall'elenco delle cartelle previste.
  const cmd = findVideosCommand();
  for (const radice of VIDEO_ROOTS) assert.ok(cmd.includes(radice), `manca la radice ${radice}`);
  for (const ext of VIDEO_EXTENSIONS) assert.ok(cmd.includes(`'*.${ext}'`), `manca ${ext}`);
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

test('gli spazi nel nome non troncano l\'indirizzo del filmato', () => {
  // "Tra Borghi e Natura.mp4": con lo spazio nudo il lettore riceveva "Tra" e
  // rispondeva che il file non esiste.
  assert.equal(
    fileUri('/sdcard/Movies/Tra Borghi e Natura.mp4'),
    'file:///sdcard/Movies/Tra%20Borghi%20e%20Natura.mp4',
  );
  // Le barre restano barre: sono la struttura del percorso.
  assert.ok(fileUri('/sdcard/Movies/a.mp4').startsWith('file:///sdcard/Movies/'));
  // # e ? tagliano l'indirizzo in due se restano nudi.
  assert.equal(fileUri('/sdcard/n#1?.mp4'), 'file:///sdcard/n%231%3F.mp4');
});
