#!/usr/bin/env node
// Genera docs/Guida-Pico-MultiView.pdf a partire da docs/guida.html.
//
// Usa il Chromium di Playwright (già presente se hai fatto "npm install", oppure
// installabile con "npx playwright install chromium"). Il PDF è rigenerabile:
// se cambi la guida, ribatti "npm run guida" e il file si aggiorna.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const footer = `
  <div style="width:100%; font-family: Helvetica, Arial, sans-serif; font-size:8.5px;
              color:#8a8a8a; padding:0 18mm; display:flex; justify-content:space-between;">
    <span>Pico MultiView — Guida passo passo</span>
    <span class="pageNumber"></span>
  </div>`;

const chromium = await loadChromium();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'networkidle' });
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
