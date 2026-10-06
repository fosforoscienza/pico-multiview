#!/usr/bin/env node
// Genera i due PDF della guida:
//  - docs/Guida-Pico-MultiView.pdf, la guida illustrata, da docs/guida.html;
//  - Guida-Installazione-Mac.pdf, nella cartella principale del progetto: è il
//    testo del pulsante «Guida» dell'app (src/renderer/index.html), ricavato da
//    lì così le due versioni non possono andare fuori sincrono.
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
const APP_HTML = path.join(ROOT, 'src', 'renderer', 'index.html');
const OUTPUT_INSTALL = path.join(ROOT, 'Guida-Installazione-Mac.pdf');

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

const size = (fs.statSync(OUTPUT).size / 1024).toFixed(0);
console.log(`Guida generata: ${path.relative(ROOT, OUTPUT)} (${size} KB)`);

// ---------------------------------------------------------------------------
// Guida all'installazione: lo stesso testo del pulsante «Guida» dell'app.
// ---------------------------------------------------------------------------

function guideFromApp() {
  const html = fs.readFileSync(APP_HTML, 'utf8');
  const start = html.indexOf('<div class="modal-card modal-wide guide">');
  const end = html.indexOf('<div class="modal-actions">', start);
  if (start < 0 || end < 0) throw new Error('guida non trovata in src/renderer/index.html');
  return html
    .slice(html.indexOf('>', start) + 1, end)
    // Il logo Apple esiste solo nei font di Apple: altrove diventa un quadratino.
    .replaceAll('\uF8FF', 'Apple');
}

const installPage = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Pico MultiView — Installazione su Mac e uso senza internet</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0 18mm;
    font-family: "Bitstream Charter", Charter, Georgia, serif;
    font-size: 10.6pt;
    line-height: 1.5;
    color: #1c2530;
  }
  h1, h2, h3, h4, dt, .guide-toc, .meta { font-family: "Liberation Sans", Helvetica, Arial, sans-serif; }
  code, pre, kbd { font-family: "DejaVu Sans Mono", "Liberation Mono", monospace; }
  .meta { color: #5b6875; font-size: 9.5pt; margin: 0 0 4mm; }
  h2 { font-size: 19pt; line-height: 1.2; margin: 0 0 2mm; color: #1f5fa0; }
  h3 {
    font-size: 13.5pt; margin: 8mm 0 2mm; padding-top: 3mm;
    border-top: 1.5px solid #d7dee6; break-after: avoid;
  }
  h4 { font-size: 11pt; margin: 5mm 0 1mm; color: #1f5fa0; break-after: avoid; }
  p, li, dd { orphans: 3; widows: 3; }
  ol, ul { padding-left: 6mm; margin: 1.5mm 0; }
  li { margin: 1mm 0; }
  code, kbd {
    font-size: 8.8pt; background: #f1f4f8; border: 1px solid #d7dee6;
    border-radius: 3px; padding: 0 3px;
  }
  pre {
    font-size: 8.6pt; line-height: 1.45; background: #f6f8fa;
    border: 1px solid #d7dee6; border-left: 3px solid #1f5fa0; border-radius: 4px;
    padding: 2.5mm 3.5mm; margin: 2mm 0; white-space: pre-wrap; overflow-wrap: anywhere;
    break-inside: avoid;
  }
  .guide-toc { display: flex; flex-wrap: wrap; gap: 2mm; margin: 4mm 0; font-size: 9pt; }
  .guide-toc a {
    border: 1px solid #d7dee6; border-radius: 999px; padding: 0.8mm 3mm;
    color: #1f5fa0; text-decoration: none;
  }
  .guide-ok, .guide-warn { border-radius: 4px; padding: 2.5mm 3.5mm; break-inside: avoid; }
  .guide-ok { background: #e9f6ef; border: 1px solid #b5dfc7; }
  .guide-warn { background: #fdf3e3; border: 1px solid #efd3a3; }
  .guide-check { list-style: none; }
  .guide-check li::before { content: '☐  '; margin-left: -5mm; color: #1f5fa0; }
  dt { font-weight: bold; margin-top: 3.5mm; break-after: avoid; }
  dd { margin: 1mm 0 0 0; }
  .muted { color: #5b6875; }
</style>
</head>
<body>
  <p class="meta">Pico MultiView v${VERSION} · la stessa guida è nel pulsante «Guida» dentro l'app</p>
  ${guideFromApp()}
</body>
</html>`;

const installTab = await browser.newPage();
await installTab.setContent(installPage, { waitUntil: 'networkidle' });
await installTab.emulateMedia({ media: 'print' });
await installTab.pdf({
  path: OUTPUT_INSTALL,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: footer.replace('Guida passo passo', 'Installazione e uso senza internet'),
  margin: { top: '14mm', bottom: '16mm', left: '0mm', right: '0mm' },
});

await browser.close();

const sizeInstall = (fs.statSync(OUTPUT_INSTALL).size / 1024).toFixed(0);
console.log(`Guida generata: ${path.relative(ROOT, OUTPUT_INSTALL)} (${sizeInstall} KB)`);
