// Modalità demo (`npm start -- --demo=10`): visori finti con un'immagine
// sintetica, per provare l'interfaccia senza hardware. Il fotogramma è
// volutamente "stereoscopico" (due occhi affiancati, rapporto 2:1) come la
// cattura di un visore vero: così si vede subito come funzionano la visuale
// libera e il pulsante "visuale visitatore".

import zlib from 'node:zlib';

const WIDTH = 1200;
const HEIGHT = 600;

export function buildDemoDevices(count) {
  return Array.from({ length: count }, (_, i) => ({
    serial: `192.168.1.${50 + i}:5555`,
    label: `Postazione ${i + 1}`,
    displayName: `Postazione ${i + 1}`,
    state: 'streaming',
    error: null,
    info: { model: 'PICO 4 (demo)' },
    status: { battery: 95 - i * 6, foreground: 'com.esempio.app', updatedAt: Date.now() },
    videoSize: { width: WIDTH, height: HEIGHT },
    mirror: 'screencap',
    crop: null,
    displayId: 0,
    quality: {},
  }));
}

/**
 * Manda un fotogramma finto per ogni visore, a intervalli regolari.
 * @returns funzione per fermare la demo
 */
export function startDemoFrames(count, send, intervalMs = 200) {
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    for (let i = 0; i < count; i++) {
      send('frame', {
        serial: `192.168.1.${50 + i}:5555`,
        kind: 'png',
        pts: 0,
        config: false,
        keyFrame: true,
        data: renderFrame(i, tick),
      });
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Disegno del fotogramma finto
// ---------------------------------------------------------------------------

const PALETTE = [
  [40, 90, 160],
  [150, 70, 60],
  [60, 130, 90],
  [130, 100, 40],
  [90, 70, 140],
  [50, 120, 140],
  [140, 60, 110],
  [70, 110, 60],
  [120, 80, 80],
  [60, 80, 150],
];

// Cifre 3×5 per stampare il numero della postazione senza dipendere da un font.
const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

function renderFrame(index, tick) {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  const base = PALETTE[index % PALETTE.length];
  const eyeWidth = WIDTH / 2;
  const horizon = Math.round(HEIGHT * 0.55);

  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const o = (y * WIDTH + x) * 3;
    rgb[o] = r;
    rgb[o + 1] = g;
    rgb[o + 2] = b;
  };

  for (let y = 0; y < HEIGHT; y++) {
    const sky = y < horizon;
    for (let x = 0; x < WIDTH; x++) {
      const eyeX = x % eyeWidth; // stessa scena nei due occhi
      let [r, g, b] = base;
      if (sky) {
        const t = y / horizon;
        r = Math.round(r * (0.45 + 0.55 * t));
        g = Math.round(g * (0.45 + 0.55 * t));
        b = Math.round(b * (0.55 + 0.45 * t));
      } else {
        // pavimento a scacchi: rende evidenti spostamenti e zoom
        const square = (Math.floor(eyeX / 40) + Math.floor(y / 20)) % 2 === 0;
        const shade = square ? 0.42 : 0.3;
        r = Math.round(r * shade + 30);
        g = Math.round(g * shade + 30);
        b = Math.round(b * shade + 30);
      }
      put(x, y, r, g, b);
    }
  }

  // "Sole" che si sposta: si vede subito che l'immagine è viva.
  const sunX = 90 + ((tick * 3) % (eyeWidth - 180));
  const sunY = Math.round(horizon * 0.42);
  for (let eye = 0; eye < 2; eye++) {
    for (let dy = -34; dy <= 34; dy++) {
      for (let dx = -34; dx <= 34; dx++) {
        if (dx * dx + dy * dy > 34 * 34) continue;
        put(Math.round(eye * eyeWidth + sunX + dx), sunY + dy, 245, 225, 150);
      }
    }
  }

  // Numero della postazione, grande, al centro di ogni occhio.
  const label = String(index + 1);
  const scale = 22;
  for (let eye = 0; eye < 2; eye++) {
    const totalWidth = label.length * 4 * scale;
    const startX = Math.round(eye * eyeWidth + (eyeWidth - totalWidth) / 2);
    const startY = Math.round(horizon - 3.2 * scale);
    label.split('').forEach((ch, di) => {
      const glyph = DIGITS[ch];
      if (!glyph) return;
      glyph.forEach((row, ry) => {
        row.split('').forEach((on, rx) => {
          if (on !== '1') return;
          for (let py = 0; py < scale; py++) {
            for (let px = 0; px < scale; px++) {
              put(startX + (di * 4 + rx) * scale + px, startY + ry * scale + py, 245, 248, 252);
            }
          }
        });
      });
    });
  }

  // Riga di separazione fra i due occhi.
  for (let y = 0; y < HEIGHT; y++) put(Math.round(eyeWidth), y, 12, 14, 18);

  return encodePng(WIDTH, HEIGHT, rgb);
}

// ---------------------------------------------------------------------------
// Codifica PNG minimale (RGB a 8 bit, nessun filtro)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: truecolor
  // compressione, filtro, interlacciamento: valori standard (già a zero)

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "None"
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
