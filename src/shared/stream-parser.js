// Parser dello stream video scrcpy, isolato dal resto per poterlo testare:
//   [device meta 64B]? [codec meta 12B]? poi, per ogni pacchetto,
//   header 12B (pts+flag, lunghezza) seguito dal frame H.264 in Annex-B.
//
// I dati TCP arrivano a pezzi arbitrari, quindi tutto passa da una coda di byte.

import { PACKET_HEADER_SIZE, codecIdToName, parsePacketHeader } from './protocol.js';

export const DEVICE_META_SIZE = 64;
export const CODEC_META_SIZE = 12;

/** Coda di byte con lettura a lunghezza fissa e senza copie inutili. */
export class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(buf) {
    if (buf.length === 0) return;
    this.chunks.push(buf);
    this.length += buf.length;
  }

  /** Rimette dei byte in testa alla coda. */
  unshift(buf) {
    if (buf.length === 0) return;
    this.chunks.unshift(buf);
    this.length += buf.length;
  }

  /** Estrae esattamente n byte, o null se non ce ne sono abbastanza. */
  take(n) {
    if (n <= 0) return Buffer.alloc(0);
    if (this.length < n) return null;

    const first = this.chunks[0];
    if (first.length === n) {
      this.chunks.shift();
      this.length -= n;
      return first;
    }
    if (first.length > n) {
      this.chunks[0] = first.subarray(n);
      this.length -= n;
      return first.subarray(0, n);
    }

    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const chunk = this.chunks[0];
      const need = n - off;
      if (chunk.length <= need) {
        chunk.copy(out, off);
        off += chunk.length;
        this.chunks.shift();
      } else {
        chunk.copy(out, off, 0, need);
        this.chunks[0] = chunk.subarray(need);
        off += need;
      }
    }
    this.length -= n;
    return out;
  }
}

export const MAX_PACKET_SIZE = 32 * 1024 * 1024;

export class StreamParser {
  /**
   * @param handlers.onDeviceMeta (name) => void
   * @param handlers.onCodec ({codecName,width,height}) => void
   * @param handlers.onFrame ({data,pts,config,keyFrame}) => void
   * @param handlers.onError (Error) => void
   */
  constructor({ sendDeviceMeta = false, sendCodecMeta = true, ...handlers } = {}) {
    this.queue = new ByteQueue();
    this.handlers = handlers;
    this.stage = sendDeviceMeta ? 'device_meta' : sendCodecMeta ? 'codec_meta' : 'frames';
    this.deviceName = null;
    this.videoSize = null;
    this.failed = false;
  }

  push(chunk) {
    if (this.failed) return;
    this.queue.push(chunk);
    this.#drain();
  }

  #fail(message) {
    this.failed = true;
    this.handlers.onError?.(new Error(message));
  }

  #drain() {
    for (;;) {
      if (this.failed) return;

      if (this.stage === 'device_meta') {
        const meta = this.queue.take(DEVICE_META_SIZE);
        if (!meta) return;
        this.deviceName = meta.toString('utf8').replace(/\0.*$/s, '');
        this.stage = 'codec_meta';
        this.handlers.onDeviceMeta?.(this.deviceName);
        continue;
      }

      if (this.stage === 'codec_meta') {
        const meta = this.queue.take(CODEC_META_SIZE);
        if (!meta) return;
        const info = {
          codecName: codecIdToName(meta.readUInt32BE(0)),
          width: meta.readInt32BE(4),
          height: meta.readInt32BE(8),
        };
        this.videoSize = { width: info.width, height: info.height };
        this.stage = 'frames';
        this.handlers.onCodec?.(info);
        continue;
      }

      // stage === 'frames'
      if (this.queue.length < PACKET_HEADER_SIZE) return;
      const header = this.queue.take(PACKET_HEADER_SIZE);
      const info = parsePacketHeader(header);
      if (info.length > MAX_PACKET_SIZE) {
        this.#fail(`pacchetto video incoerente (${info.length} byte): versione del server scrcpy incompatibile?`);
        return;
      }
      const data = this.queue.take(info.length);
      if (!data) {
        this.queue.unshift(header); // il frame non è ancora arrivato tutto
        return;
      }
      this.handlers.onFrame?.({ data, pts: info.pts, config: info.config, keyFrame: info.keyFrame });
    }
  }
}
