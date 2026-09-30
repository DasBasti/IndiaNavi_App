import { useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Polyline, Rect } from 'react-native-svg';

import { tileUrl } from '../modules/tile_source';
import { ZOOM_LEVELS, lat2world, lon2world, tileArea } from '../modules/tiles';

const TILE_SIZE = 256;

const AREA_COLORS = ['#1565c0', '#6a1b9a'];

// Color of the frame for the zoom level at the given position in ZOOM_LEVELS
export const areaColor = (index) => AREA_COLORS[index % AREA_COLORS.length];

// Shows the area the tiles are loaded for, with the track and a frame for every zoom level.
// The map is loaded from the server of the tile URL template.
export default function MapPreview({ lines, bounds, margin, tileUrlTemplate }) {
  const [size, setSize] = useState(null);

  const areas = useMemo(
    () => ZOOM_LEVELS.map((zoom) => tileArea(bounds, margin, zoom)),
    [bounds, margin]
  );

  const map = useMemo(() => {
    if (size === null) {
      return null;
    }

    // the preview shows everything that gets loaded on any zoom level
    const west = Math.min(...areas.map((area) => area.west));
    const east = Math.max(...areas.map((area) => area.east));
    const north = Math.min(...areas.map((area) => area.north));
    const south = Math.max(...areas.map((area) => area.south));

    // pixels the whole world would have in the preview
    const scale = Math.min(size.width / (east - west), size.height / (south - north));
    const x = (world) => Math.round((world - west) * scale);
    const y = (world) => Math.round((world - north) * scale);

    // zoom level where a tile is shown with at most its own size,
    // but not above the zoom levels we load, so every tile server can deliver it
    const zoom = Math.min(Math.max(Math.ceil(Math.log2(scale / TILE_SIZE)), 0), Math.max(...ZOOM_LEVELS));
    const count = 2 ** zoom;
    const tiles = [];
    for (let tx = Math.floor(west * count); tx < east * count; tx++) {
      for (let ty = Math.floor(north * count); ty < south * count; ty++) {
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          uri: tileUrl(tileUrlTemplate, { zoom, x: tx, y: ty }),
          left: x(tx / count),
          top: y(ty / count),
          width: x((tx + 1) / count) - x(tx / count),
          height: y((ty + 1) / count) - y(ty / count),
        });
      }
    }

    const frames = areas.map((area) => ({
      x: x(area.west),
      y: y(area.north),
      width: x(area.east) - x(area.west),
      height: y(area.south) - y(area.north),
    }));

    // points of the track that fall on the same pixel are drawn once
    const tracks = lines.map((line) => {
      const points = [];
      let last = null;
      for (const [lon, lat] of line) {
        const point = `${x(lon2world(lon))},${y(lat2world(lat))}`;
        if (point !== last) {
          points.push(point);
          last = point;
        }
      }
      return points.join(' ');
    });

    return { width: x(east), height: y(south), tiles, frames, tracks };
  }, [size, areas, lines, tileUrlTemplate]);

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
      {map && (
        <View style={[styles.map, { width: map.width, height: map.height }]}>
          {map.tiles.map(({ key, uri, ...position }) => (
            <Image
              key={key}
              source={{ uri, headers: { 'User-Agent': 'IndiaNaviApp/1.0' } }}
              style={[styles.tile, position]}
            />
          ))}
          <Svg width={map.width} height={map.height} style={StyleSheet.absoluteFill}>
            {map.frames.map((frame, index) => (
              <Rect
                key={ZOOM_LEVELS[index]}
                {...frame}
                fill="none"
                stroke={areaColor(index)}
                strokeWidth={2}
              />
            ))}
            {map.tracks.map((points, index) => (
              <Polyline
                key={index}
                points={points}
                fill="none"
                stroke="#d32f2f"
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </Svg>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  map: {
    backgroundColor: '#ddd',
    overflow: 'hidden',
  },
  tile: {
    position: 'absolute',
  },
});
