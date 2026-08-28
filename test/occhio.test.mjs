import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDisplaySize } from '../src/main/apps.js';
import { spiegaLogScrcpy } from '../src/main/device.js';
import { leftEyeCrop } from '../src/shared/protocol.js';

// Un visore disegna due immagini affiancate, una per occhio. Chiedergli solo la
// metà sinistra rende l'immagine leggibile ovunque — anteprima e miniature — e
// dimezza il traffico wifi, che con dieci visori è la differenza fra scorrevole
// e a scatti. Il ritaglio lo fa scrcpy sul visore, in pixel dello **schermo**.

test('legge la dimensione dello schermo da "wm size"', () => {
  assert.deepEqual(parseDisplaySize('Physical size: 3840x1080\n'), { width: 3840, height: 1080 });
});

test('se lo schermo è stato forzato vince "Override size"', () => {
  // È quella che il visore usa davvero, quindi quella che scrcpy vede.
  const out = 'Physical size: 3840x1080\nOverride size: 1920x1080\n';
  assert.deepEqual(parseDisplaySize(out), { width: 1920, height: 1080 });
});

test('un output che non contiene misure non viene inventato', () => {
  assert.equal(parseDisplaySize('error: device offline'), null);
  assert.equal(parseDisplaySize(''), null);
  assert.equal(parseDisplaySize(undefined), null);
});

test('il ritaglio prende la metà sinistra, in pixel dello schermo', () => {
  assert.equal(leftEyeCrop({ width: 3840, height: 1080 }), '1920:1080:0:0');
});

test('la larghezza del ritaglio resta pari', () => {
  // Un encoder H.264 lavora a blocchi: una larghezza dispari fa fallire
  // l'avvio dello streaming, e il visore resterebbe nero.
  assert.equal(leftEyeCrop({ width: 4098, height: 1080 }), '2048:1080:0:0');
  assert.equal(leftEyeCrop({ width: 3846, height: 1080 }), '1922:1080:0:0');
});

test('senza una dimensione valida non si produce un ritaglio', () => {
  // Meglio un errore leggibile che un "crop=0:0:0:0" che spegne l'immagine.
  assert.equal(leftEyeCrop(null), null);
  assert.equal(leftEyeCrop({ width: 0, height: 1080 }), null);
  assert.equal(leftEyeCrop({ width: 1, height: 1080 }), null);
});

// --- messaggi di scrcpy che l'operatore può incontrare in sala ---

test('il rifiuto del tocco viene spiegato in italiano', () => {
  const originale = 'WARN: Ignore touch event, it was generated for a different device size';
  const spiegato = spiegaLogScrcpy(originale);
  assert.match(spiegato, /rifiutato il tocco/);
  // Il testo originale resta in coda: serve a chi poi cerca in rete.
  assert.ok(spiegato.includes(originale), 'il messaggio originale non va perso');
});

test('gli altri messaggi passano intatti', () => {
  const passa = 'INFO: Device: [PICO] A8110 (Android 12)';
  assert.equal(spiegaLogScrcpy(passa), passa);
  assert.equal(spiegaLogScrcpy(null), '');
});
