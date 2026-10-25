import { StyleSheet, Text, View } from 'react-native';

import { Card, Hint, SectionTitle } from './ui';
import {
  Fact, InfoRow, PixelImage, SAMPLE_HEIGHT, SAMPLE_WIDTH, SCALE, describePaint, fillRect, makeCanvas, outlineRect,
  styles,
} from './vector_info';
import { BORDER, colors, font } from '../theme';
import {
  AREA_GROUPS, FARMLAND, FOREST, MEADOW, RESIDENTIAL, RESTRICTED, WATER, WETLAND, WHITE, formatTags, isOverlay,
  solid,
} from '../modules/vector_style';

// Swatch of an area look in real pixels. Overlays lie on forest (left) and on white (right), buildings on houses
// with their black edge, the land of sea tiles next to the sea.
export const AreaSwatch = ({ style, width = SAMPLE_WIDTH, height = SAMPLE_HEIGHT }) => {
  const canvas = makeCanvas(width, height);
  if (isOverlay(style.color)) {
    fillRect(canvas, 0, 0, Math.floor(width / 2), height, FOREST);
    fillRect(canvas, 0, 0, width, height, style.color);
  } else if (style.outline !== null) {
    // a margin of houses around the building, if there is room for it
    const [dx, dy] = width > 8 ? [3, 2] : [0, 0];
    fillRect(canvas, 0, 0, width, height, RESIDENTIAL);
    fillRect(canvas, dx, dy, width - dx, height - dy, style.color);
    outlineRect(canvas, dx, dy, width - dx, height - dy, style.outline);
  } else if (style.color === solid(WHITE)) {
    fillRect(canvas, 0, 0, Math.floor(width / 3), height, WATER);
  } else {
    fillRect(canvas, 0, 0, width, height, style.color);
  }
  return <PixelImage canvas={canvas} />;
};

// Size of the swatches in the list of layers, in display pixels
const MINI = 6;

const allRows = AREA_GROUPS.flatMap((group) => group.rows);

// The layers from the top down: the areas of a higher layer cover the lower ones
const LAYERS = [...new Set(allRows.map((row) => row.style.order))]
  .sort((a, b) => b - a)
  .map((order) => allRows.filter((row) => row.style.order === order));

// Forest, meadow and farmland side by side, wetland over the upper half, military over the lower half
const overlaySample = () => {
  const canvas = makeCanvas(60, 20);
  [FOREST, MEADOW, FARMLAND].forEach((paint, index) => fillRect(canvas, index * 20, 0, index * 20 + 20, 20, paint));
  fillRect(canvas, 0, 0, 60, 10, WETLAND);
  fillRect(canvas, 0, 10, 60, 20, RESTRICTED);
  return canvas;
};

const AreaFacts = ({ style }) => {
  const [inks, pattern] = describePaint(style.color);
  return (
    <>
      <Fact strong>{pattern}</Fact>
      <Fact>{inks}</Fact>
      {isOverlay(style.color) && <Fact outlined>overlay</Fact>}
      {style.outline !== null && <Fact outlined>edge</Fact>}
    </>
  );
};

// The area fills of the vector map: the dot and line patterns of the display inks, grouped by what they are.
// Content of a scrolling page, without a header.
export default function AreasInfo() {
  return (
    <View style={styles.page}>
      <Hint>
        The display has no light colors, so the IndiaNavi fills areas with dot and line patterns of its inks. The
        samples show the real pixels, 4 times larger. Unmapped land stays white.
      </Hint>

      {AREA_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <SectionTitle>{group.title}</SectionTitle>
          <Card style={styles.card}>
            {group.rows.map((row) => (
              <InfoRow
                key={row.name}
                sample={<AreaSwatch style={row.style} />}
                name={row.name}
                tags={formatTags(row.tags)}>
                <AreaFacts style={row.style} />
              </InfoRow>
            ))}
          </Card>
        </View>
      ))}

      <View style={styles.group}>
        <SectionTitle>Draw order</SectionTitle>
        <Card style={styles.card}>
          <PixelImage canvas={overlaySample()} fit />
          <Hint>
            Wetland (top) and military areas (bottom) are overlays: only their lines are drawn, the forest, meadow or
            farmland below stays visible.
          </Hint>
        </Card>
        <Card style={styles.card}>
          {LAYERS.map((rows, index) => (
            <View key={rows[0].style.order} style={styles.row}>
              <Text style={layerStyles.number}>{LAYERS.length - index}</Text>
              <View style={layerStyles.swatches}>
                {rows.map((row) => <AreaSwatch key={row.name} style={row.style} width={MINI} height={MINI} />)}
              </View>
              <Text style={layerStyles.names}>{rows.map((row) => row.name).join(' · ')}</Text>
            </View>
          ))}
        </Card>
        <Hint>
          From the top down: a higher layer covers the ones below. Lines and markers are drawn on top of all areas.
        </Hint>
      </View>
    </View>
  );
}

const layerStyles = StyleSheet.create({
  number: {
    width: 24,
    fontFamily: font.mono,
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
    color: colors.ink,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    width: 3 * (MINI * SCALE + 2 * BORDER) + 2 * 2,
  },
  names: {
    flex: 1,
    fontSize: 13,
    color: colors.ink,
  },
});
