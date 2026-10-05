import { memo, useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';

import { ICONS, ICON_SIZE } from '../modules/icons';
import { DISPLAY_COLORS } from '../modules/map_color';

const TRANSPARENT = '7';

const COLORS = DISPLAY_COLORS.map(({ rgb }) => `rgb(${rgb.join(',')})`);

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

// An icon of the IndiaNavi firmware. Use multiples of 32 for size to keep every pixel sharp.
export default memo(function Icon({ name, size = ICON_SIZE, style }) {
  const rects = useMemo(() => rectangles(ICONS[name]), [name]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} style={style}>
      {rects.map(({ key, ...rect }) => (
        <Rect key={key} {...rect} height={1} shapeRendering="crispEdges" />
      ))}
    </Svg>
  );
});
