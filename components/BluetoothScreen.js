import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';

import BluetoothIcon from './BluetoothIcon';
import Button from './Button';
import { Card, Hint, Message, ProgressBar, ScreenHeader, SectionTitle } from './ui';
import { BORDER, colors, font } from '../theme';
import { readFirmware } from '../modules/device_transfer';
import { IndiaNaviConnection, isBleSupported, scanForDevices } from '../modules/ble/ble_client';
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

const updatePhaseText = ({ phase, done, total }) => {
  if (phase === 'verifying') {
    return 'The IndiaNavi checks the firmware…';
  }
  if (phase === 'restarting') {
    return 'The IndiaNavi restarts with the new firmware.';
  }
  return `Sending ${megabytes(done)} of ${megabytes(total)}`;
};

// Talks to the IndiaNavi over Bluetooth: time and position for the GPS module, WiFi access point, what the display
// shows and the firmware. device is the remembered { id, name } of the IndiaNavi.
export default function BluetoothScreen({ device, onDeviceChange, onOpenWifi, onBack }) {
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
  const [busy, setBusy] = useState(false);
  const scanAbort = useRef(null);
  const updateAbort = useRef(null);
  const connectionRef = useRef(null);
  const subscriptions = useRef([]);

  const working = connecting || busy || scanning || update !== null;

  const dropSubscriptions = () => {
    subscriptions.current.forEach((subscription) => subscription.remove?.());
    subscriptions.current = [];
  };

  const disconnected = useCallback(() => {
    dropSubscriptions();
    connectionRef.current = null;
    setConnection(null);
    setWifi(null);
    setSettings(null);
    setDevicePosition(undefined);
    setUpdate(null);
    setBusy(false);
  }, []);

  // leaving the screen ends the connection, the IndiaNavi advertises again for the next time
  useEffect(() => () => {
    scanAbort.current?.abort();
    updateAbort.current?.abort();
    dropSubscriptions();
    connectionRef.current?.disconnect();
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

  const connect = useCallback(async (target) => {
    setError(null);
    setNotice(null);
    setFound(null);
    setConnecting(true);
    try {
      const connected = await IndiaNaviConnection.connect(target.id, { onDisconnected: disconnected });
      connectionRef.current = connected;
      onDeviceChange({ id: target.id, name: target.name });

      // the time helps the GPS module of the device to find the satellites, so it is sent right away
      let synced = false;
      try {
        await connected.syncTime();
        synced = true;
      } catch {
        // the user can send it again
      }
      setWifi(await connected.readWifiStatus());
      setSettings(await connected.readSettings());
      subscriptions.current = [
        connected.onWifiStatus(setWifi),
        connected.onPosition(setDevicePosition),
      ];
      setConnection(connected);
      if (synced) {
        setNotice('The time of the IndiaNavi is set from the phone.');
      }
    } catch (e) {
      connectionRef.current?.disconnect();
      connectionRef.current = null;
      setError(`Could not connect: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  }, [disconnected, onDeviceChange]);

  const scan = async () => {
    setError(null);
    setNotice(null);
    setFound([]);
    setScanning(true);
    const controller = new AbortController();
    scanAbort.current = controller;
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
    }
  };

  // the IndiaNavi from the last time
  useEffect(() => {
    if (device?.id && isBleSupported()) {
      connect(device);
    }
    // only when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // runs an action on the device and shows what went wrong
  const run = async (action, what) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(`${what}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const syncTime = () => run(async () => {
    await connection.syncTime();
    setNotice('The time of the IndiaNavi is set from the phone.');
  }, 'Could not set the time');

  const sendPosition = () => run(async () => {
    const position = await getPhonePosition();
    await connection.sendPosition(position);
    setNotice(`Position sent (${Math.ceil(position.accuracy ?? 0)} m accurate). Without a GPS fix the IndiaNavi shows it on the map.`);
  }, 'Could not send the position');

  const readPosition = () => run(async () => {
    setDevicePosition(await connection.readPosition());
  }, 'Could not read the position');

  const toggleWifi = () => run(async () => {
    await connection.setWifi(!wifi.running);
    // the device reports the new state, it takes a moment
    setNotice(wifi.running ? 'The WiFi access point is switching off.' : 'The WiFi access point is starting. The display shows a QR code.');
  }, 'Could not switch the WiFi');

  const changeSettings = (changes) => run(async () => {
    const next = { ...settings, ...changes };
    await connection.writeSettings(next);
    setSettings(next);
  }, 'Could not change the settings');

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
            setNotice('This phone is forgotten by the IndiaNavi. To use it again, pair it again.');
          }, 'Could not forget the phone'),
        },
      ]
    );
  };

  const updateFirmware = async () => {
    setError(null);
    setNotice(null);
    try {
      const picked = await File.pickFileAsync();
      if (picked.canceled) {
        return;
      }
      const image = await readFirmware(picked.result);
      const controller = new AbortController();
      updateAbort.current = controller;
      setUpdate({ phase: 'sending', done: 0, total: image.length });
      await connection.updateFirmware(image, { signal: controller.signal, onProgress: setUpdate });
      setNotice('The firmware was sent. The IndiaNavi restarts with the new firmware, connect again in a minute.');
    } catch (e) {
      setError(updateAbort.current?.signal.aborted ? 'The update was cancelled.' : `Firmware update failed: ${e.message}`);
    } finally {
      updateAbort.current = null;
      setUpdate(null);
    }
  };

  const supported = isBleSupported();

  return (
    <View style={styles.screen}>
      {update && <KeepAwake />}
      <ScreenHeader title="Bluetooth" onBack={onBack} disabled={working} />

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
            {connecting ? (
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
              <Button title="Disconnect" onPress={() => connection.disconnect()} disabled={working} variant="plain" compact />
            </Card>

            <SectionTitle>Time and position</SectionTitle>
            <Hint>
              The phone tells the IndiaNavi the time and where it is. Its GPS module starts with this knowledge and finds
              the satellites faster. Until it has a fix of its own, the IndiaNavi shows the position of the phone.
            </Hint>
            <View style={styles.row}>
              <Button title="Set time" onPress={syncTime} disabled={working} compact />
              <Button title="Send position" onPress={sendPosition} disabled={working} compact />
              <Button title="Get position" onPress={readPosition} disabled={working} variant="plain" compact />
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
                disabled={working || !wifi}
                variant={wifi?.running ? 'plain' : 'primary'}
                compact
              />
              <Button title="Send files" icon="WIFI_3" onPress={onOpenWifi} disabled={working} variant="secondary" compact />
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
                    disabled={working}
                    trackColor={{ false: colors.paper, true: colors.green }}
                    thumbColor={colors.ink}
                  />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.text}>Show the height graph</Text>
                  <Switch
                    value={settings.showHeightGraph}
                    onValueChange={(value) => changeSettings({ showHeightGraph: value })}
                    disabled={working}
                    trackColor={{ false: colors.paper, true: colors.green }}
                    thumbColor={colors.ink}
                  />
                </View>
                <Text style={styles.text}>Screen update every</Text>
                <View style={styles.row}>
                  {UPDATE_INTERVAL_CHOICES.map((seconds) => (
                    <Button
                      key={seconds}
                      title={formatInterval(seconds)}
                      onPress={() => changeSettings({ updateInterval: seconds })}
                      disabled={working}
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
                <Button title="Update firmware" onPress={updateFirmware} disabled={working || !connection.info.ota} variant="secondary" />
                <Hint>
                  Pick the firmware file (firmware.bin). The update takes a few minutes, stay close to the IndiaNavi and keep
                  the app open. The old firmware stays if anything goes wrong. The display shows the progress.
                </Hint>
              </>
            )}

            <SectionTitle>Phone</SectionTitle>
            <Button title="Pair another phone" onPress={forget} disabled={working} variant="danger" compact />
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
