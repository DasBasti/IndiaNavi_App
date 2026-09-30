import { useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';

import Button from './Button';
import {
  ACCESS_POINT_ADDRESS,
  DEFAULT_ROUTER_ADDRESS,
  FILES_PER_SECOND,
  deviceUrl,
  getDeviceInfo,
  isTimeout,
  transferToDevice,
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

const Progress = ({ done, total }) => (
  <View style={styles.progress}>
    <View style={[styles.progressBar, { width: `${(done / Math.max(total, 1)) * 100}%` }]} />
  </View>
);

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

// Connects to the IndiaNavi and copies the prepared files to its SD card.
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

  const busy = connecting || progress !== null;
  const bytes = files.reduce((sum, file) => sum + file.size, 0);

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

  return (
    <View style={styles.screen}>
      {progress && <KeepAwake />}
      <View style={styles.row}>
        <Button title="‹ Back" onPress={onBack} disabled={busy} />
        <Text style={styles.title}>Transfer</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text>
          {files.length} files ({megabytes(bytes)}) are ready on the phone.
        </Text>

        <Text style={styles.subtitle}>Connection</Text>
        <View style={styles.row}>
          <Button title="WiFi of the IndiaNavi" onPress={() => setMode('accessPoint')} disabled={busy || mode === 'accessPoint'} />
          <Button title="Router WiFi" onPress={() => setMode('router')} disabled={busy || mode === 'router'} />
        </View>

        {mode === 'accessPoint' ? (
          <>
            <Text style={styles.hint}>
              Plug in the charger of the IndiaNavi. The charging screen shows a QR code with the WiFi of the device.
            </Text>
            {scanning ? (
              <>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned}
                />
                <Button title="Stop scanning" onPress={() => setScanning(false)} />
              </>
            ) : (
              <Button title="Scan QR code" onPress={startScan} disabled={busy} />
            )}
            <TextInput
              style={styles.input}
              value={ssid}
              onChangeText={setSsid}
              placeholder="WiFi name, for example IndiaNavi-E3ED"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              The IndiaNavi joins the WiFi from the WIFI file on its SD card. The phone has to be in the same WiFi.
            </Text>
            <TextInput
              style={styles.input}
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
          onPress={() => connect()}
          disabled={busy || (mode === 'router' && !address.trim())}
        />

        {connection && (
          <Text style={styles.success}>
            Connected to {connection.info.id} (firmware {connection.info.firmware})
            {connection.existing && ` in the WiFi ${connection.ssid ?? 'of the IndiaNavi'} the phone was already connected to`}.{' '}
            {connection.info.sd.present
              ? `SD card: ${megabytes(connection.info.sd.free)} free of ${megabytes(connection.info.sd.total)}.`
              : 'No SD card in the device.'}
          </Text>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {connection && (
          <>
            <Text style={styles.subtitle}>Files</Text>
            {progress ? (
              <>
                <Progress done={progress.done} total={progress.total} />
                <Text>{progressText(progress)}</Text>
                <Button title="Cancel" onPress={() => abort.current?.abort()} />
              </>
            ) : (
              <Button title="Send to IndiaNavi" onPress={transfer} />
            )}
            <Text style={styles.hint}>
              Tiles that are already on the SD card are skipped. The IndiaNavi stores about {FILES_PER_SECOND} tiles
              per second and shows the progress on its display.
            </Text>
          </>
        )}

        {result && (
          <Text style={styles.success}>
            Done. {result.uploaded} files ({megabytes(result.bytes)}) sent, {result.skipped} tiles were already on
            the IndiaNavi. The new track is loaded when the device shows the map.
          </Text>
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
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  hint: {
    color: '#666',
  },
  input: {
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 6,
    padding: 8,
  },
  camera: {
    height: 300,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progress: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ddd',
    overflow: 'hidden',
  },
  progressBar: {
    height: 8,
    backgroundColor: '#2e7d32',
  },
  error: {
    color: '#c62828',
  },
  success: {
    color: '#2e7d32',
  },
});
