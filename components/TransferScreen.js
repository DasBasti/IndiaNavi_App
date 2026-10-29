import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';

import Button from './Button';
import { BusyWindow, Hint, Input, Message, ProgressWindow, ScreenHeader, SectionTitle } from './ui';
import { colors } from '../theme';
import {
  ACCESS_POINT_ADDRESS,
  DEFAULT_ROUTER_ADDRESS,
  FILES_PER_SECOND,
  deleteDeviceMap,
  deviceUrl,
  getDeviceInfo,
  getDeviceMaps,
  isTimeout,
  readFirmware,
  sendMap,
  supportsMaps,
  supportsResume,
  transferToDevice,
  updateFirmware,
} from '../modules/device_transfer';
import {
  addWifiLostListener,
  bindToConnectedDeviceWifi,
  connectToDeviceWifi,
  disconnectFromDeviceWifi,
} from '../modules/indianavi-wifi';
import { cardName } from '../modules/map_catalog';
import { displayName } from '../modules/map_listing';
import { DEFAULT_UPLOAD_RATE, measuredRate, minutesFor, resumeOffset } from '../modules/map_upload';
import { listStoredTiles, listTileFiles } from '../modules/sd_card';
import { mapFile } from '../modules/vector_maps';
import { SIMULATED_BASE, isSimulatedWifi } from '../modules/simulated_device';
import { parseWifiQr } from '../modules/wifi_qr';

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// the card needs some space next to a map while it is written
const MAP_SPACE_RESERVE = 1024 * 1024;

// the time that is left from the rate of this upload, from the rate of the uploads before at its start
const mapProgressText = ({ name, sent, total, started, from }, rate) => {
  const seconds = (Date.now() - started) / 1000;
  const current = seconds > 10 && sent > from ? (sent - from) / seconds : rate;
  return `${name}: ${megabytes(sent)} of ${megabytes(total)}, about ${minutesFor(total - sent, current)} min left`;
};

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
// files is null when no files are prepared, then only the firmware can be updated. With autoStart the files are sent as
// soon as the device is connected.
// device holds the saved connection: { mode: 'accessPoint' | 'router', ssid, password, address }
// maps are the vector maps for the IndiaNavi (opened maps of vector_maps.js), cardMaps their names on the SD card:
// { [name on the phone]: 'rheinl01.map' }, onCardMapsChange gets a function that changes the names. uploadRate is the
// measured speed of map uploads in bytes per second (undefined before the first), onUploadRateChange gets a new one.
export default function TransferScreen({
  files, autoStart, device, onDeviceChange, onTransferred, maps = [], cardMaps = {}, onCardMapsChange, uploadRate,
  onUploadRateChange, onBack,
}) {
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
  // the files are sent once by themselves, later transfers are started with the button
  const autoStartPending = useRef(autoStart);
  // the vector maps on the SD card of the connected device, null until they are read
  const [deviceMaps, setDeviceMaps] = useState(null);
  // the maps whose upload was not finished: [{ file, size, total, created }]
  const [partialMaps, setPartialMaps] = useState([]);
  // { name, sent, total, started } while a map is sent
  const [mapUpload, setMapUpload] = useState(null);
  // name of the map on the card that waits for the confirmation to be deleted
  const [deletingMap, setDeletingMap] = useState(null);

  const busy = connecting || progress !== null || firmware === 'sending' || mapUpload !== null;
  const mapsSupported = connection !== null && supportsMaps(connection.info);
  // number of tiles on the phone, of all tracks
  const storedTiles = useMemo(() => (connection ? listStoredTiles().length : 0), [connection]);
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
      if (mode === 'accessPoint' && isSimulatedWifi(credentials.ssid, credentials.password)) {
        // no WiFi to join, the IndiaNavi of this name is simulated by the app
        disconnectFromDeviceWifi();
        base = SIMULATED_BASE;
      } else if (mode === 'accessPoint') {
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

  // the prepared files, or all tiles on the phone with allTiles
  const transfer = async ({ allTiles = false } = {}) => {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setResult(null);
    setProgress({ phase: 'check', done: 0, total: 0 });
    try {
      const sent = await transferToDevice(connection.base, allTiles ? listTileFiles(listStoredTiles()) : files, {
        signal: controller.signal,
        onProgress: setProgress,
        replaceTiles: allTiles,
        keepTrack: allTiles,
      });
      setResult({ ...sent, allTiles });
      if (!allTiles) {
        onTransferred();
      }
    } catch (e) {
      setError(controller.signal.aborted ? 'The transfer was cancelled.' : `Transfer failed: ${e.message}`);
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  // the maps on the card are read when the device is connected
  const loadDeviceMaps = async (base) => {
    try {
      const { maps: onCard, partial } = await getDeviceMaps(base);
      setDeviceMaps(onCard);
      setPartialMaps(partial);
    } catch (e) {
      setDeviceMaps(null);
      setPartialMaps([]);
      setError(`Could not read the maps of the IndiaNavi: ${e.message}`);
    }
  };

  useEffect(() => {
    setDeviceMaps(null);
    if (connection && supportsMaps(connection.info)) {
      loadDeviceMaps(connection.base);
    }
  }, [connection]);

  // the entry of a phone map on the card, and the checked maps that are not (completely) on it
  const cardEntry = (map) => deviceMaps?.find((entry) => entry.file === cardMaps[map.name]);
  const isOnCard = (map) => cardEntry(map)?.size === map.source.size;
  const missingMaps = maps.filter((map) => !isOnCard(map));

  // where the upload of a map continues: the part of an earlier upload of the same map on the card, or 0
  const resumable = connection !== null && supportsResume(connection.info);
  const startOf = (map) => (resumable
    ? resumeOffset(
      { size: map.source.size, created: map.header.created },
      partialMaps.find((entry) => entry.file === cardMaps[map.name])
    )
    : 0);
  const rate = uploadRate ?? DEFAULT_UPLOAD_RATE;
  const missingBytes = missingMaps.reduce((sum, map) => sum + map.source.size - startOf(map), 0);
  // bytes of the running upload, to measure the speed
  const uploadStats = useRef(null);

  // the names on the card, with the ones given while several maps are sent one after the other
  const latestCardMaps = useRef(cardMaps);
  latestCardMaps.current = { ...latestCardMaps.current, ...cardMaps };

  // the name of a phone map on the card, a new one for a map that was not sent yet
  const cardNameOf = (name) => {
    const names = latestCardMaps.current;
    const file = names[name] ?? cardName(name, [...Object.values(names), ...(deviceMaps ?? []).map((map) => map.file)]);
    latestCardMaps.current = { ...names, [name]: file };
    return file;
  };

  // returns true when the map is on the card
  const sendVectorMap = async (map) => {
    const file = cardNameOf(map.name);
    const size = map.source.size;
    const start = startOf(map);
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setResult(null);
    try {
      // the card has to hold the rest of the map before an old version of it is removed
      const info = await getDeviceInfo(connection.base, controller.signal);
      if (size - start + MAP_SPACE_RESERVE > info.sd.free) {
        throw new Error(`${megabytes(size - start)} are needed, the SD card has ${megabytes(info.sd.free)} free`);
      }
      onCardMapsChange((current) => ({ ...current, [map.name]: file }));
      const started = Date.now();
      uploadStats.current = { started, from: start, sent: start };
      setMapUpload({ name: displayName(map.name), sent: start, total: size, started, from: start });
      await sendMap(
        connection.base,
        { uri: mapFile(map.name).uri, size, created: map.header.created, bounds: map.header.bounds },
        file,
        {
          signal: controller.signal,
          resumable,
          start,
          onProgress: ({ bytesSent }) => {
            uploadStats.current = { ...uploadStats.current, sent: bytesSent };
            setMapUpload((current) => current && { ...current, sent: bytesSent });
          },
        }
      );
      setConnection({ ...connection, info: await getDeviceInfo(connection.base) });
      return true;
    } catch (e) {
      const kept = resumable ? ' The part that was sent stays on the card, Continue sends the rest.' : '';
      setError(controller.signal.aborted
        ? `Sending the map was cancelled.${kept}`
        : `Could not send ${displayName(map.name)}: ${e.message}.${kept}`);
      loadDeviceMaps(connection.base);
      return false;
    } finally {
      // the speed of the device for the next estimates, the simulated device has none
      const stats = uploadStats.current;
      if (stats && connection.base !== SIMULATED_BASE) {
        const measured = measuredRate(uploadRate, stats.sent - stats.from, (Date.now() - stats.started) / 1000);
        if (measured !== uploadRate) {
          onUploadRateChange(measured);
        }
      }
      uploadStats.current = null;
      abort.current = null;
      setMapUpload(null);
    }
  };

  const sendMissingMaps = async (missing) => {
    for (const map of missing) {
      if (!(await sendVectorMap(map))) {
        break;
      }
    }
  };

  const removeDeviceMap = async (file) => {
    setDeletingMap(null);
    setError(null);
    try {
      await deleteDeviceMap(connection.base, file);
      onCardMapsChange((current) => Object.fromEntries(Object.entries(current).filter(([, card]) => card !== file)));
      latestCardMaps.current = Object.fromEntries(
        Object.entries(latestCardMaps.current).filter(([, card]) => card !== file)
      );
      setConnection({ ...connection, info: await getDeviceInfo(connection.base) });
    } catch (e) {
      setError(`Could not delete ${file}: ${e.message}`);
      loadDeviceMaps(connection.base);
    }
  };

  useEffect(() => {
    if (connection && files && autoStartPending.current) {
      autoStartPending.current = false;
      transfer();
    }
  });

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
      {(progress || mapUpload || firmware === 'sending') && <KeepAwake />}
      <ProgressWindow
        visible={mapUpload !== null}
        text="Sending the vector map"
        done={mapUpload?.sent ?? 0}
        total={mapUpload?.total ?? 0}
        detail={mapUpload && mapProgressText(mapUpload, rate)}
        onCancel={() => abort.current?.abort()}
      />
      <ProgressWindow
        visible={progress !== null}
        text={progress?.phase === 'check' ? 'Checking the tiles' : 'Sending the files'}
        done={progress?.done ?? 0}
        total={progress?.total ?? 0}
        detail={progress && progressText(progress)}
        onCancel={() => abort.current?.abort()}
      />
      <BusyWindow
        text={firmware === 'sending' ? 'Updating the firmware…' : connecting ? 'Connecting to the IndiaNavi…' : null}
      />
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

        {connection && (
          <>
            <SectionTitle>Files</SectionTitle>
            {files && <Button title="Send to IndiaNavi" icon="SD" onPress={() => transfer()} disabled={busy} />}
            <Button
              title="Update all tiles on the IndiaNavi"
              icon="SD"
              onPress={() => transfer({ allTiles: true })}
              disabled={busy || storedTiles === 0}
              variant="secondary"
            />
            <Hint>
              {files && 'Send to IndiaNavi skips the tiles that are already on the SD card. '}
              Update all tiles sends all {storedTiles} tiles on the phone again, for example after the filter was
              changed, the track on the IndiaNavi stays. The IndiaNavi stores about {FILES_PER_SECOND} tiles per second
              and shows the progress on its display.
            </Hint>
          </>
        )}

        {connection && (
          <>
            <SectionTitle>Vector maps</SectionTitle>
            {!mapsSupported ? (
              <Hint>
                The firmware of this IndiaNavi can not take vector maps over WiFi. Update the firmware, or copy the .map
                files into the MAPS folder of the SD card with a card reader (8.3 names like RHEINL01.MAP).
              </Hint>
            ) : (
              <>
                {maps.length === 0 && (
                  <Hint>No vector maps are checked for the IndiaNavi. Check them on the Maps screen of the IndiaNavi mode.</Hint>
                )}
                {maps.map((map) => {
                  const card = cardEntry(map);
                  const sent = isOnCard(map);
                  const start = startOf(map);
                  const size = map.source.size;
                  return (
                    <View key={map.name} style={styles.mapRow}>
                      <View style={styles.mapText}>
                        <Text style={styles.text} numberOfLines={1}>{displayName(map.name)}</Text>
                        <Text style={styles.small}>
                          {megabytes(size)}
                          {sent && ` · on the card as ${card.file}${card.used ? '' : ', replaced by a newer map'}`}
                          {!sent && start > 0 && ` · ${megabytes(start)} are on the card`}
                          {!sent && ` · about ${minutesFor(size - start, rate)} min`}
                        </Text>
                      </View>
                      {!sent && (
                        <Button
                          title={start > 0 ? 'Continue' : 'Send'}
                          onPress={() => sendVectorMap(map)}
                          disabled={busy || deviceMaps === null}
                          variant="secondary"
                          compact
                        />
                      )}
                    </View>
                  );
                })}
                {missingMaps.length > 1 && (
                  <Button
                    title={`Send ${missingMaps.length} maps (${megabytes(missingBytes)}, about ${minutesFor(missingBytes, rate)} min)`}
                    icon="SD"
                    onPress={() => sendMissingMaps(missingMaps)}
                    disabled={busy || deviceMaps === null}
                  />
                )}

                <Text style={styles.text}>On the SD card</Text>
                {deviceMaps === null && <Hint>Reading the maps of the IndiaNavi…</Hint>}
                {deviceMaps?.length === 0 && partialMaps.length === 0 && <Hint>There are no vector maps on the SD card.</Hint>}
                {deviceMaps?.map((entry) => {
                  const phone = Object.entries(cardMaps).find(([, card]) => card === entry.file)?.[0];
                  return (
                    <View key={entry.file} style={styles.mapRow}>
                      <View style={styles.mapText}>
                        <Text style={styles.text} numberOfLines={1}>
                          {entry.file}{phone ? ` (${displayName(phone)})` : ''}
                        </Text>
                        <Text style={styles.small}>
                          {megabytes(entry.size)} · {new Date(entry.created).toLocaleDateString()}
                          {entry.used ? '' : ' · replaced by a newer map, not drawn'}
                        </Text>
                      </View>
                      {deletingMap === entry.file ? (
                        <>
                          <Button title="Delete" onPress={() => removeDeviceMap(entry.file)} variant="danger" compact />
                          <Button title="Keep" onPress={() => setDeletingMap(null)} variant="plain" compact />
                        </>
                      ) : (
                        <Button title="Delete" onPress={() => setDeletingMap(entry.file)} disabled={busy} variant="plain" compact />
                      )}
                    </View>
                  );
                })}
                {partialMaps.map((entry) => (
                  <View key={`${entry.file} partial`} style={styles.mapRow}>
                    <View style={styles.mapText}>
                      <Text style={styles.text} numberOfLines={1}>{entry.file}</Text>
                      <Text style={styles.small}>
                        not finished: {megabytes(entry.size)}{entry.total > 0 ? ` of ${megabytes(entry.total)}` : ''} on the card
                      </Text>
                    </View>
                    {deletingMap === entry.file ? (
                      <>
                        <Button title="Delete" onPress={() => removeDeviceMap(entry.file)} variant="danger" compact />
                        <Button title="Keep" onPress={() => setDeletingMap(null)} variant="plain" compact />
                      </>
                    ) : (
                      <Button title="Delete" onPress={() => setDeletingMap(entry.file)} disabled={busy} variant="plain" compact />
                    )}
                  </View>
                ))}
                <Hint>
                  The IndiaNavi draws the maps that cover the screen, at most 4, and a newer map of a region replaces an
                  older one. Keep the charger plugged in while maps are sent. The times are estimated from
                  {uploadRate ? ` the maps sent before (${Math.round(uploadRate / 1024)} kB/s).` : ' the speed of tiles (180 kB/s).'}
                  {resumable && ' A map that was interrupted is continued where it stopped.'}
                </Hint>
              </>
            )}
          </>
        )}

        {connection && (
          <>
            <SectionTitle>Firmware</SectionTitle>
            <Button
              title="Update firmware"
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
            {result.allTiles
              ? `Done. ${result.uploaded} tiles (${megabytes(result.bytes)}) sent again. The IndiaNavi shows them when it draws the map.`
              : `Done. ${result.uploaded} files (${megabytes(result.bytes)}) sent, ${result.skipped} tiles were already on ` +
                'the IndiaNavi. The new track is loaded when the device shows the map.'}
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
  small: {
    fontSize: 13,
    color: colors.ink,
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapText: {
    flex: 1,
  },
  camera: {
    height: 300,
    borderWidth: 2,
    borderColor: colors.ink,
    overflow: 'hidden',
  },
});
