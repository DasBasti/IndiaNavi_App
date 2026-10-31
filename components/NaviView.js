import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, PixelRatio, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { BORDER, colors } from '../theme';
import { DISPLAY_COLORS } from '../modules/map_color';
import {
  CENTER_ANCHOR, SCREEN_HEIGHT, SCREEN_WIDTH, centerOfScreen, naviZooms, renderNaviScreen,
} from '../modules/navi_screen';
import { encodePalettePng, pngDataUri } from '../modules/png';
import { FramebufferView, dropFrame, setFrame } from '../modules/indianavi-mapsforge';
import { usePhoneStatus } from '../modules/phone_status';
import { scaleBar } from '../modules/zoom_levels';

// the screen is shown with the colors of the display, they are darker than the pure colors
const PALETTE = DISPLAY_COLORS.map((color) => color.panel);

// frame of the device around the display
const BEZEL = 10;

// The IndiaNavi on the phone: its map screen as the device draws it from the vector maps (the checked maps, which are
// also the maps for its SD card), with the position, battery and GPS satellites of the phone. The button switches
// between the two zoom levels (chosen in the app) like the button of the device.
// While following is set the position stays in the middle of the screen. Dragging scrolls the map away: view is
// { lon, lat } of the middle of the screen then, onViewChange gets the new one and onFollowingChange ends and starts the
// following.
// A track (lines) is drawn with its height graph.
// readTile reads a raw tile ({ zoom, x, y }) the device would show where no vector map covers the screen.
export default function NaviView({ maps, readTile, view, onViewChange, following, onFollowingChange, zoomLevels, zoomIndex, onZoomChange, track, trackColor }) {
  const [size, setSize] = useState(null);
  // { base, x, y } while the map is dragged: the map at the start of it and the display pixels it moved since then
  const [drag, setDrag] = useState(null);
  const { position, battery, satellites } = usePhoneStatus();
  const latest = useRef({});

  // the display keeps its proportions in the space it gets
  const width = size ? Math.max(Math.floor(Math.min(size.width - 2 * BEZEL, (size.height - 2 * BEZEL) * SCREEN_WIDTH / SCREEN_HEIGHT)), 1) : 0;
  const height = Math.round(width * SCREEN_HEIGHT / SCREEN_WIDTH);
  // phone pixels per display pixel
  const factor = width / SCREEN_WIDTH;
  const levels = naviZooms(zoomLevels);
  const zoom = levels[zoomIndex] ?? levels[0];
  const { lat, lon } = following && position !== null ? position : view;
  latest.current = { base: { lat, lon, ...CENTER_ANCHOR }, view, zoom, factor, onViewChange, onFollowingChange };

  // Every move would draw the screen, so the moves are drawn when the last drawing is done
  const frameRequest = useRef(null);
  const moved = useRef(null);
  const cancelFrame = () => {
    cancelAnimationFrame(frameRequest.current);
    frameRequest.current = null;
  };
  useEffect(() => cancelFrame, []);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      moved.current = { base: latest.current.base, x: 0, y: 0 };
      setDrag(moved.current);
    },
    onPanResponderMove: (event, { dx, dy }) => {
      const { factor: f } = latest.current;
      moved.current = { base: moved.current.base, x: Math.round(dx / f), y: Math.round(dy / f) };
      if (frameRequest.current === null) {
        frameRequest.current = requestAnimationFrame(() => {
          frameRequest.current = null;
          setDrag(moved.current);
        });
      }
    },
    onPanResponderRelease: (event, { dx, dy }) => {
      cancelFrame();
      const { factor: f, view: current, zoom: z, onViewChange: change, onFollowingChange: follow } = latest.current;
      const { base } = moved.current;
      const x = Math.round(dx / f);
      const y = Math.round(dy / f);
      setDrag(null);
      if (x !== 0 || y !== 0) {
        change({ ...current, ...centerOfScreen({ ...base, zoom: z, anchorX: base.anchorX + x, anchorY: base.anchorY + y }) });
        follow(false);
      }
    },
    onPanResponderTerminate: () => {
      cancelFrame();
      setDrag(null);
    },
  })).current;

  // Without the native view a new PNG takes seconds, so the picture itself moves while the map is dragged
  const shown = drag
    ? (FramebufferView
      ? { ...drag.base, anchorX: drag.base.anchorX + drag.x, anchorY: drag.base.anchorY + drag.y }
      : drag.base)
    : latest.current.base;

  // the screen is drawn again after every change, drawing a map takes some 10 to a few 100 ms
  const screen = useMemo(
    () => renderNaviScreen({
      maps, readTile, lat: shown.lat, lon: shown.lon, anchorX: shown.anchorX, anchorY: shown.anchorY, position, zoomLevels, zoomIndex,
      track, trackColor, battery, satellites,
    }),
    [maps, readTile, shown.lat, shown.lon, shown.anchorX, shown.anchorY, position, zoomLevels, zoomIndex, track, trackColor, battery, satellites]
  );

  // In a build of the app the pixels go to a native view as they are. Without it (web, Expo Go) they are enlarged into
  // a PNG, so they stay sharp, which takes a few seconds on a phone.
  const frameKey = useId();
  const frames = useRef(0);
  const version = useMemo(() => {
    if (FramebufferView) {
      setFrame(frameKey, screen.fb.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, PALETTE);
    }
    return ++frames.current;
  }, [screen, frameKey]);
  useEffect(() => () => dropFrame(frameKey), [frameKey]);
  const scale = Math.min(Math.max(Math.ceil(factor * PixelRatio.get()), 1), 4);
  const uri = useMemo(
    () => (FramebufferView ? null : pngDataUri(encodePalettePng(screen.fb.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, PALETTE, scale))),
    [screen, scale]
  );

  return (
    <View style={styles.container}>
      <View
        style={styles.area}
        onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
        {width > 0 && (
          <View style={[styles.device, { width: width + 2 * BEZEL, height: height + 2 * BEZEL }]}>
            <View style={[styles.display, { width, height }]} {...panResponder.panHandlers}>
              {FramebufferView
                ? <FramebufferView frameKey={frameKey} version={version} style={{ width, height }} />
                : (
                  <Image
                    source={{ uri }}
                    style={{ width, height, transform: [{ translateX: (drag?.x ?? 0) * factor }, { translateY: (drag?.y ?? 0) * factor }] }}
                    fadeDuration={0}
                  />
                )}
            </View>
          </View>
        )}
      </View>
      {screen.error && (
        <Text style={styles.error}>The map can not be read: {screen.error.message}</Text>
      )}
      {!screen.error && screen.source === 'tiles' && (
        <Text style={styles.note}>
          {screen.tiles > 0
            ? 'No vector map covers this place, the IndiaNavi shows the tiles of the converter here.'
            : 'No vector map and no tiles for this place, the IndiaNavi shows "Not Found" here.'}
        </Text>
      )}
      <View style={styles.buttons}>
        <Button
          title={`Scale ${scaleBar(zoom, lat)?.text} ⇄ ${scaleBar(levels[(zoomIndex + 1) % levels.length], lat)?.text}`}
          onPress={() => onZoomChange((zoomIndex + 1) % levels.length)}
          variant="plain"
          compact
        />
        {!following && (
          <Button title="My position" onPress={() => onFollowingChange(true)} disabled={position === null} variant="plain" compact />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 8,
  },
  area: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  device: {
    padding: BEZEL - BORDER,
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  display: {
    overflow: 'hidden',
    backgroundColor: colors.paper,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  note: {
    fontSize: 13,
    textAlign: 'center',
    color: colors.ink,
  },
  error: {
    fontSize: 13,
    textAlign: 'center',
    color: colors.red,
  },
});
