import assert from 'node:assert/strict';
import test from 'node:test';

import { ByteQueue, StreamParser } from '../src/shared/stream-parser.js';

function codecMeta(width, height) {
  const buf = Buffer.alloc(12);
  buf.write('h264', 0, 'ascii');
  buf.writeInt32BE(width, 4);
  buf.writeInt32BE(height, 8);
  return buf;
}

function packet(payload, { config = false, keyFrame = false, pts = 0 } = {}) {
  const header = Buffer.alloc(12);
  let raw = BigInt(pts);
  if (config) raw |= 1n << 63n;
  if (keyFrame) raw |= 1n << 62n;
  header.writeBigUInt64BE(raw, 0);
  header.writeUInt32BE(payload.length, 8);
  return Buffer.concat([header, payload]);
}

function collect(stream, { chunkSize = null, ...opts } = {}) {
  const events = { codec: null, frames: [], errors: [] };
  const parser = new StreamParser({
    ...opts,
    onCodec: (info) => (events.codec = info),
    onFrame: (frame) => events.frames.push(frame),
    onError: (err) => events.errors.push(err),
  });
  if (chunkSize) {
    for (let i = 0; i < stream.length; i += chunkSize) parser.push(stream.subarray(i, i + chunkSize));
  } else {
    parser.push(stream);
  }
  return events;
}

test('ByteQueue restituisce esattamente i byte richiesti attraverso più chunk', () => {
  const q = new ByteQueue();
  q.push(Buffer.from([1, 2, 3]));
  q.push(Buffer.from([4, 5]));
  q.push(Buffer.from([6, 7, 8, 9]));
  assert.equal(q.length, 9);
  assert.deepEqual([...q.take(2)], [1, 2]);
  assert.deepEqual([...q.take(5)], [3, 4, 5, 6, 7]);
  assert.equal(q.take(10), null); // non abbastanza byte: niente consumo
  assert.equal(q.length, 2);
  assert.deepEqual([...q.take(2)], [8, 9]);
  assert.equal(q.length, 0);
});

test('ByteQueue.unshift rimette i byte in testa', () => {
  const q = new ByteQueue();
  q.push(Buffer.from([3, 4]));
  q.unshift(Buffer.from([1, 2]));
  assert.deepEqual([...q.take(4)], [1, 2, 3, 4]);
});

test('legge codec meta e i frame successivi', () => {
  const stream = Buffer.concat([
    codecMeta(1280, 720),
    packet(Buffer.from([0, 0, 0, 1, 0x67, 0x42]), { config: true }),
    packet(Buffer.from([0, 0, 0, 1, 0x65, 0xaa]), { keyFrame: true, pts: 1000 }),
    packet(Buffer.from([0, 0, 0, 1, 0x41, 0xbb]), { pts: 2000 }),
  ]);
  const { codec, frames, errors } = collect(stream);
  assert.deepEqual(errors, []);
  assert.deepEqual(codec, { codecName: 'h264', width: 1280, height: 720 });
  assert.equal(frames.length, 3);
  assert.equal(frames[0].config, true);
  assert.equal(frames[1].keyFrame, true);
  assert.equal(frames[1].pts, 1000);
  assert.equal(frames[2].config, false);
  assert.equal(frames[2].keyFrame, false);
  assert.deepEqual([...frames[2].data], [0, 0, 0, 1, 0x41, 0xbb]);
});

test('il risultato non cambia comunque sia spezzettato il flusso TCP', () => {
  const payloads = [
    Buffer.alloc(37, 1),
    Buffer.alloc(4096, 2),
    Buffer.alloc(1, 3),
    Buffer.alloc(9001, 4),
  ];
  const stream = Buffer.concat([
    codecMeta(800, 400),
    ...payloads.map((p, i) => packet(p, { keyFrame: i === 0, pts: i * 100 })),
  ]);

  for (const chunkSize of [1, 2, 7, 13, 12, 64, 1000, 4096, stream.length]) {
    const { codec, frames, errors } = collect(stream, { chunkSize });
    assert.deepEqual(errors, [], `chunk ${chunkSize}`);
    assert.equal(codec.width, 800, `chunk ${chunkSize}`);
    assert.equal(frames.length, payloads.length, `chunk ${chunkSize}`);
    frames.forEach((f, i) => {
      assert.equal(f.data.length, payloads[i].length, `chunk ${chunkSize}, frame ${i}`);
      assert.equal(f.data[0], payloads[i][0], `chunk ${chunkSize}, frame ${i}`);
      assert.equal(f.pts, i * 100);
    });
  }
});

test('con send_device_meta legge prima il nome del dispositivo', () => {
  const name = Buffer.alloc(64);
  name.write('PICO 4\0', 0, 'utf8');
  const stream = Buffer.concat([name, codecMeta(640, 480), packet(Buffer.alloc(8, 7), { keyFrame: true })]);
  let deviceName = null;
  const parser = new StreamParser({
    sendDeviceMeta: true,
    onDeviceMeta: (n) => (deviceName = n),
    onCodec: () => {},
    onFrame: () => {},
  });
  parser.push(stream);
  assert.equal(deviceName, 'PICO 4');
});

test('una lunghezza assurda ferma il parser con un errore chiaro', () => {
  const header = Buffer.alloc(12);
  header.writeBigUInt64BE(0n, 0);
  header.writeUInt32BE(0x7fffffff, 8);
  const { errors, frames } = collect(Buffer.concat([codecMeta(100, 100), header]));
  assert.equal(frames.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /incompatibile/);
});
