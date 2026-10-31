// The IndiaNavi shows two zoom levels and switches between them with the button. The vector maps are drawn at any
// level, the tile images on the SD card are needed for both.

// Levels the device accepts, the same as BLEP_ZOOM_MIN/MAX in the firmware
export const ZOOM_MIN = 10;
export const ZOOM_MAX = 17;

// near is the closer level (higher number) the device shows first, far the wider one after the button
export const DEFAULT_ZOOM_LEVELS = { near: 16, far: 14 };

export const isZoomLevels = (levels) =>
  Number.isInteger(levels?.near) && Number.isInteger(levels?.far)
  && levels.near <= ZOOM_MAX && levels.far >= ZOOM_MIN && levels.far < levels.near;

// The levels of the settings, the default if there are none or they are not valid
export const zoomLevelsOf = (levels) => (isZoomLevels(levels) ? { near: levels.near, far: levels.far } : DEFAULT_ZOOM_LEVELS);

// The levels from wide to close, for the tile areas and their colors
export const zoomList = ({ near, far }) => [far, near];

// Levels that can be chosen for the closer one: one above the lowest level to the highest
export const NEAR_CHOICES = Array.from({ length: ZOOM_MAX - ZOOM_MIN }, (_, i) => ZOOM_MIN + 1 + i);
export const FAR_CHOICES = Array.from({ length: ZOOM_MAX - ZOOM_MIN }, (_, i) => ZOOM_MIN + i);

// Changes one level and keeps the other valid: the closer level always stays above the wider one
export const withLevel = (levels, which, zoom) => {
  const next = { ...levels, [which]: zoom };
  if (isZoomLevels(next)) {
    return next;
  }
  return which === 'near'
    ? { near: zoom, far: zoom - 1 }
    : { near: zoom + 1, far: zoom };
};

// length of the equator in meters
const EQUATOR = 40075016.686;
const SCALE_STEPS = [1, 2, 5];
export const SCALE_MAX_WIDTH = 90;

export const metersPerPixel = (zoom, lat) => EQUATOR * Math.cos(lat * Math.PI / 180) / (256 * 2 ** zoom);

export const scaleText = (meters) => (meters >= 1000 ? `${meters / 1000}km` : `${meters}m`);

// The scale bar of the device: the longest round distance (1, 2 or 5 times a power of ten) that is not wider than
// SCALE_MAX_WIDTH pixels, as { meters, width, text }. The firmware computes the same in blep_scale_bar().
export const scaleBar = (zoom, lat) => {
  const perPixel = metersPerPixel(zoom, lat);
  let meters = 0;
  for (let decade = 1; decade <= 1e6; decade *= 10) {
    for (const step of SCALE_STEPS) {
      if ((step * decade) / perPixel <= SCALE_MAX_WIDTH) {
        meters = step * decade;
      }
    }
  }
  return meters ? { meters, width: Math.round(meters / perPixel), text: scaleText(meters) } : null;
};
