import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KEYCODE,
  PACKET_HEADER_SIZE,
  SCRCPY_CONTROL,
  codecIdToName,
  encodeBackOrScreenOn,
  encodeKeyPress,
  encodeKeycode,
  parsePacketHeader,
} from '../src/shared/protocol.js';
import { codecStringFromConfig } from '../src/renderer/decoder.js';

test('encodeKeycode: 17 byte, campi in big endian', () => {
  const buf = encodeKeycode({ action: 0, keycode: KEYCODE.HOME, repeat: 0, metaState: 0 });
  assert.equal(buf.length, 17);
  assert.equal(buf.readUInt8(0), SCRCPY_CONTROL.INJECT_KEYCODE);
  assert.equal(buf.readUInt32BE(5), KEYCODE.HOME);
});

test('encodeKeyPress concatena pressione e rilascio', () => {
  const buf = encodeKeyPress(KEYCODE.DPAD_CENTER);
  assert.equal(buf.length, 34);
  assert.equal(buf.readUInt32BE(1), 0); // down
  assert.equal(buf.readUInt32BE(18), 1); // up
});

test('encodeBackOrScreenOn: 2 byte', () => {
  assert.deepEqual([...encodeBackOrScreenOn(1)], [SCRCPY_CONTROL.BACK_OR_SCREEN_ON, 1]);
});

test('parsePacketHeader legge flag, pts e lunghezza', () => {
  const header = Buffer.alloc(PACKET_HEADER_SIZE);
  const CONFIG = 1n << 63n;
  const KEY = 1n << 62n;
  header.writeBigUInt64BE(CONFIG | KEY | 123456n, 0);
  header.writeUInt32BE(4096, 8);
  const info = parsePacketHeader(header);
  assert.equal(info.config, true);
  assert.equal(info.keyFrame, true);
  assert.equal(info.pts, 123456);
  assert.equal(info.length, 4096);

  const plain = Buffer.alloc(PACKET_HEADER_SIZE);
  plain.writeBigUInt64BE(99n, 0);
  plain.writeUInt32BE(10, 8);
  const info2 = parsePacketHeader(plain);
  assert.equal(info2.config, false);
  assert.equal(info2.keyFrame, false);
  assert.equal(info2.pts, 99);
});

test('codecIdToName decodifica i quattro caratteri', () => {
  assert.equal(codecIdToName(0x68323634), 'h264');
});

test('codecStringFromConfig legge profilo e livello dallo SPS', () => {
  // start code + NAL type 7 (SPS) + profile_idc 0x42, constraints 0xe0, level 0x1f
  const sps = Uint8Array.from([0, 0, 0, 1, 0x67, 0x42, 0xe0, 0x1f, 0xda, 0x02]);
  assert.equal(codecStringFromConfig(sps), 'avc1.42e01f');
});

test('codecStringFromConfig ripiega su Baseline se lo SPS non c\'è', () => {
  assert.equal(codecStringFromConfig(Uint8Array.from([0, 0, 0, 1, 0x68, 0xce])), 'avc1.42e01f');
});
