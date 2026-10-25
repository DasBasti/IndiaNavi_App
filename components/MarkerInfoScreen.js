import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';

import { Card, Hint, ScreenHeader, SectionTitle } from './ui';
import { colors, displayColor, font } from '../theme';

// Black, white, green, blue, red, yellow, orange: the inks of the display, as the symbols on the IndiaNavi use them
const [BLACK, WHITE, GREEN, BLUE, RED, YELLOW, ORANGE] = [0, 1, 2, 3, 4, 5, 6].map(displayColor);

// The symbols of the vector map (style.rs of mapsforge-rs): shape, ink and radius in display pixels. A colored
// symbol has a 1 px black ring, a black landmark (plain) has a white ring, so it stays apart from the black paths.
// zoom16 marks the ones that are only drawn on the 100 m scale.
const GROUPS = [
  {
    title: 'Mountains',
    markers: [
      { shape: 'triangle', ink: BLACK, radius: 4, name: 'Peak, volcano', plain: true },
      { shape: 'diamond', ink: BLACK, radius: 3, name: 'Mountain pass', plain: true },
      { shape: 'disc', ink: BLACK, radius: 2, name: 'Cave entrance', plain: true },
      { shape: 'diamond', ink: YELLOW, radius: 4, name: 'Viewpoint' },
    ],
  },
  {
    title: 'Shelter and sleeping',
    markers: [
      { shape: 'square', ink: RED, radius: 4, name: 'Alpine hut' },
      { shape: 'square', ink: ORANGE, radius: 3, name: 'Shelter' },
      { shape: 'square', ink: RED, radius: 3, name: 'Camp site, hostel, hotel', zoom16: true },
    ],
  },
  {
    title: 'Water',
    markers: [
      { shape: 'disc', ink: BLUE, radius: 3, name: 'Drinking water, spring' },
    ],
  },
  {
    title: 'Food and supplies',
    markers: [
      { shape: 'disc', ink: ORANGE, radius: 3, name: 'Restaurant, cafe, pub, bar, fast food', zoom16: true },
      { shape: 'square', ink: ORANGE, radius: 3, name: 'Supermarket', zoom16: true },
      { shape: 'disc', ink: RED, radius: 3, name: 'Pharmacy', zoom16: true },
      { shape: 'disc', ink: RED, radius: 4, name: 'Hospital' },
    ],
  },
  {
    title: 'Transport',
    markers: [
      { shape: 'square', ink: BLACK, radius: 3, name: 'Train station, halt' },
      { shape: 'square', ink: WHITE, radius: 2, name: 'Bus or tram stop', zoom16: true },
      { shape: 'square', ink: BLUE, radius: 3, name: 'Parking', zoom16: true },
    ],
  },
  {
    title: 'Orientation and landmarks',
    markers: [
      { shape: 'square', ink: YELLOW, radius: 2, name: 'Tourist information, guidepost board', zoom16: true },
      { shape: 'disc', ink: GREEN, radius: 2, name: 'Picnic site', zoom16: true },
      { shape: 'disc', ink: BLACK, radius: 3, name: 'Castle', plain: true },
      { shape: 'disc', ink: BLACK, radius: 2, name: 'Tower, windmill, lighthouse', plain: true },
      { shape: 'disc', ink: BLACK, radius: 2, name: 'Church, monument, attraction', plain: true, zoom16: true },
    ],
  },
];

const PLACES = [
  { sample: 'CITY', bold: true, name: 'City', zoom16: false },
  { sample: 'Town', name: 'Town', zoom16: false },
  { sample: 'Village', name: 'Village', zoom16: false },
  { sample: 'Hamlet', name: 'Suburb, hamlet', zoom16: true },
];

// Pixels of the display are shown this many times larger
const SCALE = 4;
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

// A marker as on the display: a disc, square, triangle or diamond with a ring of one pixel around it
function Symbol({ shape, ink, radius, plain }) {
  const mid = BOX / 2;
  const ring = plain ? WHITE : BLACK;
  return (
    <Svg width={BOX} height={BOX}>
      {shape === 'disc' ? (
        <>
          <Circle cx={mid} cy={mid} r={(radius + 1) * SCALE + SCALE / 2} fill={ring} />
          <Circle cx={mid} cy={mid} r={radius * SCALE + SCALE / 2} fill={ink} />
        </>
      ) : (
        <Polygon
          points={polygon(shape, mid, radius)}
          fill={ink}
          stroke={ring}
          strokeWidth={SCALE * 2}
          strokeLinejoin="miter"
          paintOrder="stroke"
        />
      )}
    </Svg>
  );
}

// Explains the markers on the map of the IndiaNavi: what the symbols mean and on which scale they appear. The map
// is the vector map (MAPS/map.map on the SD card), the tile images have no markers of their own.
export default function MarkerInfoScreen({ onBack }) {
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Map markers" icon="norden" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.list}>
        <Hint>
          The IndiaNavi draws these markers on the vector map. Markers marked 100 m only appear on the 100 m scale, so
          the 500 m scale stays readable.
        </Hint>

        {GROUPS.map((group) => (
          <View key={group.title} style={styles.group}>
            <SectionTitle>{group.title}</SectionTitle>
            <Card style={styles.card}>
              {group.markers.map((marker) => (
                <View key={marker.name} style={styles.row}>
                  <Symbol {...marker} />
                  <Text style={styles.name}>{marker.name}</Text>
                  {marker.zoom16 && <Text style={styles.scale}>100 m</Text>}
                </View>
              ))}
            </Card>
          </View>
        ))}

        <View style={styles.group}>
          <SectionTitle>Place names</SectionTitle>
          <Card style={styles.card}>
            {PLACES.map((place) => (
              <View key={place.name} style={styles.row}>
                <View style={styles.sampleBox}>
                  <Text style={[styles.sample, place.bold && styles.bold]}>{place.sample}</Text>
                </View>
                <Text style={styles.name}>{place.name}</Text>
                {place.zoom16 && <Text style={styles.scale}>100 m</Text>}
              </View>
            ))}
          </Card>
          <Hint>
            Names are written in black on a white halo. Bigger places come first: a name that would overlap one that is
            already there is left out. Special characters are written as letters (ä as ae).
          </Hint>
        </View>
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
  list: {
    gap: 16,
    paddingBottom: 24,
    paddingRight: 4,
  },
  group: {
    gap: 8,
  },
  card: {
    padding: 8,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
  },
  scale: {
    fontFamily: font.mono,
    fontSize: 12,
    color: colors.ink,
    backgroundColor: colors.yellow,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sampleBox: {
    width: BOX + 24,
    alignItems: 'center',
  },
  sample: {
    fontFamily: font.mono,
    fontSize: 14,
    color: colors.ink,
  },
  bold: {
    fontWeight: 'bold',
  },
});
