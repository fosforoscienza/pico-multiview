import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDisplaySize } from '../src/main/apps.js';
import { spiegaLogScrcpy } from '../src/main/device.js';
import { framePointToScreen, leftEyeCrop, parseCrop, visiblePoint } from '../src/shared/protocol.js';

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

// --- dal punto sull'immagine al pixel sullo schermo del visore ---
//
// Il comando `input`, che usiamo sui PICO, non sa niente del rimpicciolimento
// del video né del ritaglio: vuole i pixel veri dello schermo. Sbagliare questa
// conversione significa cliccare da un'altra parte, che è peggio di non
// cliccare affatto.

test('senza ritaglio il punto si spalma su tutto lo schermo', () => {
  const schermo = { width: 3840, height: 1080 };
  assert.deepEqual(framePointToScreen(0, 0, schermo), { x: 0, y: 0 });
  assert.deepEqual(framePointToScreen(1, 1, schermo), { x: 3840, y: 1080 });
  assert.deepEqual(framePointToScreen(0.5, 0.5, schermo), { x: 1920, y: 540 });
});

test('con l\'occhio singolo il punto resta nella metà ritagliata', () => {
  // Il centro di ciò che si vede è il centro dell'occhio sinistro, cioè un
  // quarto dello schermo: non la sua metà.
  const schermo = { width: 3840, height: 1080 };
  assert.deepEqual(framePointToScreen(0.5, 0.5, schermo, '1920:1080:0:0'), { x: 960, y: 540 });
  assert.deepEqual(framePointToScreen(1, 0.5, schermo, '1920:1080:0:0'), { x: 1920, y: 540 });
});

test('un ritaglio spostato porta con sé il suo scostamento', () => {
  const schermo = { width: 3840, height: 1080 };
  assert.deepEqual(framePointToScreen(0, 0, schermo, '1920:1080:1920:0'), { x: 1920, y: 0 });
});

test('i punti fuori bordo vengono riportati dentro', () => {
  const schermo = { width: 1000, height: 500 };
  assert.deepEqual(framePointToScreen(-0.4, 1.9, schermo), { x: 0, y: 500 });
});

test('senza la dimensione dello schermo non si inventa un punto', () => {
  // Meglio un errore leggibile che un tocco a caso in mezzo alla sala.
  assert.equal(framePointToScreen(0.5, 0.5, null), null);
  assert.equal(framePointToScreen(0.5, 0.5, { width: 0, height: 500 }), null);
});

test('un ritaglio scritto male viene ignorato invece di sballare il clic', () => {
  const schermo = { width: 1000, height: 500 };
  assert.deepEqual(framePointToScreen(0.5, 0.5, schermo, 'boh'), { x: 500, y: 250 });
  assert.deepEqual(framePointToScreen(0.5, 0.5, schermo, '0:0:0:0'), { x: 500, y: 250 });
});

test('parseCrop legge le quattro misure', () => {
  assert.deepEqual(parseCrop('1920:1080:0:0'), { width: 1920, height: 1080, x: 0, y: 0 });
  assert.deepEqual(parseCrop(' 800:600:10:20 '), { width: 800, height: 600, x: 10, y: 20 });
  assert.equal(parseCrop(null), null);
  assert.equal(parseCrop('1920:1080'), null);
});

// --- il punto riportato sulla porzione che si vede davvero ---
//
// Serve per mandare un tocco a uno schermo diverso da quello catturato: lì le
// coordinate dello schermo stereo non hanno senso. Sbagliarle significa cadere
// fuori dal pannello, e la prova sembrerebbe fallita per la periferica invece
// che per le coordinate.

test('su una cattura stereoscopica la metà sinistra diventa tutto', () => {
  const stereo = { width: 3840, height: 1920 };
  // Il centro dell'occhio sinistro (nx 0.25) è il centro di ciò che si vede.
  assert.deepEqual(visiblePoint(0.25, 0.5, stereo), { nx: 0.5, ny: 0.5 });
  assert.deepEqual(visiblePoint(0, 0, stereo), { nx: 0, ny: 0 });
  assert.deepEqual(visiblePoint(0.5, 1, stereo), { nx: 1, ny: 1 });
});

test('oltre l\'occhio sinistro non si va', () => {
  const stereo = { width: 3840, height: 1920 };
  assert.deepEqual(visiblePoint(0.9, 0.5, stereo), { nx: 1, ny: 0.5 });
});

test('con il ritaglio il fotogramma è già la porzione visibile', () => {
  // "Un occhio" acceso: non va raddoppiato una seconda volta.
  const stereo = { width: 3840, height: 1920 };
  assert.deepEqual(visiblePoint(0.5, 0.5, stereo, '1920:1920:0:0'), { nx: 0.5, ny: 0.5 });
});

test('una cattura piatta resta com\'è', () => {
  const piatto = { width: 1920, height: 1080 };
  assert.deepEqual(visiblePoint(0.25, 0.5, piatto), { nx: 0.25, ny: 0.5 });
});

test('il punto per un altro schermo si calcola sulla sua misura', () => {
  // Il caso che questo evita: mandare 960,960 (schermo stereo) a un pannello
  // 1280×720, dove la y cadrebbe fuori e non toccherebbe niente.
  const stereo = { width: 3840, height: 1920 };
  const pannello = { width: 1280, height: 720 };
  const v = visiblePoint(0.25, 0.5, stereo);
  assert.deepEqual(framePointToScreen(v.nx, v.ny, pannello), { x: 640, y: 360 });
});
