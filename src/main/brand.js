// Crediti e logo, in un posto solo così app e guida PDF non vanno mai in
// disaccordo.
//
// I file del logo stanno in assets/brand/ e sono facoltativi: finché non ci
// sono, resta il solo testo dei crediti. Vedi assets/brand/README.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRAND_DIR = path.join(ROOT, 'assets', 'brand');

export const CREDIT = '© 2026 Brown Enterprises Srls';

/**
 * Versione mostrata a schermo e nella guida, letta da package.json così non ci
 * sono due numeri che possono divergere.
 *
 * Le regole: il primo numero cambia per le modifiche corpose (1.4 → 2.0), il
 * secondo per quelle piccole (1.4 → 1.5). La terza cifra del package.json
 * esiste solo perché npm pretende il semver, e non si mostra.
 */
export const VERSION = (() => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const [major, minor] = version.split('.');
  return `${major}.${minor ?? 0}`;
})();

/** Estensioni accettate, in ordine di preferenza: l'SVG resta nitido ovunque. */
const EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];

const MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Trova il logo di una variante. Il riconoscimento è per parola contenuta nel
 * nome ("bianco" o "nero"), non per nome esatto: i file li carica chi possiede
 * il marchio, spesso trascinandoli su GitHub, e non ha senso far dipendere il
 * funzionamento da un trattino o da un refuso nel nome.
 *
 * @param variant 'bianco' (per sfondi scuri) | 'nero' (per sfondi chiari)
 * @param dir cartella da guardare (parametrico per i test)
 */
export function brandLogoPath(variant, dir = BRAND_DIR) {
  let candidates;
  try {
    candidates = fs.readdirSync(dir);
  } catch {
    return null; // cartella assente: nessun logo, e va benissimo
  }

  const matching = candidates
    .filter((name) => name.toLowerCase().includes(variant))
    .filter((name) => EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .sort((a, b) => {
      const rank = (n) => EXTENSIONS.indexOf(path.extname(n).toLowerCase());
      return rank(a) - rank(b) || a.localeCompare(b); // a parità, ordine stabile
    });

  return matching.length ? path.join(dir, matching[0]) : null;
}

/**
 * Logo come data URI, pronto da mettere in un <img>. Passa dallo stesso canale
 * dei dati dell'app, quindi funziona identico nella finestra sul Mac e nel
 * telecomando via browser, senza rotte o percorsi da gestire.
 */
export function brandLogoDataUri(variant, dir = BRAND_DIR) {
  const file = brandLogoPath(variant, dir);
  if (!file) return null;
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file).toString('base64');
  return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${data}`;
}

/** Blocco crediti da mandare all'interfaccia. Lo sfondo dell'app è scuro. */
export function brandForUi() {
  return { credit: CREDIT, version: VERSION, logo: brandLogoDataUri('bianco') };
}
