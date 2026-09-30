import { requireOptionalNativeModule } from 'expo';

// Only available on Android, in a build of the app (not in Expo Go)
const IndiaNaviWifi = requireOptionalNativeModule('IndiaNaviWifi');

export const isWifiConnectSupported = IndiaNaviWifi !== null;

// Connects to the access point of the IndiaNavi and sends all requests of the app through it.
// Android asks the user to confirm the connection.
export const connectToDeviceWifi = (ssid, password, timeoutMs = 60000) => {
  if (!IndiaNaviWifi) {
    return Promise.reject(new Error('Connecting to a WiFi is not supported on this device'));
  }
  return IndiaNaviWifi.connect(ssid, password, timeoutMs);
};

// Uses the access point of an IndiaNavi if the phone is already connected to it, for example from
// the WiFi settings. Returns { ssid } (ssid is null if Android does not tell the name) or null.
export const bindToConnectedDeviceWifi = async () => (IndiaNaviWifi ? IndiaNaviWifi.useConnectedNetwork() : null);

// Leaves the access point, requests use the normal internet connection again
export const disconnectFromDeviceWifi = () => IndiaNaviWifi?.disconnect();

// Called when the connection to the access point is lost
export const addWifiLostListener = (listener) =>
  IndiaNaviWifi ? IndiaNaviWifi.addListener('onLost', listener) : { remove() {} };
