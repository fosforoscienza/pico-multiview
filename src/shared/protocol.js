// Encoder dei messaggi di controllo del protocollo scrcpy (server v2.x).
//
// Riferimento: com.genymobile.scrcpy.control.ControlMessageReader
// I layout sono byte-esatti: se un giorno aggiorni scrcpy-server e il puntatore
// smette di funzionare, è quasi certamente qui che va messa mano (vedi anche
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

// android.view.MotionEvent
export const ACTION = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
  CANCEL: 3,
  HOVER_MOVE: 7,
  SCROLL: 8,
};

export const BUTTON = {
  PRIMARY: 1 << 0,
  SECONDARY: 1 << 1,
  TERTIARY: 1 << 2,
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

// Il "pointer id" virtuale del mouse. scrcpy usa -1 (0xFFFFFFFFFFFFFFFF) per il
// mouse e -2 per il dito virtuale; noi usiamo un id per ogni sorgente.
export const POINTER_ID_MOUSE = 0xffffffffffffffffn;
export const POINTER_ID_GENERIC_FINGER = 0xfffffffffffffffen;

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

/** Da "W:H:X:Y" a numeri, o null se la stringa non è un ritaglio valido. */
export function parseCrop(crop) {
  const m = /^(\d+):(\d+):(\d+):(\d+)$/.exec(String(crop ?? '').trim());
  if (!m) return null;
  const [width, height, x, y] = m.slice(1, 5).map(Number);
  return width > 0 && height > 0 ? { width, height, x, y } : null;
}

/**
 * Da un punto dell'immagine (0..1) al pixel corrispondente dello **schermo** del
 * visore.
 *
 * Non sono la stessa cosa: il video è rimpicciolito da `max_size` e, con
 * l'occhio singolo, è anche ritagliato. Il canale di controllo di scrcpy fa
 * questa conversione da sé; il comando `input`, che usiamo sui visori PICO,
 * no — vuole i pixel veri, e sbagliarli significa cliccare da un'altra parte.
 */
export function framePointToScreen(nx, ny, screen, crop = null) {
  if (!screen?.width || !screen?.height) return null;
  const fx = Math.max(0, Math.min(1, nx));
  const fy = Math.max(0, Math.min(1, ny));
  const area = parseCrop(crop) ?? { width: screen.width, height: screen.height, x: 0, y: 0 };
  return {
    x: Math.round(area.x + fx * area.width),
    y: Math.round(area.y + fy * area.height),
  };
}

function clampInt(v, min, max) {
  v = Math.round(v);
  if (Number.isNaN(v)) return min;
  return v < min ? min : v > max ? max : v;
}

/** float 0..1 -> u16 in virgola fissa (1.0 => 0xffff) */
export function toFixedPoint16(value) {
  const v = Math.max(0, Math.min(1, value));
  const i = Math.round(v * 65536);
  return i >= 65536 ? 65535 : i;
}

/** float -1..1 -> i16 in virgola fissa */
export function toFixedPointSigned16(value) {
  const v = Math.max(-1, Math.min(1, value));
  const i = Math.round(v * 32768);
  return i >= 32768 ? 32767 : i;
}

function writePosition(buf, offset, x, y, width, height) {
  buf.writeInt32BE(clampInt(x, -2147483648, 2147483647), offset);
  buf.writeInt32BE(clampInt(y, -2147483648, 2147483647), offset + 4);
  buf.writeUInt16BE(clampInt(width, 0, 65535), offset + 8);
  buf.writeUInt16BE(clampInt(height, 0, 65535), offset + 10);
  return offset + 12;
}

/**
 * INJECT_TOUCH_EVENT — 32 byte
 * type(1) action(1) pointerId(8) x(4) y(4) w(2) h(2) pressure(2) actionButton(4) buttons(4)
 */
export function encodeTouch({
  action,
  pointerId = POINTER_ID_MOUSE,
  x,
  y,
  width,
  height,
  pressure = action === ACTION.UP ? 0 : 1,
  actionButton = BUTTON.PRIMARY,
  buttons = action === ACTION.UP ? 0 : BUTTON.PRIMARY,
}) {
  const buf = Buffer.allocUnsafe(32);
  buf.writeUInt8(SCRCPY_CONTROL.INJECT_TOUCH_EVENT, 0);
  buf.writeUInt8(action, 1);
  buf.writeBigUInt64BE(BigInt(pointerId), 2);
  let off = writePosition(buf, 10, x, y, width, height);
  buf.writeUInt16BE(toFixedPoint16(pressure), off);
  buf.writeUInt32BE(actionButton >>> 0, off + 2);
  buf.writeUInt32BE(buttons >>> 0, off + 6);
  return buf;
}

/**
 * INJECT_SCROLL_EVENT — 21 byte
 * type(1) x(4) y(4) w(2) h(2) hscroll(2) vscroll(2) buttons(4)
 */
export function encodeScroll({ x, y, width, height, hscroll = 0, vscroll = 0, buttons = 0 }) {
  const buf = Buffer.allocUnsafe(21);
  buf.writeUInt8(SCRCPY_CONTROL.INJECT_SCROLL_EVENT, 0);
  const off = writePosition(buf, 1, x, y, width, height);
  buf.writeInt16BE(toFixedPointSigned16(hscroll), off);
  buf.writeInt16BE(toFixedPointSigned16(vscroll), off + 2);
  buf.writeInt32BE(buttons | 0, off + 4);
  return buf;
}

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
