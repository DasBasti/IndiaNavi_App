// Design of the app: it follows the display of the IndiaNavi. Only the 7 colors of the ACeP display are used,
// surfaces are flat, outlines are black and corners are square, like the icons of the firmware.
import { DISPLAY_COLORS } from './modules/map_color';

const hex = ({ rgb }) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

const [black, white, green, blue, red, yellow, orange] = DISPLAY_COLORS.map(hex);

export const colors = {
  ink: black, // text and outlines
  paper: white, // background
  green, // primary action, selection, success
  blue, // the IndiaNavi, links
  red, // errors, delete, the track on the map
  yellow, // highlights, hints
  orange, // secondary action, attention
};

// Text on the colors: white only on the dark ones
export const onColor = {
  [black]: white,
  [white]: black,
  [green]: black,
  [blue]: white,
  [red]: white,
  [yellow]: black,
  [orange]: black,
};

export const BORDER = 2;
export const SHADOW = 3;
export const PAGE_PADDING = 16;

export const font = {
  // the headlines use the monospaced font, it is closest to the pixel font of the display
  mono: 'monospace',
};

// Hard offset shadow, the "pixel" way to lift a surface
export const shadow = { boxShadow: `${SHADOW}px ${SHADOW}px 0px ${black}` };

// Segments of the progress bar, same as the segments in the battery icons of the firmware
export const PROGRESS_SEGMENTS = 10;
