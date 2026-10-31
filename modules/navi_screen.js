// The map screen of the IndiaNavi, drawn the way the firmware draws it (src/screens/map_screen.c): the vector map
// with the track, its direction arrows and the position marker, the top bar, the scale, the copyright notice, the
// height graph and the black info strip at the bottom. The app shows it as a simulated display.

import { ICON_SIZE } from './icons.js';
import { MAX_DRAWN, screenBounds, selectMaps } from './map_catalog.js';
import { makeView, renderMap } from './mapsforge.js';
import {
  BLACK, CHAR_HEIGHT, WHITE, circleDraw, circleFill, drawIcon, drawText, fillRect, line, makeFramebuffer,
  rasterTarget, setPixel, textWidth,
} from './navi_raster.js';
import { SCALE_MAX_WIDTH, scaleBar, zoomLevelsOf } from './zoom_levels.js';
import { lat2world, lon2world, world2lat, world2lon } from './tiles.js';

const GREEN = 2;
const BLUE = 3;
const RED = 4;

// The display in portrait orientation
export const SCREEN_WIDTH = 448;
export const SCREEN_HEIGHT = 600;

const TILE = 256;

// The map is a grid of 3x3 tiles, the tile with the position is the one in the middle
const MAP_LEFT = -159;
const MAP_TOP = -85;

// Where the app draws the place it shows, the device has its position in the tile in the middle of the 3x3 tiles
const CENTER_X = SCREEN_WIDTH / 2;
const CENTER_Y = SCREEN_HEIGHT / 2;

// length of the equator in meters
const EQUATOR = 40075016.686;

// The two zoom levels the button switches between, the closer one first. The scale bar fits the level and the latitude.
export const naviZooms = (levels) => {
  const { near, far } = zoomLevelsOf(levels);
  return [near, far];
};

const MARGIN = 5;
const MARGIN_WIDE = 10;
const TOP_BAR_HEIGHT = ICON_SIZE + MARGIN_WIDE;

const GRAPH_HEIGHT = 45;
// the scale and the copyright notice move down without the height graph
const GRAPH_SHIFT = 29;
const INFO_HEIGHT = 16;

const ARROW_SPACING = 80;
const ARROW_LOOKAHEAD = 12;
const ARROW_MARGIN = 5;

// the scale is at the left of the bottom bar, the text of the bar gets the rest
const SCALE_LEFT = 5;
const SCALE_AREA = SCALE_LEFT + SCALE_MAX_WIDTH + 5;
const INFO_LENGTH = Math.floor((SCREEN_WIDTH - SCALE_AREA) / 8) - 1;

const COPYRIGHT = '(c) OpenStreetMap contributors';

// The icon names by the MFR_ICON_* of mapsforge.h, the native renderer leaves the pictures to the app
const NATIVE_ICONS = [
  null, 'drinking_water', 'spring', 'food', 'supermarket', 'pharmacy', 'hospital', 'train', 'bus', 'tram', 'parking',
  'castle', 'tower', 'other',
];

// An icon with a text right of it, returns the right edge of the text
const iconWithText = (fb, name, left, text = '') => {
  drawIcon(fb, name, left, MARGIN);
  const textLeft = left + ICON_SIZE + MARGIN;
  drawText(fb, textLeft + 1, MARGIN + 1, text, BLACK);
  return textLeft + textWidth(text);
};

const topBar = (fb, { battery, satellites, hasPosition }) => {
  fillRect(fb, 0, 0, SCREEN_WIDTH, TOP_BAR_HEIGHT, WHITE);
  line(fb, 0, 0, SCREEN_WIDTH - 1, 0, BLACK);
  line(fb, 0, TOP_BAR_HEIGHT - 1, SCREEN_WIDTH - 1, TOP_BAR_HEIGHT - 1, BLACK);
  line(fb, 0, 0, 0, TOP_BAR_HEIGHT - 1, BLACK);
  line(fb, SCREEN_WIDTH - 1, 0, SCREEN_WIDTH - 1, TOP_BAR_HEIGHT - 1, BLACK);

  // a battery that is not known has no icon
  const percent = battery === null ? '' : `${battery}%`;
  if (battery !== null) {
    const level = [0, 10, 30, 50, 80, 100].filter((step) => step <= battery).pop() ?? 0;
    drawIcon(fb, `bat_${level}`, MARGIN, MARGIN);
    drawText(fb, MARGIN + ICON_SIZE + 1, MARGIN + 1, percent, BLACK);
  }
  drawIcon(fb, 'norden', MARGIN + ICON_SIZE + textWidth(percent) + MARGIN_WIDE, MARGIN);

  const gps = SCREEN_WIDTH - ICON_SIZE - 2 * MARGIN - 16;
  const icon = satellites > 0 ? 'GPS_lock' : hasPosition ? 'GPS_search' : 'noGPS';
  iconWithText(fb, icon, gps, satellites === null ? '' : String(satellites));
};

// The pixel of a place in the whole world at a zoom level
const worldPixel = (lon, lat, zoom) => ({
  x: Math.floor(lon2world(lon) * 2 ** zoom * TILE),
  y: Math.floor(lat2world(lat) * 2 ** zoom * TILE),
});

// Position of the track points on the screen: points further than a tile away from the screen are not active
const placeTrack = (lines, toScreen) => lines.map((points) => points.map(([lon, lat]) => {
  const { x, y } = toScreen(lon, lat);
  const active = x >= -TILE && x < SCREEN_WIDTH + TILE && y >= -TILE && y < SCREEN_HEIGHT + TILE;
  return { x, y, active };
}));

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Arrows in the direction of the track, every ARROW_SPACING pixels along all of it, so they stay on their place on the
// track when the map is scrolled. Only the ones in the visible parts are returned.
const placeArrows = (points) => {
  const arrows = [];
  let travelled = ARROW_SPACING / 2;
  points.forEach((point, i) => {
    const next = points[i + 1];
    if (!next) {
      return;
    }
    travelled += distance(point, next);
    if (travelled < ARROW_SPACING) {
      return;
    }
    if (!point.active || !next.active) {
      travelled = 0;
      return;
    }
    let ahead = i + 1;
    while (distance(point, points[ahead]) < ARROW_LOOKAHEAD && points[ahead + 1]?.active) {
      ahead++;
    }
    if (distance(point, points[ahead]) < 2) {
      return;
    }
    arrows.push([point, points[ahead]]);
    travelled = 0;
  });
  return arrows;
};

const drawArrow = (fb, from, to, thickness, color) => {
  const length = distance(from, to);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const halfWidth = thickness + ARROW_MARGIN;
  const arrowLength = 2 * halfWidth;
  const tipX = from.x + ux * arrowLength / 2;
  const tipY = from.y + uy * arrowLength / 2;
  const baseX = tipX - ux * arrowLength;
  const baseY = tipY - uy * arrowLength;
  const x1 = Math.round(baseX - uy * halfWidth);
  const y1 = Math.round(baseY + ux * halfWidth);
  const x2 = Math.round(baseX + uy * halfWidth);
  const y2 = Math.round(baseY - ux * halfWidth);
  const tx = Math.round(tipX);
  const ty = Math.round(tipY);
  const steps = 4 * halfWidth;
  for (let i = 0; i <= steps; i++) {
    line(fb, tx, ty, x1 + Math.trunc((x2 - x1) * i / steps), y1 + Math.trunc((y2 - y1) * i / steps), color);
  }
  const border = color === BLACK ? WHITE : BLACK;
  line(fb, tx, ty, x1, y1, border);
  line(fb, tx, ty, x2, y2, border);
  line(fb, x1, y1, x2, y2, border);
};

const drawTrack = (fb, placed, color) => {
  // the thickness is set when the track is loaded, at the 100 m scale the device starts with
  const thickness = 3;
  for (const points of placed) {
    points.forEach((point, i) => {
      if (!point.active) {
        return;
      }
      circleFill(fb, point.x, point.y, thickness + 1, color);
      const next = points[i + 1];
      if (next?.active) {
        line(fb, point.x, point.y, next.x, next.y, color);
        line(fb, point.x + 1, point.y, next.x + 1, next.y, color);
        line(fb, point.x - 1, point.y, next.x - 1, next.y, color);
      }
      setPixel(fb, point.x, point.y, WHITE);
    });
  }
  // the arrows are drawn after the whole track, so its line does not cover them
  for (const points of placed) {
    for (const [from, to] of placeArrows(points)) {
      drawArrow(fb, from, to, thickness, color);
    }
  }
};

// Index of the track point closest to the position, over all lines
const closestPoint = (points, lat, lon) => {
  const scale = Math.cos(lat * Math.PI / 180);
  let best = -1;
  let bestDistance = Infinity;
  points.forEach(([pLon, pLat], i) => {
    const d = (pLat - lat) ** 2 + ((pLon - lon) * scale) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
};

// Height profile of the track, colored by the climb to the next point, with the position on it
const heightGraph = (fb, points, current) => {
  const top = SCREEN_HEIGHT - GRAPH_HEIGHT;
  const elevations = points.map((point) => (Number.isFinite(point[2]) ? point[2] : 0));
  let min = Math.floor(Math.min(...elevations));
  let max = Math.ceil(Math.max(...elevations));
  if (max <= min) {
    max = min + 1;
  }
  fillRect(fb, 0, top, SCREEN_WIDTH, GRAPH_HEIGHT, WHITE);
  line(fb, 0, top, SCREEN_WIDTH - 1, top, BLACK);
  line(fb, 0, top + GRAPH_HEIGHT - 1, SCREEN_WIDTH - 1, top + GRAPH_HEIGHT - 1, BLACK);
  line(fb, 0, top, 0, top + GRAPH_HEIGHT - 1, BLACK);
  line(fb, SCREEN_WIDTH - 1, top, SCREEN_WIDTH - 1, top + GRAPH_HEIGHT - 1, BLACK);

  const innerTop = top + 1;
  const innerHeight = GRAPH_HEIGHT - 2;
  const xStep = (SCREEN_WIDTH - 2) / (points.length - 1);
  const yStep = innerHeight / (max - min);
  const position = (i) => ({
    x: 1 + Math.trunc(i * xStep),
    y: innerTop + innerHeight - Math.ceil(Math.max(elevations[i] - min, 0) * yStep),
  });
  // the color of a point is the climb to the next one
  const color = (i) => {
    if (i + 1 >= elevations.length) {
      return BLUE;
    }
    const diff = Math.abs(Math.trunc(elevations[i] - elevations[i + 1]));
    return diff >= 10 ? RED : diff > 1 ? GREEN : BLUE;
  };
  let last = position(0);
  for (let i = 1; i < points.length; i++) {
    const p = position(i);
    line(fb, last.x, last.y, p.x, p.y, color(i));
    line(fb, last.x, last.y - 1, p.x, p.y - 1, color(i));
    last = p;
  }
  if (current > 0) {
    const p = position(current);
    circleFill(fb, p.x, p.y, 3, BLUE);
  }
  drawText(fb, 3, top + 3, `${max}m`, BLACK);
  drawText(fb, 3, top + GRAPH_HEIGHT - 2 - CHAR_HEIGHT + 1, `${min}m`, BLACK);
};

const hemisphere = (value, positive, negative) => `${Math.abs(value).toFixed(6)}${value < 0 ? negative : positive}`;

// The maps the device draws for a screen, by the rules of its map catalog (map_catalog.js)
const mapsOfScreen = (maps, screen) => {
  const entries = maps.map((map) => ({ map, created: map.header.created, bounds: map.header.bounds }));
  return selectMaps(entries, screen, MAX_DRAWN).map(({ map }) => map);
};

// bytes of a raw tile: 256 x 256 pixels, 4 bit per pixel
const RAW_TILE_BYTES = TILE * TILE / 2;

// The tiles of the SD card on the screen, origin is the world pixel of its top left corner. Around the position these
// are the 3x3 tiles map_render of the firmware draws: the raw pixels (the high 4 bits are the left pixel), "Not Found"
// in a tile that is not there. Returns the tiles drawn.
const drawRasterTiles = (fb, readTile, zoom, origin) => {
  let drawn = 0;
  for (let x = Math.floor(origin.x / TILE); x * TILE - origin.x < SCREEN_WIDTH; x++) {
    for (let y = Math.floor(origin.y / TILE); y * TILE - origin.y < SCREEN_HEIGHT; y++) {
      const left = x * TILE - origin.x;
      const top = y * TILE - origin.y;
      const data = readTile?.({ zoom, x, y });
      if (!data || data.length < RAW_TILE_BYTES) {
        const notFound = 'Not Found';
        drawText(fb, left + 1 + Math.trunc((TILE - textWidth(notFound)) / 2), top + 1 + (TILE - CHAR_HEIGHT) / 2, notFound, BLACK);
        continue;
      }
      drawn++;
      for (let row = Math.max(0, -top); row < TILE && top + row < SCREEN_HEIGHT; row++) {
        for (let column = Math.max(0, -left); column < TILE && left + column < SCREEN_WIDTH; column++) {
          const byte = data[(row * TILE + column) >> 1];
          fb.pixels[(top + row) * SCREEN_WIDTH + left + column] = column & 1 ? byte & 0x0f : byte >> 4;
        }
      }
    }
  }
  return drawn;
};

// Where the firmware draws a position: at its pixel in the tile in the middle of the 3x3 tiles
export const deviceAnchor = (lat, lon, zoom) => {
  const { x, y } = worldPixel(lon, lat, zoom);
  return { anchorX: MAP_LEFT + TILE + x % TILE, anchorY: MAP_TOP + TILE + y % TILE };
};

// The middle of the screen
export const CENTER_ANCHOR = { anchorX: CENTER_X, anchorY: CENTER_Y };

// { lat, lon } of the place in the middle of the screen when { lat, lon } is drawn at the anchor, a map that was scrolled
// is kept this way
export const centerOfScreen = ({ lat, lon, zoom, anchorX, anchorY }) => {
  const world = TILE * 2 ** zoom;
  const clamp = (value) => Math.min(Math.max(value, 0), 1);
  return {
    lat: world2lat(clamp(lat2world(lat) + (CENTER_Y - anchorY) / world)),
    lon: world2lon(clamp(lon2world(lon) + (CENTER_X - anchorX) / world)),
  };
};

// Draws the map screen. options: { maps (of openMap, the maps on the SD card), readTile ({ zoom, x, y } => the raw
// tile of the SD card or null), lat, lon (the place of the map at the anchor), anchorX, anchorY (as on the device if not
// given), position ({ lat, lon, altitude, accuracy (m) } of the marker, at lat, lon if not given, null without a
// position), zoomLevels ({ near, far }, the default levels if not given), zoomIndex (0 near, 1 far), track: { name, lines } or null, trackColor (ink), showTrack, showHeightGraph,
// battery (percent), satellites (null if not known) }.
// Like the firmware it draws the vector maps when one covers the screen, the tiles otherwise.
// Returns { fb, source, tiles, drawn, error }: source is 'vector' or 'tiles', tiles the number of map tiles that were
// drawn (of the vector maps or the raw tiles), drawn the vector maps that were drawn, error a failed map read.
export const renderNaviScreen = ({
  maps = [], readTile = null, lat, lon, anchorX, anchorY, position = { lat, lon }, zoomLevels, zoomIndex = 0, track = null,
  trackColor = BLUE, showTrack = true, showHeightGraph = true, battery = null, satellites = null,
}) => {
  const fb = makeFramebuffer(SCREEN_WIDTH, SCREEN_HEIGHT, WHITE);
  const levels = naviZooms(zoomLevels);
  const zoom = levels[zoomIndex] ?? levels[0];
  // the scale of the device fits the zoom level at the latitude of the position, as long as it is shown
  const { width: scale, text } = scaleBar(zoom, position?.lat ?? lat) ?? { width: 0, text: '' };

  const device = deviceAnchor(lat, lon, zoom);
  anchorX ??= device.anchorX;
  anchorY ??= device.anchorY;
  const center = worldPixel(lon, lat, zoom);
  const origin = { x: center.x - anchorX, y: center.y - anchorY };
  const toScreen = (pointLon, pointLat) => {
    const { x, y } = worldPixel(pointLon, pointLat, zoom);
    return { x: x - origin.x, y: y - origin.y };
  };

  let tiles = 0;
  let error = null;
  const screen = screenBounds({ lat, lon, zoom, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, anchorX, anchorY });
  const drawn = mapsOfScreen(maps, screen);
  if (drawn.length > 0) {
    try {
      if (drawn.every((map) => map.native)) {
        // opened natively (vector_maps.js): mapsforge-rs draws into the framebuffer, the icons and names are drawn here
        const view = { lat, lon, zoom, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, anchorX, anchorY };
        const result = drawn[0].native.render(drawn.map((map) => map.native.id), view, fb.pixels);
        const target = rasterTarget(fb);
        result.icons.forEach(({ x, y, icon }) => target.icon(x, y, NATIVE_ICONS[icon]));
        result.labels.forEach(({ x, y, text, rank }) => target.label(x, y, text, rank));
        tiles = result.tiles;
      } else {
        const view = (map) => makeView({
          lat, lon, zoom, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, anchorX, anchorY, tileSize: map.header.tileSize,
        });
        tiles = renderMap(drawn, view, rasterTarget(fb));
      }
    } catch (e) {
      error = e;
    }
  } else {
    tiles = drawRasterTiles(fb, readTile, zoom, origin);
  }

  const points = track ? track.lines.flat() : [];
  if (track && showTrack) {
    drawTrack(fb, placeTrack(track.lines, toScreen), trackColor);
  }

  // position marker in the color of the track, the circle shows the precision
  if (position) {
    const { x, y } = toScreen(position.lon, position.lat);
    const metersPerPixel = EQUATOR * Math.cos(position.lat * Math.PI / 180) / (TILE * 2 ** zoom);
    circleFill(fb, x, y, 6, trackColor);
    circleFill(fb, x, y, 2, WHITE);
    circleDraw(fb, x, y, Math.max(Math.round((position.accuracy ?? 0) / metersPerPixel), 8), BLACK);
  }

  topBar(fb, { battery, satellites, hasPosition: !!position });

  const graph = showHeightGraph && points.length >= 2;
  const shift = graph ? 0 : GRAPH_SHIFT;

  drawText(fb, SCREEN_WIDTH - textWidth(COPYRIGHT) - 1, SCREEN_HEIGHT - 10 - GRAPH_HEIGHT + shift + 1, COPYRIGHT, BLACK);

  if (graph) {
    heightGraph(fb, points, position ? closestPoint(points, position.lat, position.lon) : -1);
  }

  // black strip with the name of the track or the position
  const gpsInfo = () => {
    if (!position) {
      return 'GPS: no position';
    }
    const accuracy = Number.isFinite(position.accuracy) ? ` (+-${Math.round(position.accuracy)}m)` : '';
    return `GPS: ${hemisphere(position.lat, 'N', 'S')} ${hemisphere(position.lon, 'E', 'W')} ${(position.altitude ?? 0).toFixed(2)}m${accuracy}`;
  };
  const info = (track?.name && showTrack ? track.name : gpsInfo()).slice(0, INFO_LENGTH);
  const infoTop = SCREEN_HEIGHT - INFO_HEIGHT;
  fillRect(fb, 0, infoTop, SCREEN_WIDTH, INFO_HEIGHT, BLACK);
  drawText(fb, SCALE_AREA + 1 + Math.trunc((SCREEN_WIDTH - SCALE_AREA - textWidth(info)) / 2), infoTop + 1 + (INFO_HEIGHT - CHAR_HEIGHT) / 2, info, WHITE);

  // scale at the left of the bar: a white bracket open at the top with the distance in it, only with a position
  if (position && scale > 0) {
    const scaleTop = SCREEN_HEIGHT - 14;
    const scaleBottom = SCREEN_HEIGHT - 1;
    drawText(fb, SCALE_LEFT + 1 + Math.trunc((scale - textWidth(text)) / 2), scaleBottom - CHAR_HEIGHT - 1, text, WHITE);
    line(fb, SCALE_LEFT, scaleTop, SCALE_LEFT, scaleBottom, WHITE);
    line(fb, SCALE_LEFT + scale - 1, scaleTop, SCALE_LEFT + scale - 1, scaleBottom, WHITE);
    line(fb, SCALE_LEFT, scaleBottom, SCALE_LEFT + scale - 1, scaleBottom, WHITE);
  }

  return { fb, source: drawn.length > 0 ? 'vector' : 'tiles', tiles, drawn, error };
};
