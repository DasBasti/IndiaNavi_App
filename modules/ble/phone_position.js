// Position of the phone, sent to the IndiaNavi so its GPS module can start faster

import * as Location from 'expo-location';

// A position that is worse than this does not help the GPS module
const MAX_ACCURACY = 2000;

// A position of the last minutes is as good as a new one for the GPS module, and available at once
const MAX_AGE = 15 * 60 * 1000;
// the background does not wait for a fix longer than this
const BACKGROUND_TIMEOUT = 15000;

// Returns { latitude, longitude, altitude, accuracy, timestamp (seconds) }. ask: false is for the background, it
// does not ask for the permission, uses the last known position and gives up after a while.
export const getPhonePosition = async ({ ask = true } = {}) => {
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== 'granted' && ask) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (permission.status !== 'granted') {
    throw new Error('The app needs the location permission to send the position of the phone.');
  }
  let location = null;
  if (ask) {
    location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } else {
    location = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE, requiredAccuracy: MAX_ACCURACY });
    location ??= await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The phone has no position yet.')), BACKGROUND_TIMEOUT);
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(
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
  }
  const { latitude, longitude, altitude, accuracy } = location.coords;
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY) {
    throw new Error(`The position of the phone is too inaccurate (${Math.round(accuracy)} m). Try again outside.`);
  }
  return { latitude, longitude, altitude: altitude ?? 0, accuracy, timestamp: location.timestamp / 1000 };
};
