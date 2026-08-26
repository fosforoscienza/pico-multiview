import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { unpackedPath } from '../src/main/adb.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('i binari vengono cercati fuori dall\'archivio app.asar', () => {
  // Dentro il .dmg i file finiscono in app.asar, che è un archivio: da lì adb
  // non si può eseguire e il server scrcpy non si può spingere sul visore.
  const dentro = '/Applications/Pico Multiview.app/Contents/Resources/app.asar/vendor/scrcpy-server';
  assert.equal(
    unpackedPath(dentro),
    '/Applications/Pico Multiview.app/Contents/Resources/app.asar.unpacked/vendor/scrcpy-server',
  );
});

test('fuori dal pacchetto il percorso resta intatto', () => {
  const sviluppo = '/Users/anna/Documents/pico-multiview/vendor/scrcpy-server';
  assert.equal(unpackedPath(sviluppo), sviluppo);
});

test('non si fa ingannare da una cartella che si chiama app.asar-qualcosa', () => {
  const finto = '/tmp/app.asar-backup/vendor/scrcpy-server';
  assert.equal(unpackedPath(finto), finto);
});

test('il pacchetto dichiara di estrarre vendor dall\'archivio', () => {
  // Senza questa riga in package.json la riscrittura del percorso punterebbe a
  // una cartella che non esiste, e l'app impacchettata non vedrebbe i visori.
  assert.ok(pkg.build.asarUnpack?.includes('vendor/**'), 'manca asarUnpack per vendor');
  assert.ok(pkg.build.files?.includes('vendor/**'), 'vendor non è fra i file impacchettati');
});
