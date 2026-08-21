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
    'getprop ro.product.model; getprop ro.product.device; getprop ro.build.version.release; getprop persist.pico.device.name',
  ]);
  const [model, device, android, name] = (res.out || '').split('\n').map((s) => s.trim());
  return {
    model: model || null,
    device: device || null,
    android: android || null,
    name: name || null,
  };
}

/** Volume media: delta positivo o negativo espresso in "scatti". */
export async function changeVolume(serial, steps) {
  const key = steps > 0 ? 24 : 25; // VOLUME_UP / VOLUME_DOWN
  const n = Math.min(Math.abs(steps), 15);
  return shell(serial, Array.from({ length: n }, () => `input keyevent ${key}`).join('; '));
}

/** Tap/swipe di riserva quando non usiamo il canale di controllo scrcpy. */
export async function inputTap(serial, x, y) {
  return shell(serial, `input tap ${Math.round(x)} ${Math.round(y)}`, { timeout: 8000 });
}

export async function inputSwipe(serial, x1, y1, x2, y2, durationMs = 120) {
  return shell(
    serial,
    `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(durationMs)}`,
    { timeout: 8000 },
  );
}

export async function inputKeyevent(serial, keycode) {
  return shell(serial, `input keyevent ${keycode}`, { timeout: 8000 });
}

export async function reboot(serial) {
  return adbTry(['-s', serial, 'reboot']);
}

/** Elenco dei display disponibili (utile sui visori: schermo VR vs display di cast). */
export async function listDisplays(serial) {
  const res = await adbTry(['-s', serial, 'shell', 'dumpsys display | grep -E "mDisplayId=|uniqueId"']);
  if (!res.ok) return [];
  const ids = new Set();
  for (const m of (res.out || '').matchAll(/mDisplayId=(\d+)/g)) ids.add(Number(m[1]));
  return [...ids].sort((a, b) => a - b);
}
