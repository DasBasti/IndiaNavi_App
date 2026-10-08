import { memo, useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';

import { ICONS, ICON_SIZE } from '../modules/icons';
import { DISPLAY_COLORS } from '../modules/map_color';

const TRANSPARENT = '7';

const COLORS = DISPLAY_COLORS.map(({ rgb }) => `rgb(${rgb.join(',')})`);

// Icons of the app that the firmware does not have, in the same format. Diagonal lines are 3 pixels wide in a row to
// look as thick as the 2 pixel lines.
const APP_ICONS = {
  back: [
    '7777777777777777',
    '7777777777777777',
    '7777777770007777',
    '7777777700077777',
    '7777777000777777',
    '7777770007777777',
    '7777700077777777',
    '7777000777777777',
    '7777000777777777',
    '7777700077777777',
    '7777770007777777',
    '7777777000777777',
    '7777777700077777',
    '7777777770007777',
    '7777777777777777',
    '7777777777777777',
  ],
};

// Rectangles of the pixels, pixels of the same color in a row are drawn as one rectangle
const rectangles = (rows) => {
  const result = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const value = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === value) {
        end++;
      }
      if (value !== TRANSPARENT) {
        result.push({ key: `${x},${y}`, x, y, width: end - x, fill: COLORS[Number(value)] });
      }
      x = end;
    }
  });
  return result;
};

// An icon of the IndiaNavi firmware. Use multiples of 16 for size to keep every pixel sharp.
export default memo(function Icon({ name, size = ICON_SIZE, style }) {
  const rects = useMemo(() => rectangles(ICONS[name] ?? APP_ICONS[name]), [name]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} style={style}>
      {rects.map(({ key, ...rect }) => (
        <Rect key={key} {...rect} height={1} shapeRendering="crispEdges" />
      ))}
    </Svg>
  );
});
