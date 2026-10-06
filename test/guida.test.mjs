import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

test('il pulsante Guida sta nella barra in alto, visibile anche dal telecomando', () => {
  const barra = html.slice(html.indexOf('class="topbar-actions"'), html.indexOf('class="commandbar"'));
  const pulsante = barra.match(/<button id="btn-guide"[^>]*>([^<]*)<\/button>/);
  assert.ok(pulsante, 'manca btn-guide fra le azioni della barra in alto');
  assert.equal(pulsante[1].trim(), 'Guida');
  assert.ok(!pulsante[0].includes('desktop-only'), "la guida serve anche dall'iPad");
});

test('la guida è scritta nella pagina, non caricata da internet', () => {
  // Va letta proprio quando internet non c'è: niente link esterni da seguire.
  const guida = html.slice(html.indexOf('id="guide-modal"'), html.indexOf('id="log-panel"'));
  assert.ok(guida.includes('id="guida-installa"'));
  assert.ok(!/<(a|link|script|img|iframe)\b[^>]*(href|src)="https?:/.test(guida));
  for (const [, id] of guida.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(html.includes(`id="${id}"`), `l'indice punta a #${id}, che non esiste`);
  }
});

test('Esc chiude la guida come le altre finestre', () => {
  const riga = app.match(/const openModal = \[([^\]]*)\]/);
  assert.ok(riga?.[1].includes("'guide-modal'"));
});

test('lo script di installazione esiste, è eseguibile e la guida lo chiama per nome', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = new URL('../installa-mac.sh', import.meta.url);
  assert.ok(fs.statSync(script).mode & 0o111, 'installa-mac.sh non è eseguibile');
  execFileSync('bash', ['-n', script.pathname]); // solo sintassi: gira davvero solo su macOS
  assert.ok(html.includes('$U/installa-mac.sh'), 'la guida non usa installa-mac.sh');
});
