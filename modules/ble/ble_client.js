// Bluetooth LE connection to the IndiaNavi. The values are encoded in protocol.js, the firmware update is in
// firmware_update.js. Needs a build of the app with native code, it does not work in Expo Go.

import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

import { updateFirmwareOverBle } from './firmware_update.js';
import {
  API_VERSION,
  CHARACTERISTICS,
  SERVICE_UUID,
  decodeInfo,
  decodeOtaStatus,
  decodePositionOut,
  decodeSettings,
  decodeWifiStatus,
  encodeForgetPhone,
  encodePositionIn,
  encodeSettings,
  encodeTime,
  encodeWifiControl,
  fromBase64,
  toBase64,
} from './protocol.js';

// Android answers the first access to a protected value only after the user entered the passkey of the display
const CONNECT_TIMEOUT = 20000;
const PAIRING_TIMEOUT = 90000;
const SCAN_TIMEOUT = 10000;
// the device asks for more, Android settles on what both sides support
const REQUESTED_MTU = 247;

let manager = null;

// null if the phone has no Bluetooth LE or the app runs without native code
const getManager = () => {
  if (manager === null) {
    try {
      manager = new BleManager();
    } catch {
      manager = false;
    }
  }
  return manager || null;
};

export const isBleSupported = () => getManager() !== null;

const requestAndroidPermissions = async () => {
  const wanted = Platform.Version >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (!wanted.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error(
      Platform.Version >= 31
        ? 'The app needs the permission to use nearby devices to talk to the IndiaNavi.'
        : 'Android needs the location permission to find Bluetooth devices.'
    );
  }
};

// Asks for the permissions and for Bluetooth to be switched on
export const prepareBluetooth = async () => {
  const bluetooth = getManager();
  if (!bluetooth) {
    throw new Error('Bluetooth LE is not available. Use the build of the app, not Expo Go.');
  }
  if (Platform.OS === 'android') {
    await requestAndroidPermissions();
  }
  if ((await bluetooth.state()) !== 'PoweredOn') {
    await bluetooth.enable();
  }
  return bluetooth;
};

// Looks for IndiaNavis around. onDevice gets { id, name, rssi } the first time a device is seen.
// Resolves when the time is over or the signal is aborted.
export const scanForDevices = async (onDevice, { timeout = SCAN_TIMEOUT, signal } = {}) => {
  const bluetooth = await prepareBluetooth();
  const seen = new Set();
  await new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      bluetooth.stopDeviceScan();
      resolve();
    };
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop);
    bluetooth.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        bluetooth.stopDeviceScan();
        reject(error);
      } else if (device && !seen.has(device.id)) {
        seen.add(device.id);
        onDevice({ id: device.id, name: device.name ?? device.localName ?? 'IndiaNavi', rssi: device.rssi });
      }
    });
  });
};

const withTimeout = (promise, ms, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

// A connection to one IndiaNavi. Use IndiaNaviConnection.connect().
export class IndiaNaviConnection {
  constructor(device, info) {
    this.device = device;
    this.info = info;
    this.otaListeners = new Set();
    this.otaSubscription = null;
  }

  // Connects and reads the device info. The first access to a protected value starts the pairing: Android asks
  // for the six digits that the display of the IndiaNavi shows.
  static async connect(deviceId, { onDisconnected } = {}) {
    const bluetooth = await prepareBluetooth();
    const device = await bluetooth.connectToDevice(deviceId, { requestMTU: REQUESTED_MTU, timeout: CONNECT_TIMEOUT });
    try {
      await device.discoverAllServicesAndCharacteristics();
      const connection = new IndiaNaviConnection(device, null);
      connection.info = await withTimeout(
        connection.readInfo(),
        PAIRING_TIMEOUT,
        'Pairing took too long. Switch the IndiaNavi off and on, then try again.'
      );
      if (connection.info.api !== API_VERSION) {
        throw new Error(`The IndiaNavi uses Bluetooth API ${connection.info.api}, the app uses ${API_VERSION}. Update the app or the firmware.`);
      }
      if (onDisconnected) {
        connection.disconnectSubscription = device.onDisconnected(() => onDisconnected());
      }
      return connection;
    } catch (error) {
      await bluetooth.cancelDeviceConnection(deviceId).catch(() => { });
      throw error;
    }
  }

  get id() {
    return this.device.id;
  }

  get mtu() {
    return this.device.mtu ?? 23;
  }

  async read(uuid) {
    const characteristic = await this.device.readCharacteristicForService(SERVICE_UUID, uuid);
    return fromBase64(characteristic.value ?? '');
  }

  write(uuid, bytes) {
    return this.device.writeCharacteristicWithResponseForService(SERVICE_UUID, uuid, toBase64(bytes));
  }

  writeWithoutResponse(uuid, bytes) {
    return this.device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, uuid, toBase64(bytes));
  }

  monitor(uuid, listener) {
    return this.device.monitorCharacteristicForService(SERVICE_UUID, uuid, (error, characteristic) => {
      // the error of a link that went away is reported by onDisconnected
      if (!error && characteristic?.value) {
        listener(fromBase64(characteristic.value));
      }
    });
  }

  async readInfo() {
    return decodeInfo(await this.read(CHARACTERISTICS.info));
  }

  // The device uses the time to start its GPS module faster
  syncTime(nowMs = Date.now()) {
    return this.write(CHARACTERISTICS.time, encodeTime(nowMs / 1000));
  }

  // position: { latitude, longitude, altitude, accuracy, timestamp }
  sendPosition(position) {
    return this.write(CHARACTERISTICS.positionIn, encodePositionIn(position));
  }

  async readPosition() {
    return decodePositionOut(await this.read(CHARACTERISTICS.positionOut));
  }

  // listener gets the position of the device (or null without a fix) every few seconds
  onPosition(listener) {
    return this.monitor(CHARACTERISTICS.positionOut, (bytes) => listener(decodePositionOut(bytes)));
  }

  setWifi(on) {
    return this.write(CHARACTERISTICS.wifiControl, encodeWifiControl(on));
  }

  async readWifiStatus() {
    return decodeWifiStatus(await this.read(CHARACTERISTICS.wifiStatus));
  }

  onWifiStatus(listener) {
    return this.monitor(CHARACTERISTICS.wifiStatus, (bytes) => listener(decodeWifiStatus(bytes)));
  }

  async readSettings() {
    return decodeSettings(await this.read(CHARACTERISTICS.settings));
  }

  // settings: { showTrack, showHeightGraph, updateInterval }
  writeSettings(settings) {
    return this.write(CHARACTERISTICS.settings, encodeSettings(settings));
  }

  // The device forgets this phone and lets the next phone pair. The connection ends.
  forgetPhone() {
    return this.write(CHARACTERISTICS.deviceControl, encodeForgetPhone());
  }

  // one subscription of the update status shared by everything that listens
  onOtaStatus(listener) {
    this.otaListeners.add(listener);
    if (!this.otaSubscription) {
      this.otaSubscription = this.monitor(CHARACTERISTICS.otaControl, (bytes) => {
        const status = decodeOtaStatus(bytes);
        [...this.otaListeners].forEach((l) => l(status));
      });
    }
    return () => {
      this.otaListeners.delete(listener);
      if (this.otaListeners.size === 0) {
        this.otaSubscription?.remove();
        this.otaSubscription = null;
      }
    };
  }

  // Installs the firmware image (Uint8Array) and restarts the device, see firmware_update.js
  async updateFirmware(image, { signal, onProgress } = {}) {
    // a larger packet size means a faster update, the device refuses a link below the minimum
    try {
      await this.device.requestConnectionPriority(1);
    } catch {
      // a slower link is still fine
    }
    const transport = {
      readStatus: async () => decodeOtaStatus(await this.read(CHARACTERISTICS.otaControl)),
      onStatus: (listener) => this.onOtaStatus(listener),
      writeControl: (bytes) => this.write(CHARACTERISTICS.otaControl, bytes),
      writeData: (bytes) => this.writeWithoutResponse(CHARACTERISTICS.otaData, bytes),
    };
    return updateFirmwareOverBle(transport, image, { mtu: this.mtu, signal, onProgress });
  }

  async disconnect() {
    this.disconnectSubscription?.remove();
    this.otaSubscription?.remove();
    this.otaSubscription = null;
    await this.device.cancelConnection().catch(() => { });
  }
}
