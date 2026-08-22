#!/usr/bin/env node
// Genera docs/Guida-Pico-MultiView.pdf a partire da docs/guida.html.
//
// Usa il Chromium di Playwright (già presente se hai fatto "npm install", oppure
// installabile con "npx playwright install chromium"). Il PDF è rigenerabile:
// se cambi la guida, ribatti "npm run guida" e il file si aggiorna.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CREDIT, VERSION, brandLogoDataUri } from '../src/main/brand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'docs', 'guida.html');
const OUTPUT = path.join(ROOT, 'docs', 'Guida-Pico-MultiView.pdf');

async function loadChromium() {
  try {
    const pw = await import('playwright');
    return pw.chromium ?? pw.default.chromium;
  } catch {
    // Playwright installato globalmente (capita nelle immagini di sviluppo).
    const globalPath = '/opt/node22/lib/node_modules/playwright/index.js';
    if (fs.existsSync(globalPath)) {
      const pw = await import(pathToFileURL(globalPath).href);
      return pw.chromium ?? pw.default.chromium;
    }
    throw new Error('Playwright non trovato: esegui "npm i -D playwright && npx playwright install chromium"');
  }
}

// La pagina è bianca, quindi qui serve il logo nero. Se non è ancora stato
// caricato resta la sola scritta dei crediti.
const logo = brandLogoDataUri('nero');
// 6mm: il marchio sta su tre righe, più piccolo non si legge nemmeno stampato.
const logoImg = logo ? `<img src="${logo}" style="height:6mm; width:auto; display:block;">` : '';

const footer = `
  <div style="width:100%; font-family: Helvetica, Arial, sans-serif; font-size:8.5px;
              color:#8a8a8a; padding:0 18mm; display:flex; align-items:center;
              justify-content:space-between;">
    <span style="display:flex; align-items:center; gap:2mm;">${logoImg}<span>${CREDIT}</span></span>
    <span>Pico MultiView v${VERSION} — Guida passo passo · <span class="pageNumber"></span></span>
  </div>`;

const chromium = await loadChromium();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'networkidle' });

// La versione e la data non stanno nella sorgente: le mette qui il generatore,
// così non c'è un numero da ricordarsi di aggiornare a mano.
const mesi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const oggi = new Date();
await page.evaluate(
  (testo) => {
    const el = document.getElementById('versione');
    if (el) el.textContent = testo;
  },
  `Versione ${VERSION} — ${mesi[oggi.getMonth()]} ${oggi.getFullYear()}`,
);

await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: OUTPUT,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: footer,
  margin: { top: '14mm', bottom: '16mm', left: '0mm', right: '0mm' },
});

await browser.close();

const size = (fs.statSync(OUTPUT).size / 1024).toFixed(0);
console.log(`Guida generata: ${path.relative(ROOT, OUTPUT)} (${size} KB)`);
