// A framebuffer of the IndiaNavi display and the drawing functions of the firmware: one ink (0 black … 6 orange) per
// pixel. The shapes of the vector map are drawn like lib/mapsforge-rs/c/mfr_raster.c does, the text with the 8x8 font
// and the place names like lib/Platinenmacher/gui/map_labels.c, so the picture matches the display pixel by pixel.

import { FIRST_CHAR, GLYPHS, LAST_CHAR } from './font8x8.js';
import { ICONS, ICON_SIZE } from './icons.js';
import { B_BACKGROUND, B_TRANSPARENT, PATTERN_MASKS, SOLID, bCode, inkA, patternOf } from './vector_style.js';

export const BLACK = 0;
export const WHITE = 1;

// at most this many edges of a polygon cross one row, like on the device
const MAX_CROSSINGS = 128;

export const makeFramebuffer = (width, height, ink = WHITE) => ({
  width,
  height,
  pixels: new Uint8Array(width * height).fill(ink),
});

export const setPixel = (fb, x, y, ink) => {
  if (x >= 0 && y >= 0 && x < fb.width && y < fb.height) {
    fb.pixels[y * fb.width + x] = ink;
  }
};

// Run of pixels x0..x1 (both included) in one ink
export const span = (fb, y, x0, x1, ink) => {
  if (y < 0 || y >= fb.height) {
    return;
  }
  const from = Math.max(x0, 0);
  const to = Math.min(x1, fb.width - 1);
  if (from <= to) {
    fb.pixels.fill(ink, y * fb.width + from, y * fb.width + to + 1);
  }
};

export const fillRect = (fb, left, top, width, height, ink) => {
  for (let y = top; y < top + height; y++) {
    span(fb, y, left, left + width - 1, ink);
  }
};

// Run of a paint code: the pixels of a pattern are chosen by their screen position, transparent pixels are left
const spanColor = (fb, y, x0, x1, paint) => {
  const pattern = patternOf(paint);
  const a = inkA(paint);
  if (pattern === SOLID || pattern >= PATTERN_MASKS.length) {
    span(fb, y, x0, x1, a);
    return;
  }
  if (y < 0 || y >= fb.height) {
    return;
  }
  const b = bCode(paint);
  const transparent = b === B_TRANSPARENT;
  const other = b === B_BACKGROUND ? WHITE : b - 1;
  const row = (PATTERN_MASKS[pattern] >> ((y & 3) * 4)) & 0xf;
  const base = y * fb.width;
  for (let x = Math.max(x0, 0); x <= Math.min(x1, fb.width - 1); x++) {
    if ((row >> (x & 3)) & 1) {
      fb.pixels[base + x] = a;
    } else if (!transparent) {
      fb.pixels[base + x] = other;
    }
  }
};

// Fills rings (flat [x0, y0, x1, y1, ...] arrays) with the even-odd rule, inner rings are holes
export const fillPolygon = (fb, rings, paint) => {
  let minY = fb.height;
  let maxY = -1;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 2) {
      minY = Math.min(minY, ring[i]);
      maxY = Math.max(maxY, ring[i]);
    }
  }
  minY = Math.max(minY, 0);
  maxY = Math.min(maxY, fb.height - 1);
  const crossings = [];
  for (let y = minY; y <= maxY; y++) {
    crossings.length = 0;
    for (const ring of rings) {
      const count = ring.length / 2;
      for (let i = 0; i < count && crossings.length < MAX_CROSSINGS; i++) {
        // edges close the ring
        const ax = ring[2 * i];
        const ay = ring[2 * i + 1];
        const j = (i + 1) % count;
        const bx = ring[2 * j];
        const by = ring[2 * j + 1];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          crossings.push(ax + Math.trunc(((y - ay) * (bx - ax)) / (by - ay)));
        }
      }
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      spanColor(fb, y, crossings[i], crossings[i + 1], paint);
    }
  }
};

// Disc of the map symbols
export const disc = (fb, cx, cy, radius, paint) => {
  for (let dy = -radius; dy <= radius; dy++) {
    let dx = 0;
    while ((dx + 1) * (dx + 1) + dy * dy <= radius * radius + radius) {
      dx++;
    }
    spanColor(fb, cy + dy, cx - dx, cx + dx, paint);
  }
};

// Bresenham line, 1 pixel wide
export const line = (fb, x0, y0, x1, y1, paint) => {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  // a line far outside of the screen ends after this many steps
  for (let steps = 0; steps < 100000; steps++) {
    spanColor(fb, y0, x0, x0, paint);
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
};

const segmentVisible = (fb, ax, ay, bx, by) =>
  !((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax >= fb.width && bx >= fb.width) || (ay >= fb.height && by >= fb.height));

// Line of a width through the points (flat array): a quad per segment, round ends from 3 pixels on
export const polyline = (fb, points, paint, width) => {
  for (let i = 0; i + 3 < points.length; i += 2) {
    const [ax, ay, bx, by] = [points[i], points[i + 1], points[i + 2], points[i + 3]];
    if (!segmentVisible(fb, ax, ay, bx, by)) {
      continue;
    }
    if (width <= 1) {
      line(fb, ax, ay, bx, by, paint);
      continue;
    }
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    if (length > 0) {
      const inverse = (width / 2) / Math.sqrt(length);
      const nx = -dy * inverse;
      const ny = dx * inverse;
      const t = Math.trunc;
      fillPolygon(fb, [[t(ax + nx), t(ay + ny), t(bx + nx), t(by + ny), t(bx - nx), t(by - ny), t(ax - nx), t(ay - ny)]], paint);
    }
    if (width >= 3) {
      disc(fb, ax, ay, width >> 1, paint);
      disc(fb, bx, by, width >> 1, paint);
    }
  }
};

// ---- shapes of the user interface (Platinenmacher display.c) ----

export const circleFill = (fb, cx, cy, radius, ink) => {
  for (let dy = -radius; dy <= radius; dy++) {
    const dx = Math.trunc(Math.sqrt(radius * radius - dy * dy));
    span(fb, cy + dy, cx - dx, cx + dx, ink);
  }
};

export const circleDraw = (fb, cx, cy, radius, ink) => {
  let x = radius;
  let y = 0;
  let err = 1 - radius;
  while (x >= y) {
    for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) {
      setPixel(fb, cx + px, cy + py, ink);
    }
    y++;
    if (err < 0) {
      err += 2 * y + 1;
    } else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
};

// ---- text ----

export const CHAR_WIDTH = 8;
export const CHAR_HEIGHT = 8;

// Latin-1 letters (U+00C0..U+00FF) as ASCII, like the labels of the firmware
const LATIN1 = [
  'A', 'A', 'A', 'A', 'Ae', 'A', 'AE', 'C', 'E', 'E', 'E', 'E', 'I', 'I', 'I', 'I',
  'D', 'N', 'O', 'O', 'O', 'O', 'Oe', 'x', 'O', 'U', 'U', 'U', 'Ue', 'Y', 'Th', 'ss',
  'a', 'a', 'a', 'a', 'ae', 'a', 'ae', 'c', 'e', 'e', 'e', 'e', 'i', 'i', 'i', 'i',
  'd', 'n', 'o', 'o', 'o', 'o', 'oe', '-', 'o', 'u', 'u', 'u', 'ue', 'y', 'th', 'y',
];

// Text with only the characters of the font
export const toAscii = (text) => {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x80) {
      out += code >= 0x20 ? char : ' ';
    } else {
      out += code >= 0xc0 && code <= 0xff ? LATIN1[code - 0xc0] : '?';
    }
  }
  return out;
};

export const textWidth = (text) => toAscii(text).length * CHAR_WIDTH;

// Text in the 8x8 font, only the pixels of the letters are drawn
export const drawText = (fb, x, y, text, ink) => {
  let column = 0;
  for (const char of toAscii(text)) {
    let code = char.charCodeAt(0);
    if (code < FIRST_CHAR || code > LAST_CHAR) {
      code = '?'.charCodeAt(0);
    }
    const glyph = GLYPHS[code - FIRST_CHAR];
    for (let row = 0; row < CHAR_HEIGHT; row++) {
      for (let bit = 0; bit < CHAR_WIDTH; bit++) {
        if ((glyph[row] >> bit) & 1) {
          setPixel(fb, x + column * CHAR_WIDTH + bit, y + row, ink);
        }
      }
    }
    column++;
  }
};

// ---- place names ----

const MAX_LABELS = 48;
const MAX_CHARS = 32;
// free pixels between two names
const LABEL_GAP = 2;

// Place names that do not overlap: a white halo around black letters, cities in bold.
// Returns label(x, y, text, rank) for drawScene of mapsforge.js.
export const labelPlacer = (fb) => {
  const placed = [];
  const overlaps = (r) => placed.some((b) =>
    r.left < b.right + LABEL_GAP && r.right + LABEL_GAP > b.left && r.top < b.bottom + LABEL_GAP && r.bottom + LABEL_GAP > b.top);
  return (x, y, text, rank) => {
    const ascii = toAscii(text).slice(0, MAX_CHARS);
    if (ascii.length === 0 || placed.length >= MAX_LABELS) {
      return false;
    }
    const width = ascii.length * CHAR_WIDTH + (rank === 1 ? 1 : 0);
    const left = x - Math.trunc(width / 2);
    const top = y - CHAR_HEIGHT / 2;
    const r = { left, top, right: left + width, bottom: top + CHAR_HEIGHT };
    // the halo needs one pixel around the text
    if (r.left < 1 || r.top < 1 || r.right > fb.width - 1 || r.bottom > fb.height - 1 || overlaps(r)) {
      return false;
    }
    placed.push(r);
    const bold = rank === 1 ? [0, 1] : [0];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) {
          bold.forEach((b) => drawText(fb, left + dx + b, top + dy, ascii, WHITE));
        }
      }
    }
    bold.forEach((b) => drawText(fb, left + b, top, ascii, BLACK));
    return true;
  };
};

// Draws an icon (rows of ink digits, 7 is transparent) with its top-left corner at left, top. Returns false for an
// unknown icon.
export const drawIcon = (fb, name, left, top) => {
  const rows = ICONS[name];
  rows?.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '7') {
        setPixel(fb, left + x, top + y, Number(row[x]));
      }
    }
  });
  return Boolean(rows);
};

// The target of drawScene (mapsforge.js) that draws into the framebuffer
export const rasterTarget = (fb) => ({
  fillPolygon: (rings, paint) => fillPolygon(fb, rings, paint),
  polyline: (points, paint, width) => polyline(fb, points, paint, width),
  point: (x, y, paint, radius) => disc(fb, x, y, radius, paint),
  label: labelPlacer(fb),
  // the map icons of the POIs, centered on the position like map_icons_draw of the firmware
  icon: (x, y, name) => drawIcon(fb, `poi_${name}`, x - ICON_SIZE / 2, y - ICON_SIZE / 2),
});
