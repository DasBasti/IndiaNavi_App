import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';

import BluetoothIcon from './BluetoothIcon';
import Button from './Button';
import { BusyWindow, Card, Hint, Message, ProgressBar, ScreenHeader, SectionTitle } from './ui';
import { BORDER, colors, displayColor, font, onColor } from '../theme';
import { readFirmware } from '../modules/device_transfer';
import { downloadRelease, fetchLatestRelease, isNewer } from '../modules/firmware_release';
import { DISPLAY_COLORS } from '../modules/map_color';
import { isBleSupported, scanForDevices } from '../modules/ble/ble_client';
import { autoConnect } from '../modules/ble/background';
import { getPhonePosition } from '../modules/ble/phone_position';
import { FIX_NAMES, UPDATE_INTERVAL_CHOICES, formatInterval } from '../modules/ble/protocol';

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// the screen stays on while the firmware is sent
const KeepAwake = () => {
  useKeepAwake();
  return null;
};

const positionText = (position) =>
  position
    ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}, ${position.altitude} m ` +
      `(${FIX_NAMES[position.fix] ?? 'fix'}, ${position.satellitesInUse} satellites, HDOP ${position.hdop})`
    : 'The IndiaNavi has no position yet.';

const updatePhaseText = ({ phase, done, total, tag }) => {
  if (phase === 'downloading') {
    return `Downloading ${tag} from GitHub…`;
  }
  if (phase === 'verifying') {
    return 'The IndiaNavi checks the firmware…';
  }
  if (phase === 'restarting') {
    return 'The IndiaNavi restarts with the new firmware.';
  }
  return `Sending ${megabytes(done)} of ${megabytes(total)}`;
};

const sentText = ({ time, position }) =>
  position
    ? 'The IndiaNavi got the time and the position of the phone.'
    : time
      ? 'The time of the IndiaNavi is set from the phone.'
      : null;

// Talks to the IndiaNavi over Bluetooth: time and position for the GPS module, WiFi access point, what the display
// shows and the firmware. The connection is the one that the app keeps in the background (auto_connect.js), it stays
// when the screen closes. device is the remembered { id, name } of the IndiaNavi. onTrackColorChange gets the color
// of the track on the device, so the map of the app can show it the same way.
export default function BluetoothScreen({ device, onDeviceChange, onTrackColorChange, onOpenWifi, onBack }) {
  const [connection, setConnection] = useState(null);
  const [connecting, setConnecting] = useState(false);
  // devices found by the scan
  const [found, setFound] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [wifi, setWifi] = useState(null);
  const [settings, setSettings] = useState(null);
  const [devicePosition, setDevicePosition] = useState(undefined);
  // { phase, done, total } while the firmware is sent
  const [update, setUpdate] = useState(null);
  // the newest firmware on GitHub, null while unknown
  const [release, setRelease] = useState(null);
  // text of the progress window while an action on the device runs
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(false);
  const scanAbort = useRef(null);
  const updateAbort = useRef(null);
  const connectionRef = useRef(null);
  // { connection, promise } of the connection that was set up for this screen
  const adopted = useRef(null);
  const noticed = useRef(null);
  const subscriptions = useRef([]);
  // the app connects in the background, too
  const [background, setBackground] = useState(autoConnect.getState().state);

  // the progress window covers the screen while busy, the controls do not need to show it
  const connectingNow = connecting || background === 'connecting';
  const locked = connectingNow || scanning || update !== null;
  const working = locked || busy !== null;

  const dropSubscriptions = () => {
    subscriptions.current.forEach((subscription) => subscription.remove?.());
    subscriptions.current = [];
  };

  const disconnected = useCallback(() => {
    dropSubscriptions();
    connectionRef.current = null;
    adopted.current = null;
    setConnection(null);
    setWifi(null);
    setSettings(null);
    setDevicePosition(undefined);
    setUpdate(null);
  }, []);

  // leaving the screen keeps the connection, the app uses it in the background
  useEffect(() => () => {
    scanAbort.current?.abort();
    updateAbort.current?.abort();
    dropSubscriptions();
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!working) {
        onBack();
      }
      return true;
    });
    return () => subscription.remove();
  }, [working, onBack]);

  // Reads the state of the device and listens to it. Once for each connection, whoever comes first.
  const adopt = useCallback((connected) => {
    if (adopted.current?.connection === connected) {
      return adopted.current.promise;
    }
    const promise = (async () => {
      connectionRef.current = connected;
      setWifi(await connected.readWifiStatus());
      const deviceSettings = await connected.readSettings();
      setSettings(deviceSettings);
      if (connected.info.trackColor) {
        onTrackColorChange(deviceSettings.trackColor);
      }
      if (connectionRef.current !== connected) {
        return;
      }
      dropSubscriptions();
      subscriptions.current = [
        connected.onWifiStatus(setWifi),
        connected.onPosition(setDevicePosition),
      ];
      setConnection(connected);
      if (connected.info.ota) {
        // without internet there is simply no offer
        fetchLatestRelease().then(setRelease, () => setRelease(null));
      }
    })();
    adopted.current = { connection: connected, promise };
    promise.catch(() => {
      if (adopted.current?.connection === connected) {
        adopted.current = null;
      }
    });
    return promise;
  }, [onTrackColorChange]);

  const connect = useCallback(async (target) => {
    setError(null);
    setNotice(null);
    setFound(null);
    setConnecting(true);
    try {
      const connected = await autoConnect.connectNow(target);
      onDeviceChange({ id: target.id, name: target.name });
      await adopt(connected);
    } catch (e) {
      autoConnect.disconnect();
      setError(`Could not connect: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  }, [adopt, onDeviceChange]);

  // follows the connection of the app: one that is made in the background, one that ends
  useEffect(() => {
    const follow = ({ state, connection: current, sent }) => {
      setBackground(state);
      if (connectionRef.current && connectionRef.current !== current) {
        disconnected();
      }
      if (current && state === 'connected') {
        adopt(current).catch((e) => setError(`Could not connect: ${e.message}`));
        const text = sentText(sent);
        if (text && noticed.current !== current) {
          noticed.current = current;
          setNotice(text);
        }
      }
    };
    follow(autoConnect.getState());
    return autoConnect.subscribe(follow);
  }, [adopt, disconnected]);

  const scan = async () => {
    setError(null);
    setNotice(null);
    setFound([]);
    setScanning(true);
    const controller = new AbortController();
    scanAbort.current = controller;
    // the scan of the background has to wait, Android allows one at a time
    const resume = autoConnect.pause();
    try {
      await scanForDevices((entry) => setFound((current) => (current ? [...current, entry] : [entry])), { signal: controller.signal });
    } catch (e) {
      setError(`Could not search: ${e.message}`);
      setFound(null);
    } finally {
      if (scanAbort.current === controller) {
        scanAbort.current = null;
      }
      setScanning(false);
      resume();
    }
  };

  // the IndiaNavi from the last time, unless the app is busy with it already
  useEffect(() => {
    if (device?.id && isBleSupported() && !autoConnect.getState().connection && autoConnect.getState().state !== 'connecting') {
      connect(device);
    }
    // only when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs an action on the device behind the progress window. The action returns the message for the user, the old
  // one stays until then so the screen does not jump.
  const run = async (action, what, text) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(text);
    try {
      const message = await action();
      setError(null);
      setNotice(message ?? null);
    } catch (e) {
      setNotice(null);
      setError(`${what}: ${e.message}`);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const syncTime = () => run(async () => {
    await connection.syncTime();
    return 'The time of the IndiaNavi is set from the phone.';
  }, 'Could not set the time', 'Setting the time…');

  const sendPosition = () => run(async () => {
    const position = await getPhonePosition();
    await connection.sendPosition(position);
    return `Position sent (${Math.ceil(position.accuracy ?? 0)} m accurate). Without a GPS fix the IndiaNavi shows it on the map.`;
  }, 'Could not send the position', 'Sending the position of the phone…');

  const readPosition = () => run(async () => {
    setDevicePosition(await connection.readPosition());
  }, 'Could not read the position', 'Reading the position…');

  const toggleWifi = () => run(async () => {
    await connection.setWifi(!wifi.running);
    // the device reports the new state, it takes a moment
    return wifi.running ? 'The WiFi access point is switching off.' : 'The WiFi access point is starting. The display shows a QR code.';
  }, 'Could not switch the WiFi', wifi?.running ? 'Switching the WiFi off…' : 'Switching the WiFi on…');

  const changeSettings = (changes) => run(async () => {
    const next = { ...settings, ...changes };
    await connection.writeSettings(next);
    setSettings(next);
    if (connection.info.trackColor) {
      onTrackColorChange(next.trackColor);
    }
    return notice;
  }, 'Could not change the settings', 'Changing the settings…');

  const forget = () => {
    Alert.alert(
      'Pair another phone?',
      'The IndiaNavi forgets this phone. The next phone can pair within two minutes, it has to enter the code from the display.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget this phone',
          style: 'destructive',
          onPress: () => run(async () => {
            await connection.forgetPhone();
            onDeviceChange(undefined);
            return 'This phone is forgotten by the IndiaNavi. To use it again, pair it again.';
          }, 'Could not forget the phone', 'Forgetting this phone…'),
        },
      ]
    );
  };

  // Sends the image that getImage returns, it gets the signal to cancel
  const sendFirmware = async (getImage) => {
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    updateAbort.current = controller;
    try {
      const image = await getImage(controller.signal);
      if (!image) {
        return;
      }
      setUpdate({ phase: 'sending', done: 0, total: image.length });
      await connection.updateFirmware(image, { signal: controller.signal, onProgress: setUpdate });
      setNotice('The firmware was sent. The IndiaNavi restarts with the new firmware, connect again in a minute.');
    } catch (e) {
      setError(controller.signal.aborted ? 'The update was cancelled.' : `Firmware update failed: ${e.message}`);
    } finally {
      updateAbort.current = null;
      setUpdate(null);
    }
  };

  const updateFromFile = () => sendFirmware(async () => {
    const picked = await File.pickFileAsync();
    return picked.canceled ? null : readFirmware(picked.result);
  });

  const installRelease = () => {
    const { notes } = release;
    Alert.alert(
      `Install ${release.tag}?`,
      `${release.name}, ${megabytes(release.size)}${notes ? `\n\n${notes.length > 400 ? `${notes.slice(0, 400)}…` : notes}` : ''}\n\n` +
        'The update takes a few minutes, stay close to the IndiaNavi and keep the app open.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Install',
          onPress: () => sendFirmware((signal) => {
            setUpdate({ phase: 'downloading', done: 0, total: release.size, tag: release.tag });
            return downloadRelease(release, { signal });
          }),
        },
      ]
    );
  };

  const supported = isBleSupported();
  const newer = release && connection ? isNewer(release, connection.info.firmware) : null;

  return (
    <View style={styles.screen}>
      {update && <KeepAwake />}
      <BusyWindow text={busy} />
      <ScreenHeader title="Bluetooth" onBack={onBack} disabled={locked} />

      <ScrollView contentContainerStyle={styles.content}>
        {!supported && (
          <Message tone="red" icon="noSD">
            Bluetooth LE is not available in this build of the app. Install the APK instead of using Expo Go.
          </Message>
        )}
        {error && <Message tone="red" icon="noSD">{error}</Message>}
        {notice && <Message tone="green" icon="SD">{notice}</Message>}

        {!connection ? (
          <>
            <Hint>
              The IndiaNavi is always visible over Bluetooth while it is switched on. The first time, Android asks for a
              code: type in the six digits shown in the box on the display of the IndiaNavi. A new phone can pair for two
              minutes after the IndiaNavi was switched on.
            </Hint>
            {connectingNow ? (
              <Message tone="yellow">
                Connecting… If Android asks for a code, enter the six digits from the display of the IndiaNavi.
              </Message>
            ) : (
              <>
                {device?.id && (
                  <Button title={`Connect to ${device.name ?? 'IndiaNavi'}`} onPress={() => connect(device)} disabled={!supported || scanning} />
                )}
                <Button
                  title={scanning ? 'Searching…' : 'Search for an IndiaNavi'}
                  onPress={scan}
                  disabled={!supported || scanning}
                  variant={device?.id ? 'plain' : 'primary'}
                />
              </>
            )}
            {found?.length === 0 && !scanning && (
              <Message tone="yellow">No IndiaNavi found. Is it switched on and close to the phone?</Message>
            )}
            {found?.map((entry) => (
              <Card key={entry.id} style={styles.found}>
                <BluetoothIcon />
                <View style={styles.foundText}>
                  <Text style={styles.name}>{entry.name}</Text>
                  <Text style={styles.small}>{entry.rssi} dBm</Text>
                </View>
                <Button title="Connect" onPress={() => connect(entry)} compact />
              </Card>
            ))}
          </>
        ) : (
          <>
            <Card color={colors.paper} style={styles.found}>
              <BluetoothIcon />
              <View style={styles.foundText}>
                <Text style={styles.name}>{device?.name ?? 'IndiaNavi'}</Text>
                <Text style={styles.small}>
                  Firmware {connection.info.firmware}, battery {connection.info.battery}%
                  {connection.info.charging ? ' (charging)' : ''}
                </Text>
              </View>
              <Button title="Disconnect" onPress={() => autoConnect.disconnect()} disabled={locked} variant="plain" compact />
            </Card>

            <SectionTitle>Time and position</SectionTitle>
            <Hint>
              The phone tells the IndiaNavi the time and where it is. Its GPS module starts with this knowledge and finds
              the satellites faster. Until it has a fix of its own, the IndiaNavi shows the position of the phone.
            </Hint>
            <View style={styles.row}>
              <Button title="Set time" onPress={syncTime} disabled={locked} compact />
              <Button title="Send position" onPress={sendPosition} disabled={locked} compact />
              <Button title="Get position" onPress={readPosition} disabled={locked} variant="plain" compact />
            </View>
            {devicePosition !== undefined && <Text style={styles.small}>{positionText(devicePosition)}</Text>}

            <SectionTitle>WiFi</SectionTitle>
            <Text style={styles.text}>
              {wifi?.running
                ? `Access point ${wifi.ssid} is on, ${wifi.stations} ${wifi.stations === 1 ? 'phone is' : 'phones are'} connected.`
                : 'The WiFi access point is off.'}
            </Text>
            <View style={styles.row}>
              <Button
                title={wifi?.running ? 'Switch WiFi off' : 'Switch WiFi on'}
                onPress={toggleWifi}
                disabled={locked || !wifi}
                variant={wifi?.running ? 'plain' : 'primary'}
                compact
              />
              <Button title="Send files" icon="WIFI_3" onPress={onOpenWifi} disabled={locked} variant="secondary" compact />
            </View>
            <Hint>
              The password is never sent over Bluetooth. Scan the QR code from the display with the camera in the file
              transfer to join the WiFi.
            </Hint>

            <SectionTitle>Display</SectionTitle>
            {settings && (
              <>
                <View style={styles.switchRow}>
                  <Text style={styles.text}>Show the track</Text>
                  <Switch
                    value={settings.showTrack}
                    onValueChange={(value) => changeSettings({ showTrack: value })}
                    disabled={locked}
                    trackColor={{ false: colors.paper, true: colors.green }}
                    thumbColor={colors.ink}
                  />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.text}>Show the height graph</Text>
                  <Switch
                    value={settings.showHeightGraph}
                    onValueChange={(value) => changeSettings({ showHeightGraph: value })}
                    disabled={locked}
                    trackColor={{ false: colors.paper, true: colors.green }}
                    thumbColor={colors.ink}
                  />
                </View>
                {connection.info.trackColor && (
                  <>
                    <Text style={styles.text}>Color of the track</Text>
                    <View style={styles.row}>
                      {DISPLAY_COLORS.map((color, value) => {
                        const selected = settings.trackColor === value;
                        return (
                          <Pressable
                            key={color.name}
                            onPress={() => changeSettings({ trackColor: value })}
                            disabled={locked || selected}
                            accessibilityLabel={color.name}
                            accessibilityState={{ selected }}
                            style={[styles.swatch, { backgroundColor: displayColor(value) }, selected && styles.swatchSelected]}
                          >
                            {selected && <Text style={[styles.check, { color: onColor[displayColor(value)] }]}>✓</Text>}
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}
                <Text style={styles.text}>Screen update every</Text>
                <View style={styles.row}>
                  {UPDATE_INTERVAL_CHOICES.map((seconds) => (
                    <Button
                      key={seconds}
                      title={formatInterval(seconds)}
                      onPress={() => changeSettings({ updateInterval: seconds })}
                      disabled={locked}
                      variant={settings.updateInterval === seconds ? 'primary' : 'plain'}
                      compact
                    />
                  ))}
                </View>
                <Hint>
                  The e-ink display needs about 20 seconds per update. A longer interval saves battery. 30 seconds to 10
                  minutes are possible.
                </Hint>
              </>
            )}

            <SectionTitle>Firmware</SectionTitle>
            {update ? (
              <>
                <ProgressBar done={update.done} total={update.total} />
                <Text style={styles.small}>{updatePhaseText(update)}</Text>
                <Button title="Cancel" onPress={() => updateAbort.current?.abort()} variant="danger" compact />
              </>
            ) : (
              <>
                {release && connection.info.ota && (
                  newer === false ? (
                    <Text style={styles.small}>The firmware is up to date, {release.tag} is the newest release.</Text>
                  ) : (
                    <>
                      {newer && (
                        <Message tone="yellow">Firmware {release.tag} is available on GitHub.</Message>
                      )}
                      <Button
                        title={`Install ${release.tag}`}
                        onPress={installRelease}
                        disabled={locked}
                        variant={newer ? 'primary' : 'secondary'}
                      />
                    </>
                  )
                )}
                <Button title="Update from a file" onPress={updateFromFile} disabled={locked || !connection.info.ota} variant="plain" />
                <Hint>
                  The newest firmware comes from the releases on GitHub, or pick a firmware file (firmware.bin). The update
                  takes a few minutes, stay close to the IndiaNavi and keep the app open. The old firmware stays if anything
                  goes wrong. The display shows the progress.
                </Hint>
              </>
            )}

            <SectionTitle>Phone</SectionTitle>
            <Button title="Pair another phone" onPress={forget} disabled={locked} variant="danger" compact />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 12,
  },
  content: {
    gap: 12,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swatch: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER,
    borderColor: colors.ink,
  },
  swatchSelected: {
    borderWidth: 4,
  },
  check: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  found: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  foundText: {
    flex: 1,
  },
  name: {
    fontFamily: font.mono,
    fontWeight: 'bold',
    fontSize: 16,
    color: colors.ink,
  },
  text: {
    color: colors.ink,
    fontSize: 15,
  },
  small: {
    fontSize: 13,
    color: colors.ink,
  },
});
