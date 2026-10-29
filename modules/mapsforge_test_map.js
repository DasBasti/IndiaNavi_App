// Writes small Mapsforge map files for the tests: one tile of zoom 14 around a position, with the given POIs and ways.
// Only what the reader needs, see https://github.com/mapsforge/mapsforge/blob/master/docs/Specification-Binary-Map-File.md

import { tileAt } from './mapsforge.js';

const encoder = new TextEncoder();

const BASE_ZOOM = 14;
const MIN_ZOOM = 12;
const MAX_ZOOM = 21;

class Writer {
  constructor() {
    this.bytes = [];
  }

  u8(value) {
    this.bytes.push(value & 0xff);
  }

  u16(value) {
    this.u8(value >> 8);
    this.u8(value);
  }

  u32(value) {
    this.u16(Math.floor(value / 65536) & 0xffff);
    this.u16(value & 0xffff);
  }

  i32(value) {
    this.u32(value < 0 ? value + 2 ** 32 : value);
  }

  u64(value) {
    this.u32(Math.floor(value / 2 ** 32));
    this.u32(value % 2 ** 32);
  }

  vbeU(value) {
    while (value >= 0x80) {
      this.u8((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    this.u8(value);
  }

  vbeS(value) {
    let rest = Math.abs(value);
    while (rest >= 0x40) {
      this.u8((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 128);
    }
    this.u8(rest | (value < 0 ? 0x40 : 0));
  }

  degrees(value) {
    this.vbeS(Math.round(value * 1e6));
  }

  string(text) {
    const bytes = encoder.encode(text);
    this.vbeU(bytes.length);
    bytes.forEach((byte) => this.u8(byte));
  }

  append(other) {
    this.bytes.push(...other.bytes);
  }
}

const tileLat = (y, zoom) => {
  const n = Math.PI - 2 * Math.PI * y / 2 ** zoom;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const tileLon = (x, zoom) => x / 2 ** zoom * 360 - 180;

// The bounding box of the zoom 14 tile with the position, so the map has exactly one tile
export const testTileBounds = (lat, lon) => {
  const { x, y } = tileAt(lat, lon, BASE_ZOOM);
  return { x, y, minLat: tileLat(y + 1, BASE_ZOOM), maxLat: tileLat(y, BASE_ZOOM), minLon: tileLon(x, BASE_ZOOM), maxLon: tileLon(x + 1, BASE_ZOOM) };
};

// Builds a map: pois are { lat, lon, tags: ['k=v'], name, layer }, ways are { tags, name, layer, blocks: [[[lat, lon],
// ...]] }. water marks the tile as a water tile, created is the creation date in ms. Returns the bytes of the file.
export const buildTestMap = ({ lat, lon, pois = [], ways = [], water = false, startPosition = null, created = Date.UTC(2026, 0, 1) }) => {
  const bounds = testTileBounds(lat, lon);
  const poiTags = [...new Set(pois.flatMap((poi) => poi.tags))];
  const wayTags = [...new Set(ways.flatMap((way) => way.tags))];
  const originLat = bounds.maxLat;
  const originLon = bounds.minLon;

  const poiData = new Writer();
  for (const poi of pois) {
    poiData.degrees(poi.lat - originLat);
    poiData.degrees(poi.lon - originLon);
    poiData.u8((((poi.layer ?? 0) + 5) << 4) | poi.tags.length);
    poi.tags.forEach((tag) => poiData.vbeU(poiTags.indexOf(tag)));
    poiData.u8(poi.name ? 0x80 : 0);
    if (poi.name) {
      poiData.string(poi.name);
    }
  }

  const wayData = new Writer();
  for (const way of ways) {
    const body = new Writer();
    body.u16(0xffff);
    body.u8((((way.layer ?? 0) + 5) << 4) | way.tags.length);
    way.tags.forEach((tag) => body.vbeU(wayTags.indexOf(tag)));
    body.u8(way.name ? 0x80 : 0);
    if (way.name) {
      body.string(way.name);
    }
    body.vbeU(way.blocks.length);
    for (const block of way.blocks) {
      body.vbeU(block.length);
      block.forEach(([nodeLat, nodeLon], i) => {
        const [prevLat, prevLon] = i === 0 ? [originLat, originLon] : block[i - 1];
        body.degrees(nodeLat - prevLat);
        body.degrees(nodeLon - prevLon);
      });
    }
    wayData.vbeU(body.bytes.length);
    wayData.append(body);
  }

  const tile = new Writer();
  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom++) {
    tile.vbeU(zoom === MIN_ZOOM ? pois.length : 0);
    tile.vbeU(zoom === MIN_ZOOM ? ways.length : 0);
  }
  tile.vbeU(poiData.bytes.length);
  tile.append(poiData);
  tile.append(wayData);

  const INDEX_SIZE = 5;
  const subFile = new Writer();
  subFile.u8(water ? 0x80 : 0);
  subFile.u32(INDEX_SIZE);
  subFile.append(tile);

  const header = new Writer();
  header.u64(0); // file size, patched below
  header.u64(created);
  // a micro degree inside of the tile, on its edges the neighbours would be part of the map
  [bounds.minLat + 1e-6, bounds.minLon + 1e-6, bounds.maxLat - 1e-6, bounds.maxLon - 1e-6]
    .forEach((value) => header.i32(Math.round(value * 1e6)));
  header.u16(256);
  header.string('Mercator');
  header.u8(startPosition ? 0x40 : 0);
  if (startPosition) {
    header.i32(Math.round(startPosition.lat * 1e6));
    header.i32(Math.round(startPosition.lon * 1e6));
  }
  header.u16(poiTags.length);
  poiTags.forEach((tag) => header.string(tag));
  header.u16(wayTags.length);
  wayTags.forEach((tag) => header.string(tag));
  header.u8(1);
  const headerSize = 4 + header.bytes.length + 3 + 16;
  const subFileStart = 20 + 4 + headerSize;
  header.u8(BASE_ZOOM);
  header.u8(MIN_ZOOM);
  header.u8(MAX_ZOOM);
  header.u64(subFileStart);
  header.u64(subFile.bytes.length);

  const file = new Writer();
  encoder.encode('mapsforge binary OSM').forEach((byte) => file.u8(byte));
  file.u32(headerSize);
  file.u32(3);
  file.append(header);
  file.append(subFile);
  const bytes = new Uint8Array(file.bytes);
  new DataView(bytes.buffer).setUint32(32, bytes.length);
  return bytes;
};
