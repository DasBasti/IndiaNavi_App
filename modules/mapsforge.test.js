import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MapError, bufferSource, collectScene, decodeUtf8, makeView, mapCenter, mapCovers, openMap, parseHeader, tileAt,
  visitTile,
} from './mapsforge.js';
import { buildTestMap, testTileBounds } from './mapsforge_test_map.js';
import { lat2tile, lon2tile } from './tiles.js';
import { FOREST, WATER, order } from './vector_style.js';

// The header-only test map of the firmware's reader, next to the app in the IndiaNavi folder
const FIRMWARE_TEST_MAP = new URL('../../IndiaNavi_Firmware/lib/mapsforge-rs/test_data/test_map.map', import.meta.url);

const LAT = 49.143;
const LON = 7.765;

const rect = (south, west, north, east) =>
  [[south, west], [south, east], [north, east], [north, west], [south, west]];

const testMap = (features = {}) => openMap(bufferSource(buildTestMap({ lat: LAT, lon: LON, ...features })));

const view = (zoom) => makeView({ lat: LAT, lon: LON, zoom, width: 448, height: 600 });

test('UTF-8 names are decoded', () => {
  const encode = (text) => new TextEncoder().encode(text);
  for (const text of ['Dahn', 'Hütte am Föhrenberg', 'АБВГДЕЖЗ', '日本', '🏔']) {
    assert.equal(decodeUtf8(encode(text)), text);
  }
  assert.equal(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62])), 'a�b');
});

test('the header of a map', () => {
  const map = testMap({ startPosition: { lat: LAT, lon: LON }, pois: [{ lat: LAT, lon: LON, tags: ['natural=peak'] }] });
  const { header } = map;
  assert.equal(header.version, 3);
  assert.equal(header.tileSize, 256);
  assert.equal(header.projection, 'Mercator');
  assert.deepEqual(header.poiTags, ['natural=peak']);
  assert.deepEqual(header.zoomIntervals.map(({ baseZoom, minZoom, maxZoom }) => [baseZoom, minZoom, maxZoom]), [[14, 12, 21]]);
  assert.deepEqual(header.startPosition, { lat: LAT, lon: LON });
  assert.deepEqual(mapCenter(header), { lat: LAT, lon: LON });
  assert.ok(mapCovers(header, LAT, LON));
  assert.ok(!mapCovers(header, LAT + 1, LON));
});

test('other files are not maps', () => {
  assert.throws(() => openMap(bufferSource(new TextEncoder().encode('<html>not found</html>'))), MapError);
  assert.throws(() => openMap(bufferSource(new Uint8Array(0))), MapError);
});

test('the header-only test map of the firmware', { skip: !existsSync(FIRMWARE_TEST_MAP) }, () => {
  const header = parseHeader(new Uint8Array(readFileSync(FIRMWARE_TEST_MAP)));
  assert.equal(header.tileSize, 256);
});

test('POIs and ways of a tile, as offsets from its corner', () => {
  const ways = [{ tags: ['highway=path'], name: 'Felsenpfad', layer: 1, blocks: [[[LAT, LON], [LAT + 0.001, LON + 0.002]]] }];
  const pois = [{ lat: LAT + 0.0005, lon: LON - 0.0005, tags: ['tourism=viewpoint'], name: 'Aussicht' }];
  const map = testMap({ ways, pois });
  const bounds = testTileBounds(LAT, LON);
  const found = { pois: [], ways: [] };
  const meta = visitTile(map, 0, bounds.x, bounds.y, 16, {
    poi: (poi) => found.pois.push(poi),
    way: (way) => found.ways.push(way),
  });
  assert.deepEqual(meta, { water: false });
  assert.equal(found.pois.length, 1);
  assert.equal(found.pois[0].name, 'Aussicht');
  assert.ok(Math.abs(bounds.maxLat + found.pois[0].position[0] - (LAT + 0.0005)) < 2e-6);
  assert.ok(Math.abs(bounds.minLon + found.pois[0].position[1] - (LON - 0.0005)) < 2e-6);
  assert.equal(found.ways.length, 1);
  assert.equal(found.ways[0].name, 'Felsenpfad');
  assert.equal(found.ways[0].layer, 1);
  const [first, second] = found.ways[0].blocks[0];
  assert.ok(Math.abs(bounds.maxLat + second[0] - (LAT + 0.001)) < 2e-6);
  assert.ok(Math.abs(second[1] - first[1] - 0.002) < 2e-6);

  // ways can be skipped before they are decoded, tiles outside of the map have nothing
  const skipped = [];
  visitTile(map, 0, bounds.x, bounds.y, 16, { acceptWay: () => false, way: (way) => skipped.push(way) });
  assert.deepEqual(skipped, []);
  assert.equal(visitTile(map, 0, bounds.x + 5, bounds.y, 16, {}), null);
});

test('the shapes are sorted into the drawing order of the firmware', () => {
  const map = testMap({
    ways: [
      { tags: ['highway=secondary'], blocks: [[[LAT - 0.002, LON - 0.002], [LAT + 0.002, LON + 0.002]]] },
      { tags: ['landuse=forest'], blocks: [rect(LAT - 0.003, LON - 0.003, LAT + 0.003, LON + 0.003)] },
      { tags: ['natural=water'], blocks: [rect(LAT - 0.001, LON - 0.001, LAT + 0.001, LON + 0.001)] },
      { tags: ['tunnel=yes', 'highway=primary'], blocks: [[[LAT, LON - 0.002], [LAT, LON + 0.002]]] },
    ],
    pois: [
      { lat: LAT, lon: LON + 0.001, tags: ['amenity=restaurant'] },
      { lat: LAT + 0.001, lon: LON, tags: ['place=village'], name: 'Dahn' },
      { lat: LAT - 0.001, lon: LON, tags: ['place=city'], name: 'Pirmasens' },
    ],
  });
  const scene = collectScene(map, view(16));
  assert.equal(scene.tiles, 1);
  const shapes = scene.commands.map(({ shape, style }) => [shape, style.order]);
  // forest, water, the white casing of the road, the road, the restaurant; the tunnel is hidden
  assert.deepEqual(shapes, [
    ['polygon', order.FOREST],
    ['polygon', order.WATER],
    ['line', order.CASING],
    ['line', order.ROAD],
    ['point', order.POI],
  ]);
  assert.equal(scene.commands[0].style.color, FOREST);
  // the names come after the shapes, the most important first
  assert.deepEqual(scene.labels.map(({ text, rank }) => [text, rank]), [['Pirmasens', 1], ['Dahn', 3]]);

  // restaurants are only shown on the 100 m scale, roads are thinner on the 500 m scale
  const far = collectScene(map, view(14));
  assert.ok(!far.commands.some(({ shape }) => shape === 'point'));
  assert.equal(far.commands.find(({ style }) => style.order === order.ROAD).style.width, 1);
});

test('the position is drawn at the anchor of the view', () => {
  const map = testMap({ pois: [{ lat: LAT, lon: LON, tags: ['natural=peak'] }] });
  const scene = collectScene(map, makeView({ lat: LAT, lon: LON, zoom: 16, width: 448, height: 600, anchorX: 100, anchorY: 400 }));
  const [x, y] = scene.commands[0].rings[0];
  assert.ok(Math.abs(x - 100) <= 1 && Math.abs(y - 400) <= 1, `${x},${y}`);
});

test('a water tile is filled with the sea', () => {
  const scene = collectScene(testMap({ water: true }), view(16));
  assert.equal(scene.commands.length, 1);
  assert.equal(scene.commands[0].style.color, WATER);
});

test('outside of the map there is nothing', () => {
  const scene = collectScene(testMap(), makeView({ lat: LAT + 1, lon: LON, zoom: 16, width: 448, height: 600 }));
  assert.equal(scene.tiles, 0);
  assert.deepEqual(scene.commands, []);
});

test('tile numbers are those of the tile converter', () => {
  for (const zoom of [5, 14, 16]) {
    assert.deepEqual(tileAt(LAT, LON, zoom), { x: lon2tile(LON, zoom), y: lat2tile(LAT, zoom) });
  }
});
