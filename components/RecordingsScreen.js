import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import Icon from './Icon';
import { Badge, BusyWindow, Card, Hint, Message, ScreenHeader, SectionTitle } from './ui';
import { colors, font } from '../theme';
import { autoConnect } from '../modules/ble/background';
import {
  ACCESS_POINT_ADDRESS,
  DEFAULT_ROUTER_ADDRESS,
  deviceUrl,
  downloadRecording,
  getDeviceInfo,
} from '../modules/device_transfer';
import { parse } from '../modules/gpx_parser';
import {
  bindToConnectedDeviceWifi,
  connectToDeviceWifi,
  disconnectFromDeviceWifi,
} from '../modules/indianavi-wifi';
import {
  isDownloaded,
  listRecordings,
  markDeletedFromDevice,
  markDownloaded,
  recordingName,
  updateFromDevice,
} from '../modules/recording_library';
import { calculateBoundaries, trackLength, trackLines } from '../modules/tiles';
import { addTrack } from '../modules/track_library';

// the access point of the IndiaNavi needs a moment after it was switched on
const WIFI_START_TIMEOUT = 15000;

const size = (bytes) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

const time = (seconds) => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const statusText = (status, now) => {
  const since = `Recording since ${time(status.id)}, ${size(status.size)}.`;
  if (!status.lastPoint) {
    return `${since} Waiting for a GPS fix, no point written yet.`;
  }
  const ago = Math.max(0, Math.round(now / 1000 - status.lastPoint));
  return `${since} Last point ${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago.`;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Records tracks with the IndiaNavi: starts and stops the recording and lists the recorded tracks over Bluetooth,
// downloads them over WiFi into the tracks of the app and deletes them from the SD card. The app remembers the
// recordings, so a downloaded one stays in the list after it was deleted from the card.
// device is the remembered Bluetooth device { id, name }, wifiDevice the saved WiFi connection of the transfer screen.
// onShowTrack gets the entry of a downloaded track in track_library.js.
export default function RecordingsScreen({ device, wifiDevice, onShowTrack, onOpenWifi, onBack }) {
  const [connection, setConnection] = useState(() => autoConnect.getState().connection);
  const [status, setStatus] = useState(null);
  const [recordings, setRecordings] = useState(listRecordings);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // text of the progress window while an action runs
  const [busy, setBusy] = useState(null);
  const [now, setNow] = useState(Date.now());
  // { base, token, switchedOn } of the WiFi connection for the downloads
  const wifi = useRef(null);

  const supported = connection?.info.recording;

  useEffect(() => autoConnect.subscribe(({ connection: current }) => setConnection(current)), []);

  // the age of the last point
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  // reads the state and the list of the device and listens to the recording
  const refresh = useCallback(async (connected) => {
    setStatus(await connected.readRecordingStatus());
    setRecordings(updateFromDevice(await connected.listRecordings()));
  }, []);

  useEffect(() => {
    if (!connection?.info.recording) {
      setStatus(null);
      return;
    }
    let active = true;
    refresh(connection).catch((e) => active && setError(`Could not read the recordings: ${e.message}`));
    const subscription = connection.onRecordingStatus((current) => active && setStatus(current));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [connection, refresh]);

  // leaving the screen leaves the WiFi of the IndiaNavi, and switches it off if the app switched it on
  useEffect(() => () => {
    if (wifi.current) {
      disconnectFromDeviceWifi();
      if (wifi.current.switchedOn) {
        autoConnect.getState().connection?.setWifi(false).catch(() => { });
      }
    }
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) {
        onBack();
      }
      return true;
    });
    return () => subscription.remove();
  }, [busy, onBack]);

  // Runs an action behind the progress window, it returns the message for the user
  const run = async (action, what, text) => {
    if (busy) {
      return;
    }
    setBusy(text);
    try {
      const message = await action();
      setError(null);
      setNotice(message ?? null);
    } catch (e) {
      setNotice(null);
      setError(`${what}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const connect = () => run(async () => {
    await autoConnect.connectNow(device);
  }, 'Could not connect', 'Connecting…');

  const start = () => run(async () => {
    await connection.startRecording();
    await refresh(connection);
    return 'The IndiaNavi records the track. It writes a point every 5 seconds while it has a GPS fix, also after it was switched off and on again.';
  }, 'Could not start the recording', 'Starting the recording…');

  const stop = () => run(async () => {
    await connection.stopRecording();
    await refresh(connection);
    return 'The recording is stopped. Download it to see it in the tracks of the app.';
  }, 'Could not stop the recording', 'Stopping the recording…');

  // The WiFi of the IndiaNavi: the one the phone is in already, the router of the saved connection, or the access
  // point, which is switched on over Bluetooth and joined with the password from the QR code
  const openWifi = async () => {
    if (wifi.current) {
      try {
        await getDeviceInfo(wifi.current.base);
        return wifi.current;
      } catch {
        wifi.current = null;
      }
    }

    const existing = await bindToConnectedDeviceWifi();
    if (existing) {
      const base = deviceUrl(ACCESS_POINT_ADDRESS);
      try {
        await getDeviceInfo(base);
        wifi.current = { base };
        return wifi.current;
      } catch {
        disconnectFromDeviceWifi();
      }
    }

    if (wifiDevice.mode === 'router') {
      const base = deviceUrl((wifiDevice.address ?? DEFAULT_ROUTER_ADDRESS).trim());
      await getDeviceInfo(base);
      wifi.current = { base, token: wifiDevice.password };
      return wifi.current;
    }

    if (!wifiDevice.ssid || !wifiDevice.password) {
      throw new Error('the app does not know the WiFi password of the IndiaNavi yet. Open the file transfer and scan the QR code on the display once.');
    }
    let wifiStatus = await connection.readWifiStatus();
    if (wifiStatus.ssid && wifiStatus.ssid !== wifiDevice.ssid) {
      throw new Error(`the app knows the WiFi ${wifiDevice.ssid}, but this IndiaNavi has ${wifiStatus.ssid}. Scan its QR code in the file transfer once.`);
    }
    const switchedOn = !wifiStatus.running;
    if (switchedOn) {
      setBusy('Switching the WiFi of the IndiaNavi on…');
      await connection.setWifi(true);
      const until = Date.now() + WIFI_START_TIMEOUT;
      while (!wifiStatus.running && Date.now() < until) {
        await wait(1000);
        wifiStatus = await connection.readWifiStatus();
      }
    }
    setBusy('Joining the WiFi of the IndiaNavi…');
    await connectToDeviceWifi(wifiDevice.ssid, wifiDevice.password);
    const base = deviceUrl(ACCESS_POINT_ADDRESS);
    await getDeviceInfo(base);
    wifi.current = { base, switchedOn };
    return wifi.current;
  };

  const download = (recording) => run(async () => {
    const { base, token } = await openWifi();
    setBusy(`Downloading ${size(recording.size)}…`);
    const text = await downloadRecording(base, recording.id, { token });
    const lines = trackLines(parse(text));
    if (calculateBoundaries(lines) === null) {
      throw new Error('the recording has no points, the IndiaNavi had no GPS fix while it recorded');
    }
    const track = addTrack(recordingName(recording.id), text, trackLength(lines));
    setRecordings(markDownloaded(recording.id, track.id, recording.size));
    return `${track.name} is in the tracks of the app now.`;
  }, 'Could not download the recording', 'Connecting to the WiFi of the IndiaNavi…');

  const remove = (recording) => {
    Alert.alert(
      'Delete from the IndiaNavi?',
      isDownloaded(recording)
        ? `${recordingName(recording.id)} is deleted from the SD card. The download stays in the tracks of the app.`
        : `${recordingName(recording.id)} is not downloaded. It is gone for good when it is deleted from the SD card.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => run(async () => {
            await connection.deleteRecording(recording.id);
            setRecordings(markDeletedFromDevice(recording.id));
            await refresh(connection);
            return `${recordingName(recording.id)} is deleted from the IndiaNavi.`;
          }, 'Could not delete the recording', 'Deleting…'),
        },
      ]
    );
  };

  const showTrack = (recording) => {
    // the track may have been deleted in the tracks screen
    onShowTrack({ id: recording.trackId, name: recordingName(recording.id) });
  };

  const recording = status?.recording ? status : null;
  const ready = !!connection && supported && !busy;

  return (
    <View style={styles.screen}>
      <BusyWindow text={busy} />
      <ScreenHeader title="Recordings" icon="GPS" onBack={onBack} disabled={!!busy} />

      <ScrollView contentContainerStyle={styles.content}>
        {error && <Message tone="red" icon="noGPS">{error}</Message>}
        {notice && <Message tone="green" icon="GPS">{notice}</Message>}

        {!connection ? (
          <>
            <Message tone="yellow" icon="noGPS">
              The IndiaNavi is not connected over Bluetooth. The recordings below are the ones the app knows.
            </Message>
            {device?.id && <Button title={`Connect to ${device.name ?? 'IndiaNavi'}`} onPress={connect} disabled={!!busy} />}
          </>
        ) : !supported ? (
          <Message tone="yellow" icon="noGPS">
            The firmware of the IndiaNavi can not record tracks. Update it in the Bluetooth screen.
          </Message>
        ) : (
          <>
            <SectionTitle>Recording</SectionTitle>
            {recording ? (
              <>
                <Text style={styles.text}>{statusText(recording, now)}</Text>
                <Button title="Stop recording" onPress={stop} disabled={!ready} variant="danger" />
              </>
            ) : (
              <>
                <Text style={styles.text}>No track is recorded.</Text>
                <Button title="Start recording" icon="GPS" onPress={start} disabled={!ready || !status} />
              </>
            )}
            <Hint>
              The IndiaNavi writes a point every 5 seconds while it has a GPS fix. The recording goes on when the
              IndiaNavi is switched off and on again, until it is stopped here.
            </Hint>
          </>
        )}

        <SectionTitle>Recorded tracks</SectionTitle>
        {recordings.length === 0 && <Hint>No tracks recorded yet.</Hint>}
        {recordings.map((entry) => {
          const running = entry.id === recording?.id;
          const downloaded = isDownloaded(entry);
          return (
            <Card key={entry.id} color={running ? colors.yellow : colors.paper} style={styles.recording}>
              <Icon name="path" size={32} />
              <View style={styles.details}>
                <Text style={styles.name}>{recordingName(entry.id)}</Text>
                <Text style={styles.small}>{size(running ? recording.size : entry.size)}</Text>
                <View style={styles.row}>
                  {running && <Badge color={colors.red}>recording</Badge>}
                  {entry.onDevice && <Badge color={colors.blue}>on the IndiaNavi</Badge>}
                  {entry.trackId && <Badge color={colors.green}>{downloaded ? 'on the phone' : 'older copy on the phone'}</Badge>}
                </View>
                <View style={styles.row}>
                  {entry.onDevice && !running && !downloaded && (
                    <Button title="Download" onPress={() => download(entry)} disabled={!ready} compact />
                  )}
                  {entry.trackId && (
                    <Button title="Show" onPress={() => showTrack(entry)} disabled={!!busy} variant="secondary" compact />
                  )}
                  {entry.onDevice && !running && (
                    <Button title="Delete" onPress={() => remove(entry)} disabled={!ready} variant="danger" compact />
                  )}
                </View>
              </View>
            </Card>
          );
        })}
        <Hint>
          Downloads use the WiFi of the IndiaNavi: the app switches it on over Bluetooth and joins it with the password
          of the QR code that was scanned in the file transfer. Downloaded tracks are in the tracks of the app.
        </Hint>
        {!wifiDevice.ssid && wifiDevice.mode !== 'router' && (
          <Button title="Scan the WiFi QR code" icon="WIFI_3" onPress={onOpenWifi} disabled={!!busy} variant="plain" compact />
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
    gap: 8,
  },
  recording: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  details: {
    flex: 1,
    gap: 6,
  },
  name: {
    fontFamily: font.mono,
    fontWeight: 'bold',
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
