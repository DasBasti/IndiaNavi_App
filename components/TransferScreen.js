import { useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';

import Button from './Button';
import { Hint, Input, Message, ProgressBar, ScreenHeader, SectionTitle } from './ui';
import { colors } from '../theme';
import {
  ACCESS_POINT_ADDRESS,
  DEFAULT_ROUTER_ADDRESS,
  FILES_PER_SECOND,
  deviceUrl,
  getDeviceInfo,
  isTimeout,
  readFirmware,
  transferToDevice,
  updateFirmware,
} from '../modules/device_transfer';
import {
  addWifiLostListener,
  bindToConnectedDeviceWifi,
  connectToDeviceWifi,
  disconnectFromDeviceWifi,
} from '../modules/indianavi-wifi';
import { parseWifiQr } from '../modules/wifi_qr';

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// the screen stays on while files are sent, it takes some minutes
const KeepAwake = () => {
  useKeepAwake();
  return null;
};

// Uses the WiFi of an IndiaNavi the phone is already connected to, for example from the WiFi settings.
// Returns the connection { base, info, ssid, existing } or null.
const existingWifiConnection = async () => {
  const wifi = await bindToConnectedDeviceWifi();
  if (!wifi) {
    return null;
  }
  const base = deviceUrl(ACCESS_POINT_ADDRESS);
  try {
    return { base, info: await getDeviceInfo(base), ssid: wifi.ssid, existing: true };
  } catch {
    // a WiFi in the same address range, but no IndiaNavi
    disconnectFromDeviceWifi();
    return null;
  }
};

const progressText = (progress) => {
  switch (progress.phase) {
    case 'check':
      return `Checking the tiles on the IndiaNavi: ${progress.done}/${progress.total} folders`;
    case 'upload': {
      const minutes = Math.ceil((progress.total - progress.done) / FILES_PER_SECOND / 60);
      return `Sending ${progress.done}/${progress.total} files, ${megabytes(progress.bytesDone)} of ${megabytes(progress.bytesTotal)}, about ${minutes} min left`;
    }
    default:
      return 'Loading the new track on the IndiaNavi';
  }
};

// Connects to the IndiaNavi, copies the prepared files to its SD card and updates its firmware.
// files is null when no files are prepared, then only the firmware can be updated.
// device holds the saved connection: { mode: 'accessPoint' | 'router', ssid, password, address }
export default function TransferScreen({ files, device, onDeviceChange, onTransferred, onBack }) {
  const [mode, setMode] = useState(device.mode ?? 'accessPoint');
  const [ssid, setSsid] = useState(device.ssid ?? '');
  const [password, setPassword] = useState(device.password ?? '');
  const [address, setAddress] = useState(device.address ?? DEFAULT_ROUTER_ADDRESS);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // { base, info, ssid, existing } of the connected device
  const [connection, setConnection] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  // { phase, done, total, bytesDone, bytesTotal } while the files are sent
  const [progress, setProgress] = useState(null);
  // { uploaded, skipped, bytes } of the finished transfer
  const [result, setResult] = useState(null);
  const abort = useRef(null);
  // 'sending' while the firmware is written, 'restarted' when the device installs it
  const [firmware, setFirmware] = useState(null);

  const busy = connecting || progress !== null || firmware === 'sending';
  const bytes = files?.reduce((sum, file) => sum + file.size, 0) ?? 0;

  // leaving the screen ends the transfer and the connection to the access point
  useEffect(() => () => {
    abort.current?.abort();
    disconnectFromDeviceWifi();
  }, []);

  // the phone may already be in the WiFi of the IndiaNavi
  useEffect(() => {
    if (mode !== 'accessPoint') {
      return;
    }
    let active = true;
    setConnecting(true);
    existingWifiConnection()
      .then((existing) => {
        if (active && existing) {
          setConnection(existing);
        }
      })
      .catch(() => { })
      .finally(() => active && setConnecting(false));
    return () => {
      active = false;
    };
  }, [mode]);

  useEffect(() => {
    const subscription = addWifiLostListener(() => {
      setConnection(null);
      setError('The connection to the WiFi of the IndiaNavi was lost.');
    });
    return () => subscription.remove();
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

  const connect = async (credentials = { ssid, password }) => {
    setConnecting(true);
    setConnection(null);
    setError(null);
    setResult(null);
    try {
      let base;
      if (mode === 'accessPoint') {
        const existing = await existingWifiConnection();
        // a scanned code of another IndiaNavi wins over the WiFi the phone is in
        if (existing && !(existing.ssid && credentials.ssid && existing.ssid !== credentials.ssid)) {
          setConnection(existing);
          return;
        }
        if (!credentials.ssid || !credentials.password) {
          throw new Error(
            'the phone is not in the WiFi of an IndiaNavi. Scan the QR code on the charging screen, ' +
            'or type in name and password.'
          );
        }
        onDeviceChange({ mode, ssid: credentials.ssid, password: credentials.password, address });
        await connectToDeviceWifi(credentials.ssid, credentials.password);
        base = deviceUrl(ACCESS_POINT_ADDRESS);
      } else {
        onDeviceChange({ mode, ssid, password, address });
        disconnectFromDeviceWifi();
        base = deviceUrl(address.trim());
      }
      setConnection({ base, info: await getDeviceInfo(base) });
    } catch (e) {
      if (isTimeout(e) && mode === 'router') {
        setError(
          `No answer from ${address}. Guest WiFis often block connections between devices, ` +
          'and the IndiaNavi only uses 2.4 GHz. Use the WiFi of the IndiaNavi instead.'
        );
      } else if (isTimeout(e)) {
        setError('Connected to the WiFi, but the IndiaNavi does not answer. Is it still charging?');
      } else {
        setError(`Could not connect: ${e.message}`);
      }
    } finally {
      setConnecting(false);
    }
  };

  const startScan = async () => {
    setError(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted) {
      setError('The camera is needed to scan the QR code. You can also type in name and password.');
      return;
    }
    setScanning(true);
  };

  // for WiFi codes, data only holds what ML Kit shows to the user; the full text is in raw
  const scanned = ({ data, raw, extra }) => {
    const credentials =
      parseWifiQr(raw) ??
      parseWifiQr(data) ??
      (extra?.ssid ? { ssid: extra.ssid, password: extra.password ?? '' } : null);
    if (!credentials) {
      return;
    }
    setScanning(false);
    setSsid(credentials.ssid);
    setPassword(credentials.password);
    connect(credentials);
  };

  const transfer = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setResult(null);
    setProgress({ phase: 'check', done: 0, total: 0 });
    try {
      setResult(await transferToDevice(connection.base, files, {
        signal: controller.signal,
        onProgress: setProgress,
      }));
      onTransferred();
    } catch (e) {
      setError(controller.signal.aborted ? 'The transfer was cancelled.' : `Transfer failed: ${e.message}`);
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const update = async () => {
    setError(null);
    setResult(null);
    try {
      const picked = await File.pickFileAsync();
      if (picked.canceled) {
        return;
      }
      const bytes = await readFirmware(picked.result);
      setFirmware('sending');
      await updateFirmware(connection.base, bytes);
      setFirmware('restarted');
      setConnection(null);
    } catch (e) {
      setFirmware(null);
      setError(`Firmware update failed: ${e.message}`);
    }
  };

  return (
    <View style={styles.screen}>
      {(progress || firmware === 'sending') && <KeepAwake />}
      <ScreenHeader title="IndiaNavi" icon={connection ? 'WIFI_3' : connecting ? 'WIFI_1' : 'WIFI_0'} onBack={onBack} disabled={busy} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Message tone={files ? 'green' : 'yellow'} icon={files ? 'SD' : 'noSD'}>
          {files
            ? `${files.length} files (${megabytes(bytes)}) are ready on the phone.`
            : 'No files are prepared. To send a track, choose it and tap Prepare SD card files on the main screen.'}
        </Message>

        <SectionTitle>Connection</SectionTitle>
        <View style={styles.row}>
          <Button
            title="WiFi of the IndiaNavi"
            onPress={() => setMode('accessPoint')}
            disabled={busy}
            variant={mode === 'accessPoint' ? 'primary' : 'plain'}
            compact
          />
          <Button
            title="Router WiFi"
            onPress={() => setMode('router')}
            disabled={busy}
            variant={mode === 'router' ? 'primary' : 'plain'}
            compact
          />
        </View>

        {mode === 'accessPoint' ? (
          <>
            <Hint>
              Plug in the charger of the IndiaNavi, or switch its WiFi on in the Bluetooth screen. The display shows a QR
              code with the WiFi of the device.
            </Hint>
            {scanning ? (
              <>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned}
                />
                <Button title="Stop scanning" onPress={() => setScanning(false)} variant="danger" />
              </>
            ) : (
              <Button title="Scan QR code" icon="GPS_search" onPress={startScan} disabled={busy} variant="secondary" />
            )}
            <Input
              value={ssid}
              onChangeText={setSsid}
              placeholder="WiFi name, for example IndiaNavi-E3ED"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        ) : (
          <>
            <Hint>
              The IndiaNavi joins the WiFi from the WIFI file on its SD card. The phone has to be in the same WiFi.
            </Hint>
            <Input
              value={address}
              onChangeText={setAddress}
              placeholder="Address, for example indianavi.local"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </>
        )}

        <Button
          title={connecting ? 'Connecting…' : 'Connect'}
          icon={connecting ? 'WIFI_1' : 'WIFI_3'}
          onPress={() => connect()}
          disabled={busy || (mode === 'router' && !address.trim())}
        />

        {connection && (
          <Message tone="green" icon="WIFI_3">
            Connected to {connection.info.id} (firmware {connection.info.firmware})
            {connection.existing && ` in the WiFi ${connection.ssid ?? 'of the IndiaNavi'} the phone was already connected to`}.{' '}
            {connection.info.sd.present
              ? `SD card: ${megabytes(connection.info.sd.free)} free of ${megabytes(connection.info.sd.total)}.`
              : 'No SD card in the device.'}
          </Message>
        )}

        {error && <Message tone="red" icon="WIFI_0">{error}</Message>}

        {connection && files && (
          <>
            <SectionTitle>Files</SectionTitle>
            {progress ? (
              <>
                <ProgressBar done={progress.done} total={progress.total} />
                <Text style={styles.text}>{progressText(progress)}</Text>
                <Button title="Cancel" onPress={() => abort.current?.abort()} variant="danger" />
              </>
            ) : (
              <Button title="Send to IndiaNavi" icon="SD" onPress={transfer} />
            )}
            <Hint>
              Tiles that are already on the SD card are skipped. The IndiaNavi stores about {FILES_PER_SECOND} tiles
              per second and shows the progress on its display.
            </Hint>
          </>
        )}

        {connection && (
          <>
            <SectionTitle>Firmware</SectionTitle>
            <Button
              title={firmware === 'sending' ? 'Updating…' : 'Update firmware'}
              onPress={update}
              disabled={busy}
              variant="secondary"
            />
            <Hint>
              Pick the firmware file (firmware.bin) of the IndiaNavi. The device checks it, restarts and starts the new
              firmware. Keep the charger plugged in during the update.
            </Hint>
          </>
        )}

        {firmware === 'restarted' && (
          <Message tone="green" icon="bat_100">
            The firmware was sent. The IndiaNavi restarts with the new firmware, connect again in a minute.
          </Message>
        )}

        {result && (
          <Message tone="green" icon="SD">
            Done. {result.uploaded} files ({megabytes(result.bytes)}) sent, {result.skipped} tiles were already on
            the IndiaNavi. The new track is loaded when the device shows the map.
          </Message>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignSelf: 'stretch',
    gap: 12,
  },
  content: {
    gap: 12,
    paddingBottom: 24,
    paddingRight: 4,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    color: colors.ink,
  },
  camera: {
    height: 300,
    borderWidth: 2,
    borderColor: colors.ink,
    overflow: 'hidden',
  },
});
