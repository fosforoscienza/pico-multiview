import assert from 'node:assert/strict';
import test from 'node:test';

import { formattaTempo, riepilogo, stimaPosizione } from '../src/shared/playback.js';

// La barra del filmato si muove fra una lettura e l'altra: questi conti sono
// la parte che, sbagliata, si vedrebbe come una barra a scatti o bugiarda.

test('il tempo si legge come su un lettore', () => {
  assert.equal(formattaTempo(0), '0:00');
  assert.equal(formattaTempo(83000), '1:23');
  assert.equal(formattaTempo(3723000), '1:02:03');
  // Meglio un trattino che uno zero inventato: la durata può non esserci.
  assert.equal(formattaTempo(null), '–');
  assert.equal(formattaTempo(-5), '–');
});

test('fra una lettura e l\'altra la barra continua da sola', () => {
  // Le letture costano un comando adb per visore: si chiedono ogni due
  // secondi, e nel frattempo si conta il tempo che passa.
  const lettura = { positionMs: 10000, state: 'in riproduzione', speed: 1, letto: 1000 };
  assert.equal(stimaPosizione(lettura, 1000), 10000);
  assert.equal(stimaPosizione(lettura, 2500), 11500);
});

test('da ferma una lettura vecchia è ancora giusta', () => {
  const ferma = { positionMs: 10000, state: 'in pausa', letto: 1000 };
  assert.equal(stimaPosizione(ferma, 99000), 10000, 'in pausa il filmato non si muove');
});

test('la barra non corre oltre la fine del filmato', () => {
  const quasiFinito = { positionMs: 59000, durationMs: 60000, state: 'in riproduzione', speed: 1, letto: 0 };
  assert.equal(stimaPosizione(quasiFinito, 120000), 60000);
});

test('il riepilogo dice quanto sono distanti i visori', () => {
  // È il dato che non si legge altrove: dieci visori «in riproduzione»
  // possono essere a mezzo minuto l'uno dall'altro, e in sala si scopre tardi.
  const letture = [
    { positionMs: 30000, durationMs: 600000, state: 'in riproduzione', speed: 1, letto: 0, name: 'tour.mp4' },
    { positionMs: 45000, durationMs: 600000, state: 'in riproduzione', speed: 1, letto: 0 },
    { positionMs: 38000, durationMs: 600000, state: 'in riproduzione', speed: 1, letto: 0 },
  ];
  const s = riepilogo(letture, 0);
  assert.equal(s.spreadMs, 15000);
  assert.equal(s.minMs, 30000);
  assert.equal(s.maxMs, 45000);
  assert.equal(s.positionMs, 38000, 'la posizione mostrata è quella di mezzo, non la media');
  assert.equal(s.name, 'tour.mp4');
  assert.equal(s.quanti, 3);
});

test('basta un visore fermo perché il gruppo non sia «in riproduzione»', () => {
  // Da lì il pulsante deve proporre di farli ripartire tutti, non di fermarli:
  // altrimenti un visore rimasto indietro resterebbe indietro per sempre.
  const letture = [
    { positionMs: 1000, state: 'in riproduzione', letto: 0 },
    { positionMs: 1000, state: 'in pausa', letto: 0 },
  ];
  assert.equal(riepilogo(letture, 0).inRiproduzione, false);
});

test('senza letture non c\'è barra da mostrare', () => {
  assert.equal(riepilogo([]), null);
  assert.equal(riepilogo([{ positionMs: null }]), null);
});
