import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import Button from './Button';
import { DEFAULT_FILTER, DISPLAY_COLORS, convertPixels, findFilterEntry } from '../modules/map_color';
import { encodePalettePng, pngDataUri } from '../modules/png';
import { fetchTile } from '../modules/tile_loader';
import { ZOOM_LEVELS } from '../modules/tiles';

const PADDING = 16;
const GAP = 8;

// converted tiles are enlarged before they are shown, so the dithering stays visible
const PREVIEW_SCALE = 4;

const DISPLAY_PALETTE = DISPLAY_COLORS.map((color) => color.rgb);

const hex = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

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

// One entry of the filter: map color => one display color, or two display colors in a checkerboard
const FilterEntry = ({ entry, highlighted, editing, onEdit, onChange, onDelete }) => (
  <View style={[styles.entry, highlighted && styles.entryHighlighted]}>
    <View style={styles.row}>
      <Swatch rgb={entry.rgb} />
      <Text style={styles.hex}>{hex(entry.rgb)}</Text>
      <Text>→</Text>
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
          <Text>+</Text>
        </Pressable>
      )}
      <View style={styles.spacer} />
      {onDelete && (
        <Pressable onPress={onDelete} hitSlop={8}>
          <Text style={styles.delete}>✕</Text>
        </Pressable>
      )}
    </View>
    {editing !== null && (
      <View style={styles.row}>
        {DISPLAY_COLORS.map((color, value) => (
          <Swatch
            key={color.name}
            rgb={color.rgb}
            selected={entry.colors[editing] === value}
            onPress={() => {
              const colors = [...entry.colors];
              colors[editing] = value;
              onChange({ ...entry, colors });
            }}
          />
        ))}
        {editing === 1 && entry.colors.length === 2 && (
          <Button title="No dither" onPress={() => {
            onEdit(null);
            onChange({ ...entry, colors: [entry.colors[0]] });
          }} />
        )}
      </View>
    )}
  </View>
);

// Shows a tile of the map next to its converted version and lets the user change the filter
export default function FilterScreen({ filter, tileUrlTemplate, startTile, onApply, onBack }) {
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

  useEffect(() => setDraft(filter), [filter]);

  useEffect(() => {
    const controller = new AbortController();
    setImage(null);
    setError(null);
    setPicked(null);
    fetchTile(tileUrlTemplate, tile, controller.signal)
      .then(({ png, ...pixels }) => setImage({ uri: pngDataUri(png), ...pixels }))
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

  const pick = ({ nativeEvent }) => {
    if (image === null) {
      return;
    }
    const x = Math.min(Math.max(Math.floor(nativeEvent.locationX / imageSize * image.width), 0), image.width - 1);
    const y = Math.min(Math.max(Math.floor(nativeEvent.locationY / imageSize * image.height), 0), image.height - 1);
    const offset = (y * image.width + x) * 4;
    setPicked({ x, y, rgb: [image.rgba[offset], image.rgba[offset + 1], image.rgba[offset + 2]] });
    setEditing(null);
  };

  const changeEntry = (index, entry) => setDraft(draft.map((old, i) => (i === index ? entry : old)));

  const deleteEntry = (index) => {
    setDraft(draft.filter((_, i) => i !== index));
    setEditing(null);
  };

  // the picked color gets an entry of its own, starting with the display colors it has now
  const addPickedColor = () => {
    setDraft([...draft, { rgb: picked.rgb, colors: [...draft[pickedEntry].colors] }]);
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
      <View style={styles.row}>
        <Button title="‹ Back" onPress={onBack} />
        <Text style={styles.title}>Conversion filter</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          {ZOOM_LEVELS.map((zoom) => (
            <Button key={zoom} title={`Zoom ${zoom}`} onPress={() => changeZoom(zoom)} disabled={zoom === tile.zoom} />
          ))}
        </View>
        <View style={styles.row}>
          <Button title="←" onPress={() => move(-1, 0)} />
          <Button title="↑" onPress={() => move(0, -1)} />
          <Button title="↓" onPress={() => move(0, 1)} />
          <Button title="→" onPress={() => move(1, 0)} />
          <Text>{tile.zoom}/{tile.x}/{tile.y}</Text>
        </View>

        <View style={styles.images}>
          {[image?.uri, converted].map((uri, index) => (
            <Pressable key={index} onPress={pick} style={[styles.image, { width: imageSize, height: imageSize }]}>
              {uri && <Image source={{ uri }} style={{ width: imageSize, height: imageSize }} fadeDuration={0} />}
              {picked && (
                <View
                  pointerEvents="none"
                  style={[styles.marker, {
                    left: (picked.x + 0.5) / image.width * imageSize - 8,
                    top: (picked.y + 0.5) / image.height * imageSize - 8,
                  }]}
                />
              )}
            </Pressable>
          ))}
        </View>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.hint}>
            {image ? 'Original and converted tile. Tap a pixel to see its filter entry.' : 'Loading tile…'}
          </Text>
        )}

        {picked && (
          <View style={styles.section}>
            <View style={styles.row}>
              <Text>Pixel</Text>
              <Swatch rgb={picked.rgb} />
              <Text style={styles.hex}>{hex(picked.rgb)}</Text>
              <Text>uses</Text>
            </View>
            {renderEntry(pickedEntry)}
            {!sameRgb(draft[pickedEntry].rgb, picked.rgb) && (
              <Button title={`Add ${hex(picked.rgb)} as own entry`} onPress={addPickedColor} />
            )}
          </View>
        )}

        <View style={styles.row}>
          <Button title="Apply" onPress={() => onApply(draft)} disabled={draft === filter} />
          <Button title="Undo" onPress={() => setDraft(filter)} disabled={draft === filter} />
          <Button title="Default" onPress={() => setDraft(DEFAULT_FILTER)} disabled={draft === DEFAULT_FILTER} />
        </View>
        <Text style={styles.hint}>
          Apply uses the filter for all tiles. Tiles already converted on the phone are deleted and loaded again.
        </Text>

        <Text style={styles.subtitle}>Filter entries</Text>
        <Text style={styles.hint}>
          Every pixel gets the display colors of the entry with the most similar color.
          Two display colors are drawn as checkerboard.
        </Text>
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
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: 'bold',
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
  images: {
    flexDirection: 'row',
    gap: GAP,
  },
  image: {
    backgroundColor: '#ddd',
  },
  marker: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e91e63',
  },
  hint: {
    color: '#666',
  },
  error: {
    color: '#c62828',
  },
  section: {
    gap: 8,
  },
  entry: {
    gap: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
  },
  entryHighlighted: {
    borderColor: '#e91e63',
    borderWidth: 2,
  },
  swatch: {
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 4,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#e91e63',
  },
  addColor: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#888',
    borderRadius: 4,
  },
  hex: {
    fontFamily: 'monospace',
  },
  delete: {
    fontSize: 18,
    color: '#c62828',
  },
});
