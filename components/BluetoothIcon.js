import Svg, { Polyline } from 'react-native-svg';

import { colors } from '../theme';

// The Bluetooth rune, drawn with lines because the icons of the firmware have none
export default function BluetoothIcon({ size = 32, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Polyline
        points="4,4.5 12,11.5 8,15 8,1 12,4.5 4,11.5"
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="miter"
      />
    </Svg>
  );
}
