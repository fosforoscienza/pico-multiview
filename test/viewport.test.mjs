import assert from 'node:assert/strict';
import test from 'node:test';

import { Viewport, wearerRect } from '../src/renderer/viewport.js';

const STEREO = { width: 2000, height: 1000 }; // cattura a due occhi affiancati
const FLAT = { width: 1280, height: 720 };

test('la visuale del visitatore è un occhio su cattura stereoscopica', () => {
  assert.deepEqual(wearerRect(2000, 1000), { x: 0, y: 0, width: 1000, height: 1000 });
});

test('su cattura normale la visuale del visitatore è tutto il fotogramma', () => {
  assert.deepEqual(wearerRect(1280, 720), { x: 0, y: 0, width: 1280, height: 720 });
});

test('senza fotogramma non si rompe niente', () => {
  const vp = new Viewport();
  assert.equal(vp.ready, false);
  assert.equal(vp.isHome, true);
  assert.deepEqual(vp.rect(), { x: 0, y: 0, width: 0, height: 0 });
  vp.panByFramePixels(100, 100); // non deve lanciare
});

test('all\'inizio si guarda esattamente quello che guarda il visitatore', () => {
  const vp = new Viewport();
  vp.setFrameSize(STEREO.width, STEREO.height);
  assert.equal(vp.isHome, true);
  assert.deepEqual(vp.rect(), { x: 0, y: 0, width: 1000, height: 1000 });
});

test('trascinando ci si sposta e il pulsante "faccia" riporta indietro', () => {
  const vp = new Viewport();
  vp.setFrameSize(STEREO.width, STEREO.height);
  vp.panByFramePixels(400, 0);
  assert.equal(vp.isHome, false);
  assert.equal(vp.rect().x, 400);
  vp.home();
  assert.equal(vp.isHome, true);
  assert.equal(vp.rect().x, 0);
});

test('l\'inquadratura non esce mai dai bordi del fotogramma', () => {
  const vp = new Viewport();
  vp.setFrameSize(STEREO.width, STEREO.height);
  vp.panByFramePixels(99999, 99999);
  const r = vp.rect();
  assert.equal(r.x + r.width, STEREO.width);
  assert.ok(r.y >= 0 && r.y + r.height <= STEREO.height);

  vp.panByFramePixels(-99999, -99999);
  const r2 = vp.rect();
  assert.equal(r2.x, 0);
  assert.equal(r2.y, 0);
});

test('lo zoom minimo fa entrare tutto il fotogramma, compreso l\'altro occhio', () => {
  const vp = new Viewport();
  vp.setFrameSize(STEREO.width, STEREO.height);
  assert.equal(vp.minZoom, 0.5);
  vp.zoomBy(0.01); // molto oltre il limite: deve saturare
  assert.equal(vp.zoom, 0.5);
  const r = vp.rect();
  assert.equal(r.width, STEREO.width);
  assert.equal(r.height, STEREO.height);
});

test('lo zoom massimo è limitato', () => {
  const vp = new Viewport({ maxZoom: 4 });
  vp.setFrameSize(FLAT.width, FLAT.height);
  vp.zoomBy(1000);
  assert.equal(vp.zoom, 4);
  assert.equal(Math.round(vp.rect().width), 320);
});

test('lo zoom tiene fermo il punto sotto il puntatore', () => {
  const vp = new Viewport();
  vp.setFrameSize(FLAT.width, FLAT.height);
  const anchor = { nx: 0.25, ny: 0.75 };
  const before = vp.viewToFrame(anchor.nx, anchor.ny);
  vp.zoomBy(2, anchor.nx, anchor.ny);
  const after = vp.viewToFrame(anchor.nx, anchor.ny);
  assert.ok(Math.abs(before.nx - after.nx) < 0.01, `${before.nx} vs ${after.nx}`);
  assert.ok(Math.abs(before.ny - after.ny) < 0.01, `${before.ny} vs ${after.ny}`);
});

test('viewToFrame converte il clic dell\'anteprima in coordinate del visore', () => {
  const vp = new Viewport();
  vp.setFrameSize(STEREO.width, STEREO.height);
  // A riposo l'anteprima mostra l'occhio sinistro: metà larghezza del fotogramma.
  assert.deepEqual(vp.viewToFrame(0.5, 0.5), { nx: 0.25, ny: 0.5 });
  vp.panByFramePixels(1000, 0); // ci spostiamo sull'occhio destro
  assert.deepEqual(vp.viewToFrame(0.5, 0.5), { nx: 0.75, ny: 0.5 });
});

test('se cambia la risoluzione dello stream si torna sulla visuale del visitatore', () => {
  const vp = new Viewport();
  vp.setFrameSize(STEREO.width, STEREO.height);
  vp.panByFramePixels(500, 0);
  assert.equal(vp.isHome, false);
  assert.equal(vp.setFrameSize(1600, 800), true);
  assert.equal(vp.isHome, true);
  assert.equal(vp.setFrameSize(1600, 800), false); // stessa dimensione: nessun reset
});
