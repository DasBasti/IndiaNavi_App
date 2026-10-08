import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import Button from './Button';
import TileServerSetting from './TileServerSetting';
import { Hint, Message, ScreenHeader, SectionTitle } from './ui';
import { BORDER, colors, font } from '../theme';
import { DEFAULT_FILTER, DISPLAY_COLORS, SHARE_STEPS, convertPixels, findFilterEntry } from '../modules/map_color';
import { encodePalettePng, encodeRgbPng, pngDataUri } from '../modules/png';
import { loadOriginal } from '../modules/tile_loader';
import { ZOOM_LEVELS } from '../modules/tiles';

const PADDING = 16;
const GAP = 8;

// tiles are enlarged before they are shown, so the pixels and the dithering stay sharp when zoomed in
const PREVIEW_SCALE = 4;
const MAX_ZOOM = 8;
// a touch that moves less than this is a tap that picks a pixel
const TAP_SLOP = 8;
const NO_ZOOM = { scale: 1, x: 0, y: 0 };

// the preview shows the colors like the display does, they are darker than the pure colors
const DISPLAY_PALETTE = DISPLAY_COLORS.map((color) => color.panel);

// the share of the second color changes in steps of 1/16, the dither pattern has 64 steps
const SHARE_STEP = 4 / SHARE_STEPS;

const hex = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

// part of the second display color, entries without one are a checkerboard
const share = (entry) => entry.share ?? 0.5;

const sameRgb = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const Swatch = ({ rgb, size = 28, selected, onPress }) => (
  <Pressable
    onPress={onPress}
    disabled={!onPress}
    style={[
      styles.swatch,
      { width: size, height: size, backgroundColor: hex(rgb) },
      selected && styles.swatchSelected,
    ]}
  />
);

// One entry of the filter: map color => one display color, or two display colors mixed in a dither pattern
const FilterEntry = ({ entry, highlighted, editing, onEdit, onChange, onDelete }) => (
  <View style={[styles.entry, highlighted && styles.entryHighlighted]}>
    <View style={styles.row}>
      <Swatch rgb={entry.rgb} />
      <Text style={styles.hex}>{hex(entry.rgb)}</Text>
      <Text style={styles.arrow}>→</Text>
      {entry.colors.map((color, slot) => (
        <Swatch
          key={slot}
          rgb={DISPLAY_PALETTE[color]}
          selected={editing === slot}
          onPress={() => onEdit(editing === slot ? null : slot)}
        />
      ))}
      {entry.colors.length === 1 && (
        <Pressable onPress={() => onEdit(editing === 1 ? null : 1)} style={[styles.addColor, editing === 1 && styles.swatchSelected]}>
          <Text style={styles.plus}>+</Text>
        </Pressable>
      )}
      <View style={styles.spacer} />
      {onDelete && (
        <Pressable onPress={onDelete} hitSlop={8}>
          <View style={styles.delete}>
            <Text style={styles.deleteText}>✕</Text>
          </View>
        </Pressable>
      )}
    </View>
    {entry.colors.length === 2 && (
      <View style={styles.row}>
        <Button title="−" variant="plain" compact disabled={share(entry) <= SHARE_STEP}
          onPress={() => onChange({ ...entry, share: share(entry) - SHARE_STEP })} />
        <Text style={styles.hex}>{Math.round(share(entry) * 100)}%</Text>
        <Button title="+" variant="plain" compact disabled={share(entry) >= 1 - SHARE_STEP}
          onPress={() => onChange({ ...entry, share: share(entry) + SHARE_STEP })} />
        <Text style={styles.text}>of the second color</Text>
      </View>
    )}
    {editing !== null && (
      <View style={styles.row}>
        {DISPLAY_COLORS.map((color, value) => (
          <Swatch
            key={color.name}
            rgb={color.panel}
            selected={entry.colors[editing] === value}
            onPress={() => {
              const colors = [...entry.colors];
              colors[editing] = value;
              onChange({ ...entry, colors });
            }}
          />
        ))}
        {editing === 1 && entry.colors.length === 2 && (
          <Button title="No dither" variant="plain" compact onPress={() => {
            onEdit(null);
            const { share: _, ...single } = entry;
            onChange({ ...single, colors: [entry.colors[0]] });
          }} />
        )}
      </View>
    )}
  </View>
);

// Shows a tile of the map next to its converted version and lets the user change the filter and the tile server
export default function FilterScreen({ filter, tileUrlTemplate, startTile, onApply, onTileUrlChange, onBack }) {
  const { width: windowWidth } = useWindowDimensions();
  const imageSize = Math.floor((windowWidth - 2 * PADDING - GAP) / 2);

  const [tile, setTile] = useState(startTile);
  // { uri, rgba, width, height } of the original tile
  const [image, setImage] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(filter);
  // pixel of the tile the user tapped on: { x, y, rgb }
  const [picked, setPicked] = useState(null);
  // entry and color slot whose display color is changed: { index, slot }
  const [editing, setEditing] = useState(null);
  // both tiles are zoomed and moved together: scale and the position of the zoomed tile in the frame
  const [zoom, setZoom] = useState(NO_ZOOM);
  const [scrolling, setScrolling] = useState(true);

  useEffect(() => setDraft(filter), [filter]);

  useEffect(() => {
    const controller = new AbortController();
    setImage(null);
    setError(null);
    setPicked(null);
    setZoom(NO_ZOOM);
    loadOriginal(tileUrlTemplate, tile, controller.signal)
      .then((pixels) => setImage({
        uri: pngDataUri(encodeRgbPng(pixels.rgba, pixels.width, pixels.height, PREVIEW_SCALE)),
        ...pixels,
      }))
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(`Could not load the tile: ${e.message}`);
        }
      });
    return () => controller.abort();
  }, [tile, tileUrlTemplate]);

  const converted = useMemo(() => {
    if (image === null) {
      return null;
    }
    const pixels = convertPixels(image.rgba, image.width, image.height, draft);
    return pngDataUri(encodePalettePng(pixels, image.width, image.height, DISPLAY_PALETTE, PREVIEW_SCALE));
  }, [image, draft]);

  const pickedEntry = picked && findFilterEntry(draft, ...picked.rgb);

  // frameX and frameY are the position of the tap in the frame of the tile
  const pick = (frameX, frameY) => {
    if (image === null) {
      return;
    }
    const size = imageSize * zoom.scale;
    const x = Math.min(Math.max(Math.floor((frameX - zoom.x) / size * image.width), 0), image.width - 1);
    const y = Math.min(Math.max(Math.floor((frameY - zoom.y) / size * image.height), 0), image.height - 1);
    const offset = (y * image.width + x) * 4;
    setPicked({ x, y, rgb: [image.rgba[offset], image.rgba[offset + 1], image.rgba[offset + 2]] });
    setEditing(null);
  };

  // the zoomed tile always covers the whole frame
  const limitZoom = (scale, x, y) => {
    const limited = Math.min(Math.max(scale, 1), MAX_ZOOM);
    const min = imageSize - imageSize * limited;
    return { scale: limited, x: Math.min(Math.max(x, min), 0), y: Math.min(Math.max(y, min), 0) };
  };

  const latest = useRef({});
  latest.current = { zoom, pick, limitZoom };
  // start of the gesture, rebased when the number of fingers changes:
  // { zoom, fingers, x, y, distance } and the origin of the frame on the page
  const gesture = useRef(null);

  // two fingers zoom around the point between them, one finger moves the zoomed tile, a tap picks a pixel
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: ({ nativeEvent }) => {
      setScrolling(false);
      gesture.current = {
        originX: nativeEvent.pageX - nativeEvent.locationX,
        originY: nativeEvent.pageY - nativeEvent.locationY,
        fingers: 1,
        x: nativeEvent.locationX,
        y: nativeEvent.locationY,
        distance: 0,
        zoom: latest.current.zoom,
        moved: false,
      };
    },
    onPanResponderMove: ({ nativeEvent: { touches } }) => {
      const g = gesture.current;
      const fingers = Math.min(touches.length, 2);
      const x = (fingers === 2 ? (touches[0].pageX + touches[1].pageX) / 2 : touches[0].pageX) - g.originX;
      const y = (fingers === 2 ? (touches[0].pageY + touches[1].pageY) / 2 : touches[0].pageY) - g.originY;
      const distance = fingers === 2 ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) : 0;
      if (fingers !== g.fingers) {
        Object.assign(g, { fingers, x, y, distance, zoom: latest.current.zoom });
        return;
      }
      if (fingers === 2 || Math.hypot(x - g.x, y - g.y) > TAP_SLOP) {
        g.moved = true;
      }
      if (!g.moved) {
        return;
      }
      const scale = fingers === 2 ? g.zoom.scale * distance / Math.max(g.distance, 1) : g.zoom.scale;
      const factor = scale / g.zoom.scale;
      // the point of the tile below the fingers stays below them
      setZoom(latest.current.limitZoom(scale, x - (g.x - g.zoom.x) * factor, y - (g.y - g.zoom.y) * factor));
    },
    onPanResponderRelease: () => {
      const g = gesture.current;
      setScrolling(true);
      if (!g.moved && g.fingers <= 1) {
        latest.current.pick(g.x, g.y);
      }
    },
    onPanResponderTerminate: () => setScrolling(true),
  })).current;

  const changeEntry = (index, entry) => setDraft(draft.map((old, i) => (i === index ? entry : old)));

  const deleteEntry = (index) => {
    setDraft(draft.filter((_, i) => i !== index));
    setEditing(null);
  };

  // the picked color gets an entry of its own, starting with the display colors and share it has now
  const addPickedColor = () => {
    setDraft([...draft, { ...draft[pickedEntry], rgb: picked.rgb, colors: [...draft[pickedEntry].colors] }]);
    setEditing({ index: draft.length, slot: 0 });
  };

  const move = (dx, dy) => {
    const last = 2 ** tile.zoom - 1;
    setTile({
      ...tile,
      x: Math.min(Math.max(tile.x + dx, 0), last),
      y: Math.min(Math.max(tile.y + dy, 0), last),
    });
  };

  // keeps the center of the tile when the zoom level changes
  const changeZoom = (zoom) => {
    const factor = 2 ** (zoom - tile.zoom);
    setTile({ zoom, x: Math.floor((tile.x + 0.5) * factor), y: Math.floor((tile.y + 0.5) * factor) });
  };

  const renderEntry = (index) => (
    <FilterEntry
      key={index}
      entry={draft[index]}
      highlighted={index === pickedEntry}
      editing={editing?.index === index ? editing.slot : null}
      onEdit={(slot) => setEditing(slot === null ? null : { index, slot })}
      onChange={(entry) => changeEntry(index, entry)}
      onDelete={draft.length > 1 ? () => deleteEntry(index) : null}
    />
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Conversion filter" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} scrollEnabled={scrolling}>
        <TileServerSetting url={tileUrlTemplate} onChange={onTileUrlChange} />

        <View style={styles.row}>
          {ZOOM_LEVELS.map((zoom) => (
            <Button
              key={zoom}
              title={`Zoom ${zoom}`}
              onPress={() => changeZoom(zoom)}
              variant={zoom === tile.zoom ? 'primary' : 'plain'}
              compact
            />
          ))}
        </View>
        <View style={styles.row}>
          <Button title="←" onPress={() => move(-1, 0)} variant="plain" compact />
          <Button title="↑" onPress={() => move(0, -1)} variant="plain" compact />
          <Button title="↓" onPress={() => move(0, 1)} variant="plain" compact />
          <Button title="→" onPress={() => move(1, 0)} variant="plain" compact />
          <Text style={styles.hex}>{tile.zoom}/{tile.x}/{tile.y}</Text>
        </View>

        <View style={styles.images}>
          {[image?.uri, converted].map((uri, index) => (
            <View key={index} style={[styles.image, { width: imageSize, height: imageSize }]}>
              {uri && (
                <Image
                  source={{ uri }}
                  style={{
                    position: 'absolute',
                    left: zoom.x,
                    top: zoom.y,
                    width: imageSize * zoom.scale,
                    height: imageSize * zoom.scale,
                  }}
                  fadeDuration={0}
                />
              )}
              {picked && (
                <View
                  pointerEvents="none"
                  style={[styles.marker, {
                    left: zoom.x + (picked.x + 0.5) / image.width * imageSize * zoom.scale - 8,
                    top: zoom.y + (picked.y + 0.5) / image.height * imageSize * zoom.scale - 8,
                  }]}
                />
              )}
              <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
            </View>
          ))}
        </View>
        {error ? (
          <Message tone="red">{error}</Message>
        ) : (
          <Hint>
            {image
              ? 'Original and converted tile. Pinch to zoom in, tap a pixel to see its filter entry.'
              : 'Loading tile…'}
          </Hint>
        )}

        {picked && (
          <View style={styles.section}>
            <View style={styles.row}>
              <Text style={styles.text}>Pixel</Text>
              <Swatch rgb={picked.rgb} />
              <Text style={styles.hex}>{hex(picked.rgb)}</Text>
              <Text style={styles.text}>uses</Text>
            </View>
            {renderEntry(pickedEntry)}
            {!sameRgb(draft[pickedEntry].rgb, picked.rgb) && (
              <Button title={`Add ${hex(picked.rgb)} as own entry`} onPress={addPickedColor} variant="secondary" />
            )}
          </View>
        )}

        <View style={styles.row}>
          <Button title="Apply" onPress={() => onApply(draft)} disabled={draft === filter} />
          <Button title="Undo" onPress={() => setDraft(filter)} disabled={draft === filter} variant="plain" />
          <Button title="Default" onPress={() => setDraft(DEFAULT_FILTER)} disabled={draft === DEFAULT_FILTER} variant="secondary" />
        </View>
        <Hint>
          Apply uses the filter for all tiles. Tiles already converted on the phone are deleted and loaded again.
        </Hint>

        <SectionTitle>Filter entries</SectionTitle>
        <Hint>
          Every pixel gets the display colors of the entry with the most similar color.
          Two display colors are mixed in a dither pattern, the percentage is the part of the second color.
          Thin lines and text are drawn solid in the darker of the two colors.
        </Hint>
        {draft.map((_, index) => renderEntry(index))}
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
  spacer: {
    flex: 1,
  },
  text: {
    color: colors.ink,
  },
  arrow: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.ink,
  },
  plus: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.ink,
  },
  images: {
    flexDirection: 'row',
    gap: GAP,
  },
  image: {
    overflow: 'hidden',
    backgroundColor: colors.paper,
    borderWidth: BORDER,
    borderColor: colors.ink,
  },
  marker: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderWidth: 3,
    borderColor: colors.red,
  },
  section: {
    gap: 8,
  },
  entry: {
    gap: 8,
    padding: 8,
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  entryHighlighted: {
    backgroundColor: colors.yellow,
  },
  swatch: {
    borderWidth: BORDER,
    borderColor: colors.ink,
  },
  swatchSelected: {
    borderColor: colors.blue,
    borderWidth: 4,
  },
  addColor: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER,
    borderStyle: 'dashed',
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  hex: {
    fontFamily: font.mono,
    color: colors.ink,
  },
  delete: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.red,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.paper,
  },
});
