import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from './Icon';
import { BORDER, SHADOW, colors, font, onColor, shadow } from '../theme';

const VARIANTS = {
  primary: colors.green,
  secondary: colors.orange,
  danger: colors.red,
  plain: colors.paper,
};

// Flat button with a black outline and a hard shadow. It moves into its shadow when it is pressed.
export default function Button({ title, onPress, disabled, variant = 'primary', icon, compact }) {
  const background = VARIANTS[variant];
  const color = onColor[background];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        { backgroundColor: background },
        disabled ? styles.disabled : pressed ? styles.pressed : shadow,
      ]}>
      {icon && <Icon name={icon} size={compact ? 24 : 32} style={disabled && styles.disabledIcon} />}
      <View style={styles.label}>
        <Text style={[styles.text, { color }, disabled && styles.disabledText]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: BORDER,
    borderColor: colors.ink,
    marginRight: SHADOW,
    marginBottom: SHADOW,
  },
  compact: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  pressed: {
    transform: [{ translateX: SHADOW }, { translateY: SHADOW }],
  },
  // no shadow and a dashed outline: the button is flat, it cannot be pressed
  disabled: {
    backgroundColor: colors.paper,
    borderStyle: 'dashed',
  },
  disabledIcon: {
    opacity: 0.35,
  },
  label: {
    flexShrink: 1,
  },
  text: {
    fontFamily: font.mono,
    fontWeight: 'bold',
    fontSize: 15,
    textAlign: 'center',
  },
  disabledText: {
    color: colors.ink,
    opacity: 0.4,
  },
});
