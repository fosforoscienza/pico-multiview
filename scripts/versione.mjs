// Cambia il numero di versione dove serve, in un colpo solo.
//
// Perché esiste: il numero sta in package.json e in DUE punti di
// package-lock.json. Cambiandone uno solo, "npm install" riscrive il lock per
// allinearlo, e chi aggiorna si ritrova un file modificato che non ha toccato:
// il "git pull" successivo si rifiuta di procedere. È già successo.
//
//   node scripts/versione.mjs 1.6
//   node scripts/versione.mjs 1.6.0

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const arg = process.argv[2];
if (!arg) {
  console.error('Uso: node scripts/versione.mjs <numero>   (per esempio 1.6)');
  process.exit(1);
}
if (!/^\d+\.\d+(\.\d+)?$/.test(arg)) {
  console.error(`"${arg}" non è un numero di versione: serve qualcosa come 1.6 o 1.6.0`);
  process.exit(1);
}
const version = arg.split('.').length === 2 ? `${arg}.0` : arg;

const leggi = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const scrivi = (file, dati) =>
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(dati, null, 2)}\n`, 'utf8');

const pkg = leggi('package.json');
const precedente = pkg.version;
pkg.version = version;
scrivi('package.json', pkg);

const lock = leggi('package-lock.json');
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
scrivi('package-lock.json', lock);

console.log(`versione ${precedente} → ${version} (package.json + package-lock.json)`);
console.log('ricordati di rigenerare la guida:  npm run guida');
