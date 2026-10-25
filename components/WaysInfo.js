import { StyleSheet, Text, View } from 'react-native';

import { Card, Hint, SectionTitle } from './ui';
import {
  Fact, InfoRow, PixelImage, SAMPLE_HEIGHT, SAMPLE_WIDTH, ScaleBadge, drawWays, fillRect, makeCanvas, styles,
} from './vector_info';
import {
  FOREST, HIDDEN_WAYS, WAY_GROUPS, WAY_RULES, ZOOM_100M, formatTags, styleOf, widthAt,
} from '../modules/vector_style';

// Zoom levels of the two scales of the IndiaNavi
const ZOOM_100M_SCALE = 16;
const ZOOM_500M_SCALE = 14;

// A line on forest, where its white casing matters most
const forest = (width, height) => {
  const canvas = makeCanvas(width, height);
  fillRect(canvas, 0, 0, width, height, FOREST);
  return canvas;
};

// A line of the vector map in real pixels, with its casing
export const WaySample = ({ style, zoom = ZOOM_100M_SCALE }) => (
  <PixelImage canvas={drawWays(forest(SAMPLE_WIDTH, SAMPLE_HEIGHT), [{ style, at: SAMPLE_HEIGHT / 2 }], zoom)} />
);

// Walkable ways crossing a road and a stream: path, footway, street, main road, railway from the left
const CROSSING = [
  { tag: 'highway=secondary', at: 6 },
  { tag: 'waterway=stream', at: 15 },
  { tag: 'highway=path', at: 8, vertical: true },
  { tag: 'highway=footway', at: 20, vertical: true },
  { tag: 'highway=residential', at: 32, vertical: true },
  { tag: 'highway=primary', at: 44, vertical: true },
  { tag: 'railway=rail', at: 55, vertical: true },
].map(({ tag, ...way }) => ({ ...way, style: styleOf(WAY_RULES, tag) }));

export const CrossingSample = ({ zoom }) => <PixelImage canvas={drawWays(forest(64, 20), CROSSING, zoom)} fit />;

const WayFacts = ({ style }) => (
  <>
    <Fact strong>{style.width} px</Fact>
    {style.minZoom >= ZOOM_100M ? (
      <ScaleBadge />
    ) : (
      widthAt(style, ZOOM_500M_SCALE) !== style.width && <Fact>{widthAt(style, ZOOM_500M_SCALE)} px at 500 m</Fact>
    )}
  </>
);

// The lines of the vector map at their width in display pixels, the widest first in each group. Content of a
// scrolling page, without a header.
export default function WaysInfo() {
  return (
    <View style={styles.page}>
      <Hint>
        Lines are drawn at their real width in display pixels (1 px is 0.2 mm), shown 4 times larger on forest. Ways to
        walk are thicker than roads for cars. A white casing keeps roads, railways and streams readable on dark areas.
      </Hint>

      <View style={styles.group}>
        <SectionTitle>Crossings</SectionTitle>
        <Card style={styles.card}>
          {[[ZOOM_100M_SCALE, '100 m scale'], [ZOOM_500M_SCALE, '500 m scale']].map(([zoom, title]) => (
            <View key={zoom} style={scaleStyles.scale}>
              <Text style={[styles.fact, styles.strong]}>{title}</Text>
              <CrossingSample zoom={zoom} />
            </View>
          ))}
          <Hint>
            From the left: path, footway, street, main road and railway, crossing a secondary road and a stream. Ways to
            walk lie on top, the casings join at crossings. On the 500 m scale the roads are one pixel thinner and
            footways, pedestrian streets and service roads are left out.
          </Hint>
        </Card>
      </View>

      {WAY_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <SectionTitle>{group.title}</SectionTitle>
          <Card style={styles.card}>
            {[...group.rows]
              .sort((a, b) => b.style.width - a.style.width)
              .map((row) => (
                <InfoRow
                  key={row.name}
                  sample={<WaySample style={row.style} />}
                  name={row.name}
                  tags={formatTags(row.tags)}>
                  <WayFacts style={row.style} />
                </InfoRow>
              ))}
          </Card>
        </View>
      ))}

      <Hint>Not drawn: {HIDDEN_WAYS.join(', ')}.</Hint>
    </View>
  );
}

const scaleStyles = StyleSheet.create({
  scale: {
    gap: 4,
  },
});
