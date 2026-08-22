// Decodifica e disegno di un singolo riquadro.
//  - modalità scrcpy: H.264 Annex-B via WebCodecs (accelerato dalla GPU)
//  - modalità screencap: PNG decodificati con createImageBitmap
//
// Ogni istanza gestisce un canvas.

const NAL_SPS = 7;

/** Trova il primo NAL del tipo richiesto in un buffer Annex-B. */
function findNal(bytes, type) {
  for (let i = 0; i + 4 < bytes.length; i++) {
    const isStart3 = bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1;
    const isStart4 = bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1;
    if (!isStart3 && !isStart4) continue;
    const nalStart = i + (isStart3 ? 3 : 4);
    if (nalStart >= bytes.length) return null;
    if ((bytes[nalStart] & 0x1f) === type) return bytes.subarray(nalStart);
    i = nalStart;
  }
  return null;
}

/**
 * Costruisce la stringa codec ("avc1.PPCCLL") leggendo profilo e livello dall'SPS.
 * Se non ci riesce ripiega su Baseline 3.1, che i Pico usano di norma.
 */
export function codecStringFromConfig(bytes) {
  const sps = findNal(bytes, NAL_SPS);
  if (!sps || sps.length < 4) return 'avc1.42e01f';
  const hex = [sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `avc1.${hex}`;
}

export class TileRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.decoder = null;
    this.codecString = null;
    this.configBytes = null;
    this.waitingKeyFrame = true;
    this.size = { width: 0, height: 0 };
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsAt = performance.now();
    this.lastFrameAt = 0;
    this.error = null;
    this.destroyed = false;
    this.pendingBitmap = false;
    // Chiamata dopo ogni disegno: l'anteprima grande ridisegna da questo canvas
    // invece di decodificare una seconda volta lo stesso flusso.
    this.onPaint = null;
  }

  reset() {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        /* già chiuso */
      }
    }
    this.decoder = null;
    this.codecString = null;
    this.waitingKeyFrame = true;
  }

  destroy() {
    this.destroyed = true;
    this.reset();
  }

  /** Riempie il canvas di nero: i messaggi li mostra l'overlay HTML. */
  clear() {
    this.ctx.fillStyle = '#05070a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  #ensureCanvasSize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.size = { width, height };
    }
  }

  #countFrame() {
    try {
      this.onPaint?.();
    } catch (err) {
      this.error = err.message;
    }
    this.frameCount++;
    this.lastFrameAt = performance.now();
    const elapsed = this.lastFrameAt - this.lastFpsAt;
    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFpsAt = this.lastFrameAt;
    }
  }

  #configure(codecString) {
    this.reset();
    this.codecString = codecString;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (!this.destroyed) {
            this.#ensureCanvasSize(frame.displayWidth, frame.displayHeight);
            this.ctx.drawImage(frame, 0, 0);
            this.#countFrame();
          }
        } finally {
          frame.close();
        }
      },
      error: (err) => {
        this.error = err.message;
        // Un errore di decodifica non è fatale: si riparte dal prossimo keyframe.
        this.reset();
      },
    });
    this.decoder.configure({
      codec: codecString,
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-hardware',
    });
    this.waitingKeyFrame = true;
  }

  /** frame: { kind, data(Uint8Array), pts, config, keyFrame } */
  handleFrame(frame) {
    if (this.destroyed) return;
    if (frame.kind === 'png') return this.#handlePng(frame.data);
    return this.#handleH264(frame);
  }

  #handleH264({ data, pts, config, keyFrame }) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (config) {
      this.configBytes = bytes;
      const codecString = codecStringFromConfig(bytes);
      if (!this.decoder || codecString !== this.codecString) this.#configure(codecString);
      return;
    }

    if (!this.decoder) {
      if (!this.configBytes) return; // aspettiamo SPS/PPS
      this.#configure(codecStringFromConfig(this.configBytes));
    }
    if (this.decoder.state !== 'configured') return;
    if (this.waitingKeyFrame) {
      if (!keyFrame) return;
      this.waitingKeyFrame = false;
    }
    // Se la coda si allunga stiamo accumulando ritardo: meglio saltare
    // qualche frame "delta" e restare in tempo reale.
    if (this.decoder.decodeQueueSize > 8 && !keyFrame) return;

    // Ai keyframe anteponiamo SPS/PPS: costa poco e rende lo stream ripartibile.
    const payload = keyFrame && this.configBytes ? concat(this.configBytes, bytes) : bytes;
    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: keyFrame ? 'key' : 'delta',
          timestamp: pts || performance.now() * 1000,
          data: payload,
        }),
      );
    } catch (err) {
      this.error = err.message;
      this.reset();
    }
  }

  async #handlePng(data) {
    if (this.pendingBitmap) return; // niente accodamento: mostriamo l'ultimo utile
    this.pendingBitmap = true;
    try {
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
      if (!this.destroyed) {
        this.#ensureCanvasSize(bitmap.width, bitmap.height);
        this.ctx.drawImage(bitmap, 0, 0);
        this.#countFrame();
      }
      bitmap.close();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.pendingBitmap = false;
    }
  }

  get isStale() {
    return this.lastFrameAt > 0 && performance.now() - this.lastFrameAt > 4000;
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
