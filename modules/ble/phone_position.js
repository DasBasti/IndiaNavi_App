// Position of the phone, sent to the IndiaNavi so its GPS module can start faster

import * as Location from 'expo-location';

// A position that is worse than this does not help the GPS module
const MAX_ACCURACY = 2000;

// Returns { latitude, longitude, altitude, accuracy, timestamp (seconds) }
export const getPhonePosition = async () => {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('The app needs the location permission to send the position of the phone.');
  }
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const { latitude, longitude, altitude, accuracy } = location.coords;
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY) {
    throw new Error(`The position of the phone is too inaccurate (${Math.round(accuracy)} m). Try again outside.`);
  }
  return { latitude, longitude, altitude: altitude ?? 0, accuracy, timestamp: location.timestamp / 1000 };
};
