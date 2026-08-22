import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CREDIT, brandForUi, brandLogoDataUri, brandLogoPath } from '../src/main/brand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_DIR = path.join(ROOT, 'assets', 'brand');

/** Crea file di prova nella cartella dei loghi e li toglie sempre alla fine. */
function withLogos(files, fn) {
  const created = [];
  try {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(BRAND_DIR, name);
      fs.writeFileSync(file, content);
      created.push(file);
    }
    fn();
  } finally {
    for (const file of created) fs.rmSync(file, { force: true });
  }
}

test('i crediti sono quelli concordati', () => {
  assert.equal(CREDIT, '© 2026 Brown Enterprises Srls');
});

test('senza logo caricato non si rompe niente: resta la sola scritta', () => {
  // Nel repository i loghi non ci sono: li carica chi possiede il marchio.
  assert.equal(brandLogoPath('bianco'), null);
  assert.equal(brandLogoDataUri('bianco'), null);
  assert.deepEqual(brandForUi(), { credit: CREDIT, logo: null });
});

test('trova il logo per la variante giusta', () => {
  withLogos({ 'brown-enterprises-nero.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) }, () => {
    assert.match(brandLogoPath('nero'), /brown-enterprises-nero\.png$/);
    assert.equal(brandLogoPath('bianco'), null, 'la variante bianca non deve prendere il file nero');
    assert.match(brandLogoDataUri('nero'), /^data:image\/png;base64,/);
  });
});

test('a parità di nome vince l\'SVG, che resta nitido a ogni dimensione', () => {
  withLogos(
    {
      'brown-enterprises-bianco.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      'brown-enterprises-bianco.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    },
    () => {
      assert.match(brandLogoPath('bianco'), /\.svg$/);
      assert.match(brandLogoDataUri('bianco'), /^data:image\/svg\+xml;base64,/);
    },
  );
});

test('il logo arriva all\'interfaccia come data URI, senza percorsi da risolvere', () => {
  // Serve proprio così: la stessa pagina gira nella finestra sul Mac (file://)
  // e nel telecomando via browser (http://), e un percorso relativo non
  // funzionerebbe in entrambi i casi.
  withLogos({ 'brown-enterprises-bianco.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' }, () => {
    const brand = brandForUi();
    assert.equal(brand.credit, CREDIT);
    assert.match(brand.logo, /^data:image\/svg\+xml;base64,/);
  });
});
