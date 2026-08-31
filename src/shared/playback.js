// Conti e formati della barra del filmato. Stanno qui, fuori dalla finestra e
// fuori dal processo principale, perché sono la parte che si può provare senza
// un visore e senza aprire l'app — ed è la parte in cui un errore si vedrebbe
// come una barra che va a scatti o che dice l'ora sbagliata.

/** «1:23», «1:02:03». Meno di un'ora resta corta: è la lunghezza tipica. */
export function formattaTempo(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '–';
  const totale = Math.floor(ms / 1000);
  const s = totale % 60;
  const m = Math.floor(totale / 60) % 60;
  const h = Math.floor(totale / 3600);
  const due = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${due(m)}:${due(s)}` : `${m}:${due(s)}`;
}

/**
 * Dove sarà il filmato adesso, partendo da una lettura di qualche istante fa.
 *
 * Le letture al visore costano un comando ciascuna e non si possono chiedere
 * dieci volte al secondo: fra una e l'altra si conta il tempo che passa. Da
 * ferma, invece, una posizione vecchia è ancora giusta.
 */
export function stimaPosizione(lettura, adesso = Date.now()) {
  if (!lettura || lettura.positionMs == null) return null;
  if (lettura.state !== 'in riproduzione') return lettura.positionMs;
  const trascorso = Math.max(0, adesso - (lettura.letto ?? adesso));
  const stimata = lettura.positionMs + trascorso * (lettura.speed || 1);
  // Non si va oltre la fine: senza questo, un filmato finito continuerebbe a
  // far correre la barra all'infinito.
  return lettura.durationMs ? Math.min(stimata, lettura.durationMs) : stimata;
}

/**
 * Il riassunto che finisce nella barra: dove sono i visori, e quanto sono
 * distanti fra loro.
 *
 * La distanza è il dato che non si può leggere altrove. Dieci visori «in
 * riproduzione» possono essere a mezzo minuto l'uno dall'altro, e in sala si
 * scopre solo guardandoli: qui si vede.
 */
export function riepilogo(letture, adesso = Date.now()) {
  const posizioni = letture
    .map((l) => ({ ...l, ora: stimaPosizione(l, adesso) }))
    .filter((l) => l.ora != null);
  if (!posizioni.length) return null;
  const ore = posizioni.map((p) => p.ora).sort((a, b) => a - b);
  const durate = posizioni.map((p) => p.durationMs).filter(Boolean);
  return {
    // La testa del gruppo: è quella che l'operatore vede sul visore che guarda.
    positionMs: ore[Math.floor(ore.length / 2)],
    minMs: ore[0],
    maxMs: ore[ore.length - 1],
    spreadMs: ore[ore.length - 1] - ore[0],
    durationMs: durate.length ? Math.max(...durate) : null,
    name: posizioni.find((p) => p.name)?.name ?? null,
    quanti: posizioni.length,
    // «In riproduzione» solo se lo sono tutti: basta un visore fermo perché il
    // pulsante debba proporre di farli ripartire.
    inRiproduzione: posizioni.every((p) => p.state === 'in riproduzione'),
  };
}

/**
 * Cosa deve dire la barra, viste le letture arrivate.
 *
 * Sta qui, e non nella finestra, perché è una decisione — quando un pulsante
 * serve, quando una spiegazione va data — e le decisioni si provano. Nella
 * finestra resta il mestiere di scriverla a schermo.
 *
 * @param sintesi   riepilogo delle letture, o null se nessuno ha risposto
 * @param mandati   i filmati che abbiamo mandato noi e risultano in corso
 */
export function statoBarra(sintesi, mandati = []) {
  if (!sintesi) {
    return {
      nome: mandati[0]?.name ?? 'Nessun filmato in corso',
      tempo: '–',
      quota: 0,
      etichettaPausa: 'Pausa a tutti',
      // I tasti del lettore si mandano anche senza sapere dove sia il filmato:
      // è il salto che, senza posizione, non ha un bersaglio.
      pausaAttiva: mandati.length > 0,
      saltoAttivo: false,
      nota: mandati.length
        ? 'il lettore del visore non dice a che punto è: pausa e «da capo» funzionano lo stesso, il salto no'
        : 'mandane uno da «Video…»',
    };
  }
  const durata = sintesi.durationMs;
  const distanti = Boolean(durata) && sintesi.spreadMs > 1500 && sintesi.quanti > 1;
  return {
    nome: sintesi.name ?? mandati[0]?.name ?? 'Filmato in corso',
    tempo: durata
      ? `${formattaTempo(sintesi.positionMs)} / ${formattaTempo(durata)}`
      : formattaTempo(sintesi.positionMs),
    quota: durata ? Math.max(0, Math.min(100, (sintesi.positionMs / durata) * 100)) : 0,
    etichettaPausa: sintesi.inRiproduzione ? 'Pausa a tutti' : 'Riprendi tutti',
    pausaAttiva: true,
    // Senza durata non si sa a quale istante corrisponda il punto cliccato.
    saltoAttivo: Boolean(durata),
    distanti,
    nota: durata
      ? distanti
        ? `${sintesi.quanti} visori, ${formattaTempo(sintesi.spreadMs)} di scarto`
        : `${sintesi.quanti} visori allineati`
      : 'durata sconosciuta: il filmato non è ancora nell\'indice del visore',
  };
}
