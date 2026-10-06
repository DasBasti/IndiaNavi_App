import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';

import Button from './Button';
import { colors } from '../theme';
import { tileUrl } from '../modules/tile_source';
import { ZOOM_LEVELS, lat2world, lon2world, pointBounds, tileArea, world2lat, world2lon } from '../modules/tiles';

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 17;
// the track is drawn this far outside of the screen, so it is there while the map is dragged
const PAD = TILE_SIZE;
// distance of two fingers has to change by this factor to zoom one level
const PINCH_STEP = 1.6;
const CROSS = 14;

const AREA_COLORS = [colors.blue, colors.ink];

// Color of the frame for the zoom level at the given position in ZOOM_LEVELS
export const areaColor = (index) => AREA_COLORS[index % AREA_COLORS.length];

const clampZoom = (zoom) => Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);

const areasOf = (bounds, margin) => ZOOM_LEVELS.map((zoom) => tileArea(bounds, margin, zoom));

// Map to move around with one finger and to zoom with two fingers or the buttons.
// view is { lon, lat, zoom } of the center, onViewChange gets the new view after every gesture.
// With lines (and the bounds of them) the frames show the area of the track, fitKey fits the view to them once.
// Without lines the area is around the cross in the middle of the map.
export default function MapView({ view, onViewChange, lines, bounds, fitKey, margin, tileUrlTemplate }) {
  const [size, setSize] = useState(null);
  // pixels the map is dragged by the finger, committed to the view when it is released
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const latest = useRef({});
  latest.current = { view, onViewChange };
  const gesture = useRef({ pinch: null, baseX: 0, baseY: 0 });

  const move = (dx, dy, zoomChange = 0) => {
    const { view: current, onViewChange: change } = latest.current;
    setOffset({ x: 0, y: 0 });
    if (dx === 0 && dy === 0 && zoomChange === 0) {
      return;
    }
    const world = TILE_SIZE * 2 ** current.zoom;
    const x = lon2world(current.lon) - dx / world;
    const y = Math.min(Math.max(lat2world(current.lat) - dy / world, 0), 1);
    change({ lon: world2lon(x), lat: world2lat(y), zoom: clampZoom(current.zoom + zoomChange) });
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      gesture.current = { pinch: null, baseX: 0, baseY: 0 };
    },
    onPanResponderMove: (event, { dx, dy }) => {
      const touches = event.nativeEvent.touches;
      const g = gesture.current;
      if (touches.length >= 2) {
        const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
        if (g.pinch === null) {
          g.pinch = distance;
        } else if (distance > g.pinch * PINCH_STEP || distance < g.pinch / PINCH_STEP) {
          const zoomChange = distance > g.pinch ? 1 : -1;
          g.pinch = distance;
          move(dx - g.baseX, dy - g.baseY, zoomChange);
          g.baseX = dx;
          g.baseY = dy;
        }
        return;
      }
      g.pinch = null;
      setOffset({ x: dx - g.baseX, y: dy - g.baseY });
    },
    onPanResponderRelease: (event, { dx, dy }) => move(dx - gesture.current.baseX, dy - gesture.current.baseY),
    onPanResponderTerminate: () => setOffset({ x: 0, y: 0 }),
  })).current;

  const world = TILE_SIZE * 2 ** view.zoom;
  const centerX = lon2world(view.lon);
  const centerY = lat2world(view.lat);

  // the area of the track in world positions, fixed while the map is moved
  const trackAreas = useMemo(() => (bounds ? areasOf(bounds, margin) : null), [bounds, margin]);

  // fit the view to the area of a track when it is shown
  const fitted = useRef(null);
  useEffect(() => {
    if (!trackAreas || size === null) {
      fitted.current = null;
      return;
    }
    if (fitted.current === fitKey) {
      return;
    }
    fitted.current = fitKey;
    const west = Math.min(...trackAreas.map((area) => area.west));
    const east = Math.max(...trackAreas.map((area) => area.east));
    const north = Math.min(...trackAreas.map((area) => area.north));
    const south = Math.max(...trackAreas.map((area) => area.south));
    const scale = Math.min(size.width / (east - west), size.height / (south - north));
    onViewChange({
      lon: world2lon((west + east) / 2),
      lat: world2lat((north + south) / 2),
      zoom: clampZoom(Math.floor(Math.log2(scale / TILE_SIZE))),
    });
  }, [trackAreas, size, fitKey, onViewChange]);

  // tiles and track, they are moved as one while the map is dragged
  const content = useMemo(() => {
    if (size === null) {
      return null;
    }
    const x = (worldX) => size.width / 2 + (worldX - centerX) * world;
    const y = (worldY) => size.height / 2 + (worldY - centerY) * world;

    const count = 2 ** view.zoom;
    const reach = (pixels) => pixels / world;
    const tiles = [];
    const firstX = Math.floor((centerX - reach(size.width / 2 + TILE_SIZE)) * count);
    const lastX = Math.floor((centerX + reach(size.width / 2 + TILE_SIZE)) * count);
    const firstY = Math.max(Math.floor((centerY - reach(size.height / 2 + TILE_SIZE)) * count), 0);
    const lastY = Math.min(Math.floor((centerY + reach(size.height / 2 + TILE_SIZE)) * count), count - 1);
    for (let tx = firstX; tx <= lastX; tx++) {
      for (let ty = firstY; ty <= lastY; ty++) {
        const left = Math.round(x(tx / count));
        const top = Math.round(y(ty / count));
        tiles.push({
          key: `${view.zoom}/${tx}/${ty}`,
          uri: tileUrl(tileUrlTemplate, { zoom: view.zoom, x: ((tx % count) + count) % count, y: ty }),
          left,
          top,
          width: Math.round(x((tx + 1) / count)) - left,
          height: Math.round(y((ty + 1) / count)) - top,
        });
      }
    }

    // points of the track that fall on the same pixel are drawn once
    const tracks = (lines ?? []).map((line) => {
      const points = [];
      let last = null;
      for (const [lon, lat] of line) {
        const point = `${x(lon2world(lon)) + PAD | 0},${y(lat2world(lat)) + PAD | 0}`;
        if (point !== last) {
          points.push(point);
          last = point;
        }
      }
      return points.join(' ');
    });
    return { tiles, tracks };
  }, [size, view.zoom, centerX, centerY, world, lines, tileUrlTemplate]);

  // frames of the areas and the cross follow the finger, so they are not part of the content
  const frames = useMemo(() => {
    if (size === null) {
      return [];
    }
    const liveX = centerX - offset.x / world;
    const liveY = centerY - offset.y / world;
    const areas = trackAreas ?? areasOf(pointBounds(world2lon(liveX), world2lat(Math.min(Math.max(liveY, 0), 1))), margin);
    const x = (worldX) => size.width / 2 + (worldX - liveX) * world;
    const y = (worldY) => size.height / 2 + (worldY - liveY) * world;
    return areas.map((area) => ({
      x: x(area.west),
      y: y(area.north),
      width: x(area.east) - x(area.west),
      height: y(area.south) - y(area.north),
    }));
  }, [size, trackAreas, margin, centerX, centerY, world, offset]);

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}
      {...panResponder.panHandlers}>
      {content && (
        <View style={[styles.content, { transform: [{ translateX: offset.x }, { translateY: offset.y }] }]} pointerEvents="none">
          {content.tiles.map(({ key, uri, ...position }) => (
            <Image
              key={key}
              source={{ uri, headers: { 'User-Agent': 'IndiaNaviApp/1.0' } }}
              style={[styles.tile, position]}
            />
          ))}
          {content.tracks.length > 0 && (
            <Svg
              width={size.width + 2 * PAD}
              height={size.height + 2 * PAD}
              style={{ position: 'absolute', left: -PAD, top: -PAD }}>
              {content.tracks.map((points, index) => (
                <Polyline
                  key={index}
                  points={points}
                  fill="none"
                  stroke={colors.red}
                  strokeWidth={4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            </Svg>
          )}
        </View>
      )}
      {size && (
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {frames.map((frame, index) => (
            <Rect
              key={ZOOM_LEVELS[index]}
              {...frame}
              fill="none"
              stroke={areaColor(index)}
              strokeWidth={2}
            />
          ))}
          {!bounds && (
            <>
              <Line x1={size.width / 2 - CROSS} x2={size.width / 2 + CROSS} y1={size.height / 2} y2={size.height / 2} stroke={colors.red} strokeWidth={3} />
              <Line y1={size.height / 2 - CROSS} y2={size.height / 2 + CROSS} x1={size.width / 2} x2={size.width / 2} stroke={colors.red} strokeWidth={3} />
            </>
          )}
        </Svg>
      )}
      <View style={styles.zoom}>
        <Button title="+" onPress={() => move(0, 0, 1)} disabled={view.zoom >= MAX_ZOOM} variant="plain" compact />
        <Button title="−" onPress={() => move(0, 0, -1)} disabled={view.zoom <= MIN_ZOOM} variant="plain" compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  content: {
    ...StyleSheet.absoluteFillObject,
  },
  tile: {
    position: 'absolute',
  },
  zoom: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    gap: 8,
  },
});
