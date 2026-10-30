import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import BluetoothIcon from './components/BluetoothIcon';
import BluetoothScreen from './components/BluetoothScreen';
import Button from './components/Button';
import Icon from './components/Icon';
import FilterScreen from './components/FilterScreen';
import RecordingsScreen from './components/RecordingsScreen';
import TracksScreen from './components/TracksScreen';
import TransferScreen from './components/TransferScreen';
import MapSearch from './components/MapSearch';
import MapsScreen from './components/MapsScreen';
import MapView, { areaColor } from './components/MapView';
import NaviView from './components/NaviView';
import { Badge, Card, Hint, Message, PaletteStrip, ProgressWindow } from './components/ui';

import { isFileUrl, pickGpxFile, readGpxFile } from './modules/gpx_file';
import { parse } from './modules/gpx_parser';
import { DEFAULT_FILTER, isFilter } from './modules/map_color';
import { deleteTiles, deleteTrack, hasFile, listSdCardFiles, tileFile, trackFile, writeFile } from './modules/sd_card';
import { autoConnect } from './modules/ble/background';
import { getPhonePosition } from './modules/ble/phone_position';
import { TRACK_COLOR_DEFAULT, TRACK_COLOR_MAX } from './modules/ble/protocol';
import { loadSettings, saveSettings } from './modules/settings';
import { BORDER, PAGE_PADDING, SHADOW, colors, displayColor, font, shadow } from './theme';
import { loadTiles, reconvertTiles } from './modules/tile_loader';
import { DEFAULT_TILE_URL, tileServerName } from './modules/tile_source';
import { DEFAULT_MARGIN, RAW_TILE_BYTES, ZOOM_LEVELS, calculateBoundaries, countTiles, lat2tile, listTiles, lon2tile, pointBounds, trackLength, trackLines, zoomMargin } from './modules/tiles';
import { addTrack, listTracks, readTrack, touchTrack } from './modules/track_library';
import { trackDeleted as recordingTrackDeleted } from './modules/recording_library';
import { mapCenter, mapCovers } from './modules/mapsforge';
import { displayName } from './modules/map_listing';
import { NAVI_ZOOMS } from './modules/navi_screen';
import { listMaps, openMapFile } from './modules/vector_maps';

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Dahner Felsenland, shown as long as there is no track, the map was not moved and the phone has no position
const DEFAULT_VIEW = { lon: 7.765, lat: 49.143, zoom: 13 };

// A raw tile of the converter on the phone, the IndiaNavi shows the tiles where no vector map covers the screen
const readTile = (tile) => {
  try {
    const file = tileFile(tile);
    return hasFile(file) ? file.bytesSync() : null;
  } catch {
    return null;
  }
};

const isView = (view) =>
  [view?.lon, view?.lat, view?.zoom].every(Number.isFinite);

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

// Tablets in landscape show the map on the left and the controls on the right
const SIDE_BY_SIDE_WIDTH = 720;

// Tile of the main navigation: icon with a label below. The tile of the mode the main screen shows is selected.
const NavTile = ({ label, children, onPress, disabled, selected }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityState={{ selected: !!selected }}
    style={({ pressed }) => [
      styles.navTile,
      selected && styles.navSelected,
      disabled ? styles.navDisabled : pressed ? styles.navPressed : shadow,
    ]}>
    <View style={styles.navIcon}>{children}</View>
    <Text style={styles.navLabel} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
  </Pressable>
);

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const tileUrlTemplate = settings.tileUrl ?? DEFAULT_TILE_URL;
  const filter = isFilter(settings.filter) ? settings.filter : DEFAULT_FILTER;
  // the track looks like on the IndiaNavi, the color comes from it over Bluetooth
  const trackInk = Number.isInteger(settings.trackColor) && settings.trackColor >= 0 && settings.trackColor <= TRACK_COLOR_MAX
    ? settings.trackColor
    : TRACK_COLOR_DEFAULT;
  const trackColor = displayColor(trackInk);
  const mode = settings.mode === 'converter' ? 'converter' : 'navi';
  const naviZoom = Number.isInteger(settings.naviZoom) && NAVI_ZOOMS[settings.naviZoom] ? settings.naviZoom : 0;
  // { id, name, text, lines, bounds } of the selected track
  const [track, setTrack] = useState(() => selectedTrack(settings.trackId));
  // { lon, lat, zoom } of the map, the last position is remembered
  const [view, setView] = useState(() => (isView(settings.view) ? settings.view : DEFAULT_VIEW));
  const latestView = useRef(view);
  latestView.current = view;
  // set when the map is moved, a position of the phone that arrives later does not move it back
  const viewMoved = useRef(false);
  // the simulated IndiaNavi has the position of the phone in its middle until its map is scrolled
  const [naviFollowing, setNaviFollowing] = useState(true);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  // 'main', 'tracks', 'filter', 'maps', 'transfer', 'connection' or 'recordings'. The main screen shows the IndiaNavi
  // as it draws the vector map, or the converter of the tiles for the device (settings.mode).
  const [screen, setScreen] = useState('main');
  // the screen the file transfer goes back to
  const [transferBack, setTransferBack] = useState('main');
  // the transfer screen sends the prepared files as soon as it is connected
  const [autoTransfer, setAutoTransfer] = useState(false);
  const [error, setError] = useState(null);
  // { done, total, failed } while the tiles are loaded or converted
  const [progress, setProgress] = useState(null);
  // title of the progress window
  const [progressTitle, setProgressTitle] = useState('');
  // { files, bytes, failed } when the files are ready for the transfer
  const [prepared, setPrepared] = useState(null);
  const abort = useRef(null);
  // the vector maps the simulated IndiaNavi draws: { maps, errors } of the checked files
  const [vectorMaps, setVectorMaps] = useState({ maps: [], errors: [] });

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

  // changes are the changed settings, or a function that returns them from the current settings
  const changeSettings = useCallback((changes) => {
    setSettings((current) => {
      const newSettings = { ...current, ...(typeof changes === 'function' ? changes(current) : changes) };
      saveSettings(newSettings);
      return newSettings;
    });
  }, []);

  // the checked vector maps are the maps for the IndiaNavi: the simulation draws them and they are sent to the
  // device. Settings of older versions had one selected map.
  const checkedMaps = useMemo(
    () => (Array.isArray(settings.vectorMaps) ? settings.vectorMaps : settings.vectorMap ? [settings.vectorMap] : []),
    [settings.vectorMaps, settings.vectorMap]
  );
  // names of the maps on the SD card of the IndiaNavi: { [name on the phone]: 'rheinl01.map' }
  const cardMaps = settings.cardMaps ?? {};
  const changeCheckedMaps = useCallback(
    (maps) => changeSettings({ vectorMaps: maps, vectorMap: undefined }),
    [changeSettings]
  );

  // the checked maps are open while they are checked. Without a track the position moves onto the maps when it is
  // outside of all of them, so the simulated IndiaNavi shows something.
  const checkedKey = checkedMaps.join('\n');
  // set when the user checks other maps, the maps that are checked when the app starts do not end the following
  const mapsChecked = useRef(false);
  const hasTrackRef = useRef(false);
  hasTrackRef.current = track !== null;
  useEffect(() => {
    const maps = [];
    const errors = [];
    for (const name of checkedKey ? checkedKey.split('\n') : []) {
      try {
        maps.push(openMapFile(name));
      } catch (e) {
        errors.push(`${displayName(name)}: ${e.message}`);
      }
    }
    setVectorMaps({ maps, errors });
    const { lat, lon } = latestView.current;
    if (maps.length > 0 && !hasTrackRef.current && !maps.some((map) => mapCovers(map.header, lat, lon))) {
      const center = mapCenter(maps[0].header);
      const newView = { ...latestView.current, lat: center.lat, lon: center.lon };
      viewMoved.current = true;
      setView(newView);
      if (mapsChecked.current) {
        setNaviFollowing(false);
      }
      changeSettings({ view: newView });
    }
    mapsChecked.current = false;
    return () => maps.forEach((map) => map.close());
  }, [checkedKey, changeSettings]);

  // the first map on the phone is checked if no map was ever checked
  useEffect(() => {
    if (!Array.isArray(settings.vectorMaps) && !settings.vectorMap) {
      const first = listMaps()[0];
      if (first) {
        changeCheckedMaps([first.name]);
      }
    }
    // only when the app starts, unchecked maps stay unchecked
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
    // a new track is shown from its first point, closing it goes back to the position
    const first = newTrack?.lines?.[0]?.[0];
    if (first) {
      const newView = { ...latestView.current, lon: first[0], lat: first[1] };
      viewMoved.current = true;
      setView(newView);
      setNaviFollowing(false);
      changeSettings({ trackId: newTrack.id, view: newView });
    } else {
      setNaviFollowing(true);
      changeSettings({ trackId: newTrack?.id });
    }
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
    recordingTrackDeleted(id);
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

  // tiles of another server are loaded again, so the tiles and their originals on the phone are deleted
  const changeTileUrl = (tileUrl) => {
    try {
      deleteTiles();
      changeSettings({ tileUrl });
      setError(null);
      setPrepared(null);
    } catch (e) {
      setError(`Could not change the settings: ${e.message}`);
    }
  };

  // the tiles on the phone are converted again from their originals. The prepared files stay valid, but tiles that are
  // already on the IndiaNavi are only replaced with Update all tiles on the Device screen.
  const changeFilter = async (newFilter) => {
    changeSettings({ filter: newFilter === DEFAULT_FILTER ? undefined : newFilter });
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgressTitle('Converting tiles');
    setProgress({ done: 0, total: 0, failed: 0 });
    try {
      const failed = await reconvertTiles(tileUrlTemplate, newFilter, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) {
        setError('Converting was cancelled, some tiles still use the old filter.');
      } else if (failed.length > 0) {
        setError(`${failed.length} tiles still use the old filter, they could not be converted (${failed[0].error.message}).`);
      }
    } catch (e) {
      setError(`Could not convert the tiles: ${e.message}`);
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setProgress(null);
      }
    }
  };

  // the Android back button leaves the tracks, filter and maps screen, the transfer and Bluetooth screens handle it
  // themselves
  useEffect(() => {
    if (screen !== 'filter' && screen !== 'tracks' && screen !== 'maps') {
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
    setProgressTitle('Loading tiles');
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

  const { width, height } = useWindowDimensions();
  const sideBySide = width > height && width >= SIDE_BY_SIDE_WIDTH;

  const mainTop = (
    <>
      <View style={styles.header}>
        <Icon name="norden" size={40} />
        <Text style={styles.title}>Wander Navi</Text>
      </View>

      <View style={styles.nav}>
        <NavTile label="Tracks" onPress={() => setScreen('tracks')} disabled={loading}>
          <Icon name="path" size={32} />
        </NavTile>
        <NavTile label="IndiaNavi" onPress={() => changeSettings({ mode: 'navi' })} disabled={loading} selected={mode === 'navi'}>
          <Icon name="norden" size={32} />
        </NavTile>
        <NavTile label="Converter" onPress={() => changeSettings({ mode: 'converter' })} disabled={loading} selected={mode === 'converter'}>
          <Icon name="SD" size={32} />
        </NavTile>
        <NavTile label="Connection" onPress={() => setScreen('connection')} disabled={loading}>
          <BluetoothIcon />
        </NavTile>
      </View>

      {error && <Message tone="red" icon="noSD">{error}</Message>}

      {track && (
        <View style={styles.trackName}>
          <Icon name="path" size={32} />
          <Text style={styles.name} numberOfLines={1}>{track.name}</Text>
          {track.id === settings.deviceTrackId && <Badge color={colors.blue}>on the IndiaNavi</Badge>}
          <Button title="×" onPress={() => showTrack(null)} disabled={loading} variant="plain" compact />
        </View>
      )}
    </>
  );

  const naviMap = vectorMaps.maps.length > 0 ? (
    <View style={styles.navi}>
      <NaviView
        maps={vectorMaps.maps}
        readTile={readTile}
        view={view}
        onViewChange={changeView}
        following={naviFollowing}
        onFollowingChange={setNaviFollowing}
        zoomIndex={naviZoom}
        onZoomChange={(index) => changeSettings({ naviZoom: index })}
        track={track}
        trackColor={trackInk}
      />
    </View>
  ) : (
    <View style={styles.noMap}>
      <Icon name="noSD" size={48} />
      <Text style={styles.noMapTitle}>No vector map</Text>
      {vectorMaps.errors.map((text) => <Message key={text} tone="red" icon="noSD">{text}</Message>)}
      <Hint style={styles.noMapHint}>
        The IndiaNavi draws its map from a Mapsforge vector map. Download the map of your region to see the device
        here as it shows your track.
      </Hint>
      <Button title="Download a vector map" icon="SD" onPress={() => setScreen('maps')} />
    </View>
  );

  const naviBottom = (
    <View style={styles.row}>
      <Icon name="SD" size={32} />
      <Text style={styles.mapName} numberOfLines={1}>
        {vectorMaps.maps.length === 0
          ? 'No vector map checked'
          : vectorMaps.maps.length === 1
            ? displayName(vectorMaps.maps[0].name)
            : `${vectorMaps.maps.length} vector maps`}
      </Text>
      <Button title="Maps" onPress={() => setScreen('maps')} variant="plain" compact />
      <Button title="Colors" onPress={() => setScreen('filter')} variant="plain" compact />
    </View>
  );

  const mainMap = mode === 'navi' ? naviMap : (
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
  );

  const mainBottom = mode === 'navi' ? naviBottom : (
    <>
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

      <Pressable
        onPress={() => setScreen('filter')}
        disabled={loading}
        accessibilityRole="button"
        style={({ pressed }) => [styles.filterButton, loading ? styles.navDisabled : pressed ? styles.navPressed : shadow]}>
        <PaletteStrip size={8} />
        <Text style={styles.navLabel}>Filter</Text>
      </Pressable>

      <View style={styles.row}>
        <Text style={styles.marginText}>Margin: {margin} tiles</Text>
        <Button title="−" onPress={() => changeMargin(-1)} disabled={loading || margin === 0} variant="plain" compact />
        <Button title="+" onPress={() => changeMargin(1)} disabled={loading} variant="plain" compact />
      </View>

      <Button
        title={prepared?.failed ? 'Retry failed tiles' : 'Prepare SD card files'}
        icon="SD"
        onPress={prepare}
        disabled={loading}
      />

      {prepared && (
        <Message tone={prepared.failed ? 'red' : 'green'} icon={prepared.failed ? 'noSD' : 'SD'}>
          {prepared.failed
            ? `${prepared.failed} tiles could not be loaded (${prepared.reason}).`
            : `${prepared.files.length} files (${megabytes(prepared.bytes)}) are ready for the transfer to the IndiaNavi.`}
        </Message>
      )}
      {prepared && !loading && (
        <Button title="Transfer to IndiaNavi" icon="WIFI_3" variant="secondary" onPress={() => {
          setAutoTransfer(true);
          setTransferBack('main');
          setScreen('transfer');
        }} />
      )}
    </>
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <ProgressWindow
          visible={loading}
          text={progressTitle}
          done={progress?.done ?? 0}
          total={progress?.total ?? 0}
          detail={progress && `${progress.done}/${progress.total} tiles${progress.failed > 0 ? `, ${progress.failed} failed` : ''}`}
          onCancel={() => abort.current?.abort()}
        />
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
            mode={mode === 'navi' ? 'vector' : 'tiles'}
            filter={filter}
            tileUrlTemplate={tileUrlTemplate}
            startTile={previewTile()}
            onApply={changeFilter}
            onTileUrlChange={changeTileUrl}
            onBack={() => setScreen('main')}
          />
        ) : screen === 'maps' ? (
          <MapsScreen
            checked={checkedMaps}
            onCheckedChange={(maps) => {
              mapsChecked.current = true;
              changeCheckedMaps(maps);
            }}
            onBack={() => setScreen('main')}
          />
        ) : screen === 'connection' ? (
          <BluetoothScreen
            device={settings.bleDevice}
            onDeviceChange={(bleDevice) => changeSettings({ bleDevice })}
            onTrackColorChange={(newTrackColor) => changeSettings({ trackColor: newTrackColor })}
            onOpenWifi={() => {
              setAutoTransfer(false);
              setTransferBack('connection');
              setScreen('transfer');
            }}
            onOpenRecordings={() => setScreen('recordings')}
            onBack={() => setScreen('main')}
          />
        ) : screen === 'recordings' ? (
          <RecordingsScreen
            device={settings.bleDevice}
            wifiDevice={settings.device ?? {}}
            onShowTrack={selectTrack}
            onOpenWifi={() => {
              setAutoTransfer(false);
              setTransferBack('recordings');
              setScreen('transfer');
            }}
            onBack={() => setScreen('connection')}
          />
        ) : screen === 'transfer' ? (
          <TransferScreen
            files={prepared?.files ?? null}
            autoStart={autoTransfer}
            device={settings.device ?? {}}
            onDeviceChange={(device) => changeSettings({ device })}
            onTransferred={() => changeSettings({ deviceTrackId: track?.id })}
            maps={vectorMaps.maps}
            cardMaps={cardMaps}
            onCardMapsChange={(update) => changeSettings((current) => ({ cardMaps: update(current.cardMaps ?? {}) }))}
            uploadRate={Number.isFinite(settings.mapUploadRate) ? settings.mapUploadRate : undefined}
            onUploadRateChange={(mapUploadRate) => changeSettings({ mapUploadRate })}
            onBack={() => setScreen(transferBack)}
          />
        ) : (
          sideBySide ? (
            <View style={styles.sideBySide}>
              {mainMap}
              <ScrollView style={styles.controls} contentContainerStyle={styles.controlsContent} keyboardShouldPersistTaps="handled">
                {mainTop}
                {mainBottom}
              </ScrollView>
            </View>
          ) : (
            <>
              {mainTop}
              {mainMap}
              {mainBottom}
            </>
          )
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
    // CONNECTION fits a quarter of a small phone
    fontSize: 11,
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
  sideBySide: {
    flex: 1,
    flexDirection: 'row',
    gap: PAGE_PADDING,
  },
  controls: {
    width: '40%',
    maxWidth: 440,
  },
  controlsContent: {
    gap: 12,
  },
  navSelected: {
    backgroundColor: colors.green,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 10,
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.yellow,
    marginRight: SHADOW,
    marginBottom: SHADOW,
  },
  navi: {
    flex: 1,
  },
  noMap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: PAGE_PADDING,
    borderWidth: BORDER,
    borderColor: colors.ink,
    borderStyle: 'dashed',
  },
  noMapTitle: {
    fontFamily: font.mono,
    fontWeight: 'bold',
    fontSize: 18,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  noMapHint: {
    textAlign: 'center',
  },
  mapName: {
    flexShrink: 1,
    fontFamily: font.mono,
    fontWeight: 'bold',
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
