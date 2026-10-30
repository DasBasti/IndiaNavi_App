// What the simulated IndiaNavi shows of the phone: its position, battery and GPS satellites

import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getPhonePosition } from './ble/phone_position';
import { batteryLevel, watchSatellites } from './indianavi-phone';

const POSITION_INTERVAL = 2000;
const BATTERY_INTERVAL = 60000;

// Returns { position: { lat, lon, altitude, accuracy } or null, battery (percent), satellites }, the last two are null
// if they are not known. The GPS of the phone runs while the app is in the foreground and a screen uses this.
export const usePhoneStatus = () => {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [position, setPosition] = useState(null);
  const [battery, setBattery] = useState(batteryLevel);
  const [satellites, setSatellites] = useState(null);
  // Android asks once, the dialog sends the app to the background and it comes back here
  const asked = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setBattery(batteryLevel());
    const timer = setInterval(() => setBattery(batteryLevel()), BATTERY_INTERVAL);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let stopped = false;
    let stopPosition = null;
    let stopSatellites = null;
    const start = async () => {
      const { status } = asked.current
        ? await Location.getForegroundPermissionsAsync()
        : await Location.requestForegroundPermissionsAsync();
      asked.current = true;
      if (status !== 'granted' || stopped) {
        return;
      }
      stopSatellites = watchSatellites(setSatellites);
      // until the GPS has its fix the last position of the phone is shown
      getPhonePosition({ ask: false })
        .then(({ latitude, longitude, altitude, accuracy }) => {
          if (!stopped) {
            setPosition((current) => current ?? { lat: latitude, lon: longitude, altitude, accuracy });
          }
        })
        .catch(() => {});
      const watch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: POSITION_INTERVAL, distanceInterval: 0 },
        ({ coords: { latitude, longitude, altitude, accuracy } }) => {
          setPosition({ lat: latitude, lon: longitude, altitude, accuracy });
        }
      );
      if (stopped) {
        watch.remove();
      } else {
        stopPosition = () => watch.remove();
      }
    };
    // without location services there is no position to show
    start().catch(() => {});
    return () => {
      stopped = true;
      stopPosition?.();
      stopSatellites?.();
    };
  }, [active]);

  return { position, battery, satellites };
};
