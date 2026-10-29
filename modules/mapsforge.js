// Reads Mapsforge map files (.map, binary format version 3 to 5) and draws them like the IndiaNavi does. A port of the
// reader and the renderer of the firmware (lib/mapsforge-rs, src/visit.rs, src/view.rs and src/render.rs): the same
// tiles are read, the same styles (vector_style.js) are picked and the shapes are drawn in the same order, so the
// simulated display of the app shows what the device shows.
//
// The file is read through a source { size, read(offset, length) => Uint8Array }, on the phone a file handle of
// expo-file-system, in the tests a buffer. Map files have several GB, only the header and the visible tiles are read.

import { POI_RULES, WAY_RULES, WATER, casingOrder, inkA, order, solid, style as makeStyle, widthAt, WHITE } from './vector_style.js';

const MAGIC = 'mapsforge binary OSM';
const MIN_VERSION = 3;

const DEBUG_INFO = 0x80;
const START_POSITION = 0x40;
const START_ZOOM = 0x20;
const LANGUAGE = 0x10;
const COMMENT = 0x08;
const CREATED_BY = 0x04;

const INDEX_SIGNATURE_SIZE = 16;
const SIGNATURE_SIZE = 32;
const INDEX_ENTRY_SIZE = 5;
const WATER_TILE = 0x80;

// layers are stored as 0..10, 5 is layer 0
const LAYER_OFFSET = 5;

// strings and node lists larger than this are a damaged file
const MAX_ITEMS = 1 << 20;

// tiles of at most this many degrees of latitude are projected with the scale at their middle
const LINEAR_MAX_TILE_DEGREES = 0.5;

// UTF-8 to a string, Hermes has no TextDecoder. Broken sequences become U+FFFD.
export const decodeUtf8 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i++];
    let code;
    let extra;
    if (byte < 0x80) {
      code = byte;
      extra = 0;
    } else if (byte >= 0xc0 && byte < 0xe0) {
      code = byte & 0x1f;
      extra = 1;
    } else if (byte >= 0xe0 && byte < 0xf0) {
      code = byte & 0x0f;
      extra = 2;
    } else if (byte >= 0xf0 && byte < 0xf8) {
      code = byte & 0x07;
      extra = 3;
    } else {
      text += '\ufffd';
      continue;
    }
    for (; extra > 0; extra--) {
      if (i >= bytes.length || (bytes[i] & 0xc0) !== 0x80) {
        code = 0xfffd;
        break;
      }
      code = (code << 6) | (bytes[i++] & 0x3f);
    }
    text += String.fromCodePoint(code > 0x10ffff ? 0xfffd : code);
  }
  return text;
};

export class MapError extends Error {}

// Reads the numbers and strings of the format from a byte array
class Cursor {
  constructor(bytes, position = 0) {
    this.bytes = bytes;
    this.position = position;
  }

  need(count) {
    if (this.position + count > this.bytes.length) {
      throw new MapError('The map file ends too early');
    }
  }

  u8() {
    this.need(1);
    return this.bytes[this.position++];
  }

  u16() {
    return this.u8() * 256 + this.u8();
  }

  u32() {
    return this.u16() * 65536 + this.u16();
  }

  i32() {
    const value = this.u32();
    return value >= 2 ** 31 ? value - 2 ** 32 : value;
  }

  // 8 bytes, exact up to 2^53
  u64() {
    return this.u32() * 2 ** 32 + this.u32();
  }

  skip(count) {
    this.need(count);
    this.position += count;
  }

  // variable length unsigned number: 7 bits per byte, the high bit says that another byte follows
  vbeU() {
    let value = 0;
    let factor = 1;
    for (;;) {
      const byte = this.u8();
      value += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) {
        return value;
      }
      factor *= 128;
    }
  }

  // variable length signed number: the last byte has 6 bits and the sign in bit 6
  vbeS() {
    let value = 0;
    let factor = 1;
    for (;;) {
      const byte = this.u8();
      if ((byte & 0x80) === 0) {
        value += (byte & 0x3f) * factor;
        return byte & 0x40 ? -value : value;
      }
      value += (byte & 0x7f) * factor;
      factor *= 128;
    }
  }

  degrees() {
    return this.vbeS() / 1e6;
  }

  string() {
    const length = this.vbeU();
    if (length > MAX_ITEMS) {
      throw new MapError('The map file is damaged (string too long)');
    }
    this.need(length);
    const text = decodeUtf8(this.bytes.subarray(this.position, this.position + length));
    this.position += length;
    return text;
  }

  bytesOf(length) {
    this.need(length);
    const bytes = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return bytes;
  }
}

// ---- Web Mercator ----

const lonToX = (lon, world) => (lon + 180) / 360 * world;

const latToY = (lat, world) => {
  const rad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * world;
};

const tileToLon = (x, zoom) => x / 2 ** zoom * 360 - 180;

const tileToLat = (y, zoom) => {
  const n = Math.PI - 2 * Math.PI * y / 2 ** zoom;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// Tile x, y of a position at a zoom level
export const tileAt = (lat, lon, zoom) => {
  const n = 2 ** zoom;
  const rad = lat * Math.PI / 180;
  return {
    x: Math.floor((lon + 180) / 360 * n),
    y: Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n),
  };
};

// ---- header ----

const readBoundingBox = (cursor) => {
  const [minLat, minLon, maxLat, maxLon] = [cursor.i32(), cursor.i32(), cursor.i32(), cursor.i32()].map((v) => v / 1e6);
  if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180 || minLat > maxLat || minLon > maxLon) {
    throw new MapError('The map file has an invalid bounding box');
  }
  return { minLat, minLon, maxLat, maxLon };
};

// Reads the header of a map file from its first bytes
export const parseHeader = (bytes) => {
  const cursor = new Cursor(bytes);
  if (bytes.length < MAGIC.length + 4 || decodeUtf8(cursor.bytesOf(MAGIC.length)) !== MAGIC) {
    throw new MapError('The file is not a Mapsforge map');
  }
  const headerSize = cursor.u32();
  const version = cursor.u32();
  if (version < MIN_VERSION) {
    throw new MapError(`Map files of version ${version} are not supported`);
  }
  const header = {
    headerSize,
    version,
    fileSize: cursor.u64(),
    created: cursor.u64(),
    bounds: readBoundingBox(cursor),
    tileSize: cursor.u16(),
    projection: cursor.string(),
  };
  const flags = cursor.u8();
  header.flags = flags;
  header.debug = (flags & DEBUG_INFO) !== 0;
  if (flags & START_POSITION) {
    header.startPosition = { lat: cursor.i32() / 1e6, lon: cursor.i32() / 1e6 };
  }
  if (flags & START_ZOOM) {
    header.startZoom = cursor.u8();
  }
  if (flags & LANGUAGE) {
    header.language = cursor.string();
  }
  if (flags & COMMENT) {
    header.comment = cursor.string();
  }
  if (flags & CREATED_BY) {
    header.createdBy = cursor.string();
  }
  header.poiTags = Array.from({ length: cursor.u16() }, () => cursor.string());
  header.wayTags = Array.from({ length: cursor.u16() }, () => cursor.string());
  header.zoomIntervals = Array.from({ length: cursor.u8() }, () => ({
    baseZoom: cursor.u8(),
    minZoom: cursor.u8(),
    maxZoom: cursor.u8(),
    start: cursor.u64(),
    size: cursor.u64(),
  }));
  return header;
};

// Size of the header: magic, its size field and the header itself
const headerLength = (bytes) => MAGIC.length + 4 + new Cursor(bytes, MAGIC.length).u32();

// ---- styles ----

// Index of the first rule matching a tag string and its style (null = hidden), undefined if no rule matches
const classify = (rules, tag) => {
  const at = tag.indexOf('=');
  if (at < 0) {
    return undefined;
  }
  const key = tag.slice(0, at);
  const value = tag.slice(at + 1);
  const index = rules.findIndex(([k, pattern]) =>
    k === key && (pattern.endsWith('*') ? value.startsWith(pattern.slice(0, -1)) : pattern === value));
  return index < 0 ? undefined : { rule: index, style: rules[index][2] };
};

// The style of the earliest rule among the tags of a feature, null if unstyled or hidden
const pick = (table, tagIds) => {
  let best;
  for (const id of tagIds) {
    const entry = table[id];
    if (entry && (best === undefined || entry.rule < best.rule)) {
      best = entry;
    }
  }
  return best?.style ?? null;
};

// ---- the map ----

// Opens a map file. Throws a MapError if it is not a Mapsforge map.
export const openMap = (source) => {
  const start = source.read(0, Math.min(source.size, MAGIC.length + 4));
  if (start.length < MAGIC.length + 4 || decodeUtf8(start.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new MapError('The file is not a Mapsforge map');
  }
  const header = parseHeader(source.read(0, headerLength(start)));
  return {
    source,
    header,
    poiStyles: header.poiTags.map((tag) => classify(POI_RULES, tag)),
    wayStyles: header.wayTags.map((tag) => classify(WAY_RULES, tag)),
    // the bytes of the last tiles that were read, the map is redrawn often at the same place
    cache: new Map(),
  };
};

// Range of the tiles of a sub file at its base zoom level
const tileRange = (header, baseZoom) => {
  const { minLat, minLon, maxLat, maxLon } = header.bounds;
  const topLeft = tileAt(maxLat, minLon, baseZoom);
  const bottomRight = tileAt(minLat, maxLon, baseZoom);
  return { xMin: topLeft.x, yMin: topLeft.y, xMax: bottomRight.x, yMax: bottomRight.y };
};

export const subFileForZoom = (header, zoom) =>
  header.zoomIntervals.findIndex(({ minZoom, maxZoom }) => zoom >= minZoom && zoom <= maxZoom);

// Index of tile x, y in the sub file, -1 outside of the map
const tileIndex = (header, subFile, x, y) => {
  const range = tileRange(header, header.zoomIntervals[subFile].baseZoom);
  if (x < range.xMin || x > range.xMax || y < range.yMin || y > range.yMax) {
    return -1;
  }
  return (y - range.yMin) * (range.xMax - range.xMin + 1) + (x - range.xMin);
};

const tileCount = (header, subFile) => {
  const range = tileRange(header, header.zoomIntervals[subFile].baseZoom);
  return (range.xMax - range.xMin + 1) * (range.yMax - range.yMin + 1);
};

// The bytes of a tile and if it is a water tile; null for an empty tile
const readTile = (map, subFile, index) => {
  const key = `${subFile}/${index}`;
  const cached = map.cache.get(key);
  if (cached !== undefined) {
    // most recently used last
    map.cache.delete(key);
    map.cache.set(key, cached);
    return cached;
  }
  const { header, source } = map;
  const interval = header.zoomIntervals[subFile];
  const indexStart = interval.start + (header.debug ? INDEX_SIGNATURE_SIZE : 0) + index * INDEX_ENTRY_SIZE;
  const last = index + 1 >= tileCount(header, subFile);
  const entries = source.read(indexStart, last ? INDEX_ENTRY_SIZE : 2 * INDEX_ENTRY_SIZE);
  const offsetOf = (at) => (entries[at] & 0x7f) * 2 ** 32 + new Cursor(entries, at + 1).u32();
  const offset = offsetOf(0);
  const end = last ? interval.size : offsetOf(INDEX_ENTRY_SIZE);
  const tile = {
    water: (entries[0] & WATER_TILE) !== 0,
    // a tile without data has the same offset as the next one
    bytes: end > offset ? source.read(interval.start + offset, end - offset) : null,
  };
  map.cache.set(key, tile);
  if (map.cache.size > 48) {
    map.cache.delete(map.cache.keys().next().value);
  }
  return tile;
};

const readTagIds = (cursor, count, tags) => {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = cursor.vbeU();
    if (id >= tags.length) {
      throw new MapError('The map file is damaged (unknown tag)');
    }
    ids.push(id);
  }
  // tags like maxspeed=%i have their value after the ids
  for (const id of ids) {
    const at = tags[id].indexOf('=%');
    const kind = at < 0 ? undefined : tags[id][at + 2];
    if (kind === 'b') {
      cursor.skip(1);
    } else if (kind === 'h') {
      cursor.skip(2);
    } else if (kind === 'i' || kind === 'f') {
      cursor.skip(4);
    } else if (kind === 's') {
      cursor.skip(cursor.vbeU());
    }
  }
  return ids;
};

// Coordinates of a block: the first node is an offset from the top left corner of the tile, the others are deltas
// (or deltas of deltas)
const readNodes = (cursor, count, doubleDelta) => {
  if (count > MAX_ITEMS) {
    throw new MapError('The map file is damaged (too many way nodes)');
  }
  const nodes = [];
  if (count === 0) {
    return nodes;
  }
  let lat = cursor.degrees();
  let lon = cursor.degrees();
  nodes.push([lat, lon]);
  let dLat = 0;
  let dLon = 0;
  for (let i = 1; i < count; i++) {
    const a = cursor.degrees();
    const b = cursor.degrees();
    if (doubleDelta) {
      dLat += a;
      dLon += b;
    } else {
      dLat = a;
      dLon = b;
    }
    lat += dLat;
    lon += dLon;
    nodes.push([lat, lon]);
  }
  return nodes;
};

// Hands the POIs and ways of a tile that are visible at the zoom level to the visitor:
// { poi({ position: [lat, lon], layer, tagIds, name }), way({ layer, tagIds, name, blocks }), acceptWay(bitmap) }.
// Positions are offsets in degrees from the top left corner of the tile. Returns { water } of the tile, null for a
// tile outside of the map.
export const visitTile = (map, subFile, x, y, zoom, visitor) => {
  const { header } = map;
  const index = tileIndex(header, subFile, x, y);
  if (index < 0) {
    return null;
  }
  const tile = readTile(map, subFile, index);
  if (tile.bytes === null) {
    return { water: tile.water };
  }
  const interval = header.zoomIntervals[subFile];
  const cursor = new Cursor(tile.bytes);
  if (header.debug) {
    cursor.skip(SIGNATURE_SIZE);
  }
  const rows = Math.min(Math.max(zoom, interval.minZoom), interval.maxZoom) - interval.minZoom + 1;
  let pois = 0;
  let ways = 0;
  for (let row = 0; row <= interval.maxZoom - interval.minZoom; row++) {
    const p = cursor.vbeU();
    const w = cursor.vbeU();
    if (row < rows) {
      pois += p;
      ways += w;
    }
  }
  const firstWay = cursor.vbeU();
  const waysStart = cursor.position + firstWay;

  for (let i = 0; i < pois; i++) {
    if (header.debug) {
      cursor.skip(SIGNATURE_SIZE);
    }
    const position = [cursor.degrees(), cursor.degrees()];
    const special = cursor.u8();
    const layer = (special >> 4) - LAYER_OFFSET;
    const tagIds = readTagIds(cursor, special & 0x0f, header.poiTags);
    const flags = cursor.u8();
    const name = flags & 0x80 ? cursor.string() : null;
    if (flags & 0x40) {
      cursor.string(); // house number
    }
    if (flags & 0x20) {
      cursor.vbeS(); // elevation
    }
    visitor.poi?.({ position, layer, tagIds, name });
  }

  cursor.position = waysStart;
  for (let i = 0; i < ways; i++) {
    if (header.debug) {
      cursor.skip(SIGNATURE_SIZE);
    }
    const size = cursor.vbeU();
    const dataStart = cursor.position;
    const bitmap = cursor.u16();
    if (visitor.acceptWay && !visitor.acceptWay(bitmap)) {
      cursor.position = dataStart + size;
      continue;
    }
    const special = cursor.u8();
    const layer = (special >> 4) - LAYER_OFFSET;
    const tagIds = readTagIds(cursor, special & 0x0f, header.wayTags);
    const flags = cursor.u8();
    const name = flags & 0x80 ? cursor.string() : null;
    if (flags & 0x40) {
      cursor.string(); // house number
    }
    if (flags & 0x20) {
      cursor.string(); // ref
    }
    if (flags & 0x10) {
      cursor.degrees(); // label position
      cursor.degrees();
    }
    const dataBlocks = flags & 0x08 ? cursor.vbeU() : 1;
    const doubleDelta = (flags & 0x04) !== 0;
    const blocks = [];
    for (let d = 0; d < dataBlocks; d++) {
      const count = cursor.vbeU();
      for (let b = 0; b < count; b++) {
        blocks.push(readNodes(cursor, cursor.vbeU(), doubleDelta));
      }
    }
    // the size of the way is authoritative, it also skips data of newer versions
    cursor.position = dataStart + size;
    visitor.way?.({ bitmap, layer, tagIds, name, blocks });
  }
  return { water: tile.water };
};

// ---- view ----

// The screen: the position lat, lon is drawn at the pixel anchorX, anchorY of a width x height screen
export const makeView = ({ lat, lon, zoom, width, height, anchorX = Math.trunc(width / 2), anchorY = Math.trunc(height / 2), tileSize = 256 }) => {
  const world = tileSize * 2 ** zoom;
  return { lat, lon, zoom, width, height, tileSize, world, left: lonToX(lon, world) - anchorX, top: latToY(lat, world) - anchorY };
};

// Tiles of a sub file with baseZoom that overlap the screen
const visibleTiles = (view, baseZoom) => {
  const span = view.tileSize * 2 ** (view.zoom - baseZoom);
  const n = 2 ** baseZoom - 1;
  const clamp = (v) => Math.min(Math.max(Math.floor(v), 0), n);
  return {
    xMin: clamp(view.left / span),
    xMax: clamp((view.left + view.width - 1) / span),
    yMin: clamp(view.top / span),
    yMax: clamp((view.top + view.height - 1) / span),
  };
};

// Turns the offsets in a tile into screen pixels
const tileProjection = (view, x, y, baseZoom) => {
  const originLat = tileToLat(y, baseZoom);
  const originLon = tileToLon(x, baseZoom);
  const originX = lonToX(originLon, view.world) - view.left;
  const originY = latToY(originLat, view.world) - view.top;
  const scaleX = view.world / 360;
  const nextLat = tileToLat(y + 1, baseZoom);
  const exact = originLat - nextLat > LINEAR_MAX_TILE_DEGREES;
  const scaleY = scaleX / Math.cos((originLat + nextLat) / 2 * Math.PI / 180);
  return {
    originX,
    originY,
    project: exact
      ? ([lat, lon]) => [originX + lon * scaleX, latToY(originLat + lat, view.world) - view.top]
      : ([lat, lon]) => [originX + lon * scaleX, originY - lat * scaleY],
  };
};

// screen pixels are 16 bit numbers on the device, coordinates are cut towards zero
const toPixel = (value) => Math.trunc(Math.min(Math.max(value, -30000), 30000));

const isClosed = (block) => {
  if (block.length <= 3) {
    return false;
  }
  const [a, b] = [block[0], block[block.length - 1]];
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
};

// 4x4 cells of a tile (bit 15 is the top left one) that touch the screen
const visibleCells = (projection, view, baseZoom) => {
  const cell = view.tileSize * 2 ** (view.zoom - baseZoom) / 4;
  let mask = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const left = projection.originX + col * cell;
      const top = projection.originY + row * cell;
      if (left < view.width && left + cell > 0 && top < view.height && top + cell > 0) {
        mask |= 0x8000 >> (row * 4 + col);
      }
    }
  }
  return mask;
};

const sortKey = (layer, style) => ((Math.min(Math.max(layer, -5), 5) + 5) << 8) | style.order;

// Projects a ring, points on the same pixel as the one before are left out. Returns { points, visible }.
const projectRing = (projection, block, view) => {
  const points = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let lastX = NaN;
  let lastY = NaN;
  for (const node of block) {
    const [fx, fy] = projection.project(node);
    const x = toPixel(fx);
    const y = toPixel(fy);
    if (x === lastX && y === lastY) {
      continue;
    }
    lastX = x;
    lastY = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    points.push(x, y);
  }
  return { points, visible: maxX >= 0 && maxY >= 0 && minX < view.width && minY < view.height };
};

const SEA_STYLE = makeStyle({ kind: 'area', color: WATER, order: order.SEA });

// Collects the shapes of all visible tiles and sorts them into the drawing order of the firmware.
// Returns { commands, labels, tiles }: commands are { shape: 'polygon' | 'line' | 'point', style, rings }, rings are
// flat [x0, y0, x1, y1, ...] arrays, labels are { x, y, text, rank }. tiles is the number of tiles with data.
export const collectScene = (map, view) => {
  const subFile = subFileForZoom(map.header, view.zoom);
  const scene = { commands: [], labels: [], tiles: 0 };
  if (subFile < 0) {
    return scene;
  }
  const baseZoom = map.header.zoomIntervals[subFile].baseZoom;
  const range = visibleTiles(view, baseZoom);
  const { zoom } = view;
  for (let y = range.yMin; y <= range.yMax; y++) {
    for (let x = range.xMin; x <= range.xMax; x++) {
      const projection = tileProjection(view, x, y, baseZoom);
      const cells = visibleCells(projection, view, baseZoom);
      const meta = visitTile(map, subFile, x, y, zoom, {
        acceptWay: (bitmap) => bitmap === 0 || (bitmap & cells) !== 0,
        poi: ({ position, layer, tagIds, name }) => {
          const style = pick(map.poiStyles, tagIds);
          if (style === null || style.minZoom > zoom) {
            return;
          }
          const [fx, fy] = projection.project(position);
          const px = toPixel(fx);
          const py = toPixel(fy);
          if (px < 0 || py < 0 || px >= view.width || py >= view.height) {
            return;
          }
          if (style.label > 0) {
            if (name) {
              scene.labels.push({ x: px, y: py, text: name, rank: style.label });
            }
            return;
          }
          scene.commands.push({ key: sortKey(layer, style), shape: 'point', style, rings: [[px, py]] });
        },
        way: ({ layer, tagIds, blocks }) => {
          const found = pick(map.wayStyles, tagIds);
          if (found === null || found.kind === 'poi' || found.minZoom > zoom) {
            return;
          }
          const style = { ...found, width: widthAt(found, zoom) };
          const rings = [];
          let visible = false;
          let closed = false;
          blocks.forEach((block, i) => {
            const ring = projectRing(projection, block, view);
            if (i === 0) {
              visible = ring.visible;
              closed = isClosed(block);
            }
            if (ring.points.length >= 4) {
              rings.push(ring.points);
            }
          });
          if (!visible || rings.length === 0) {
            return;
          }
          const shape = style.kind === 'area' && closed ? 'polygon' : 'line';
          // lines only use their first block
          const command = { key: sortKey(layer, style), shape, style, rings: shape === 'line' ? [rings[0]] : rings };
          if (shape === 'line' && style.casing > 0) {
            // white casing below all lines of the layer
            const casing = { ...style, color: solid(WHITE), width: style.width + 2 * style.casing, order: casingOrder(style), casing: 0 };
            scene.commands.push({ ...command, key: sortKey(layer, casing), style: casing });
          }
          scene.commands.push(command);
        },
      });
      if (meta === null) {
        continue;
      }
      scene.tiles++;
      if (meta.water) {
        // water tiles have no sea polygon of their own: the whole tile is water
        const span = view.tileSize * 2 ** (zoom - baseZoom);
        const [x0, y0] = [projection.originX, projection.originY];
        const ring = [x0, y0, x0 + span, y0, x0 + span, y0 + span, x0, y0 + span].map(toPixel);
        scene.commands.push({ key: 0, shape: 'polygon', style: SEA_STYLE, rings: [ring] });
      }
    }
  }
  // stable: the order of the file within the same layer and style order
  scene.commands.sort((a, b) => a.key - b.key);
  // names on top of everything, the most important first
  scene.labels.sort((a, b) => a.rank - b.rank);
  return scene;
};

// Corners of a POI symbol of radius r around x, y
const symbolRing = (symbol, x, y, r) => {
  switch (symbol) {
    case 'square':
      return [x - r, y - r, x + r, y - r, x + r, y + r + 1, x - r, y + r + 1];
    case 'diamond':
      return [x, y - r - 1, x + r + 1, y, x, y + r + 1, x - r - 1, y];
    case 'triangle':
      return [x, y - r - 1, x + r + 1, y + r + 1, x - r - 1, y + r + 1];
    default:
      return null;
  }
};

// Draws the scene with a target { fillPolygon(rings, paint), polyline(points, paint, width), point(x, y, paint, radius),
// label(x, y, text, rank) }, back to front, like the firmware hands it to its rasterizer
export const drawScene = (scene, target) => {
  for (const { shape, style, rings } of scene.commands) {
    if (shape === 'point') {
      const [x, y] = rings[0];
      if (style.symbol === 'disc') {
        if (style.outline !== null) {
          target.point(x, y, solid(style.outline), style.width + 1);
        }
        target.point(x, y, style.color, style.width);
      } else {
        if (style.outline !== null) {
          target.fillPolygon([symbolRing(style.symbol, x, y, style.width + 1)], solid(style.outline));
        }
        target.fillPolygon([symbolRing(style.symbol, x, y, style.width)], style.color);
      }
    } else if (shape === 'line') {
      // an area that is not closed: its border in the main ink
      if (style.kind === 'area') {
        target.polyline(rings[0], inkA(style.color), 1);
      } else {
        target.polyline(rings[0], style.color, style.width);
      }
    } else {
      target.fillPolygon(rings, style.color);
      if (style.outline !== null) {
        for (const ring of rings) {
          target.polyline([...ring, ring[0], ring[1]], solid(style.outline), 1);
        }
      }
    }
  }
  for (const { x, y, text, rank } of scene.labels) {
    target.label(x, y, text, rank);
  }
};

// Draws the map at the view into the target, returns the number of tiles with data
export const renderMap = (map, view, target) => {
  const scene = collectScene(map, view);
  drawScene(scene, target);
  return scene.tiles;
};

// true if the position is inside the bounding box of the map
export const mapCovers = (header, lat, lon) => {
  const { minLat, minLon, maxLat, maxLon } = header.bounds;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
};

// Position to show a map at: its start position, or the middle of its bounding box
export const mapCenter = (header) => header.startPosition ?? {
  lat: (header.bounds.minLat + header.bounds.maxLat) / 2,
  lon: (header.bounds.minLon + header.bounds.maxLon) / 2,
};

// A source over the bytes of a whole file in memory (tests, small maps)
export const bufferSource = (bytes) => ({
  size: bytes.length,
  read: (offset, length) => bytes.subarray(offset, Math.min(offset + length, bytes.length)),
});
