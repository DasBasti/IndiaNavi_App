import { StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { Hint } from './ui';
import { colors } from '../theme';
import { FAR_CHOICES, NEAR_CHOICES, scaleBar, withLevel } from '../modules/zoom_levels';

// Latitude the scales are shown for, the scale of the device depends on it. The middle of Germany.
const SCALE_LATITUDE = 50;

const scaleOf = (zoom) => scaleBar(zoom, SCALE_LATITUDE)?.text ?? '';

// Choice of the two zoom levels of the IndiaNavi: the closer one it shows first and the wider one after the button.
// levels is { near, far }, onChange gets the new ones. The vector maps are drawn at any level, the tile images on the
// SD card are needed for both levels.
export default function ZoomLevelsSetting({ levels, onChange, disabled }) {
  const row = (which, title, choices) => (
    <View key={which} style={styles.block}>
      <Text style={styles.text}>{title}: zoom {levels[which]} (about {scaleOf(levels[which])})</Text>
      <View style={styles.row}>
        {choices.map((zoom) => (
          <Button
            key={zoom}
            title={String(zoom)}
            onPress={() => onChange(withLevel(levels, which, zoom))}
            disabled={disabled}
            variant={levels[which] === zoom ? 'primary' : 'plain'}
            compact
          />
        ))}
      </View>
    </View>
  );
  return (
    <View style={styles.container}>
      {row('near', 'Close', NEAR_CHOICES)}
      {row('far', 'Wide', FAR_CHOICES)}
      <Hint>
        The button of the IndiaNavi switches between the two levels. A higher number shows less area in more detail,
        and needs about four times the tiles of the level below it. The tiles are loaded and sent to the SD card for the
        chosen levels, tiles that are already there are kept.
      </Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  block: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    color: colors.ink,
    fontSize: 15,
  },
});
