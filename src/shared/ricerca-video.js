// Cosa dire all'operatore dopo una ricerca dei filmati sui visori.
//
// Sta a parte, e non dentro app.js, perché sono frasi da provare: «nessun
// filmato trovato» detto e basta ha già fatto perdere tempo. Un visore vuoto,
// una ricerca fallita e un visore che non è nemmeno collegato si somigliano
// sullo schermo e hanno tre rimedi diversi.

import { VIDEO_EXTENSIONS } from './formati-video.js';

/** Una riga per visore: cosa ha trovato, o perché non ha potuto cercare. */
export function rigaEsito(esito) {
  if (!esito.ok) {
    if (esito.errore === 'non collegato') return `${esito.nome}: non collegato, non ho potuto cercare`;
    return `${esito.nome}: ricerca non riuscita — ${esito.errore}`;
  }
  const dove = esito.radici?.length ? ` in ${esito.radici.join(', ')}` : ' (il visore non mostra la sua memoria)';
  if (esito.file === 0) return `${esito.nome}: nessun file video${dove}`;
  return `${esito.nome}: ${esito.file} file${dove}`;
}

/**
 * Il riepilogo della ricerca.
 *
 * @param filmati quanti filmati diversi sono stati trovati in tutto
 * @param esiti   un esito per visore, come li restituisce videoLibrary
 * @returns {{ titolo: string, righe: string[], consiglio: string|null }}
 *   `righe` elenca i visori da guardare: tutti se non è stato trovato niente,
 *   solo quelli con un problema altrimenti.
 */
export function descriviRicerca(filmati, esiti) {
  if (!esiti.length) {
    return {
      titolo: 'Nessun visore da interrogare: mettine almeno uno in una postazione.',
      righe: [],
      consiglio: null,
    };
  }
  const falliti = esiti.filter((e) => !e.ok);
  const vuoti = esiti.filter((e) => e.ok && e.file === 0);
  const formati = VIDEO_EXTENSIONS.join(', ');

  if (filmati === 0) {
    const titolo =
      falliti.length === esiti.length
        ? 'La ricerca non è riuscita su nessun visore.'
        : 'Nessun filmato trovato sui visori.';
    return {
      titolo,
      righe: esiti.map(rigaEsito),
      consiglio: vuoti.length
        ? `I filmati vanno copiati nella memoria del visore — va bene qualunque cartella, ` +
          `per esempio Movies o Download, ma non dentro Android — in uno di questi formati: ${formati}. ` +
          'Poi premi «Rileggi i file».'
        : null,
    };
  }

  const problemi = [...falliti, ...vuoti];
  return {
    titolo: `${filmati} filmati trovati`,
    righe: problemi.map(rigaEsito),
    consiglio: null,
  };
}
