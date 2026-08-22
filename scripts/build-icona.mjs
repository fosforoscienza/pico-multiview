#!/usr/bin/env node
// Dall'SVG dell'icona genera il PNG e il file .icns che macOS usa per l'app.
//
//   npm run icona
//
// Il PNG serve anche a chi vuole riusare l'icona altrove; l'.icns è quello che
// il Finder legge dentro "Pico Multiview.app".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(ROOT, 'assets', 'icona', 'pico-multiview.svg');
const PNG = path.join(ROOT, 'assets', 'icona', 'pico-multiview.png');
const ICNS = path.join(ROOT, 'Pico Multiview.app', 'Contents', 'Resources', 'pico-multiview.icns');

/**
 * Fette che macOS si aspetta in un .icns, con il codice di quattro lettere che
 * le identifica. Dalle versioni moderne il contenuto può essere direttamente un
 * PNG, il che rende il formato semplice da scrivere a mano.
 */
const SLICES = [
  ['ic11', 32], // 16pt @2x
  ['ic12', 64], // 32pt @2x
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256], // 128pt @2x
  ['ic09', 512],
  ['ic14', 512], // 256pt @2x
  ['ic10', 1024], // 512pt @2x
];

async function loadChromium() {
  try {
    const pw = await import('playwright');
    return pw.chromium ?? pw.default.chromium;
  } catch {
    const globalPath = '/opt/node22/lib/node_modules/playwright/index.js';
    if (fs.existsSync(globalPath)) {
      const pw = await import(pathToFileURL(globalPath).href);
      return pw.chromium ?? pw.default.chromium;
    }
    throw new Error('Playwright non trovato: esegui "npm i -D playwright && npx playwright install chromium"');
  }
}

const svgSource = fs.readFileSync(SVG, 'utf8');

/**
 * Disegna l'SVG alla dimensione richiesta e restituisce il PNG.
 * L'SVG viene messo dentro una pagina HTML invece di essere aperto da solo: un
 * documento SVG non ha <body>, e senza quello non si può imporre la dimensione.
 */
async function renderPng(page, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}
     svg{width:${size}px;height:${size}px;display:block}</style>${svgSource}`,
    { waitUntil: 'load' },
  );
  return page.screenshot({ omitBackground: true });
}

function buildIcns(images) {
  const chunks = [];
  for (const [type, buffer] of images) {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(buffer.length + 8, 4);
    chunks.push(header, buffer);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

const chromium = await loadChromium();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

// Una sola resa per dimensione, riusata dalle fette che chiedono gli stessi pixel.
const perSize = new Map();
for (const [, size] of SLICES) {
  if (!perSize.has(size)) perSize.set(size, await renderPng(page, size));
}
await browser.close();

fs.mkdirSync(path.dirname(PNG), { recursive: true });
fs.writeFileSync(PNG, perSize.get(1024));

fs.mkdirSync(path.dirname(ICNS), { recursive: true });
fs.writeFileSync(ICNS, buildIcns(SLICES.map(([type, size]) => [type, perSize.get(size)])));

console.log(`PNG:  ${path.relative(ROOT, PNG)} (${(perSize.get(1024).length / 1024).toFixed(0)} KB)`);
console.log(`ICNS: ${path.relative(ROOT, ICNS)} (${(fs.statSync(ICNS).size / 1024).toFixed(0)} KB, ${SLICES.length} dimensioni)`);
