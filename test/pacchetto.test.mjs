import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { unpackedPath } from '../src/main/adb.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

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

test('l\'app viene firmata, seppure in modo ad-hoc', () => {
  // Senza nessuna firma i Mac con chip Apple non dicono "sviluppatore non
  // identificato" (avviso che si supera): dicono "è danneggiata" e chiudono il
  // discorso. "-" è l'identità ad-hoc: non certifica l'autore, ma rende l'app
  // eseguibile.
  assert.equal(pkg.build.mac.identity, '-', 'l\'app uscirebbe dal .dmg senza firma');
});

test('package-lock.json porta lo stesso numero di versione', () => {
  // Se restano diversi, "npm install" riscrive il lock per allinearlo: chi
  // aggiorna si ritrova un file modificato che non ha toccato, e il "git pull"
  // successivo si rifiuta di procedere. È già successo.
  assert.equal(lock.version, pkg.version, 'lock.version diverso da package.json');
  assert.equal(lock.packages[''].version, pkg.version, 'lock.packages[""].version diverso');
});

test('il runtime irrobustito resta spento, altrimenti l\'app non parte', () => {
  // electron-builder lo accende da solo. Insieme a una firma ad-hoc attiva la
  // "library validation", che impedisce a Electron di caricare i propri
  // framework: l'app si firmerebbe correttamente e poi non si aprirebbe.
  assert.equal(pkg.build.mac.hardenedRuntime, false);
});
