import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import BluetoothIcon from './components/BluetoothIcon';
import BluetoothScreen from './components/BluetoothScreen';
import Button from './components/Button';
import Icon from './components/Icon';
import FilterScreen from './components/FilterScreen';
import TracksScreen from './components/TracksScreen';
import TransferScreen from './components/TransferScreen';
import MapSearch from './components/MapSearch';
import MapView, { areaColor } from './components/MapView';
import TileServerSetting from './components/TileServerSetting';
import { Badge, Card, Hint, Message, PaletteStrip, ProgressBar } from './components/ui';

import { isFileUrl, pickGpxFile, readGpxFile } from './modules/gpx_file';
import { parse } from './modules/gpx_parser';
import { DEFAULT_FILTER } from './modules/map_color';
import { deleteTiles, deleteTrack, listSdCardFiles, trackFile, writeFile } from './modules/sd_card';
import { autoConnect } from './modules/ble/background';
import { getPhonePosition } from './modules/ble/phone_position';
import { TRACK_COLOR_DEFAULT, TRACK_COLOR_MAX } from './modules/ble/protocol';
import { loadSettings, saveSettings } from './modules/settings';
import { BORDER, PAGE_PADDING, SHADOW, colors, displayColor, font, shadow } from './theme';
import { loadTiles } from './modules/tile_loader';
import { DEFAULT_TILE_URL, tileServerName } from './modules/tile_source';
import { DEFAULT_MARGIN, RAW_TILE_BYTES, ZOOM_LEVELS, calculateBoundaries, countTiles, lat2tile, listTiles, lon2tile, pointBounds, trackLength, trackLines, zoomMargin } from './modules/tiles';
import { addTrack, listTracks, readTrack, touchTrack } from './modules/track_library';

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Dahner Felsenland, shown as long as there is no track, the map was not moved and the phone has no position
const DEFAULT_VIEW = { lon: 7.765, lat: 49.143, zoom: 13 };

const isView = (view) =>
  [view?.lon, view?.lat, view?.zoom].every(Number.isFinite);

const isFilter = (filter) =>
  Array.isArray(filter) && filter.length > 0 &&
  filter.every(({ rgb, colors, share }) => Array.isArray(rgb) && rgb.length === 3 && Array.isArray(colors) && colors.length > 0 &&
    (share === undefined || (share >= 0 && share <= 1)));

// Reads the lines of a GPX file, returns { lines, bounds }
const readLines = (name, text) => {
  const lines = trackLines(parse(text));
  const bounds = calculateBoundaries(lines);
  if (bounds === null) {
    throw new Error(`${name} has no track or route`);
  }
  return { lines, bounds };
};

// The track selected the last time the app was used
const selectedTrack = (id) => {
  if (!id) {
    return null;
  }
  try {
    const entry = { id, name: '', ...listTracks().find((track) => track.id === id) };
    const text = readTrack(id);
    return { id, name: entry.name, text, ...readLines(entry.name, text) };
  } catch {
    return null;
  }
};

// Tile of the main navigation: icon with a label below
const NavTile = ({ label, children, onPress, disabled }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    style={({ pressed }) => [styles.navTile, disabled ? styles.navDisabled : pressed ? styles.navPressed : shadow]}>
    <View style={styles.navIcon}>{children}</View>
    <Text style={styles.navLabel}>{label}</Text>
  </Pressable>
);

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const tileUrlTemplate = settings.tileUrl ?? DEFAULT_TILE_URL;
  const filter = isFilter(settings.filter) ? settings.filter : DEFAULT_FILTER;
  // the track looks like on the IndiaNavi, the color comes from it over Bluetooth
  const trackColor = displayColor(
    Number.isInteger(settings.trackColor) && settings.trackColor >= 0 && settings.trackColor <= TRACK_COLOR_MAX
      ? settings.trackColor
      : TRACK_COLOR_DEFAULT
  );
  // { id, name, text, lines, bounds } of the selected track
  const [track, setTrack] = useState(() => selectedTrack(settings.trackId));
  // { lon, lat, zoom } of the map, the last position is remembered
  const [view, setView] = useState(() => (isView(settings.view) ? settings.view : DEFAULT_VIEW));
  const latestView = useRef(view);
  latestView.current = view;
  // set when the map is moved, a position of the phone that arrives later does not move it back
  const viewMoved = useRef(false);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  // 'main', 'tracks', 'filter', 'transfer' or 'bluetooth'
  const [screen, setScreen] = useState('main');
  const [error, setError] = useState(null);
  // { done, total, failed } while the tiles are loaded
  const [progress, setProgress] = useState(null);
  // { files, bytes, failed } when the files are ready for the transfer
  const [prepared, setPrepared] = useState(null);
  const abort = useRef(null);

  // a track decides the area, without a track it is around the middle of the map
  const bounds = useMemo(
    () => track?.bounds ?? pointBounds(view.lon, view.lat),
    [track, view.lon, view.lat]
  );

  const tiles = useMemo(() => listTiles(bounds, margin), [bounds, margin]);

  // The remembered IndiaNavi is connected in the background as soon as it is visible, so it gets the time and the
  // position of the phone and finds the satellites faster. Only while the app is open.
  const bleDevice = settings.bleDevice;
  useEffect(() => {
    autoConnect.setDevice(bleDevice?.id ? bleDevice : undefined);
  }, [bleDevice]);

  useEffect(() => {
    autoConnect.setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => autoConnect.setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const changeSettings = useCallback((changes) => {
    setSettings((current) => {
      const newSettings = { ...current, ...changes };
      saveSettings(newSettings);
      return newSettings;
    });
  }, []);

  const changeView = useCallback((newView) => {
    viewMoved.current = true;
    setView(newView);
    if (!track) {
      // the area follows the map, so the prepared files do not match it anymore
      setPrepared(null);
    }
    changeSettings({ view: newView });
  }, [changeSettings, track]);

  // without a track the map is centered on the phone, when the app starts and when the track is closed
  const hasTrack = track !== null;
  useEffect(() => {
    if (hasTrack) {
      return;
    }
    viewMoved.current = false;
    let cancelled = false;
    getPhonePosition({ quick: true })
      .then(({ longitude, latitude }) => {
        if (!cancelled && !viewMoved.current) {
          changeView({ lon: longitude, lat: latitude, zoom: latestView.current.zoom });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasTrack, changeView]);

  const showTrack = useCallback((newTrack) => {
    abort.current?.abort();
    setScreen('main');
    setError(null);
    setPrepared(null);
    setTrack(newTrack);
    changeSettings({ trackId: newTrack?.id });
  }, [changeSettings]);

  // opened GPX files are added to the tracks and selected
  const openGpx = useCallback(async (load) => {
    try {
      const file = await load();
      if (file === null) {
        return;
      }
      const { lines, bounds } = readLines(file.name, file.text);
      const entry = addTrack(file.name, file.text, trackLength(lines));
      showTrack({ id: entry.id, name: entry.name, text: file.text, lines, bounds });
    } catch (e) {
      setScreen('main');
      setError(`Could not open GPX: ${e.message}`);
    }
  }, [showTrack]);

  const selectTrack = (entry) => {
    try {
      const text = readTrack(entry.id);
      touchTrack(entry.id);
      showTrack({ id: entry.id, name: entry.name, text, ...readLines(entry.name, text) });
    } catch (e) {
      setScreen('main');
      setError(`Could not open ${entry.name}: ${e.message}`);
    }
  };

  const trackDeleted = (id) => {
    if (track?.id === id) {
      abort.current?.abort();
      setPrepared(null);
      setTrack(null);
      changeSettings({ trackId: undefined });
    }
    if (settings.deviceTrackId === id) {
      changeSettings({ deviceTrackId: undefined });
    }
  };

  // GPX files opened with the app from a file manager, mail, browser, ...
  useEffect(() => {
    const openUrl = (url) => {
      if (isFileUrl(url)) {
        openGpx(() => readGpxFile(url));
      }
    };
    Linking.getInitialURL().then(openUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => openUrl(url));
    return () => subscription.remove();
  }, [openGpx]);

  const searchResult = ({ lon, lat }) => changeView({ lon, lat, zoom: 14 });

  const changeMargin = (change) => {
    setMargin(Math.max(0, margin + change));
    setPrepared(null);
  };

  // tile server and filter decide how the tiles look, so the tiles on the phone are deleted when they change
  const changeTileSettings = (changes) => {
    try {
      deleteTiles();
      changeSettings(changes);
      setError(null);
      setPrepared(null);
    } catch (e) {
      setError(`Could not change the settings: ${e.message}`);
    }
  };

  const changeTileUrl = (tileUrl) => changeTileSettings({ tileUrl });

  const changeFilter = (newFilter) =>
    changeTileSettings({ filter: newFilter === DEFAULT_FILTER ? undefined : newFilter });

  // the Android back button leaves the tracks and filter screen, the transfer and Bluetooth screens handle it themselves
  useEffect(() => {
    if (screen !== 'filter' && screen !== 'tracks') {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('main');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  // the filter screen starts with the tile in the middle of the track
  const previewTile = () => {
    const zoom = Math.max(...ZOOM_LEVELS);
    const lon = (bounds.minLon + bounds.maxLon) / 2;
    const lat = (bounds.minLat + bounds.maxLat) / 2;
    return { zoom, x: lon2tile(lon, zoom), y: lat2tile(lat, zoom) };
  };

  const prepare = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setPrepared(null);
    setProgress({ done: 0, total: tiles.length, failed: 0 });
    try {
      if (track) {
        writeFile(trackFile(), track.text);
      } else {
        deleteTrack();
      }
      const failed = await loadTiles(tileUrlTemplate, tiles, filter, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (!controller.signal.aborted) {
        const files = listSdCardFiles(tiles);
        setPrepared({
          files,
          bytes: files.reduce((sum, file) => sum + file.size, 0),
          failed: failed.length,
          reason: failed[0]?.error.message,
        });
      }
    } catch (e) {
      setError(`Could not prepare files: ${e.message}`);
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setProgress(null);
      }
    }
  };

  const loading = progress !== null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        {screen === 'tracks' ? (
          <TracksScreen
            selectedId={track?.id}
            deviceTrackId={settings.deviceTrackId}
            onSelect={selectTrack}
            onOpenGpx={() => openGpx(pickGpxFile)}
            onDeleted={trackDeleted}
            onBack={() => setScreen('main')}
          />
        ) : screen === 'filter' ? (
          <FilterScreen
            filter={filter}
            tileUrlTemplate={tileUrlTemplate}
            startTile={previewTile()}
            onApply={changeFilter}
            onBack={() => setScreen('main')}
          />
        ) : screen === 'bluetooth' ? (
          <BluetoothScreen
            device={settings.bleDevice}
            onDeviceChange={(bleDevice) => changeSettings({ bleDevice })}
            onTrackColorChange={(newTrackColor) => changeSettings({ trackColor: newTrackColor })}
            onOpenWifi={() => setScreen('transfer')}
            onBack={() => setScreen('main')}
          />
        ) : screen === 'transfer' ? (
          <TransferScreen
            files={prepared?.files ?? null}
            device={settings.device ?? {}}
            onDeviceChange={(device) => changeSettings({ device })}
            onTransferred={() => changeSettings({ deviceTrackId: track?.id })}
            onBack={() => setScreen('main')}
          />
        ) : (
          <>
            <View style={styles.header}>
              <Icon name="norden" size={40} />
              <Text style={styles.title}>Wander Navi</Text>
            </View>

            <View style={styles.nav}>
              <NavTile label="Tracks" onPress={() => setScreen('tracks')} disabled={loading}>
                <Icon name="path" size={32} />
              </NavTile>
              <NavTile label="Filter" onPress={() => setScreen('filter')} disabled={loading}>
                <PaletteStrip size={8} />
              </NavTile>
              <NavTile label="Device" onPress={() => setScreen('transfer')} disabled={loading}>
                <Icon name={settings.deviceTrackId ? 'WIFI_3' : 'WIFI_0'} size={32} />
              </NavTile>
              <NavTile label="Bluetooth" onPress={() => setScreen('bluetooth')} disabled={loading}>
                <BluetoothIcon />
              </NavTile>
            </View>

            <TileServerSetting url={tileUrlTemplate} onChange={changeTileUrl} disabled={loading} />

            {error && <Message tone="red" icon="noSD">{error}</Message>}

            {track && (
              <View style={styles.trackName}>
                <Icon name="path" size={32} />
                <Text style={styles.name} numberOfLines={1}>{track.name}</Text>
                {track.id === settings.deviceTrackId && <Badge color={colors.blue}>on the IndiaNavi</Badge>}
                <Button title="×" onPress={() => showTrack(null)} disabled={loading} variant="plain" compact />
              </View>
            )}

            <View style={styles.map}>
              <MapView
                view={view}
                onViewChange={changeView}
                lines={track?.lines}
                bounds={track?.bounds}
                fitKey={track?.id}
                margin={margin}
                tileUrlTemplate={tileUrlTemplate}
                trackColor={trackColor}
              />
              {!track && <MapSearch onSelect={searchResult} />}
            </View>

            {!track && (
              <Hint>Move the map to put the cross where you need tiles, or open a GPX track.</Hint>
            )}

            <View style={styles.legends}>
              {ZOOM_LEVELS.map((zoom, index) => (
                <View key={zoom} style={styles.legend}>
                  <View style={[styles.legendFrame, { borderColor: areaColor(index) }]} />
                  <Text style={styles.small}>
                    Zoom {zoom}: {countTiles(bounds, margin, zoom)} tiles, margin {zoomMargin(margin, zoom)}
                  </Text>
                </View>
              ))}
            </View>

            <Card style={styles.summary}>
              <Icon name="SD" size={32} />
              <Text style={styles.summaryText}>
                {tiles.length} tiles from {tileServerName(tileUrlTemplate)}
                {'\n'}{megabytes(tiles.length * RAW_TILE_BYTES)} on the SD card
              </Text>
            </Card>

            <View style={styles.row}>
              <Text style={styles.marginText}>Margin: {margin} tiles</Text>
              <Button title="−" onPress={() => changeMargin(-1)} disabled={loading || margin === 0} variant="plain" compact />
              <Button title="+" onPress={() => changeMargin(1)} disabled={loading} variant="plain" compact />
            </View>

            {loading ? (
              <>
                <ProgressBar done={progress.done} total={progress.total} />
                <View style={styles.row}>
                  <Text style={styles.small}>
                    {progress.done}/{progress.total} tiles
                    {progress.failed > 0 && `, ${progress.failed} failed`}
                  </Text>
                  <Button title="Cancel" onPress={() => abort.current?.abort()} variant="danger" compact />
                </View>
              </>
            ) : (
              <Button
                title={prepared?.failed ? 'Retry failed tiles' : 'Prepare SD card files'}
                icon="SD"
                onPress={prepare}
              />
            )}

            {prepared && (
              <Message tone={prepared.failed ? 'red' : 'green'} icon={prepared.failed ? 'noSD' : 'SD'}>
                {prepared.failed
                  ? `${prepared.failed} tiles could not be loaded (${prepared.reason}).`
                  : `${prepared.files.length} files (${megabytes(prepared.bytes)}) are ready for the transfer to the IndiaNavi.`}
              </Message>
            )}
            {prepared && !loading && (
              <Button title="Transfer to IndiaNavi" icon="WIFI_3" variant="secondary" onPress={() => setScreen('transfer')} />
            )}
          </>
        )}

        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'stretch',
    padding: PAGE_PADDING,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: BORDER,
    borderBottomColor: colors.ink,
  },
  title: {
    fontFamily: font.mono,
    fontSize: 24,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.ink,
  },
  nav: {
    flexDirection: 'row',
    gap: 12,
  },
  navTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.yellow,
    marginRight: SHADOW,
    marginBottom: SHADOW,
  },
  navPressed: {
    transform: [{ translateX: SHADOW }, { translateY: SHADOW }],
  },
  navDisabled: {
    backgroundColor: colors.paper,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  navIcon: {
    height: 32,
    justifyContent: 'center',
  },
  navLabel: {
    fontFamily: font.mono,
    fontWeight: 'bold',
    fontSize: 13,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  trackName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flexShrink: 1,
    fontFamily: font.mono,
    fontWeight: 'bold',
    fontSize: 16,
    color: colors.ink,
  },
  map: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  small: {
    fontSize: 13,
    color: colors.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  marginText: {
    fontFamily: font.mono,
    fontWeight: 'bold',
    color: colors.ink,
  },
  legends: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 16,
    rowGap: 4,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendFrame: {
    width: 14,
    height: 14,
    borderWidth: 3,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.paper,
  },
  summaryText: {
    flex: 1,
    color: colors.ink,
  },
});
