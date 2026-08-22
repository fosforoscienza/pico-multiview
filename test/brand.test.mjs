import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CREDIT, brandForUi, brandLogoDataUri, brandLogoPath } from '../src/main/brand.js';

/** Cartella temporanea con i file indicati, cancellata comunque alla fine. */
function withBrandDir(names, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-brand-'));
  try {
    for (const name of names) fs.writeFileSync(path.join(dir, name), 'contenuto di prova');
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('i crediti sono quelli concordati', () => {
  assert.equal(CREDIT, '© 2026 Brown Enterprises Srls');
});

test('senza logo non si rompe niente: resta la sola scritta', () => {
  withBrandDir([], (dir) => {
    assert.equal(brandLogoPath('bianco', dir), null);
    assert.equal(brandLogoDataUri('nero', dir), null);
  });
  // Nemmeno se la cartella non esiste proprio.
  assert.equal(brandLogoPath('bianco', '/cartella/che/non/esiste'), null);
});

test('riconosce il logo dalla parola nel nome, non dal nome esatto', () => {
  // Nomi realistici: chi carica i file su GitHub li chiama come gli viene.
  withBrandDir(['logo brown enterpises bianco.png', 'logo brown enterpises nero.png'], (dir) => {
    assert.match(brandLogoPath('bianco', dir), /bianco\.png$/);
    assert.match(brandLogoPath('nero', dir), /nero\.png$/);
  });
});

test('non confonde una variante con l\'altra', () => {
  withBrandDir(['logo-nero.png'], (dir) => {
    assert.match(brandLogoPath('nero', dir), /logo-nero\.png$/);
    assert.equal(brandLogoPath('bianco', dir), null);
  });
});

test('a parità di variante vince l\'SVG, che resta nitido a ogni dimensione', () => {
  withBrandDir(['logo-bianco.png', 'logo-bianco.svg'], (dir) => {
    assert.match(brandLogoPath('bianco', dir), /\.svg$/);
  });
});

test('ignora i file che non sono immagini', () => {
  withBrandDir(['note-sul-logo-bianco.txt', 'README-bianco.md'], (dir) => {
    assert.equal(brandLogoPath('bianco', dir), null);
  });
});

test('il tipo di immagine finisce nel data URI', () => {
  withBrandDir(['logo-nero.png'], (dir) => {
    assert.match(brandLogoDataUri('nero', dir), /^data:image\/png;base64,/);
  });
  withBrandDir(['logo-nero.svg'], (dir) => {
    assert.match(brandLogoDataUri('nero', dir), /^data:image\/svg\+xml;base64,/);
  });
});

test('l\'interfaccia riceve crediti e logo come data URI', () => {
  // Serve proprio così: la stessa pagina gira nella finestra sul Mac (file://)
  // e nel telecomando via browser (http://), e un percorso relativo non
  // funzionerebbe in entrambi i casi.
  const brand = brandForUi();
  assert.equal(brand.credit, CREDIT);
  assert.ok(brand.logo === null || brand.logo.startsWith('data:image/'), 'logo malformato');
});
