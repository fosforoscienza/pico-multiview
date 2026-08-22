import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION,
  BUTTON,
  KEYCODE,
  PACKET_HEADER_SIZE,
  SCRCPY_CONTROL,
  codecIdToName,
  encodeBackOrScreenOn,
  encodeKeyPress,
  encodeKeycode,
  encodeScroll,
  encodeTouch,
  parsePacketHeader,
  toFixedPoint16,
  toFixedPointSigned16,
} from '../src/shared/protocol.js';
import { codecStringFromConfig } from '../src/renderer/decoder.js';

test('encodeTouch produce i 32 byte attesi da scrcpy', () => {
  const buf = encodeTouch({
    action: ACTION.DOWN,
    pointerId: 0xffffffffffffffffn,
    x: 100,
    y: 200,
    width: 1280,
    height: 720,
    pressure: 1,
    actionButton: BUTTON.PRIMARY,
    buttons: BUTTON.PRIMARY,
  });
  assert.equal(buf.length, 32);
  assert.equal(buf.readUInt8(0), SCRCPY_CONTROL.INJECT_TOUCH_EVENT);
  assert.equal(buf.readUInt8(1), ACTION.DOWN);
  assert.equal(buf.readBigUInt64BE(2), 0xffffffffffffffffn);
  assert.equal(buf.readInt32BE(10), 100);
  assert.equal(buf.readInt32BE(14), 200);
  assert.equal(buf.readUInt16BE(18), 1280);
  assert.equal(buf.readUInt16BE(20), 720);
  assert.equal(buf.readUInt16BE(22), 0xffff); // pressione piena
  assert.equal(buf.readUInt32BE(24), BUTTON.PRIMARY);
  assert.equal(buf.readUInt32BE(28), BUTTON.PRIMARY);
});

test('il rilascio azzera pressione e pulsanti', () => {
  const buf = encodeTouch({ action: ACTION.UP, x: 1, y: 2, width: 10, height: 10 });
  assert.equal(buf.readUInt16BE(22), 0);
  assert.equal(buf.readUInt32BE(28), 0);
});

test('le coordinate fuori scala vengono limitate ai campi u16', () => {
  const buf = encodeTouch({ action: ACTION.MOVE, x: 5, y: 5, width: 999999, height: -3 });
  assert.equal(buf.readUInt16BE(18), 65535);
  assert.equal(buf.readUInt16BE(20), 0);
});

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

test('encodeScroll: 21 byte con scroll in virgola fissa', () => {
  const buf = encodeScroll({ x: 10, y: 20, width: 100, height: 50, vscroll: -1 });
  assert.equal(buf.length, 21);
  assert.equal(buf.readUInt8(0), SCRCPY_CONTROL.INJECT_SCROLL_EVENT);
  assert.equal(buf.readInt16BE(13), 0); // hscroll
  assert.equal(buf.readInt16BE(15), -32768); // vscroll
  assert.equal(buf.readInt32BE(17), 0); // buttons
});

test('encodeBackOrScreenOn: 2 byte', () => {
  assert.deepEqual([...encodeBackOrScreenOn(1)], [SCRCPY_CONTROL.BACK_OR_SCREEN_ON, 1]);
});

test('virgola fissa: saturazione ai limiti', () => {
  assert.equal(toFixedPoint16(1), 0xffff);
  assert.equal(toFixedPoint16(0), 0);
  assert.equal(toFixedPoint16(2), 0xffff);
  assert.equal(toFixedPointSigned16(1), 32767);
  assert.equal(toFixedPointSigned16(-1), -32768);
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
