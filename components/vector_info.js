import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { BORDER, colors, displayColor, font } from '../theme';
import {
  B_BACKGROUND, B_TRANSPARENT, DIAG, HLINES, INK_NAMES, SOLID, WHITE, bCode, casingOrder, coverage, inkA, inkAt,
  patternOf, solid, widthAt,
} from '../modules/vector_style';

// Pixels of the display are shown this many times larger
export const SCALE = 4;

// Size of the samples in display pixels
export const SAMPLE_WIDTH = 18;
export const SAMPLE_HEIGHT = 12;

// Width of the sample column of a row, the same on all info pages
export const SAMPLE_BOX = SAMPLE_WIDTH * SCALE + 2 * BORDER;

// A small screen of display pixels to draw samples on, the way the IndiaNavi draws the map: every pixel is one
// ink, the patterns are anchored at the pixel positions.
export const makeCanvas = (width, height, ground = WHITE) => ({
  width,
  height,
  pixels: new Array(width * height).fill(ground),
});

// Fills the pixels x0..x1, y0..y1 (without x1, y1) with a paint, an overlay leaves the pixels below in between
export const fillRect = (canvas, x0, y0, x1, y1, paint) => {
  for (let y = Math.max(y0, 0); y < Math.min(y1, canvas.height); y++) {
    for (let x = Math.max(x0, 0); x < Math.min(x1, canvas.width); x++) {
      const ink = inkAt(paint, x, y);
      if (ink !== null) {
        canvas.pixels[y * canvas.width + x] = ink;
      }
    }
  }
};

// 1 px line in an ink around the inside of a rectangle
export const outlineRect = (canvas, x0, y0, x1, y1, ink) => {
  fillRect(canvas, x0, y0, x1, y0 + 1, solid(ink));
  fillRect(canvas, x0, y1 - 1, x1, y1, solid(ink));
  fillRect(canvas, x0, y0, x0 + 1, y1, solid(ink));
  fillRect(canvas, x1 - 1, y0, x1, y1, solid(ink));
};

// A straight band of a width around the middle row (horizontal) or column (vertical)
const band = (canvas, { at, vertical }, width, paint) => {
  const start = at - Math.floor(width / 2);
  if (vertical) {
    fillRect(canvas, start, 0, start + width, canvas.height, paint);
  } else {
    fillRect(canvas, 0, start, canvas.width, start + width, paint);
  }
};

// Draws lines across the canvas like the firmware: the white casings and the lines sorted by their draw order, so
// the casings of all roads lie below all roads and crossings stay joined. ways is a list of { style, at, vertical },
// lines hidden at the zoom level are left out.
export const drawWays = (canvas, ways, zoom = 16) => {
  const commands = [];
  ways
    .filter(({ style }) => style.minZoom <= zoom)
    .forEach((way) => {
      const width = widthAt(way.style, zoom);
      if (way.style.casing > 0) {
        commands.push({ way, order: casingOrder(way.style), width: width + 2 * way.style.casing, paint: solid(WHITE) });
      }
      commands.push({ way, order: way.style.order, width, paint: way.style.color });
    });
  commands
    .sort((a, b) => a.order - b.order)
    .forEach(({ way, width, paint }) => band(canvas, way, width, paint));
  return canvas;
};

// The canvas as an image, one path per ink with the runs of each row. fit stretches it to the width of the parent
// instead of SCALE.
export const PixelImage = ({ canvas, fit, style }) => {
  const runs = {};
  for (let y = 0; y < canvas.height; y++) {
    let x = 0;
    while (x < canvas.width) {
      const ink = canvas.pixels[y * canvas.width + x];
      let end = x + 1;
      while (end < canvas.width && canvas.pixels[y * canvas.width + end] === ink) {
        end++;
      }
      runs[ink] = (runs[ink] ?? '') + `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  }
  const image = (
    <Svg
      width={fit ? '100%' : canvas.width * SCALE}
      height={fit ? '100%' : canvas.height * SCALE}
      viewBox={`0 0 ${canvas.width} ${canvas.height}`}>
      {Object.entries(runs).map(([ink, d]) => (
        <Path key={ink} d={d} fill={displayColor(Number(ink))} shapeRendering="crispEdges" />
      ))}
    </Svg>
  );
  return (
    <View style={[styles.frame, fit && { width: '100%', aspectRatio: canvas.width / canvas.height }, style]}>
      {image}
    </View>
  );
};

const percent = (paint) => `${Math.round((coverage(paint) / 16) * 1000) / 10} %`;

// The inks and the pattern of a paint in words: ['green/yellow', '50 %'], ['blue', 'lines']
export const describePaint = (paint) => {
  const b = bCode(paint);
  const a = INK_NAMES[inkA(paint)];
  const inks = b === B_BACKGROUND || b === B_TRANSPARENT ? a : `${a}/${INK_NAMES[b - 1]}`;
  const pattern = patternOf(paint);
  if (pattern === SOLID) {
    return [inks, 'solid'];
  }
  return [inks, { [HLINES]: 'lines', [DIAG]: 'hatch' }[pattern] ?? percent(paint)];
};

// Small fact on the right of a row: 'strong' for the main number, color for a badge like the scale
export const Fact = ({ children, strong, color, outlined }) => (
  <Text
    style={[
      styles.fact,
      strong && styles.strong,
      color && { backgroundColor: color },
      outlined && styles.outlined,
    ]}>
    {children}
  </Text>
);

// The scale badge of things that only appear on the 100 m scale, as in the marker list
export const ScaleBadge = () => <Fact color={colors.yellow}>100 m</Fact>;

// Row of an info page: the sample on the left, the name and the tags of the map, the facts on the right
export const InfoRow = ({ sample, name, tags, children }) => (
  <View style={styles.row}>
    <View style={styles.sample}>{sample}</View>
    <View style={styles.text}>
      <Text style={styles.name}>{name}</Text>
      {tags ? <Text style={styles.tags}>{tags}</Text> : null}
    </View>
    {children ? <View style={styles.facts}>{children}</View> : null}
  </View>
);

export const styles = StyleSheet.create({
  page: {
    gap: 16,
  },
  group: {
    gap: 8,
  },
  card: {
    padding: 8,
    gap: 8,
  },
  frame: {
    alignSelf: 'flex-start',
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sample: {
    width: SAMPLE_BOX,
    alignItems: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    color: colors.ink,
  },
  tags: {
    fontFamily: font.mono,
    fontSize: 10,
    lineHeight: 14,
    color: colors.ink,
    opacity: 0.6,
  },
  facts: {
    alignItems: 'flex-end',
    gap: 3,
  },
  fact: {
    fontFamily: font.mono,
    fontSize: 11,
    color: colors.ink,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  strong: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  outlined: {
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
});
