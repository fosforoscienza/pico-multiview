// Crediti e logo, in un posto solo così app e guida PDF non vanno mai in
// disaccordo.
//
// I file del logo stanno in assets/brand/ e sono facoltativi: finché non ci
// sono, resta il solo testo dei crediti. Vedi assets/brand/README.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND_DIR = path.join(ROOT, 'assets', 'brand');

export const CREDIT = '© 2026 Brown Enterprises Srls';

/** Estensioni accettate, in ordine di preferenza: l'SVG resta nitido ovunque. */
const EXTENSIONS = ['.svg', '.png'];

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png' };

/**
 * Percorso del logo, o null se non è stato ancora caricato.
 * @param variant 'bianco' (per sfondi scuri) | 'nero' (per sfondi chiari)
 */
export function brandLogoPath(variant) {
  for (const ext of EXTENSIONS) {
    const candidate = path.join(BRAND_DIR, `brown-enterprises-${variant}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Logo come data URI, pronto da mettere in un <img>. Passa dallo stesso canale
 * dei dati dell'app, quindi funziona identico nella finestra sul Mac e nel
 * telecomando via browser, senza rotte o percorsi da gestire.
 */
export function brandLogoDataUri(variant) {
  const file = brandLogoPath(variant);
  if (!file) return null;
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file).toString('base64');
  return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${data}`;
}

/** Blocco crediti da mandare all'interfaccia. Lo sfondo dell'app è scuro. */
export function brandForUi() {
  return { credit: CREDIT, logo: brandLogoDataUri('bianco') };
}
