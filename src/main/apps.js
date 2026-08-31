// Gestione applicazioni sul visore: elenco pacchetti, avvio, chiusura,
// app in primo piano, batteria. Tutto via "adb shell".

import { shell, adbTry } from './adb.js';

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
export async function playVideo(serial, percorso) {
  // L'apostrofo sopravvive alla codifica dell'indirizzo, e nudo chiuderebbe la
  // stringa del comando: va protetto qui, dopo.
  const escaped = fileUri(percorso).replace(/'/g, `'\\''`);
  // 'video/*' fra virgolette: nudo, la shell del visore lo tratterebbe come un
  // glob da espandere.
  return shell(
    serial,
    `am start -a android.intent.action.VIEW -t 'video/*' -d '${escaped}'`,
    { timeout: 20000 },
  );
}
