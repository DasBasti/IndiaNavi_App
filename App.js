import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import Button from './components/Button';
import FilterScreen from './components/FilterScreen';
import MapPreview, { areaColor } from './components/MapPreview';
import TileServerSetting from './components/TileServerSetting';

import { isFileUrl, pickGpxFile, readGpxFile } from './modules/gpx_file';
import { parse } from './modules/gpx_parser';
import { DEFAULT_FILTER } from './modules/map_color';
import { deleteTiles, listSdCardFiles, trackFile, writeFile } from './modules/sd_card';
import { loadSettings, saveSettings } from './modules/settings';
import { loadTiles } from './modules/tile_loader';
import { DEFAULT_TILE_URL, tileServerName } from './modules/tile_source';
import { DEFAULT_MARGIN, RAW_TILE_BYTES, ZOOM_LEVELS, calculateBoundaries, countTiles, lat2tile, listTiles, lon2tile, trackLines, zoomMargin } from './modules/tiles';

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Dahner Felsenland, shown in the filter screen as long as no GPX file is open
const DEFAULT_PREVIEW_POSITION = { lon: 7.765, lat: 49.143 };

const isFilter = (filter) =>
  Array.isArray(filter) && filter.length > 0 &&
  filter.every(({ rgb, colors }) => Array.isArray(rgb) && rgb.length === 3 && Array.isArray(colors) && colors.length > 0);

export default function App() {
  // { name, text, lines, bounds } of the opened GPX file
  const [track, setTrack] = useState(null);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [settings, setSettings] = useState(loadSettings);
  const tileUrlTemplate = settings.tileUrl ?? DEFAULT_TILE_URL;
  const filter = isFilter(settings.filter) ? settings.filter : DEFAULT_FILTER;
  // 'main' or 'filter'
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

  const openGpx = useCallback(async (load) => {
    try {
      const file = await load();
      if (file === null) {
        return;
      }
      const lines = trackLines(parse(file.text));
      const bounds = calculateBoundaries(lines);
      if (bounds === null) {
        throw new Error(`${file.name} has no track or route`);
      }
      abort.current?.abort();
      setScreen('main');
      setError(null);
      setPrepared(null);
      setTrack({ ...file, lines, bounds });
    } catch (e) {
      setError(`Could not open GPX: ${e.message}`);
    }
  }, []);

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
      const newSettings = { ...settings, ...changes };
      saveSettings(newSettings);
      setSettings(newSettings);
      setError(null);
      setPrepared(null);
    } catch (e) {
      setError(`Could not change the settings: ${e.message}`);
    }
  };

  const changeTileUrl = (tileUrl) => changeTileSettings({ tileUrl });

  const changeFilter = (newFilter) =>
    changeTileSettings({ filter: newFilter === DEFAULT_FILTER ? undefined : newFilter });

  // the Android back button leaves the filter screen
  useEffect(() => {
    if (screen === 'main') {
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
        {screen === 'filter' ? (
          <FilterScreen
            filter={filter}
            tileUrlTemplate={tileUrlTemplate}
            startTile={previewTile()}
            onApply={changeFilter}
            onBack={() => setScreen('main')}
          />
        ) : (
          <>
            <View style={styles.row}>
              <Text style={styles.title}>IndiaNavi</Text>
              <Button title="Open GPX" onPress={() => openGpx(pickGpxFile)} disabled={loading} />
              <Button title="Filter" onPress={() => setScreen('filter')} disabled={loading} />
            </View>

            <TileServerSetting url={tileUrlTemplate} onChange={changeTileUrl} disabled={loading} />

            {error && <Text style={styles.error}>{error}</Text>}

            {track ? (
              <>
                <Text style={styles.name} numberOfLines={1}>{track.name}</Text>

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
              </>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.centered}>Open a GPX file to see the area of the map.</Text>
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
  centered: {
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
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
