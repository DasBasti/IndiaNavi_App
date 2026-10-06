// Bluetooth LE protocol of the IndiaNavi, API version 1.
// Encoding and decoding of the values of the characteristics, without any Bluetooth code so it can be tested.
// The byte layouts are described in docs/ble_api.md, the firmware has the same in lib/ble_protocol.
// All numbers are little endian.

export const API_VERSION = 1;

// 494e4449-00NN-4e41-5649-000000000000 ("INDI" "NAVI")
const uuid = (n) => `494e4449-${n.toString(16).padStart(4, '0')}-4e41-5649-000000000000`;

export const SERVICE_UUID = uuid(1);

export const CHARACTERISTICS = {
  info: uuid(2),
  time: uuid(3),
  positionIn: uuid(4),
  positionOut: uuid(5),
  wifiControl: uuid(6),
  wifiStatus: uuid(7),
  settings: uuid(8),
  otaControl: uuid(9),
  otaData: uuid(10),
  deviceControl: uuid(11),
};

// ---- Base64, the Bluetooth library exchanges values as base64 text ----

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    text += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    text += b === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    text += c === undefined ? '=' : ALPHABET[triple & 63];
  }
  return text;
};

export const fromBase64 = (text) => {
  const clean = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of clean) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) {
      throw new Error('Invalid base64');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
};

// ---- Little endian numbers ----

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const check = (bytes, length, what) => {
  if (bytes.length !== length) {
    throw new Error(`${what} has ${bytes.length} bytes, expected ${length}`);
  }
};

// ---- Info ----

export const INFO_HEADER_SIZE = 4;

// { api, ota, charging, trackColor (the settings carry the track color), battery (percent), firmware }
export const decodeInfo = (bytes) => {
  if (bytes.length < INFO_HEADER_SIZE) {
    throw new Error('Device info is too short');
  }
  return {
    api: bytes[0],
    ota: (bytes[1] & 0x01) !== 0,
    charging: (bytes[1] & 0x02) !== 0,
    trackColor: (bytes[1] & 0x04) !== 0,
    battery: bytes[2],
    firmware: new TextDecoder().decode(bytes.subarray(INFO_HEADER_SIZE)),
  };
};

// ---- Time ----

export const TIME_SIZE = 8;

// The firmware accepts the time between 2026-01-01 and 2100-01-01
export const TIME_MIN = 1767225600;
export const TIME_MAX = 4102444800;

// Seconds since 1970-01-01 UTC
export const encodeTime = (epochSeconds) => {
  const seconds = Math.floor(epochSeconds);
  if (!Number.isSafeInteger(seconds) || seconds < TIME_MIN || seconds >= TIME_MAX) {
    throw new Error('The time of the phone is not plausible');
  }
  const bytes = new Uint8Array(TIME_SIZE);
  const data = view(bytes);
  data.setUint32(0, seconds % 2 ** 32, true);
  data.setUint32(4, Math.floor(seconds / 2 ** 32), true);
  return bytes;
};

export const decodeTime = (bytes) => {
  check(bytes, TIME_SIZE, 'Time');
  const data = view(bytes);
  return data.getUint32(0, true) + data.getUint32(4, true) * 2 ** 32;
};

// ---- Position ----

export const POSITION_IN_SIZE = 16;
export const POSITION_OUT_SIZE = 16;

const E7 = 1e7;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Position of the phone for the device: { latitude, longitude, altitude (m, optional), accuracy (m), timestamp (s) }
export const encodePositionIn = ({ latitude, longitude, altitude = 0, accuracy, timestamp }) => {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error('The position is not valid');
  }
  const bytes = new Uint8Array(POSITION_IN_SIZE);
  const data = view(bytes);
  data.setInt32(0, Math.round(latitude * E7), true);
  data.setInt32(4, Math.round(longitude * E7), true);
  data.setInt16(8, clamp(Math.round(Number.isFinite(altitude) ? altitude : 0), -32768, 32767), true);
  // the device does not accept an accuracy of 0, a position without accuracy counts as 100 m
  const meters = Number.isFinite(accuracy) && accuracy > 0 ? Math.ceil(accuracy) : 100;
  data.setUint16(10, clamp(meters, 1, 65535), true);
  data.setUint32(12, Math.floor(timestamp) % 2 ** 32, true);
  return bytes;
};

export const FIX_NAMES = {
  0: 'no fix',
  1: 'GPS',
  2: 'DGPS',
  6: 'dead reckoning',
  7: 'position of the phone',
};

// Position of the device, null while it has none
// { latitude, longitude, altitude, hdop, fix, fixName, satellitesInUse, satellitesInView }
export const decodePositionOut = (bytes) => {
  check(bytes, POSITION_OUT_SIZE, 'Position');
  const data = view(bytes);
  const fix = bytes[12];
  if (fix === 0) {
    return null;
  }
  return {
    latitude: data.getInt32(0, true) / E7,
    longitude: data.getInt32(4, true) / E7,
    altitude: data.getInt16(8, true),
    hdop: data.getUint16(10, true) / 10,
    fix,
    fixName: FIX_NAMES[fix] ?? `fix ${fix}`,
    satellitesInUse: bytes[13],
    satellitesInView: bytes[14],
  };
};

// ---- WiFi access point ----

// The device never sends the password. The phone reads it from the QR code on the display.
export const encodeWifiControl = (on) => Uint8Array.of(on ? 1 : 0);

// { running, stations (phones that joined), ssid }
export const decodeWifiStatus = (bytes) => {
  if (bytes.length < 2) {
    throw new Error('WiFi status is too short');
  }
  return {
    running: bytes[0] === 1,
    stations: bytes[1],
    ssid: new TextDecoder().decode(bytes.subarray(2)),
  };
};

// ---- Display settings ----

export const SETTINGS_SIZE = 4;
export const SETTING_SHOW_TRACK = 0x01;
export const SETTING_SHOW_HEIGHT_GRAPH = 0x02;

// The screen of the device is updated this often, the e-ink display takes long to refresh
export const UPDATE_INTERVAL_MIN = 30;
export const UPDATE_INTERVAL_MAX = 600;
export const UPDATE_INTERVAL_DEFAULT = 60;
export const UPDATE_INTERVAL_CHOICES = [30, 60, 120, 300, 600];

export const clampUpdateInterval = (seconds) => clamp(Math.round(seconds), UPDATE_INTERVAL_MIN, UPDATE_INTERVAL_MAX);

// The track color is a color of the display, the number in DISPLAY_COLORS of map_color.js (0 black … 6 orange)
export const TRACK_COLOR_MAX = 6;
export const TRACK_COLOR_DEFAULT = 3; // blue

export const formatInterval = (seconds) => (seconds < 60 ? `${seconds} s` : `${seconds / 60} min`);

// Without trackColor the byte is 0 and the device keeps blue, a firmware without the color accepts only that
export const encodeSettings = ({ showTrack, showHeightGraph, trackColor, updateInterval }) => {
  if (!Number.isInteger(updateInterval) || updateInterval < UPDATE_INTERVAL_MIN || updateInterval > UPDATE_INTERVAL_MAX) {
    throw new Error(`The update interval has to be ${UPDATE_INTERVAL_MIN} to ${UPDATE_INTERVAL_MAX} seconds`);
  }
  if (trackColor !== undefined && (!Number.isInteger(trackColor) || trackColor < 0 || trackColor > TRACK_COLOR_MAX)) {
    throw new Error(`The track color has to be 0 to ${TRACK_COLOR_MAX}`);
  }
  const bytes = new Uint8Array(SETTINGS_SIZE);
  bytes[0] = (showTrack ? SETTING_SHOW_TRACK : 0) | (showHeightGraph ? SETTING_SHOW_HEIGHT_GRAPH : 0);
  bytes[1] = trackColor === undefined ? 0 : trackColor + 1;
  view(bytes).setUint16(2, updateInterval, true);
  return bytes;
};

// { showTrack, showHeightGraph, trackColor, updateInterval }
export const decodeSettings = (bytes) => {
  check(bytes, SETTINGS_SIZE, 'Settings');
  return {
    showTrack: (bytes[0] & SETTING_SHOW_TRACK) !== 0,
    showHeightGraph: (bytes[0] & SETTING_SHOW_HEIGHT_GRAPH) !== 0,
    trackColor: bytes[1] === 0 ? TRACK_COLOR_DEFAULT : bytes[1] - 1,
    updateInterval: view(bytes).getUint16(2, true),
  };
};

// ---- Device control ----

// The device forgets the phone that is paired, the next phone can pair
export const encodeForgetPhone = () => Uint8Array.of(0x01);

// ---- Firmware update ----

export const OTA_CMD_START = 0x01;
export const OTA_CMD_ABORT = 0x02;
export const OTA_CMD_FINISH = 0x03;
export const OTA_CMD_RESTART = 0x04;

// A link with a smaller MTU is too slow, the device refuses the update
export const OTA_MIN_MTU = 185;
// The device reports its progress in steps of this size
export const OTA_ACK_INTERVAL = 4096;
// The phone never sends more than this beyond the last report of the device
export const OTA_WINDOW = 8192;
export const OTA_MAX_CHUNK = 244;

export const OTA_STATE = {
  IDLE: 0,
  READY: 1,
  RECEIVING: 2,
  VERIFYING: 3,
  DONE: 4,
  ERROR: 5,
};

export const OTA_ERROR = {
  NONE: 0,
  BUSY: 1,
  SIZE: 2,
  BATTERY: 3,
  MTU: 4,
  FLASH: 5,
  INVALID: 6,
  SEQUENCE: 7,
  TIMEOUT: 8,
  OVERFLOW: 9,
  ABORTED: 10,
};

const OTA_ERROR_TEXT = {
  [OTA_ERROR.BUSY]: 'Another update or a file transfer is running on the IndiaNavi',
  [OTA_ERROR.SIZE]: 'The firmware file does not fit into the IndiaNavi',
  [OTA_ERROR.BATTERY]: 'The battery of the IndiaNavi is too low, connect the charger',
  [OTA_ERROR.MTU]: 'The Bluetooth link is too slow for an update',
  [OTA_ERROR.FLASH]: 'The IndiaNavi could not write the firmware',
  [OTA_ERROR.INVALID]: 'The IndiaNavi rejected the firmware file',
  [OTA_ERROR.SEQUENCE]: 'The update got out of step',
  [OTA_ERROR.TIMEOUT]: 'The IndiaNavi got no data for too long',
  [OTA_ERROR.OVERFLOW]: 'The data came faster than the IndiaNavi can store it',
  [OTA_ERROR.ABORTED]: 'The update was stopped',
};

export const describeOtaError = (error) => OTA_ERROR_TEXT[error] ?? `Error ${error}`;

export const encodeOtaStart = (size) => {
  if (!Number.isInteger(size) || size <= 0 || size > 0xffffffff) {
    throw new Error('The firmware file is empty');
  }
  const bytes = new Uint8Array(5);
  bytes[0] = OTA_CMD_START;
  view(bytes).setUint32(1, size, true);
  return bytes;
};

export const encodeOtaCommand = (command) => Uint8Array.of(command);

export const OTA_STATUS_SIZE = 6;

// { state, error, offset (bytes of the image that are in flash) }
export const decodeOtaStatus = (bytes) => {
  check(bytes, OTA_STATUS_SIZE, 'Update status');
  return { state: bytes[0], error: bytes[1], offset: view(bytes).getUint32(2, true) };
};

// Chunk size for a negotiated MTU: 3 bytes of the MTU are the ATT header
export const otaChunkSize = (mtu) => Math.min(mtu - 3, OTA_MAX_CHUNK);
