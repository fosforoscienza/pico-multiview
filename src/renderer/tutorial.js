// Il giro guidato dell'interfaccia: un riflettore sul pezzo di cui si parla,
// il resto in penombra, un testo che spiega, «Avanti» e «Termina».
//
// Il riflettore è un buco: un riquadro trasparente sopra l'elemento, con
// un'ombra sterminata tutt'attorno che scurisce tutto il resto. Un solo
// elemento da muovere, niente da calcolare quattro volte.

const $ = (id) => document.getElementById(id);

let passi = [];
let indice = -1;
let buco = null;
let scheda = null;

function elementoDi(passo) {
  const el = document.querySelector(passo.selettore);
  // Un passo il cui pezzo non è a schermo in questo momento (la barra del
  // filmato senza filmato, un pulsante solo-iPad) si salta senza drammi: il
  // giro racconta quello che c'è.
  if (!el || el.offsetParent === null) return null;
  return el;
}

function disegna() {
  const passo = passi[indice];
  const el = elementoDi(passo);
  if (!el) return avanti();

  const r = el.getBoundingClientRect();
  const margine = 6;
  Object.assign(buco.style, {
    left: `${r.left - margine}px`,
    top: `${r.top - margine}px`,
    width: `${r.width + margine * 2}px`,
    height: `${r.height + margine * 2}px`,
  });

  scheda.querySelector('.tutorial-title').textContent = passo.titolo;
  scheda.querySelector('.tutorial-text').textContent = passo.testo;
  scheda.querySelector('.tutorial-count').textContent = `${indice + 1} di ${passi.length}`;
  scheda.querySelector('.tutorial-next').textContent = indice === passi.length - 1 ? 'Fine' : 'Avanti';

  // La scheda sta sotto il riflettore se c'è posto, sopra altrimenti: mai
  // addosso al pezzo di cui sta parlando.
  const altezza = scheda.offsetHeight || 160;
  const sotto = r.bottom + margine + altezza + 16 < window.innerHeight;
  scheda.style.top = sotto ? `${r.bottom + margine + 10}px` : `${Math.max(10, r.top - margine - altezza - 10)}px`;
  scheda.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - scheda.offsetWidth - 10))}px`;
}

function avanti() {
  indice += 1;
  if (indice >= passi.length) return termina();
  disegna();
}

function termina() {
  buco?.remove();
  scheda?.remove();
  buco = null;
  scheda = null;
  indice = -1;
  window.removeEventListener('resize', disegna);
  document.removeEventListener('keydown', suiTasti);
}

function suiTasti(e) {
  if (e.key === 'Escape') termina();
  if (e.key === 'Enter' || e.key === 'ArrowRight') avanti();
}

export function avviaTutorial(listaPassi) {
  if (buco) termina();
  passi = listaPassi;
  indice = -1;

  buco = document.createElement('div');
  buco.className = 'tutorial-hole';

  scheda = document.createElement('div');
  scheda.className = 'tutorial-card';
  scheda.innerHTML = `
    <div class="tutorial-head">
      <strong class="tutorial-title"></strong>
      <span class="tutorial-count muted"></span>
    </div>
    <p class="tutorial-text"></p>
    <div class="tutorial-actions">
      <button type="button" class="btn tutorial-quit">Termina tutorial</button>
      <button type="button" class="btn btn-primary tutorial-next">Avanti</button>
    </div>`;
  scheda.querySelector('.tutorial-next').addEventListener('click', avanti);
  scheda.querySelector('.tutorial-quit').addEventListener('click', termina);

  document.body.append(buco, scheda);
  window.addEventListener('resize', disegna);
  document.addEventListener('keydown', suiTasti);
  avanti();
}
