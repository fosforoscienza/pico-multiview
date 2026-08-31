// Gestione applicazioni sul visore: elenco pacchetti, avvio, chiusura,
// app in primo piano, batteria. Tutto via "adb shell".

import { adb, shell, adbTry, delay } from './adb.js';

/** Pacchetti che non ha senso mostrare nella libreria app. */
const SYSTEM_PREFIXES = [
  'com.android.',
  'com.google.',
  'android.',
  'com.qualcomm.',
  'com.pico.settings',
  'com.picovr.assistantphoneservice',
];

export function isInterestingPackage(pkg) {
  return !SYSTEM_PREFIXES.some((p) => pkg.startsWith(p));
}

/** Elenco dei pacchetti installati dall'utente (-3 = non di sistema). */
export async function listPackages(serial, { includeSystem = false } = {}) {
  const out = await shell(serial, `pm list packages${includeSystem ? '' : ' -3'}`);
  return out
    .split('\n')
    .map((l) => l.trim().replace(/^package:/, ''))
    .filter(Boolean)
    .filter((p) => includeSystem || isInterestingPackage(p))
    .sort();
}

/**
 * Avvia un'app. Se è nota l'activity usa "am start -n", altrimenti chiede al
 * monkey di lanciare l'intent LAUNCHER del pacchetto (funziona anche quando
 * non conosciamo il nome dell'activity, come succede spesso sui visori).
 */
export async function launchApp(serial, pkg, activity = null) {
  if (activity) {
    const target = activity.includes('/') ? activity : `${pkg}/${activity}`;
    return shell(serial, `am start -n ${target}`, { timeout: 20000 });
  }
  return shell(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, { timeout: 20000 });
}

export async function stopApp(serial, pkg) {
  return shell(serial, `am force-stop ${pkg}`, { timeout: 20000 });
}

/** Torna alla home del visore (KEYCODE_HOME). */
export async function goHome(serial) {
  return shell(serial, 'input keyevent 3');
}

/** Pacchetto attualmente in primo piano, o null. */
export async function foregroundPackage(serial) {
  const res = await adbTry([
    '-s',
    serial,
    'shell',
    "dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | head -n 1",
  ]);
  if (!res.ok) return null;
  const m = /\s([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.$]+)/.exec(res.out || '');
  return m ? m[1] : null;
}

export async function batteryLevel(serial) {
  const res = await adbTry(['-s', serial, 'shell', 'dumpsys battery | grep level']);
  if (!res.ok) return null;
  const m = /level:\s*(\d+)/.exec(res.out || '');
  return m ? Number(m[1]) : null;
}

/** Info statiche del visore (modello, nome, versione PICO OS). */
export async function deviceInfo(serial) {
  const res = await adbTry([
    '-s',
    serial,
    'shell',
    'getprop ro.product.model; getprop ro.product.device; getprop ro.build.version.release; getprop persist.pico.device.name; getprop ro.serialno',
  ]);
  const [model, device, android, name, hardwareId] = (res.out || '').split('\n').map((s) => s.trim());
  return {
    model: model || null,
    device: device || null,
    android: android || null,
    name: name || null,
    // Identità della macchina, uguale via cavo e via wifi: serve a non
    // registrare due volte lo stesso visore.
    hardwareId: hardwareId || null,
  };
}

/** Volume media: delta positivo o negativo espresso in "scatti". */
export async function changeVolume(serial, steps) {
  const key = steps > 0 ? 24 : 25; // VOLUME_UP / VOLUME_DOWN
  const n = Math.min(Math.abs(steps), 15);
  return shell(serial, Array.from({ length: n }, () => `input keyevent ${key}`).join('; '));
}

/**
 * Tap/swipe di riserva quando non passiamo dal canale di controllo scrcpy.
 *
 * `source` sceglie da quale periferica finta arriva l'evento. Serve perché i
 * visori PICO **ignorano** i tocchi che dicono di venire dal touchscreen — non
 * ne hanno uno — mentre accettano gli stessi eventi dichiarati come trackball.
 */
export async function inputTap(serial, x, y, source = '', displayId = null) {
  return shell(serial, tapCommand(x, y, source, displayId), { timeout: 8000 });
}

/**
 * Il comando `input` per un tocco, costruito a parte perché va anche scritto
 * nel registro: se il visore non reagisce, è la riga da riprovare a mano.
 *
 * `-d` sceglie lo schermo. Su un visore ce n'è più d'uno — quello stereo che
 * si vede e quelli virtuali su cui girano i pannelli 2D — e un tocco mandato
 * allo schermo sbagliato non raggiunge nessuna finestra.
 */
export function tapCommand(x, y, source = '', displayId = null) {
  const parti = ['input'];
  if (source) parti.push(source);
  if (displayId != null) parti.push('-d', String(displayId));
  parti.push('tap', String(Math.round(x)), String(Math.round(y)));
  return parti.join(' ');
}

export async function inputSwipe(serial, x1, y1, x2, y2, durationMs = 120, source = '') {
  const da = source ? `${source} ` : '';
  return shell(
    serial,
    `input ${da}swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(durationMs)}`,
    { timeout: 8000 },
  );
}

export async function inputKeyevent(serial, keycode) {
  return shell(serial, `input keyevent ${keycode}`, { timeout: 8000 });
}

/** Più tasti in una volta sola: `input` li accetta in fila, ed è molto più
 * svelto di un comando per ciascuno — conta quando ne servono venti. */
export async function inputKeyevents(serial, keycodes) {
  if (!keycodes.length) return null;
  return shell(serial, `input keyevent ${keycodes.join(' ')}`, { timeout: 15000 });
}

export async function reboot(serial) {
  return adbTry(['-s', serial, 'reboot']);
}

/**
 * Dimensione in pixel dello schermo del visore, quella vera: serve a costruire
 * il ritaglio, che scrcpy vuole in pixel dello schermo e non del video (che è
 * già rimpicciolito da `max_size`).
 *
 * "Override size" vince su "Physical size": se qualcuno ha forzato una
 * risoluzione diversa, è quella che scrcpy vede.
 */
export function parseDisplaySize(text) {
  const misure = [...(text || '').matchAll(/(Physical|Override) size:\s*(\d+)x(\d+)/g)];
  if (!misure.length) return null;
  // "Override size" vince: se qualcuno ha forzato una risoluzione diversa, è
  // quella che il visore usa davvero, ed è quella che scrcpy vede.
  const scelta = misure.find((m) => m[1] === 'Override') ?? misure[0];
  const width = Number(scelta[2]);
  const height = Number(scelta[3]);
  return width > 0 && height > 0 ? { width, height } : null;
}

export async function displaySize(serial, displayId = 0) {
  const args = displayId ? `wm size -d ${displayId}` : 'wm size';
  const res = await adbTry(['-s', serial, 'shell', args]);
  return res.ok ? parseDisplaySize(res.out) : null;
}

/** Elenco dei display disponibili (schermo VR vs display di cast). */
export async function listDisplays(serial) {
  const res = await adbTry(['-s', serial, 'shell', 'dumpsys display | grep -E "mDisplayId=|uniqueId"']);
  if (!res.ok) return [];
  const ids = new Set();
  for (const m of (res.out || '').matchAll(/mDisplayId=(\d+)/g)) ids.add(Number(m[1]));
  return [...ids].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Video sui visori
// ---------------------------------------------------------------------------

/** Estensioni che un visore sa riprodurre. Il resto non ha senso mostrarlo. */
export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', '3gp', 'insv'];

/**
 * Le radici da provare, in ordine.
 *
 * `/sdcard` **non è una cartella**: è un collegamento a
 * `/storage/self/primary`, e `find` non attraversa i collegamenti se non glielo
 * si chiede. `find /sdcard …` visitava quindi il solo collegamento, che non è
 * un file video, e usciva senza risultati e senza errori: la ricerca diceva
 * «0 file trovati» su un visore pieno di filmati.
 *
 * Da qui le due difese: `-L` per seguire il collegamento, e più radici da
 * provare in fila per i visori dove `/sdcard` non c'è.
 */
export const VIDEO_ROOTS = ['/sdcard', '/storage/emulated/0', '/storage/self/primary'];

/** Riga con cui il visore dichiara in quale cartella ha cercato. */
export const RADICE_PREFISSO = 'radice: ';

/**
 * Costruisce il comando di ricerca. Sta a parte perché è la parte con la
 * sintassi delicata — virgolette, `-prune`, `-o`, `-L` — ed è quella che vale
 * la pena provare senza un visore attaccato.
 *
 * Si cerca in TUTTA la memoria condivisa: indovinare le cartelle giuste era
 * già costato un «non trova il file», con i filmati in una cartella fuori
 * dall'elenco. L'unica esclusa è `Android` — i dati privati delle app, decine
 * di migliaia di file dove un filmato dell'operatore non sta comunque.
 *
 * Due giri. Il primo prova i nomi della memoria interna e si ferma al primo
 * che dà risultati: sono tre nomi della **stessa** memoria, e cercarli tutti
 * vorrebbe dire trovare ogni filmato tre volte, con tre percorsi diversi. Il
 * secondo guarda le memorie **davvero** separate montate sotto `/storage` — una
 * microSD, una chiavetta — che sono altri posti, non altri nomi, e vanno
 * guardati tutti.
 */
export function findVideosCommand(
  roots = VIDEO_ROOTS,
  extensions = VIDEO_EXTENSIONS,
  // Dove stanno le memorie removibili. Parametro perché è l'unico modo di
  // provare questo giro su una macchina che non è un visore.
  { montaggi = '/storage/*' } = {},
) {
  const radici = (Array.isArray(roots) ? roots : [roots]).join(' ');
  const nomi = extensions.map((e) => `-iname '*.${e}'`).join(' -o ');
  // 2>/dev/null: le cartelle senza permesso sono la norma, non un errore da
  // mostrare all'operatore. -maxdepth 6 evita di sprofondare in alberi strani.
  const find =
    `find -L "$d" -maxdepth 6 -type d -name Android -prune -o ` +
    `-type f \\( ${nomi} \\) -print 2>/dev/null`;
  // La radice viene annunciata comunque, anche quando non trova niente: se
  // l'elenco esce vuoto, la prima cosa da sapere è dove ha guardato.
  const annuncia = `echo "${RADICE_PREFISSO}$d"`;
  const interna =
    `for d in ${radici}; do [ -d "$d" ] || continue; ` +
    `${annuncia}; t=$(${find}); [ -z "$t" ] || { echo "$t"; break; }; done`;
  // `emulated`, `self` e `primary` sono la memoria interna, già guardata sopra:
  // ripassarci significherebbe elencare ogni filmato due volte.
  if (!montaggi) return interna;
  const esterne =
    `for d in ${montaggi}; do case "$d" in */emulated|*/self|*/primary|*/container*) continue;; esac; ` +
    `[ -d "$d" ] || continue; ${annuncia}; ${find}; done`;
  return `${interna}; ${esterne}`;
}

/** Nome del file senza percorso. */
export function fileName(percorso) {
  return String(percorso ?? '').split('/').filter(Boolean).pop() ?? '';
}

/**
 * L'indirizzo `file://` di un percorso, con i caratteri speciali codificati.
 *
 * Uno spazio nudo dentro l'indirizzo tronca il nome del file — «Tra Borghi e
 * Natura.mp4» diventerebbe «Tra» — e lo stesso vale per `#`, `?` e `%`. Le
 * barre restano barre: sono la struttura del percorso, non testo da codificare.
 */
export function fileUri(percorso) {
  const parti = String(percorso ?? '').split('/').map((p) => encodeURIComponent(p));
  return `file://${parti.join('/')}`;
}

/**
 * Elenco dei video presenti sul visore.
 *
 * Torna anche le memorie in cui ha cercato: «nessun filmato in /sdcard» e
 * «nessuna memoria da guardare» sono due guasti diversi, e senza questo dato
 * si somigliano troppo.
 */
export async function listVideos(serial) {
  const res = await adbTry(['-s', serial, 'shell', findVideosCommand()], { timeout: 60000 });
  // Un fallimento deve fallire, non travestirsi da "nessun video trovato":
  // sono due risposte diverse e chi cerca ha bisogno di sapere quale delle due.
  if (!res.ok) throw new Error(res.err?.message ?? 'ricerca fallita');
  const righe = (res.out || '').split('\n').map((r) => r.trim());
  const roots = righe.filter((r) => r.startsWith(RADICE_PREFISSO)).map((r) => r.slice(RADICE_PREFISSO.length));
  const paths = righe
    .filter((r) => r.startsWith('/'))
    .sort((a, b) => fileName(a).localeCompare(fileName(b), 'it'));
  return { roots, paths };
}

/**
 * Manda un file in riproduzione.
 *
 * Nessun lettore indicato: si chiede ad Android di aprirlo con quello che c'è,
 * che sul visore è il suo lettore video. Indicarne uno a mano vorrebbe dire
 * indovinare il nome del pacchetto, che cambia da modello a modello.
 */
export async function playVideo(serial, percorso, { fromStart = true, player = null, videoType = null } = {}) {
  const risolto = await resolveVideoPlayer(serial, percorso).catch(() => null);

  // Un lettore lasciato aperto riprenderebbe da dov'era, e sul visore chi apre
  // il filmato e chi lo riproduce possono essere app diverse: si chiudono
  // **tutte** le app di riproduzione video, non una indovinata. Resta un
  // tentativo, non un requisito — sotto, l'avvio si difende da solo.
  const azzerati = [];
  if (fromStart) {
    const home = await resolveHomePackage(serial).catch(() => null);
    await stopVideoApps(serial, { extra: [player, risolto?.package], home }).catch(() => {});
    // Il «riprendi da dove eri» sta su disco, e sopravvive a qualunque
    // chiusura: se il filmato riparte sempre dallo stesso punto è perché il
    // lettore rilegge quel punto salvato. Si azzera il lettore — quello visto
    // in azione, e quello a cui il visore affiderebbe il filmato — così
    // riparte come appena installato. Solo loro: mai la home, mai il sistema.
    for (const pkg of new Set([player, risolto?.package].filter(Boolean))) {
      if (NON_LETTORI.has(pkg) || pkg === home) continue;
      if (await clearAppData(serial, pkg).then(() => true, () => false)) azzerati.push(pkg);
    }
  }

  // L'apostrofo sopravvive alla codifica dell'indirizzo, e nudo chiuderebbe la
  // stringa del comando: va protetto qui, dopo.
  const escaped = fileUri(percorso).replace(/'/g, `'\\''`);
  // 'video/*' fra virgolette: nudo, la shell del visore lo tratterebbe come un
  // glob da espandere.
  const base = `am start -a android.intent.action.VIEW -t 'video/*' -d '${escaped}'`;

  // **L'ordine dei tentativi è il punto di questa funzione.**
  //
  // Il comando nudo è quello che ha sempre funzionato: va provato per primo,
  // sempre. Poi viene quello esplicito, che nomina l'activity invece di
  // lasciarla scegliere ad Android: serve proprio dopo una chiusura forzata,
  // perché un'app appena fermata può restare fuori dalla scelta automatica.
  // Ultimi i flag che rifanno la schermata da capo: aiutano a ripartire
  // dall'inizio, ma su certi lettori impediscono l'avvio — e un filmato che
  // parte da metà vale infinitamente più di uno che non parte.
  const tentativi = [
    // Quando l'operatore ha scelto la modalità, si parla direttamente al
    // lettore PICO: parte già nella proiezione giusta, invece di cominciare
    // «al cinema» e correggersi dopo. Sui visori che non capiscono questa
    // chiamata non si apre niente, e si scala sui tentativi soliti.
    videoType != null && { descrizione: 'lettore PICO con modalità', comando: picoStartCommand(percorso, { videoType }) },
    { descrizione: 'comando semplice', comando: base },
    risolto && { descrizione: `lettore esplicito (${risolto.package})`, comando: `am start -n ${risolto.activity} -a android.intent.action.VIEW -t 'video/*' -d '${escaped}'` },
    { descrizione: 'con riavvio pulito', comando: `${base} --activity-clear-task --activity-new-task --ei position 0` },
  ].filter(Boolean);

  const motivi = [];
  for (const tentativo of tentativi) {
    try {
      const out = await eseguiAvvio(serial, tentativo.comando);
      // Non basta che `am` non protesti: bisogna vedere qualcosa aperto. È la
      // differenza fra «il comando è stato accettato» e «il filmato è partito»,
      // ed è quella che finora l'app non sapeva fare.
      if (await qualcosaSiEAperto(serial)) return { out, azzerati };
      motivi.push(`${tentativo.descrizione}: il visore non ha aperto niente`);
    } catch (err) {
      motivi.push(`${tentativo.descrizione}: ${err.message}`);
    }
  }
  throw new Error(motivi.join(' — '));
}

/**
 * Dopo un avvio, c'è qualcosa davanti che non sia la schermata iniziale?
 *
 * Non chiede *quale* lettore: chiede se il visore ha aperto qualcosa. È il
 * controllo più povero possibile, ed è apposta — dev'essere vero anche su un
 * lettore che non conosciamo, e costare un solo comando.
 */
async function qualcosaSiEAperto(serial, { attesaMs = 1200 } = {}) {
  await delay(attesaMs);
  const fg = await foregroundPackage(serial).catch(() => null);
  if (!fg) return true; // se non si riesce a guardare, non si accusa l'avvio
  const home = await resolveHomePackage(serial).catch(() => null);
  return fg !== home && !NON_LETTORI.has(fg);
}

/** Lancia e controlla: un avvio che non ha aperto niente dev'essere un errore. */
async function eseguiAvvio(serial, comando) {
  const out = await shell(serial, comando, { timeout: 20000 });
  if (!avvioRiuscito(out)) throw new Error(motivoAvvioFallito(out));
  return out;
}

// ---------------------------------------------------------------------------
// Stato e comandi del lettore video
// ---------------------------------------------------------------------------

/**
 * Tasti "media" di Android.
 *
 * Play e pausa sono **separati** apposta: il tasto unico (PLAY_PAUSE) è un
 * interruttore, e mandarlo a dieci visori di cui uno era già fermo li lascia
 * metà in moto e metà fermi. Con due tasti distinti il comando è un'istruzione
 * ("fermatevi"), non un'inversione, e i visori restano allineati.
 */
export const MEDIA_KEYS = {
  play: 126,
  pause: 127,
  stop: 86,
  next: 87,
  previous: 88,
  rewind: 89,
  fastForward: 90,
};

/**
 * I modi in cui un lettore si lascia comandare.
 *
 * I tasti «media» sono gli unici standard, e sono anche quelli che su molti
 * visori non fanno **niente**: Android li consegna alla sessione multimediale,
 * e un lettore che non ne apre una non li riceve mai. I lettori dei visori si
 * comandano invece come si comandano col telecomando in mano — OK per fermare,
 * frecce per saltare — perché è così che li usa chi ha il visore in testa.
 *
 * Quale sia quello giusto non si può indovinare da qui: si prova, e la scelta
 * resta. `toggle` dice se il tasto è un interruttore (lo stesso per fermare e
 * riprendere) o se ci sono due tasti distinti.
 */
export const PROFILI_LETTORE = {
  media: { etichetta: 'Tasti media', play: 126, pause: 127, toggle: false, avanti: 90, indietro: 89 },
  mediaToggle: { etichetta: 'Media play/pausa (unico)', play: 85, pause: 85, toggle: true, avanti: 90, indietro: 89 },
  ok: { etichetta: 'OK / Invio', play: 66, pause: 66, toggle: true, avanti: 22, indietro: 21 },
  dpad: { etichetta: 'Centro del pad', play: 23, pause: 23, toggle: true, avanti: 22, indietro: 21 },
  spazio: { etichetta: 'Barra spaziatrice', play: 62, pause: 62, toggle: true, avanti: 22, indietro: 21 },
};

export function profiloLettore(nome) {
  return PROFILI_LETTORE[nome] ?? PROFILI_LETTORE.media;
}

/**
 * Comando che chiede al visore lo stato del lettore.
 *
 * Le due cose vanno chieste **insieme**: `dumpsys` dice a che punto era il
 * filmato a un certo istante dell'orologio interno, e senza leggere quello
 * stesso orologio nello stesso momento non si può sapere quanto tempo è
 * passato da allora — cioè dove si trova il filmato adesso.
 */
export const PLAYER_STATE_COMMAND = 'dumpsys media_session; echo ---orologio---; cat /proc/uptime';

/** Gli stati di PlaybackState che ci servono, tradotti in parole. */
const PLAYBACK_STATES = {
  0: 'nessuno',
  1: 'fermo',
  2: 'in pausa',
  3: 'in riproduzione',
  6: 'in caricamento',
  8: 'in caricamento',
};

/**
 * Legge il dump delle sessioni multimediali.
 *
 * Un lettore che si comporta bene pubblica una "MediaSession": è il modo in cui
 * Android sa cosa mostrare sulla schermata di blocco, ed è l'unico punto da cui
 * si può sapere da fuori a che punto è un filmato. Se il lettore non ne
 * pubblica nessuna qui non esce niente — e questo, per chi guarda, è un dato
 * quanto la posizione: vuol dire che quel lettore non si lascia seguire.
 *
 * @returns {{package: string|null, state: string, positionMs: number, updatedMs: number, speed: number}|null}
 */
export function parsePlaybackState(text) {
  const dump = String(text ?? '').split('---orologio---')[0];
  const sessioni = [];
  // Ogni sessione comincia con la sua riga "package=…"; quello che segue fino
  // al prossimo "package=" appartiene a lei.
  const blocchi = dump.split(/^\s*package=/m).slice(1);
  for (const blocco of blocchi) {
    const pkg = /^([A-Za-z0-9_.]+)/.exec(blocco)?.[1] ?? null;
    const stato = /PlaybackState\s*\{([^}]*)\}/.exec(blocco)?.[1];
    if (!stato) continue;
    const numero = (chiave) => {
      const m = new RegExp(`${chiave}=(-?[\\d.]+)`).exec(stato);
      return m ? Number(m[1]) : null;
    };
    const codice = numero('state');
    sessioni.push({
      package: pkg,
      code: codice,
      state: PLAYBACK_STATES[codice] ?? 'sconosciuto',
      positionMs: Math.max(0, numero('position') ?? 0),
      updatedMs: numero('updated') ?? 0,
      speed: numero('speed') ?? 1,
    });
  }
  if (!sessioni.length) return null;
  // Fra più sessioni vince quella che sta suonando: le altre sono lettori
  // aperti e fermi, che non è quello che l'operatore sta guardando.
  const scelta = sessioni.find((s) => s.code === 3) ?? sessioni.find((s) => s.code === 2) ?? sessioni[0];
  const { code, ...resto } = scelta;
  return resto;
}

/** L'orologio interno del visore (millisecondi da /proc/uptime). */
export function parseUptimeMs(text) {
  const dopo = String(text ?? '').split('---orologio---')[1] ?? '';
  const m = /([\d.]+)/.exec(dopo);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/**
 * Dove si trova il filmato **adesso**.
 *
 * `dumpsys` fotografa la posizione a un certo istante; se da allora il filmato
 * ha continuato a scorrere, quella fotografia è già vecchia di qualche
 * decimo di secondo. Il conto rimette in pari — ma solo se sta suonando: da
 * fermo la posizione è quella e basta.
 */
export function posizioneOra(playback, uptimeMs) {
  if (!playback) return null;
  if (playback.state !== 'in riproduzione' || !uptimeMs || !playback.updatedMs) {
    return playback.positionMs;
  }
  const passato = Math.max(0, uptimeMs - playback.updatedMs);
  return Math.round(playback.positionMs + passato * (playback.speed || 1));
}

/** Stato del lettore su un visore, o null se il lettore non si lascia seguire. */
export async function playerState(serial) {
  const res = await adbTry(['-s', serial, 'shell', PLAYER_STATE_COMMAND], { timeout: 10000 });
  if (!res.ok) return null;
  const playback = parsePlaybackState(res.out);
  if (!playback) return null;
  return { ...playback, positionMs: posizioneOra(playback, parseUptimeMs(res.out)) };
}

export async function mediaKey(serial, azione, profilo = 'media') {
  const tasti = profiloLettore(profilo);
  const keycode = tasti[azione] ?? MEDIA_KEYS[azione];
  if (!keycode) throw new Error(`comando lettore sconosciuto: ${azione}`);
  return inputKeyevent(serial, keycode);
}

/**
 * Durata del filmato, chiesta all'indice multimediale di Android.
 *
 * Il visore la conosce già — è lo stesso dato che il suo lettore usa per
 * disegnare la barra — e chiederla a lui costa una riga. Un file appena
 * copiato può non essere ancora indicizzato: in quel caso non c'è durata, e la
 * barra mostrerà solo il tempo trascorso invece di mentire su quanto manca.
 */
export function parseDurata(text) {
  const m = /duration=(\d+)/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

export async function videoDuration(serial, percorso) {
  const dove = String(percorso).replace(/'/g, `'\\''`);
  const res = await adbTry([
    '-s',
    serial,
    'shell',
    `content query --uri content://media/external/video/media --projection duration --where "_data='${dove}'"`,
  ]);
  return res.ok ? parseDurata(res.out) : null;
}

/** Il pacchetto che aprirebbe un filmato, secondo il visore stesso. */
export function parseResolvedActivity(text) {
  const righe = String(text ?? '').split('\n').map((r) => r.trim()).filter(Boolean);
  const riga = [...righe].reverse().find((r) => /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(r));
  return riga ? { package: riga.split('/')[0], activity: riga } : null;
}

/**
 * Pacchetti che non sono un lettore, per quanto il visore li nomini.
 *
 * `android` è il selettore «apri con»: chiuderlo non ha senso, e chiederlo
 * significherebbe fermare un pezzo del sistema.
 */
const NON_LETTORI = new Set(['android', 'com.android.systemui']);

/**
 * Il pacchetto che aprirà questo filmato.
 *
 * Il file **va passato**: la stessa domanda senza il file, su molti visori,
 * torna a mani vuote — e a mani vuote il lettore non veniva chiuso, quindi
 * riprendeva da dove era rimasto. Era questa la ragione per cui «riparte
 * dall'inizio» non ripartiva dall'inizio.
 */
export async function resolveVideoPlayer(serial, percorso = null) {
  const conFile = percorso ? ` -d '${fileUri(percorso).replace(/'/g, `'\\''`)}'` : '';
  const res = await adbTry([
    '-s',
    serial,
    'shell',
    `cmd package resolve-activity --brief -a android.intent.action.VIEW -t 'video/*'${conFile}`,
  ]);
  const trovato = res.ok ? parseResolvedActivity(res.out) : null;
  if (!trovato || NON_LETTORI.has(trovato.package)) return null;
  return trovato;
}

/**
 * Le modalità del lettore PICO, coi codici che il lettore stesso usa.
 *
 * Vengono dal codice pubblicato da PICO (launch-pico-player, MovieType.java):
 * non sono indovinate. Dirgliela al lancio evita la scena che si vede in sala:
 * il filmato parte «al cinema», su uno schermo piatto davanti al visitatore, e
 * solo dopo qualche secondo il lettore capisce da solo che era un 360.
 */
export const VIDEO_MODES = {
  auto: { etichetta: 'Riconosci da solo', code: null },
  flat2d: { etichetta: '2D piatto', code: 0 },
  deg360: { etichetta: '360°', code: 2 },
  deg360tb: { etichetta: '3D 360° sopra-sotto', code: 3 },
  deg360lr: { etichetta: '3D 360° fianco-a-fianco', code: 5 },
  deg180: { etichetta: '180°', code: 10 },
  deg180tb: { etichetta: '3D 180° sopra-sotto', code: 11 },
};

/**
 * Il comando che apre il lettore PICO dicendogli subito come proiettare.
 *
 * `videoType` viaggia come **stringa**, non come numero: è così che lo passa
 * il codice di PICO, ed è il genere di dettaglio che non si contraddice.
 */
export function picoStartCommand(percorso, { videoType = null } = {}) {
  const uri = fileUri(percorso).replace(/'/g, `'\\''`);
  const nome = fileName(percorso).replace(/'/g, `'\\''`);
  const tipo = videoType != null ? ` --es videoType ${videoType}` : '';
  return (
    `am start -a picovr.intent.action.player ` +
    `--es uri '${uri}' --es title '${nome}'${tipo}`
  );
}

/**
 * `am start` è riuscito?
 *
 * `am` **esce sempre con successo**, anche quando non ha aperto niente: scrive
 * «Error: …» e se ne va con la coscienza a posto. Era per questo che un
 * filmato che non partiva non produceva nessun messaggio — l'app credeva di
 * averlo avviato.
 *
 * «Warning: Activity not started, its current task has been brought to the
 * front» invece è un successo: l'app era già aperta ed è tornata davanti.
 */
export function avvioRiuscito(output) {
  const testo = String(output ?? '');
  if (/^\s*Error(:| type)/mi.test(testo)) return false;
  if (/does not exist|Permission Denial|Unable to resolve|no activity found/i.test(testo)) return false;
  return true;
}

/** Il messaggio da mostrare quando l'avvio non è riuscito. */
export function motivoAvvioFallito(output) {
  const riga = String(output ?? '')
    .split('\n')
    .map((r) => r.trim())
    .find((r) => /^Error|does not exist|Permission Denial|Unable to resolve/i.test(r));
  return riga || 'il visore non ha aperto niente e non ha detto perché';
}

/**
 * I pacchetti che sanno aprire filmati, secondo il visore stesso.
 *
 * È l'elenco delle «app di riproduzione video» da chiudere prima di lanciare:
 * sul visore chi apre il filmato e chi lo riproduce possono essere app diverse
 * (il gestore file delega al lettore), e chiudere solo la prima lasciava la
 * seconda viva, con il suo «riprendi da dove eri» intatto.
 */
export function parseVideoHandlers(text) {
  const pacchetti = new Set();
  for (const m of String(text ?? '').matchAll(/([A-Za-z][A-Za-z0-9_.]*)\/[A-Za-z0-9_.$]+/g)) {
    pacchetti.add(m[1]);
  }
  return [...pacchetti];
}

export async function videoHandlerPackages(serial) {
  const res = await adbTry([
    '-s',
    serial,
    'shell',
    "cmd package query-activities --components -a android.intent.action.VIEW -t 'video/*'",
  ]);
  if (!res.ok) return [];
  return parseVideoHandlers(res.out).filter((p) => !NON_LETTORI.has(p));
}

/**
 * Cancella i dati salvati di un'app (pm clear).
 *
 * È il colpo che serve contro il «riprendi da dove eri» scritto su disco:
 * chiudere il lettore non lo tocca — anzi lo congela, perché l'app non salva
 * più niente e riparte per sempre dallo stesso punto. Sparisce anche ogni
 * preferenza del lettore: è il prezzo, ed è il motivo per cui si azzera solo
 * chi riproduce, mai il resto del visore.
 */
export async function clearAppData(serial, pkg) {
  const out = await shell(serial, `pm clear ${pkg}`, { timeout: 20000 });
  if (!/Success/i.test(out || '')) throw new Error(`pm clear ${pkg}: ${(out || '').trim() || 'nessuna risposta'}`);
  return true;
}

/**
 * Chiude tutte le app di riproduzione video del visore, in un colpo solo.
 *
 * Un solo comando con tutti i force-stop in fila: dieci comandi separati
 * sarebbero dieci viaggi, e il lancio del filmato arriverebbe con secondi di
 * ritardo su un visore e non sull'altro.
 */
export async function stopVideoApps(serial, { extra = [], home = null } = {}) {
  const trovati = await videoHandlerPackages(serial);
  const daChiudere = [...new Set([...trovati, ...extra.filter(Boolean)])]
    .filter((p) => !NON_LETTORI.has(p) && p !== home);
  if (!daChiudere.length) return [];
  await shell(serial, daChiudere.map((p) => `am force-stop ${p}`).join('; '), { timeout: 20000 });
  return daChiudere;
}

/**
 * Questo pacchetto sa aprire dei filmati?
 *
 * Serve a non prendere per lettore la prima app che si trova in primo piano
 * dopo un avvio: se il filmato non è partito, davanti c'è dell'altro — e
 * ricordarselo come «lettore» vorrebbe dire chiuderlo al prossimo giro. Un
 * visore su cui l'app chiude la schermata iniziale è messo peggio di prima.
 */
export async function gestisceVideo(serial, pkg) {
  if (!pkg) return false;
  const res = await adbTry([
    '-s',
    serial,
    'shell',
    "cmd package query-activities -a android.intent.action.VIEW -t 'video/*'",
  ]);
  if (!res.ok || !res.out) return false;
  return res.out.includes(pkg);
}

/** Il pacchetto della schermata iniziale del visore. */
export async function resolveHomePackage(serial) {
  const res = await adbTry([
    '-s',
    serial,
    'shell',
    'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME',
  ]);
  return res.ok ? parseResolvedActivity(res.out)?.package ?? null : null;
}

/**
 * Il lettore che si è davvero aperto, viste le app in primo piano.
 *
 * Serve a non prendere per lettore la schermata iniziale: se il filmato non è
 * partito, in primo piano c'è la home, e ricordarsela come «lettore» vorrebbe
 * dire chiuderla al prossimo avvio.
 */
export function riconosciLettore(foreground, homePackage) {
  if (!foreground || foreground === homePackage) return null;
  return NON_LETTORI.has(foreground) ? null : foreground;
}

/**
 * Quanti colpi di avanti/indietro servono per arrivare al punto voluto.
 *
 * Il passo non lo decidiamo noi: ogni lettore salta di quanto gli pare (dieci
 * secondi, quindici, trenta). Lo si misura con un colpo solo e poi si fa il
 * conto — meglio che indovinare e trovarsi altrove.
 *
 * Il tetto serve a non restare a martellare tasti: se con quaranta colpi non
 * ci si arriva, il salto è troppo lungo per questa strada e va detto.
 */
export function colpiPerSalto(deltaMs, passoMs, { massimo = 40 } = {}) {
  if (!passoMs) return 0;
  const colpi = Math.round(deltaMs / passoMs);
  return Math.max(-massimo, Math.min(massimo, colpi));
}

/**
 * Porta il filmato a un punto preciso.
 *
 * Da fuori non esiste un «vai al minuto 3»: esistono i tasti avanti e indietro,
 * e ogni lettore salta di quanto gli pare. Allora si fa come si farebbe a mano:
 * si mette in pausa (fermo, la posizione non scappa e il salto si misura), si
 * dà un colpo per vedere quanto vale, si fa il conto dei colpi che mancano, si
 * verifica. E se il lettore ai colpi non risponde, lo si dice invece di far
 * finta.
 */
export async function seekTo(
  serial,
  targetMs,
  { tolleranzaMs = 2000, giri = 3, profilo = 'media' } = {},
) {
  const tasti = profiloLettore(profilo);
  let stato = await playerState(serial);
  if (!stato) throw new Error('il lettore non dice a che punto è il filmato: da qui non si può saltare');

  const suonava = stato.state === 'in riproduzione';
  if (suonava) {
    await mediaKey(serial, 'pause', profilo);
    await delay(400);
    stato = (await playerState(serial)) ?? stato;
  }

  let passo = null;
  for (let giro = 0; giro < giri; giro += 1) {
    const delta = targetMs - stato.positionMs;
    if (Math.abs(delta) <= tolleranzaMs) break;
    if (passo === null) {
      // Un colpo solo, da fermo: è la misura del passo di questo lettore.
      await mediaKey(serial, delta > 0 ? 'avanti' : 'indietro', profilo);
      await delay(500);
      const dopo = (await playerState(serial)) ?? stato;
      passo = Math.abs(dopo.positionMs - stato.positionMs);
      stato = dopo;
      if (passo < 500) {
        if (suonava) await mediaKey(serial, 'play', profilo);
        throw new Error('questo lettore non risponde ai tasti avanti/indietro: il salto non è possibile');
      }
      continue;
    }
    const colpi = colpiPerSalto(delta, passo);
    if (!colpi) break;
    const tasto = colpi > 0 ? tasti.avanti : tasti.indietro;
    await inputKeyevents(serial, Array.from({ length: Math.abs(colpi) }, () => tasto));
    await delay(600);
    stato = (await playerState(serial)) ?? stato;
  }

  if (suonava) await mediaKey(serial, 'play', profilo);
  return stato;
}
