import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';

import Icon from './Icon';
import { Card, Hint, SectionTitle } from './ui';
import { InfoRow, SCALE, ScaleBadge, styles } from './vector_info';
import { colors, displayColor, font } from '../theme';
import { PLACE_ROWS, POI_GROUPS, ZOOM_100M, formatTags, inkA } from '../modules/vector_style';

const BOX = 12 * SCALE;

// Corners of the symbol around the middle, the same shapes as the IndiaNavi draws
const polygon = (shape, mid, r) => {
  const points = {
    square: [[-r, -r], [r, -r], [r, r], [-r, r]],
    diamond: [[0, -r - 1], [r + 1, 0], [0, r + 1], [-r - 1, 0]],
    triangle: [[0, -r - 1], [r + 1, r], [-r - 1, r]],
  }[shape];
  return points.map(([x, y]) => `${mid + x * SCALE},${mid + y * SCALE}`).join(' ');
};

// A marker as on the display: an icon, or a disc, square, triangle or diamond of the style's ink and radius with a ring of one
// pixel around it, black around colored symbols, white around black ones
export const PoiSymbol = ({ style }) => {
  // POIs with an icon are drawn as that picture, the IndiaNavi has no symbol for them if it has icons
  if (style.icon !== null) {
    return <Icon name={`poi_${style.icon}`} size={BOX} />;
  }
  const mid = BOX / 2;
  const ink = displayColor(inkA(style.color));
  const ring = displayColor(style.outline);
  const radius = style.width;
  return (
    <Svg width={BOX} height={BOX}>
      {style.symbol === 'disc' ? (
        <>
          <Circle cx={mid} cy={mid} r={(radius + 1) * SCALE + SCALE / 2} fill={ring} />
          <Circle cx={mid} cy={mid} r={radius * SCALE + SCALE / 2} fill={ink} />
        </>
      ) : (
        <Polygon
          points={polygon(style.symbol, mid, radius)}
          fill={ink}
          stroke={ring}
          strokeWidth={SCALE * 2}
          strokeLinejoin="miter"
          paintOrder="stroke"
        />
      )}
    </Svg>
  );
};

// A place name as a sample, the most important ones in capitals
export const PlaceSample = ({ name, style }) => {
  const word = name.split(',')[0];
  return (
    <Text style={[placeStyles.sample, style.label === 1 && placeStyles.bold]}>
      {style.label === 1 ? word.toUpperCase() : word}
    </Text>
  );
};

// The markers and place names of the vector map, what the symbols mean and on which scale they appear. The tile
// images have no markers of their own. Content of a scrolling page, without a header.
export default function PoisInfo() {
  return (
    <View style={styles.page}>
      <Hint>
        The IndiaNavi draws these markers on the vector map. Markers marked 100 m only appear on the 100 m scale, so
        the 500 m scale stays readable.
      </Hint>

      {POI_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <SectionTitle>{group.title}</SectionTitle>
          <Card style={styles.card}>
            {group.rows.map((row) => (
              <InfoRow
                key={row.name}
                sample={<PoiSymbol style={row.style} />}
                name={row.name}
                tags={formatTags(row.tags)}>
                {row.style.minZoom >= ZOOM_100M && <ScaleBadge />}
              </InfoRow>
            ))}
          </Card>
        </View>
      ))}

      <View style={styles.group}>
        <SectionTitle>Place names</SectionTitle>
        <Card style={styles.card}>
          {PLACE_ROWS.map((row) => (
            <InfoRow key={row.name} sample={<PlaceSample {...row} />} name={row.name} tags={formatTags(row.tags)}>
              {row.style.minZoom >= ZOOM_100M && <ScaleBadge />}
            </InfoRow>
          ))}
        </Card>
        <Hint>
          Names are written in black on a white halo. Bigger places come first: a name that would overlap one that is
          already there is left out. Special characters are written as letters (ä as ae).
        </Hint>
      </View>
    </View>
  );
}

const placeStyles = StyleSheet.create({
  sample: {
    fontFamily: font.mono,
    fontSize: 14,
    color: colors.ink,
  },
  bold: {
    fontWeight: 'bold',
  },
});
