import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, PixelRatio, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { BORDER, colors } from '../theme';
import { DISPLAY_COLORS } from '../modules/map_color';
import { NAVI_ZOOMS, SCREEN_HEIGHT, SCREEN_WIDTH, renderNaviScreen } from '../modules/navi_screen';
import { encodePalettePng, pngDataUri } from '../modules/png';
import { lat2world, lon2world, world2lat, world2lon } from '../modules/tiles';

// the screen is shown with the colors of the display, they are darker than the pure colors
const PALETTE = DISPLAY_COLORS.map((color) => color.panel);

// frame of the device around the display
const BEZEL = 10;

// The IndiaNavi on the phone: its map screen as the device draws it from the vector map. Dragging moves the
// simulated GPS position, the button switches between the 100 m and the 500 m scale like the button of the device.
// view is { lon, lat } of the position, onViewChange gets the new one. A track (lines) is drawn with its height graph,
// fitKey moves the position to the start of the track once.
export default function NaviView({ map, view, onViewChange, zoomIndex, onZoomChange, track, fitKey, trackColor }) {
  const [size, setSize] = useState(null);
  // display pixels the screen is dragged by the finger, committed to the position when it is released
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const latest = useRef({});

  // the display keeps its proportions in the space it gets
  const width = size ? Math.max(Math.floor(Math.min(size.width - 2 * BEZEL, (size.height - 2 * BEZEL) * SCREEN_WIDTH / SCREEN_HEIGHT)), 1) : 0;
  const height = Math.round(width * SCREEN_HEIGHT / SCREEN_WIDTH);
  // phone pixels per display pixel
  const factor = width / SCREEN_WIDTH;
  latest.current = { view, onViewChange, factor, zoom: NAVI_ZOOMS[zoomIndex].zoom };

  const move = (dx, dy) => {
    const { view: current, onViewChange: change, factor: f, zoom } = latest.current;
    setOffset({ x: 0, y: 0 });
    if ((dx === 0 && dy === 0) || f === 0) {
      return;
    }
    const world = 256 * 2 ** zoom;
    const x = lon2world(current.lon) - dx / f / world;
    const y = Math.min(Math.max(lat2world(current.lat) - dy / f / world, 0), 1);
    change({ ...current, lon: world2lon(x), lat: world2lat(y) });
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (event, { dx, dy }) => setOffset({ x: dx, y: dy }),
    onPanResponderRelease: (event, { dx, dy }) => move(dx, dy),
    onPanResponderTerminate: () => setOffset({ x: 0, y: 0 }),
  })).current;

  // a track that is shown starts at its first point, like a walk does
  const fitted = useRef(null);
  useEffect(() => {
    const first = track?.lines?.[0]?.[0];
    if (!first || fitted.current === fitKey) {
      return;
    }
    fitted.current = fitKey;
    onViewChange({ ...latest.current.view, lon: first[0], lat: first[1] });
  }, [track, fitKey, onViewChange]);

  // the screen is drawn again after every change, drawing a map takes some 10 to a few 100 ms
  const screen = useMemo(
    () => renderNaviScreen({ map, lat: view.lat, lon: view.lon, zoomIndex, track, trackColor }),
    [map, view.lat, view.lon, zoomIndex, track, trackColor]
  );

  // the pixels are enlarged before they are shown, so they stay sharp
  const scale = Math.min(Math.max(Math.ceil(factor * PixelRatio.get()), 1), 4);
  const uri = useMemo(
    () => pngDataUri(encodePalettePng(screen.fb.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, PALETTE, scale)),
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
              <Image
                source={{ uri }}
                style={{ width, height, transform: [{ translateX: offset.x }, { translateY: offset.y }] }}
                fadeDuration={0}
              />
            </View>
          </View>
        )}
      </View>
      {screen.error && (
        <Text style={styles.error}>The map can not be read: {screen.error.message}</Text>
      )}
      {map && !screen.error && screen.tiles === 0 && (
        <Text style={styles.note}>The position is outside of the vector map, the IndiaNavi shows no map here.</Text>
      )}
      <Button
        title={`Scale ${NAVI_ZOOMS[zoomIndex].text} ⇄ ${NAVI_ZOOMS[(zoomIndex + 1) % NAVI_ZOOMS.length].text}`}
        onPress={() => onZoomChange((zoomIndex + 1) % NAVI_ZOOMS.length)}
        variant="plain"
        compact
      />
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
