import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARACTERISTICS,
  SERVICE_UUID,
  OTA_ERROR,
  OTA_STATE,
  TIME_MIN,
  clampUpdateInterval,
  decodeInfo,
  decodeOtaStatus,
  decodePositionOut,
  decodeSettings,
  decodeTime,
  decodeWifiStatus,
  describeOtaError,
  encodeForgetPhone,
  encodeOtaCommand,
  encodeOtaStart,
  encodePositionIn,
  encodeSettings,
  encodeTime,
  encodeWifiControl,
  formatInterval,
  fromBase64,
  otaChunkSize,
  toBase64,
} from './protocol.js';

const bytes = (...values) => Uint8Array.from(values);

test('UUIDs follow the pattern of the firmware', () => {
  assert.equal(SERVICE_UUID, '494e4449-0001-4e41-5649-000000000000');
  assert.equal(CHARACTERISTICS.otaData, '494e4449-000a-4e41-5649-000000000000');
  assert.equal(CHARACTERISTICS.deviceControl, '494e4449-000b-4e41-5649-000000000000');
  assert.equal(new Set(Object.values(CHARACTERISTICS)).size, Object.keys(CHARACTERISTICS).length);
});

test('base64 matches the test vectors of RFC 4648', () => {
  const vectors = [['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'], ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy']];
  for (const [text, encoded] of vectors) {
    const input = new TextEncoder().encode(text);
    assert.equal(toBase64(input), encoded);
    assert.deepEqual(fromBase64(encoded), input);
  }
});

test('base64 round trip with all byte values', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(fromBase64(toBase64(all)), all);
  assert.throws(() => fromBase64('a*b='), /Invalid base64/);
});

test('info has version, flags, battery and firmware', () => {
  const info = decodeInfo(Uint8Array.from([1, 3, 80, 0, ...new TextEncoder().encode('abc1234')]));
  assert.deepEqual(info, { api: 1, ota: true, charging: true, battery: 80, firmware: 'abc1234' });
  assert.equal(decodeInfo(bytes(1, 0, 5, 0)).ota, false);
  assert.throws(() => decodeInfo(bytes(1, 0)), /too short/);
});

test('time is 8 bytes little endian and checked like the firmware does', () => {
  const encoded = encodeTime(1790000000);
  assert.equal(encoded.length, 8);
  assert.equal(decodeTime(encoded), 1790000000);
  // 1790000000 = 0x6AB13B80, least significant byte first, upper word is zero
  assert.deepEqual([...encoded], [0x80, 0x3b, 0xb1, 0x6a, 0, 0, 0, 0]);
  assert.throws(() => encodeTime(TIME_MIN - 1), /not plausible/);
  assert.throws(() => encodeTime(4102444800), /not plausible/);
  assert.throws(() => encodeTime(NaN), /not plausible/);
  assert.equal(decodeTime(encodeTime(TIME_MIN + 0.9)), TIME_MIN);
});

test('time above 2^32 seconds still fits the upper word', () => {
  // 2099-12-31 is below 2^32 (2106), the upper word is zero
  assert.deepEqual([...encodeTime(4102444799).subarray(4)], [0, 0, 0, 0]);
});

test('position for the device has 16 bytes in the layout of the firmware', () => {
  const encoded = encodePositionIn({ latitude: 49.626846, longitude: -8.581875, altitude: 312.4, accuracy: 24.2, timestamp: 1790000000 });
  assert.equal(encoded.length, 16);
  const data = new DataView(encoded.buffer);
  assert.equal(data.getInt32(0, true), 496268460);
  assert.equal(data.getInt32(4, true), -85818750);
  assert.equal(data.getInt16(8, true), 312);
  assert.equal(data.getUint16(10, true), 25); // rounded up, never better than measured
  assert.equal(data.getUint32(12, true), 1790000000);
});

test('position without accuracy counts as 100 m, the device does not accept 0', () => {
  const data = new DataView(encodePositionIn({ latitude: 1, longitude: 2, timestamp: 1790000000 }).buffer);
  assert.equal(data.getUint16(10, true), 100);
  assert.equal(new DataView(encodePositionIn({ latitude: 1, longitude: 2, accuracy: 0, timestamp: 1790000000 }).buffer).getUint16(10, true), 100);
});

test('altitude is limited to 16 bits', () => {
  const data = new DataView(encodePositionIn({ latitude: 1, longitude: 2, altitude: 99999, accuracy: 5, timestamp: 1790000000 }).buffer);
  assert.equal(data.getInt16(8, true), 32767);
});

test('invalid positions are refused', () => {
  assert.throws(() => encodePositionIn({ latitude: 91, longitude: 0, accuracy: 5, timestamp: 1 }), /not valid/);
  assert.throws(() => encodePositionIn({ latitude: 0, longitude: -181, accuracy: 5, timestamp: 1 }), /not valid/);
  assert.throws(() => encodePositionIn({ latitude: NaN, longitude: 0, accuracy: 5, timestamp: 1 }), /not valid/);
});

test('position of the device is null without a fix', () => {
  assert.equal(decodePositionOut(new Uint8Array(16)), null);
});

test('position of the device is decoded', () => {
  const raw = new Uint8Array(16);
  const data = new DataView(raw.buffer);
  data.setInt32(0, -496268460, true);
  data.setInt32(4, 85818750, true);
  data.setInt16(8, 312, true);
  data.setUint16(10, 12, true);
  raw.set([7, 7, 11, 0], 12);
  assert.deepEqual(decodePositionOut(raw), {
    latitude: -49.626846,
    longitude: 8.581875,
    altitude: 312,
    hdop: 1.2,
    fix: 7,
    fixName: 'position of the phone',
    satellitesInUse: 7,
    satellitesInView: 11,
  });
  assert.throws(() => decodePositionOut(new Uint8Array(15)), /expected 16/);
});

test('WiFi control is one byte, status has no password', () => {
  assert.deepEqual(encodeWifiControl(true), bytes(1));
  assert.deepEqual(encodeWifiControl(false), bytes(0));
  const status = decodeWifiStatus(Uint8Array.from([1, 2, ...new TextEncoder().encode('IndiaNavi-A1B2')]));
  assert.deepEqual(status, { running: true, stations: 2, ssid: 'IndiaNavi-A1B2' });
  assert.deepEqual(Object.keys(status).sort(), ['running', 'ssid', 'stations']);
  assert.equal(decodeWifiStatus(bytes(0, 0)).running, false);
});

test('settings round trip', () => {
  const settings = { showTrack: true, showHeightGraph: false, updateInterval: 300 };
  const encoded = encodeSettings(settings);
  assert.deepEqual([...encoded], [1, 0, 300 & 0xff, 300 >> 8]);
  assert.deepEqual(decodeSettings(encoded), settings);
  assert.deepEqual([...encodeSettings({ showTrack: true, showHeightGraph: true, updateInterval: 30 })], [3, 0, 30, 0]);
});

test('update interval is 30 s to 10 min', () => {
  assert.doesNotThrow(() => encodeSettings({ showTrack: true, showHeightGraph: true, updateInterval: 30 }));
  assert.doesNotThrow(() => encodeSettings({ showTrack: true, showHeightGraph: true, updateInterval: 600 }));
  assert.throws(() => encodeSettings({ showTrack: true, showHeightGraph: true, updateInterval: 29 }), /30 to 600/);
  assert.throws(() => encodeSettings({ showTrack: true, showHeightGraph: true, updateInterval: 601 }), /30 to 600/);
  assert.throws(() => encodeSettings({ showTrack: true, showHeightGraph: true, updateInterval: 45.5 }), /30 to 600/);
  assert.equal(clampUpdateInterval(5), 30);
  assert.equal(clampUpdateInterval(9999), 600);
  assert.equal(clampUpdateInterval(90.4), 90);
  assert.equal(formatInterval(30), '30 s');
  assert.equal(formatInterval(120), '2 min');
});

test('forget phone is one command byte', () => {
  assert.deepEqual(encodeForgetPhone(), bytes(1));
});

test('firmware update commands', () => {
  assert.deepEqual([...encodeOtaStart(1500000)], [1, 0x60, 0xe3, 0x16, 0]);
  assert.throws(() => encodeOtaStart(0), /empty/);
  assert.deepEqual(encodeOtaCommand(2), bytes(2));
});

test('firmware update status and error texts', () => {
  assert.deepEqual(decodeOtaStatus(bytes(OTA_STATE.RECEIVING, 0, 4, 3, 2, 1)), { state: 2, error: 0, offset: 0x01020304 });
  assert.throws(() => decodeOtaStatus(bytes(1, 2, 3)), /expected 6/);
  assert.match(describeOtaError(OTA_ERROR.BATTERY), /battery/);
  assert.match(describeOtaError(99), /99/);
});

test('chunks fit into the MTU', () => {
  assert.equal(otaChunkSize(247), 244);
  assert.equal(otaChunkSize(185), 182);
  assert.equal(otaChunkSize(517), 244);
});
