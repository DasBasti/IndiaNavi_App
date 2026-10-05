import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Button from './Button';
import Icon from './Icon';
import { BORDER, PROGRESS_SEGMENTS, colors, font, onColor, shadow } from '../theme';

// Title bar of a screen: back button, icon and title
export const ScreenHeader = ({ title, icon, onBack, disabled }) => (
  <View style={styles.header}>
    {onBack && <Button title="‹" onPress={onBack} disabled={disabled} variant="plain" compact />}
    {icon && <Icon name={icon} size={32} />}
    <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
  </View>
);

// Headline of a block on a screen
export const SectionTitle = ({ children }) => (
  <View style={styles.sectionTitle}>
    <View style={styles.sectionBar} />
    <Text style={styles.sectionText}>{children}</Text>
  </View>
);

// Explanation below a control
export const Hint = ({ children, style }) => <Text style={[styles.hint, style]}>{children}</Text>;

// Outlined surface
export const Card = ({ children, color = colors.paper, selected, style, onPress }) => {
  const Component = onPress ? Pressable : View;
  return (
    <Component
      onPress={onPress}
      style={[styles.card, { backgroundColor: color }, selected && shadow, style]}>
      {children}
    </Component>
  );
};

// Message in a color of the display: red for errors, green for success, yellow for hints
export const Message = ({ children, tone = 'yellow', icon }) => {
  const background = colors[tone];
  return (
    <View style={[styles.message, { backgroundColor: background }]}>
      {icon && <Icon name={icon} size={32} />}
      <Text style={[styles.messageText, { color: onColor[background] }]}>{children}</Text>
    </View>
  );
};

// Small label, for example "selected" or "on the IndiaNavi"
export const Badge = ({ children, color = colors.green }) => (
  <View style={[styles.badge, { backgroundColor: color }]}>
    <Text style={[styles.badgeText, { color: onColor[color] }]}>{children}</Text>
  </View>
);

// Progress as segments, like the battery icons of the IndiaNavi
export const ProgressBar = ({ done, total, color = colors.green }) => {
  const filled = Math.round((done / Math.max(total, 1)) * PROGRESS_SEGMENTS);
  return (
    <View style={styles.progress}>
      {Array.from({ length: PROGRESS_SEGMENTS }, (_, index) => (
        <View
          key={index}
          style={[styles.segment, index < filled && { backgroundColor: color }]}
        />
      ))}
    </View>
  );
};

export const Input = (props) => (
  <TextInput
    placeholderTextColor={colors.ink + '99'}
    selectionColor={colors.blue}
    {...props}
    style={[styles.input, props.style]}
  />
);

// The colors of the display in a row, used as the logo of the filter
export const PaletteStrip = ({ size = 12 }) => (
  <View style={styles.strip}>
    {[colors.ink, colors.paper, colors.green, colors.blue, colors.red, colors.yellow, colors.orange].map((color) => (
      <View key={color} style={{ width: size, height: size * 2, backgroundColor: color, borderWidth: 1, borderColor: colors.ink }} />
    ))}
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: BORDER,
    borderBottomColor: colors.ink,
  },
  headerTitle: {
    flex: 1,
    fontFamily: font.mono,
    fontSize: 20,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.ink,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  sectionBar: {
    width: 10,
    height: 20,
    backgroundColor: colors.orange,
    borderWidth: BORDER,
    borderColor: colors.ink,
  },
  sectionText: {
    fontFamily: font.mono,
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: colors.ink,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
    opacity: 0.7,
  },
  card: {
    padding: 12,
    borderWidth: BORDER,
    borderColor: colors.ink,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderWidth: BORDER,
    borderColor: colors.ink,
  },
  messageText: {
    flex: 1,
    fontWeight: 'bold',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  badgeText: {
    fontFamily: font.mono,
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  progress: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 3,
    padding: 3,
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  segment: {
    flex: 1,
    height: 18,
    borderWidth: 1,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  input: {
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
    color: colors.ink,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  strip: {
    flexDirection: 'row',
  },
});
