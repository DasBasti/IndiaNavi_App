import { requireOptionalNativeModule } from 'expo';

// Only available on Android, in a build of the app (not in Expo Go)
const IndiaNaviPhone = requireOptionalNativeModule('IndiaNaviPhone');

// Battery of the phone in percent, null if it is not known
export const batteryLevel = () => IndiaNaviPhone?.batteryLevel() ?? null;

// Calls the listener with the number of satellites the GPS of the phone uses for its position, needs the location
// permission. The GPS only runs while the app asks for a position. Returns a function that stops it, null if the phone
// can not tell the satellites.
export const watchSatellites = (listener) => {
  if (!IndiaNaviPhone?.startSatellites()) {
    return null;
  }
  const subscription = IndiaNaviPhone.addListener('onSatellites', ({ count }) => listener(count));
  return () => {
    subscription.remove();
    IndiaNaviPhone.stopSatellites();
  };
};
