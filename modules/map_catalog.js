// The rules of the firmware for several vector maps (lib/map_catalog of the firmware), so the simulated IndiaNavi
// draws the same maps as the device:
// - New tops old: a map is left out when a newer map covers at least 90 % of its area.
// - At most MAX_DRAWN maps per screen, the ones with the smallest area first.
// Maps are { name, created, bounds: { minLat, minLon, maxLat, maxLon } }, the header of mapsforge.js has both.

export const MAX_DRAWN = 4;

// share of the area of an older map a newer one has to cover to replace it
export const SUPERSEDED_SHARE = 0.9;

// in square degrees, enough to compare maps that lie on top of each other
const area = (b) => {
  const height = b.maxLat - b.minLat;
  const width = b.maxLon - b.minLon;
  return height > 0 && width > 0 ? height * width : 0;
};

const intersection = (a, b) => ({
  minLat: Math.max(a.minLat, b.minLat),
  minLon: Math.max(a.minLon, b.minLon),
  maxLat: Math.min(a.maxLat, b.maxLat),
  maxLon: Math.min(a.maxLon, b.maxLon),
});

const overlap = (a, b) => a.minLat <= b.maxLat && b.minLat <= a.maxLat && a.minLon <= b.maxLon && b.minLon <= a.maxLon;

// true when a newer map covers (almost) all of the map
export const isSuperseded = (map, maps) => {
  const own = area(map.bounds);
  return maps.some((other) => other.created > map.created && (own > 0
    ? area(intersection(map.bounds, other.bounds)) >= SUPERSEDED_SHARE * own
    : overlap(map.bounds, other.bounds)));
};

// Area of a screen in degrees: the position lat/lon is at the pixel anchorX/anchorY of a width x height screen at
// the zoom level (Web Mercator, 256 px tiles)
export const screenBounds = ({ lat, lon, zoom, width, height, anchorX, anchorY }) => {
  const world = 256 * 2 ** zoom;
  const rad = lat * Math.PI / 180;
  const left = (lon + 180) / 360 * world - anchorX;
  const top = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * world - anchorY;
  const toLon = (x) => x / world * 360 - 180;
  const toLat = (y) => 180 / Math.PI * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / world));
  return { minLat: toLat(top + height), minLon: toLon(left), maxLat: toLat(top), maxLon: toLon(left + width) };
};

// The maps to draw for a screen: not replaced and overlapping it, the smallest first, at most max. Maps of the same
// area keep their order.
export const selectMaps = (maps, screen, max = MAX_DRAWN) => maps
  .filter((map) => !isSuperseded(map, maps) && overlap(map.bounds, screen))
  .map((map, index) => ({ map, index }))
  .sort((a, b) => area(a.map.bounds) - area(b.map.bounds) || a.index - b.index)
  .slice(0, max)
  .map(({ map }) => map);

// Name of a map on the SD card: 1 to 8 letters, digits, '_' or '-' and .map. The app uses lower case names.
export const isCardName = (name) => /^[a-z0-9_-]{1,8}\.map$/i.test(name);

// A free card name for a map of the phone: up to 6 letters and digits of its region and a number,
// 'germany-rheinland-pfalz.map' => 'rheinl01.map'. The name of a map on the phone is folder-region (localName of
// map_listing.js). taken are the names already used, in lower case.
export const cardName = (phoneName, taken) => {
  const stem = phoneName.replace(/\.map$/i, '');
  const region = stem.includes('-') ? stem.slice(stem.indexOf('-') + 1) : stem;
  const base = (region.toLowerCase().replace(/[^a-z0-9]/g, '') || 'map').slice(0, 6);
  for (let number = 1; number < 100; number++) {
    const name = `${base}${String(number).padStart(2, '0')}.map`;
    if (!taken.includes(name)) {
      return name;
    }
  }
  throw new Error(`No free name on the SD card for ${phoneName}`);
};
