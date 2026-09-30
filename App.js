import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import Button from './components/Button';
import FilterScreen from './components/FilterScreen';
import TracksScreen from './components/TracksScreen';
import TransferScreen from './components/TransferScreen';
import MapPreview, { areaColor } from './components/MapPreview';
import TileServerSetting from './components/TileServerSetting';

import { isFileUrl, pickGpxFile, readGpxFile } from './modules/gpx_file';
import { parse } from './modules/gpx_parser';
import { DEFAULT_FILTER } from './modules/map_color';
import { deleteTiles, listSdCardFiles, trackFile, writeFile } from './modules/sd_card';
import { loadSettings, saveSettings } from './modules/settings';
import { loadTiles } from './modules/tile_loader';
import { DEFAULT_TILE_URL, tileServerName } from './modules/tile_source';
import { DEFAULT_MARGIN, RAW_TILE_BYTES, ZOOM_LEVELS, calculateBoundaries, countTiles, lat2tile, listTiles, lon2tile, trackLength, trackLines, zoomMargin } from './modules/tiles';
import { addTrack, listTracks, readTrack, touchTrack } from './modules/track_library';

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Dahner Felsenland, shown in the filter screen as long as no GPX file is open
const DEFAULT_PREVIEW_POSITION = { lon: 7.765, lat: 49.143 };

const isFilter = (filter) =>
  Array.isArray(filter) && filter.length > 0 &&
  filter.every(({ rgb, colors }) => Array.isArray(rgb) && rgb.length === 3 && Array.isArray(colors) && colors.length > 0);

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

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const tileUrlTemplate = settings.tileUrl ?? DEFAULT_TILE_URL;
  const filter = isFilter(settings.filter) ? settings.filter : DEFAULT_FILTER;
  // { id, name, text, lines, bounds } of the selected track
  const [track, setTrack] = useState(() => selectedTrack(settings.trackId));
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  // 'main', 'tracks', 'filter' or 'transfer'
  const [screen, setScreen] = useState('main');
  const [error, setError] = useState(null);
  // { done, total, failed } while the tiles are loaded
  const [progress, setProgress] = useState(null);
  // { files, bytes, failed } when the files are ready for the transfer
  const [prepared, setPrepared] = useState(null);
  const abort = useRef(null);

  const tiles = useMemo(
    () => (track ? listTiles(track.bounds, margin) : []),
    [track, margin]
  );

  const changeSettings = useCallback((changes) => {
    setSettings((current) => {
      const newSettings = { ...current, ...changes };
      saveSettings(newSettings);
      return newSettings;
    });
  }, []);

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

  // the Android back button leaves the tracks and filter screen, the transfer screen handles it itself
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
    const lon = track ? (track.bounds.minLon + track.bounds.maxLon) / 2 : DEFAULT_PREVIEW_POSITION.lon;
    const lat = track ? (track.bounds.minLat + track.bounds.maxLat) / 2 : DEFAULT_PREVIEW_POSITION.lat;
    return { zoom, x: lon2tile(lon, zoom), y: lat2tile(lat, zoom) };
  };

  const prepare = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setPrepared(null);
    setProgress({ done: 0, total: tiles.length, failed: 0 });
    try {
      writeFile(trackFile(), track.text);
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
        ) : screen === 'transfer' ? (
          <TransferScreen
            files={prepared.files}
            device={settings.device ?? {}}
            onDeviceChange={(device) => changeSettings({ device })}
            onTransferred={() => changeSettings({ deviceTrackId: track.id })}
            onBack={() => setScreen('main')}
          />
        ) : (
          <>
            <View style={styles.row}>
              <Text style={styles.title}>IndiaNavi</Text>
              <Button title="Tracks" onPress={() => setScreen('tracks')} disabled={loading} />
              <Button title="Filter" onPress={() => setScreen('filter')} disabled={loading} />
            </View>

            <TileServerSetting url={tileUrlTemplate} onChange={changeTileUrl} disabled={loading} />

            {error && <Text style={styles.error}>{error}</Text>}

            {track ? (
              <>
                <Text style={styles.name} numberOfLines={1}>
                  {track.name}
                  {track.id === settings.deviceTrackId && <Text style={styles.onDevice}> · on the IndiaNavi</Text>}
                </Text>

                <MapPreview lines={track.lines} bounds={track.bounds} margin={margin} tileUrlTemplate={tileUrlTemplate} />

                <View style={[styles.row, styles.wrap]}>
                  {ZOOM_LEVELS.map((zoom, index) => (
                    <View key={zoom} style={styles.legend}>
                      <View style={[styles.legendFrame, { borderColor: areaColor(index) }]} />
                      <Text>
                        Zoom {zoom}: {countTiles(track.bounds, margin, zoom)} tiles, margin {zoomMargin(margin, zoom)}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.centered}>
                  {tiles.length} tiles from {tileServerName(tileUrlTemplate)}, {megabytes(tiles.length * RAW_TILE_BYTES)} on the SD card
                </Text>

                <View style={styles.row}>
                  <Text>Margin: {margin} tiles</Text>
                  <Button title="−" onPress={() => changeMargin(-1)} disabled={loading || margin === 0} />
                  <Button title="+" onPress={() => changeMargin(1)} disabled={loading} />
                </View>

                {loading ? (
                  <>
                    <View style={styles.progress}>
                      <View style={[styles.progressBar, { width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }]} />
                    </View>
                    <View style={styles.row}>
                      <Text>
                        {progress.done}/{progress.total} tiles
                        {progress.failed > 0 && `, ${progress.failed} failed`}
                      </Text>
                      <Button title="Cancel" onPress={() => abort.current?.abort()} />
                    </View>
                  </>
                ) : (
                  <Button
                    title={prepared?.failed ? 'Retry failed tiles' : 'Prepare SD card files'}
                    onPress={prepare}
                  />
                )}

                {prepared && (
                  <Text style={prepared.failed ? styles.error : styles.success}>
                    {prepared.failed
                      ? `${prepared.failed} tiles could not be loaded (${prepared.reason}).`
                      : `${prepared.files.length} files (${megabytes(prepared.bytes)}) are ready for the transfer to the IndiaNavi.`}
                  </Text>
                )}
                {prepared && !loading && (
                  <Button title="Transfer to IndiaNavi" onPress={() => setScreen('transfer')} />
                )}
              </>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.centered}>Open a GPX file or choose one of your tracks to see the area of the map.</Text>
                <Button title="Open GPX" onPress={() => openGpx(pickGpxFile)} />
              </View>
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
    backgroundColor: '#fff',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  name: {
    fontWeight: 'bold',
    textAlign: 'center',
  },
  onDevice: {
    fontWeight: 'normal',
    color: '#1565c0',
  },
  centered: {
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  wrap: {
    flexWrap: 'wrap',
    justifyContent: 'center',
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
    borderWidth: 2,
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
    textAlign: 'center',
  },
  success: {
    color: '#2e7d32',
    textAlign: 'center',
  },
});
