// The map screen of the IndiaNavi, drawn the way the firmware draws it (src/screens/map_screen.c): the vector map
// with the track, its direction arrows and the position marker, the top bar, the scale, the copyright notice, the
// height graph and the black info strip at the bottom. The app shows it as a simulated display.

import { ICON_SIZE } from './icons.js';
import { MAX_DRAWN, screenBounds, selectMaps } from './map_catalog.js';
import { makeView, renderMap } from './mapsforge.js';
import {
  BLACK, CHAR_HEIGHT, WHITE, circleDraw, circleFill, drawIcon, drawText, fillRect, labelPlacer, line, makeFramebuffer,
  rasterTarget, setPixel, textWidth,
} from './navi_raster.js';
import { lat2world, lon2world } from './tiles.js';

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

// The two scales the button switches between: zoom level, width of the scale and its text
export const NAVI_ZOOMS = [
  { zoom: 16, scale: 63, text: '100m' },
  { zoom: 14, scale: 77, text: '500m' },
];

const MARGIN = 5;
const MARGIN_WIDE = 10;
const TOP_BAR_HEIGHT = ICON_SIZE + MARGIN_WIDE;

const GRAPH_HEIGHT = 45;
// the scale and the copyright notice move down without the height graph
const GRAPH_SHIFT = 29;
const INFO_HEIGHT = 16;
const INFO_LENGTH = SCREEN_WIDTH / 8 - 1;

const ARROW_SPACING = 80;
const ARROW_LOOKAHEAD = 12;
const ARROW_MARGIN = 5;

const COPYRIGHT = '(c) OpenStreetMap contributors';

// An icon with a text right of it, returns the right edge of the text
const iconWithText = (fb, name, left, text = '') => {
  drawIcon(fb, name, left, MARGIN);
  const textLeft = left + ICON_SIZE + MARGIN;
  drawText(fb, textLeft + 1, MARGIN + 1, text, BLACK);
  return textLeft + textWidth(text);
};

const topBar = (fb, { battery, satellites }) => {
  fillRect(fb, 0, 0, SCREEN_WIDTH, TOP_BAR_HEIGHT, WHITE);
  line(fb, 0, 0, SCREEN_WIDTH - 1, 0, BLACK);
  line(fb, 0, TOP_BAR_HEIGHT - 1, SCREEN_WIDTH - 1, TOP_BAR_HEIGHT - 1, BLACK);
  line(fb, 0, 0, 0, TOP_BAR_HEIGHT - 1, BLACK);
  line(fb, SCREEN_WIDTH - 1, 0, SCREEN_WIDTH - 1, TOP_BAR_HEIGHT - 1, BLACK);

  const level = [0, 10, 30, 50, 80, 100].filter((step) => step <= battery).pop() ?? 0;
  drawIcon(fb, `bat_${level}`, MARGIN, MARGIN);
  drawText(fb, MARGIN + ICON_SIZE + 1, MARGIN + 1, `${battery}%`, BLACK);
  const north = MARGIN + ICON_SIZE + textWidth(`${battery}%`) + MARGIN_WIDE;
  // the WiFi is off while the device is not charging, so its place stays empty, Bluetooth advertises
  const wifi = iconWithText(fb, 'norden', north) + MARGIN_WIDE;
  const bluetooth = wifi + ICON_SIZE + MARGIN + MARGIN_WIDE;
  drawIcon(fb, 'BLE', bluetooth, MARGIN);

  const gps = SCREEN_WIDTH - ICON_SIZE - 2 * MARGIN - 16;
  iconWithText(fb, 'GPS_lock', gps, String(satellites));
  drawIcon(fb, 'SD', gps - 2 * ICON_SIZE - MARGIN, MARGIN);
};

// Position of the track points on the screen: points outside of the 3x3 tiles are not active
const placeTrack = (lines, zoom, centerTileX, centerTileY) => {
  const n = 2 ** zoom;
  return lines.map((points) => points.map(([lon, lat]) => {
    const worldX = lon2world(lon) * n;
    const worldY = lat2world(lat) * n;
    const tx = Math.floor(worldX) - (centerTileX - 1);
    const ty = Math.floor(worldY) - (centerTileY - 1);
    const active = tx >= 0 && tx < 3 && ty >= 0 && ty < 3;
    return {
      x: tx * TILE + Math.floor((worldX % 1) * TILE) + MAP_LEFT,
      y: ty * TILE + Math.floor((worldY % 1) * TILE) + MAP_TOP,
      active,
    };
  }));
};

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Arrows in the direction of the track, every ARROW_SPACING pixels along its visible parts
const placeArrows = (points) => {
  const arrows = [];
  let travelled = ARROW_SPACING / 2;
  points.forEach((point, i) => {
    const next = points[i + 1];
    if (!point.active || !next?.active) {
      return;
    }
    travelled += distance(point, next);
    if (travelled < ARROW_SPACING) {
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

// The tiles of the SD card in the 3x3 tiles around the position, as map_render of the firmware draws them: the raw
// pixels (the high 4 bits are the left pixel), "Not Found" in a tile that is not there. Returns the tiles drawn.
const drawRasterTiles = (fb, readTile, zoom, centerTileX, centerTileY) => {
  let drawn = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const left = MAP_LEFT + i * TILE;
      const top = MAP_TOP + j * TILE;
      const data = readTile?.({ zoom, x: centerTileX - 1 + i, y: centerTileY - 1 + j });
      if (!data || data.length < RAW_TILE_BYTES) {
        const notFound = 'Not Found';
        drawText(fb, left + 1 + Math.trunc((TILE - textWidth(notFound)) / 2), top + 1 + (TILE - CHAR_HEIGHT) / 2, notFound, BLACK);
        continue;
      }
      drawn++;
      for (let y = Math.max(0, -top); y < TILE && top + y < SCREEN_HEIGHT; y++) {
        for (let x = Math.max(0, -left); x < TILE && left + x < SCREEN_WIDTH; x++) {
          const byte = data[(y * TILE + x) >> 1];
          fb.pixels[(top + y) * SCREEN_WIDTH + left + x] = x & 1 ? byte & 0x0f : byte >> 4;
        }
      }
    }
  }
  return drawn;
};

// Draws the map screen. options: { maps (of openMap, the maps on the SD card), readTile ({ zoom, x, y } => the raw
// tile of the SD card or null), lat, lon, zoomIndex (into NAVI_ZOOMS), track: { name, lines } or null, trackColor
// (ink), showTrack, showHeightGraph, battery, satellites, hdop, altitude }.
// Like the firmware it draws the vector maps when one covers the screen, the tiles otherwise.
// Returns { fb, source, tiles, drawn, error }: source is 'vector' or 'tiles', tiles the number of map tiles that were
// drawn (of the vector maps or the raw tiles), drawn the vector maps that were drawn, error a failed map read.
export const renderNaviScreen = ({
  maps = [], readTile = null, lat, lon, zoomIndex = 0, track = null, trackColor = BLUE, showTrack = true,
  showHeightGraph = true, battery = 80, satellites = 9, hdop = 1, altitude = 0,
}) => {
  const fb = makeFramebuffer(SCREEN_WIDTH, SCREEN_HEIGHT, WHITE);
  const { zoom, scale, text } = NAVI_ZOOMS[zoomIndex] ?? NAVI_ZOOMS[0];

  // the position is at its pixel in the tile in the middle of the 3x3 tiles
  const worldX = lon2world(lon) * 2 ** zoom;
  const worldY = lat2world(lat) * 2 ** zoom;
  const anchorX = MAP_LEFT + TILE + Math.floor((worldX % 1) * TILE);
  const anchorY = MAP_TOP + TILE + Math.floor((worldY % 1) * TILE);

  let tiles = 0;
  let error = null;
  const screen = screenBounds({ lat, lon, zoom, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, anchorX, anchorY });
  const drawn = mapsOfScreen(maps, screen);
  if (drawn.length > 0) {
    try {
      if (drawn.every((map) => map.native)) {
        // opened natively (vector_maps.js): mapsforge-rs draws into the framebuffer, the names are placed here
        const view = { lat, lon, zoom, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, anchorX, anchorY };
        const result = drawn[0].native.render(drawn.map((map) => map.native.id), view, fb.pixels);
        const label = labelPlacer(fb);
        result.labels.forEach(({ x, y, text, rank }) => label(x, y, text, rank));
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
    tiles = drawRasterTiles(fb, readTile, zoom, Math.floor(worldX), Math.floor(worldY));
  }

  const points = track ? track.lines.flat() : [];
  if (track && showTrack) {
    drawTrack(fb, placeTrack(track.lines, zoom, Math.floor(worldX), Math.floor(worldY)), trackColor);
  }

  // position marker in the color of the track, the circle shows the precision
  circleFill(fb, anchorX, anchorY, 6, trackColor);
  circleFill(fb, anchorX, anchorY, 2, WHITE);
  circleDraw(fb, anchorX, anchorY, Math.floor(hdop / 2) + 8, BLACK);

  topBar(fb, { battery, satellites });

  const graph = showHeightGraph && points.length >= 2;
  const shift = graph ? 0 : GRAPH_SHIFT;

  // scale: a bracket open at the top with the distance in it
  const scaleTop = SCREEN_HEIGHT - 15 - GRAPH_HEIGHT + shift;
  const scaleBottom = scaleTop + 12;
  drawText(fb, 10 + 1 + Math.trunc((scale - textWidth(text)) / 2), scaleTop + 13 - CHAR_HEIGHT - 1, text, BLACK);
  line(fb, 10, scaleTop, 10, scaleBottom, BLACK);
  line(fb, 10 + scale - 1, scaleTop, 10 + scale - 1, scaleBottom, BLACK);
  line(fb, 10, scaleBottom, 10 + scale - 1, scaleBottom, BLACK);

  drawText(fb, SCREEN_WIDTH - textWidth(COPYRIGHT) - 1, SCREEN_HEIGHT - 10 - GRAPH_HEIGHT + shift + 1, COPYRIGHT, BLACK);

  if (graph) {
    heightGraph(fb, points, closestPoint(points, lat, lon));
  }

  // black strip with the name of the track or the position
  const info = (track?.name && showTrack
    ? track.name
    : `GPS: ${hemisphere(lat, 'N', 'S')} ${hemisphere(lon, 'E', 'W')} ${altitude.toFixed(2)}m (HDOP:${hdop.toFixed(1)})`
  ).slice(0, INFO_LENGTH);
  const infoTop = SCREEN_HEIGHT - INFO_HEIGHT;
  fillRect(fb, 0, infoTop, SCREEN_WIDTH, INFO_HEIGHT, BLACK);
  drawText(fb, 1 + Math.trunc((SCREEN_WIDTH - textWidth(info)) / 2), infoTop + 1 + (INFO_HEIGHT - CHAR_HEIGHT) / 2, info, WHITE);

  return { fb, source: drawn.length > 0 ? 'vector' : 'tiles', tiles, drawn, error };
};
