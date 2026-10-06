import assert from 'node:assert/strict';
import test from 'node:test';

import { formattaTempo, letturaStimata, riepilogo, statoBarra, stimaPosizione } from '../src/shared/playback.js';

// La barra del filmato si muove fra una lettura e l'altra: questi conti sono
// la parte che, sbagliata, si vedrebbe come una barra a scatti o bugiarda.

test('il tempo si legge come su un lettore', () => {
  assert.equal(formattaTempo(0), '0:00');
  assert.equal(formattaTempo(83000), '1:23');
  assert.equal(formattaTempo(3723000), '1:02:03');
  // Meglio un trattino che uno zero inventato: la durata può non esserci.
  assert.equal(formattaTempo(null), '–');
  assert.equal(formattaTempo(-5), '–');
});

test('fra una lettura e l\'altra la barra continua da sola', () => {
  // Le letture costano un comando adb per visore: si chiedono ogni due
  // secondi, e nel frattempo si conta il tempo che passa.
  const lettura = { positionMs: 10000, state: 'in riproduzione', speed: 1, letto: 1000 };
  assert.equal(stimaPosizione(lettura, 1000), 10000);
  assert.equal(stimaPosizione(lettura, 2500), 11500);
});

test('da ferma una lettura vecchia è ancora giusta', () => {
  const ferma = { positionMs: 10000, state: 'in pausa', letto: 1000 };
  assert.equal(stimaPosizione(ferma, 99000), 10000, 'in pausa il filmato non si muove');
});

test('la barra non corre oltre la fine del filmato', () => {
  const quasiFinito = { positionMs: 59000, durationMs: 60000, state: 'in riproduzione', speed: 1, letto: 0 };
  assert.equal(stimaPosizione(quasiFinito, 120000), 60000);
});

test('il riepilogo dice quanto sono distanti i visori', () => {
  // È il dato che non si legge altrove: dieci visori «in riproduzione»
  // possono essere a mezzo minuto l'uno dall'altro, e in sala si scopre tardi.
  const letture = [
    { positionMs: 30000, durationMs: 600000, state: 'in riproduzione', speed: 1, letto: 0, name: 'tour.mp4' },
    { positionMs: 45000, durationMs: 600000, state: 'in riproduzione', speed: 1, letto: 0 },
    { positionMs: 38000, durationMs: 600000, state: 'in riproduzione', speed: 1, letto: 0 },
  ];
  const s = riepilogo(letture, 0);
  assert.equal(s.spreadMs, 15000);
  assert.equal(s.minMs, 30000);
  assert.equal(s.maxMs, 45000);
  assert.equal(s.positionMs, 38000, 'la posizione mostrata è quella di mezzo, non la media');
  assert.equal(s.name, 'tour.mp4');
  assert.equal(s.quanti, 3);
});

test('basta un visore fermo perché il gruppo non sia «in riproduzione»', () => {
  // Da lì il pulsante deve proporre di farli ripartire tutti, non di fermarli:
  // altrimenti un visore rimasto indietro resterebbe indietro per sempre.
  const letture = [
    { positionMs: 1000, state: 'in riproduzione', letto: 0 },
    { positionMs: 1000, state: 'in pausa', letto: 0 },
  ];
  assert.equal(riepilogo(letture, 0).inRiproduzione, false);
});

test('senza letture non c\'è barra da mostrare', () => {
  assert.equal(riepilogo([]), null);
  assert.equal(riepilogo([{ positionMs: null }]), null);
});

test('senza filmato la barra resta, e dice cosa fare', () => {
  // Nasconderla sarebbe la cosa peggiore: una riga che a volte c'è e a volte
  // no, per chi guarda, è un guasto — non una scelta di stile.
  const b = statoBarra(null, []);
  assert.equal(b.nome, 'Nessun filmato in corso');
  assert.match(b.nota, /Video…/);
  assert.equal(b.pausaAttiva, false, 'non c\'è niente da fermare');
  assert.equal(b.saltoAttivo, false);
});

test('un lettore muto non spegne pausa e «da capo»', () => {
  // Mandare i tasti del lettore non richiede di sapere dove sia il filmato:
  // è solo il salto che, senza posizione, non ha un bersaglio.
  const b = statoBarra(null, [{ name: 'tour.mp4' }]);
  assert.equal(b.nome, 'tour.mp4');
  assert.equal(b.pausaAttiva, true);
  assert.equal(b.saltoAttivo, false);
  assert.match(b.nota, /pausa e «da capo» funzionano lo stesso/);
});

test('senza durata la barra non è cliccabile, e lo dice', () => {
  // Un punto sulla riga non corrisponde a nessun istante finché non si sa
  // quanto dura il filmato: cliccarlo manderebbe i visori a caso.
  const sintesi = riepilogo([{ positionMs: 5000, state: 'in pausa', letto: 0 }], 0);
  const b = statoBarra(sintesi, []);
  assert.equal(b.saltoAttivo, false);
  assert.equal(b.tempo, '0:05');
  assert.match(b.nota, /durata sconosciuta/);
});

test('con tutto al suo posto la barra è viva', () => {
  const sintesi = riepilogo(
    [{ positionMs: 30000, durationMs: 120000, state: 'in riproduzione', speed: 1, letto: 0, name: 'tour.mp4' }],
    0,
  );
  const b = statoBarra(sintesi, []);
  // Il conto alla rovescia sta accanto al tempo: in sala la domanda vera è
  // «quanto manca», non «a che punto siamo».
  assert.equal(b.tempo, '0:30 / 2:00 · −1:30');
  assert.equal(b.quota, 25);
  assert.equal(b.etichettaPausa, 'Pausa a tutti');
  assert.equal(b.saltoAttivo, true);
  assert.match(b.nota, /allineati/);
});

test('se i visori sono sparpagliati il pulsante propone di riprenderli', () => {
  const sintesi = riepilogo(
    [
      { positionMs: 10000, durationMs: 120000, state: 'in pausa', letto: 0 },
      { positionMs: 40000, durationMs: 120000, state: 'in riproduzione', speed: 1, letto: 0 },
    ],
    0,
  );
  const b = statoBarra(sintesi, []);
  assert.equal(b.etichettaPausa, 'Riprendi tutti');
  assert.equal(b.distanti, true);
  assert.match(b.nota, /di scarto/);
});

test('quando il lettore non si legge, il pulsante alterna e ricorda', () => {
  // Senza lettura non si sa se i visori sono fermi o in moto: il pulsante
  // ricorda l\'ultimo ordine dato e propone l\'altro. Non è elegante, è onesto
  // — e senza, chi ferma non può più riprendere.
  const fermo = statoBarra(null, [{ name: 'tour.mp4' }], { prossimaAzione: 'pause' });
  assert.equal(fermo.etichettaPausa, 'Pausa a tutti');
  const riparti = statoBarra(null, [{ name: 'tour.mp4' }], { prossimaAzione: 'play' });
  assert.equal(riparti.etichettaPausa, 'Riprendi tutti');
});

test('quando il lettore tace, l\'orologio di bordo tiene la barra viva', () => {
  // Il lettore PICO non dice a che punto è, ma l\'avvio e le pause li
  // ordiniamo noi: la posizione è il tempo passato in moto. È una stima, e la
  // barra lo scrive — mai spacciarla per la parola del lettore.
  const playing = { name: 'tour.mp4', durationMs: 600000, startedAt: 1000, pausedAt: null, pausedMs: 0 };
  const lettura = letturaStimata(playing, 61000);
  assert.equal(lettura.positionMs, 60000);
  assert.equal(lettura.state, 'in riproduzione');
  assert.equal(lettura.stimata, true);

  const sintesi = riepilogo([lettura], 61000);
  const b = statoBarra(sintesi, []);
  assert.match(b.tempo, /1:00 \/ 10:00 · −9:00/, 'posizione, durata e conto alla rovescia');
  assert.match(b.nota, /stimato/);
  assert.equal(b.saltoAttivo, true);
});

test('l\'orologio di bordo conta solo il tempo in moto', () => {
  // Due minuti di filmato, di cui trenta secondi passati in pausa: la
  // posizione è un minuto e mezzo. Le pause ordinate da qui si sottraggono.
  const playing = { name: 'tour.mp4', durationMs: 600000, startedAt: 0, pausedAt: null, pausedMs: 30000 };
  assert.equal(letturaStimata(playing, 120000).positionMs, 90000);
  // In pausa adesso: la posizione è ferma all\'istante della pausa.
  const fermo = { ...playing, pausedAt: 100000 };
  const lettura = letturaStimata(fermo, 999000);
  assert.equal(lettura.positionMs, 70000);
  assert.equal(lettura.state, 'in pausa');
});

test('a filmato finito il conto si ferma a zero, non va sotto', () => {
  const playing = { name: 'tour.mp4', durationMs: 60000, startedAt: 0, pausedAt: null, pausedMs: 0 };
  const lettura = letturaStimata(playing, 300000);
  assert.equal(lettura.positionMs, 60000, 'la barra si ferma alla fine');
  assert.equal(lettura.state, 'in pausa');
  const b = statoBarra(riepilogo([lettura], 300000), []);
  assert.match(b.tempo, /−0:00/);
});

test('senza durata il tempo scorre, ma il conto alla rovescia no', () => {
  // Un file non ancora nell'indice del visore non ha durata: mezzo orologio —
  // il tempo trascorso — è meglio di nessun orologio, purché non inventi
  // quanto manca.
  const lettura = letturaStimata({ name: 'x', startedAt: 0, durationMs: null, pausedAt: null, pausedMs: 0 }, 65000);
  assert.equal(lettura.positionMs, 65000);
  assert.equal(lettura.durationMs, null);
  const b = statoBarra(riepilogo([lettura], 65000), []);
  assert.equal(b.tempo, '1:05', 'solo il trascorso, nessun countdown inventato');
  assert.equal(b.saltoAttivo, false);
  assert.equal(letturaStimata(null), null);
});

test('le etichette dicono su chi agiranno i pulsanti', () => {
  // Di default su tutti; con una selezione, solo sugli scelti — e va scritto
  // sul pulsante, non lasciato indovinare.
  const sintesi = riepilogo(
    [{ positionMs: 1000, durationMs: 60000, state: 'in riproduzione', speed: 1, letto: 0 }],
    0,
  );
  assert.equal(statoBarra(sintesi, []).etichettaPausa, 'Pausa a tutti');
  assert.equal(statoBarra(sintesi, [], { scelti: 2 }).etichettaPausa, 'Pausa sui 2 scelti');
});
