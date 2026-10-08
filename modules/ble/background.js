// The one background connection of the app, see auto_connect.js
import { createAutoConnect } from './auto_connect.js';
import { IndiaNaviConnection, isBleSupported, waitForDevice } from './ble_client.js';
import { getPhonePosition } from './phone_position.js';

const unsupported = {
  setDevice() { },
  setActive() { },
  pause: () => () => { },
  connectNow: () => Promise.reject(new Error('Bluetooth LE is not available.')),
  disconnect: async () => { },
  getState: () => ({ state: 'idle', connection: null, sent: { time: false, position: false } }),
  subscribe: () => () => { },
};

export const autoConnect = isBleSupported()
  ? createAutoConnect({
    waitForDevice,
    connect: (id, options) => IndiaNaviConnection.connect(id, options),
    getPosition: getPhonePosition,
  })
  : unsupported;
