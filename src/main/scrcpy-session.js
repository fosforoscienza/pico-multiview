// Una sessione scrcpy per un singolo visore:
//  1. push del server sul dispositivo
//  2. avvio del server via app_process
//  3. adb forward + connessione al socket video e a quello di controllo
//  4. parsing dello stream (header 12 byte + frame H.264 in Annex-B)
//
// Emette: 'codec' {codecName,width,height} | 'frame' {data,pts,config,keyFrame}
//         'log' {level,message} | 'error' Error | 'closed' {reason}

import { EventEmitter } from 'node:events';
import net from 'node:net';
import crypto from 'node:crypto';

import {
  adbSpawn,
  delay,
  findFreePort,
  forward,
  forwardRemove,
  push,
  scrcpyServerPath,
} from './adb.js';
import { StreamParser } from '../shared/stream-parser.js';

export const SCRCPY_VERSION = '2.7';
const REMOTE_JAR = '/data/local/tmp/pico-multiview-server.jar';

export const DEFAULT_VIDEO_OPTIONS = {
  maxSize: 800,
  bitRate: 2_000_000,
  maxFps: 20,
  codec: 'h264',
  displayId: 0,
  crop: null, // "W:H:X:Y"
};

/**
 * Attacca il lettore al socket video e lo rimette in moto.
 *
 * L'handshake mette il socket in pausa per non perdere i byte arrivati insieme
 * al dummy byte. Da lì attaccare un listener 'data' **non basta**: uno stream
 * messo in pausa di proposito resta fermo finché non gli si dice `resume()`.
 * Senza, la sessione risulta avviata — dummy byte ricevuto, stato "in
 * streaming" — e non arriva mai un fotogramma.
 */
export function attachVideoStream(socket, onChunk) {
  socket.on('data', onChunk);
  socket.resume();
}

export class ScrcpySession extends EventEmitter {
  constructor(serial, options = {}) {
    super();
    this.serial = serial;
    this.options = { ...DEFAULT_VIDEO_OPTIONS, ...options };
    this.scid = crypto.randomInt(0, 0x7fffffff);
    this.socketName = `scrcpy_${this.scid.toString(16).padStart(8, '0')}`;
    this.port = null;
    this.proc = null;
    this.videoSocket = null;
    this.controlSocket = null;
    this.videoSize = null;
    this.stopped = false;
    this.stats = { frames: 0, bytes: 0, lastFrameAt: 0 };
    this.parser = new StreamParser({
      sendDeviceMeta: false,
      sendCodecMeta: true,
      onCodec: (info) => {
        this.videoSize = { width: info.width, height: info.height };
        this.emit('codec', info);
      },
      onFrame: (frame) => {
        this.stats.frames++;
        this.stats.lastFrameAt = Date.now();
        this.emit('frame', frame);
      },
      onError: (err) => this.#fail(err),
    });
  }

  serverArgs() {
    const o = this.options;
    const args = [
      `scid=${this.scid.toString(16).padStart(8, '0')}`,
      'log_level=info',
      'video=true',
      'audio=false',
      'control=true',
      'tunnel_forward=true',
      'cleanup=true',
      'send_device_meta=false',
      'send_frame_meta=true',
      'send_codec_meta=true',
      'send_dummy_byte=true',
      'raw_stream=false',
      'stay_awake=true',
      `video_codec=${o.codec}`,
      `max_size=${o.maxSize}`,
      `video_bit_rate=${o.bitRate}`,
      `max_fps=${o.maxFps}`,
      `display_id=${o.displayId}`,
    ];
    if (o.crop) args.push(`crop=${o.crop}`);
    return args;
  }

  async start() {
    this.stopped = false;

    await push(this.serial, scrcpyServerPath(), REMOTE_JAR);

    this.port = await findFreePort(27183);
    await forward(this.serial, this.port, `localabstract:${this.socketName}`);

    const cmd = [
      '-s',
      this.serial,
      'shell',
      `CLASSPATH=${REMOTE_JAR}`,
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      SCRCPY_VERSION,
      ...this.serverArgs(),
    ];

    this.proc = adbSpawn(cmd);
    const onLog = (level) => (buf) => {
      const text = buf.toString().trim();
      if (text) this.emit('log', { level, message: text });
    };
    this.proc.stdout.on('data', onLog('info'));
    this.proc.stderr.on('data', onLog('error'));
    this.proc.on('exit', (code) => {
      if (!this.stopped) this.#fail(new Error(`il server scrcpy è terminato (codice ${code})`));
    });

    this.videoSocket = await this.#connectWithDummyByte();
    attachVideoStream(this.videoSocket, (chunk) => this.#onVideoData(chunk));
    this.videoSocket.on('error', (err) => this.#fail(err));
    this.videoSocket.on('close', () => {
      if (!this.stopped) this.#fail(new Error('socket video chiuso dal dispositivo'));
    });

    this.controlSocket = await this.#connectSocket();
    this.controlSocket.on('error', (err) => this.emit('log', { level: 'error', message: `socket controllo: ${err.message}` }));
    // Lo stream di ritorno (clipboard, ack) non ci serve: lo scartiamo.
    this.controlSocket.resume();

    this.emit('log', { level: 'info', message: `sessione avviata (porta ${this.port})` });
  }

  #connectSocket() {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: this.port });
      socket.setNoDelay(true);
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  /**
   * Con il tunnel "forward" la connessione TCP riesce anche se il server non è
   * ancora in ascolto: la conferma è il dummy byte. Quindi ritentiamo finché
   * non arriva.
   */
  async #connectWithDummyByte(attempts = 100, intervalMs = 100) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
      if (this.stopped) throw new Error('sessione fermata durante l\'avvio');
      let socket;
      try {
        socket = await this.#connectSocket();
      } catch (err) {
        lastError = err;
        await delay(intervalMs);
        continue;
      }
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 1000);
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeListener('data', onData);
          socket.removeListener('close', onClose);
          socket.removeListener('error', onClose);
        };
        const onData = (chunk) => {
          cleanup();
          // Mettiamo in pausa finché non colleghiamo il parser, così non
          // perdiamo i byte che arrivano subito dopo il dummy byte.
          socket.pause();
          // Il primo byte è il dummy byte; il resto (se già arrivato) va in coda.
          if (chunk.length > 1) this.parser.push(chunk.subarray(1));
          resolve(true);
        };
        const onClose = () => {
          cleanup();
          resolve(false);
        };
        socket.once('data', onData);
        socket.once('close', onClose);
        socket.once('error', onClose);
      });
      if (ok) return socket;
      socket.destroy();
      lastError = new Error('nessun dummy byte dal server');
      await delay(intervalMs);
    }
    throw lastError ?? new Error('impossibile connettersi al server scrcpy');
  }

  #onVideoData(chunk) {
    this.stats.bytes += chunk.length;
    this.parser.push(chunk);
  }

  /** Invia un messaggio di controllo già codificato. */
  sendControl(buffer) {
    if (!this.controlSocket || this.controlSocket.destroyed) return false;
    return this.controlSocket.write(buffer);
  }

  #fail(err) {
    if (this.stopped) return;
    this.emit('error', err);
    this.stop(err.message);
  }

  async stop(reason = 'stop richiesto') {
    if (this.stopped) return;
    this.stopped = true;
    for (const s of [this.videoSocket, this.controlSocket]) {
      try {
        s?.destroy();
      } catch {
        /* ignora */
      }
    }
    this.videoSocket = null;
    this.controlSocket = null;
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {
        /* ignora */
      }
      this.proc = null;
    }
    if (this.port != null) {
      await forwardRemove(this.serial, this.port);
      this.port = null;
    }
    this.emit('closed', { reason });
  }
}
