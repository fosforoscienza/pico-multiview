// Encoder dei messaggi di controllo del protocollo scrcpy (server v2.x).
//
// Riferimento: com.genymobile.scrcpy.control.ControlMessageReader
// I layout sono byte-esatti: se un giorno aggiorni scrcpy-server e i tasti
// smettono di funzionare, è quasi certamente qui che va messa mano (vedi anche
// SCRCPY_VERSION in src/main/scrcpy-session.js).

export const SCRCPY_CONTROL = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_SCREEN_POWER_MODE: 10,
  ROTATE_DEVICE: 11,
};

// android.view.KeyEvent (solo quelli che ci servono)
export const KEYCODE = {
  HOME: 3,
  BACK: 4,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  ENTER: 66,
  ESCAPE: 111,
  MEDIA_PLAY_PAUSE: 85,
  APP_SWITCH: 187,
  VOLUME_MUTE: 164,
};

export const KEY_ACTION = { DOWN: 0, UP: 1 };

/**
 * Ritaglio scrcpy ("W:H:X:Y") per la sola metà sinistra dello schermo, cioè
 * l'occhio sinistro di una cattura stereoscopica.
 *
 * Le misure sono in pixel dello **schermo**, non del video: scrcpy ritaglia
 * prima di rimpicciolire. La larghezza si arrotonda a un numero pari, perché
 * un encoder H.264 lavora su blocchi e una larghezza dispari viene rifiutata.
 */
export function leftEyeCrop(size) {
  if (!size?.width || !size?.height) return null;
  const width = Math.floor(size.width / 2 / 2) * 2;
  if (width <= 0) return null;
  return `${width}:${size.height}:0:0`;
}

// Oltre questo rapporto larghezza/altezza la cattura è stereoscopica: due
// immagini affiancate, una per occhio. Sotto, è una cattura piatta (16:9 fa
// 1.78). La soglia sta in mezzo.
export const STEREO_ASPECT_THRESHOLD = 1.9;

/**
 * INJECT_KEYCODE — 17 byte
 * type(1) action(4) keycode(4) repeat(4) metaState(4)
 */
export function encodeKeycode({ action, keycode, repeat = 0, metaState = 0 }) {
  const buf = Buffer.allocUnsafe(17);
  buf.writeUInt8(SCRCPY_CONTROL.INJECT_KEYCODE, 0);
  buf.writeUInt32BE(action >>> 0, 1);
  buf.writeUInt32BE(keycode >>> 0, 5);
  buf.writeUInt32BE(repeat >>> 0, 9);
  buf.writeUInt32BE(metaState >>> 0, 13);
  return buf;
}

/** Pressione + rilascio di un tasto, come due messaggi consecutivi. */
export function encodeKeyPress(keycode, metaState = 0) {
  return Buffer.concat([
    encodeKeycode({ action: KEY_ACTION.DOWN, keycode, metaState }),
    encodeKeycode({ action: KEY_ACTION.UP, keycode, metaState }),
  ]);
}

/** BACK_OR_SCREEN_ON — 2 byte: type(1) action(1) */
export function encodeBackOrScreenOn(action = KEY_ACTION.DOWN) {
  const buf = Buffer.allocUnsafe(2);
  buf.writeUInt8(SCRCPY_CONTROL.BACK_OR_SCREEN_ON, 0);
  buf.writeUInt8(action, 1);
  return buf;
}

/** Messaggi senza payload (COLLAPSE_PANELS, EXPAND_*). */
export function encodeSimple(type) {
  return Buffer.from([type]);
}

// ---------------------------------------------------------------------------
// Parsing dell'header dei pacchetti video (Streamer.writeHeader)
// pts(8) + len(4); i due bit alti del pts sono flag.
// ---------------------------------------------------------------------------

export const PACKET_HEADER_SIZE = 12;
const FLAG_CONFIG = 1n << 63n;
const FLAG_KEY_FRAME = 1n << 62n;
const PTS_MASK = (1n << 62n) - 1n;

export function parsePacketHeader(buf, offset = 0) {
  const raw = buf.readBigUInt64BE(offset);
  return {
    config: (raw & FLAG_CONFIG) !== 0n,
    keyFrame: (raw & FLAG_KEY_FRAME) !== 0n,
    pts: Number(raw & PTS_MASK), // microsecondi
    length: buf.readUInt32BE(offset + 8),
  };
}

/** Codec id inviato nel "codec meta" (4 char ASCII, big endian). */
export function codecIdToName(id) {
  return Buffer.from([(id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff]).toString('ascii');
}
