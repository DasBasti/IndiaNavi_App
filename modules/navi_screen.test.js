import assert from 'node:assert/strict';
import test from 'node:test';

import { bufferSource, openMap } from './mapsforge.js';
import { buildTestMap, testTileBounds } from './mapsforge_test_map.js';
import {
  BLACK, WHITE, fillPolygon, labelPlacer, makeFramebuffer, polyline, rasterTarget, toAscii,
} from './navi_raster.js';
import { NAVI_ZOOMS, SCREEN_HEIGHT, SCREEN_WIDTH, renderNaviScreen } from './navi_screen.js';
import { BLUE, GREEN, P50, RED, tint } from './vector_style.js';

const LAT = 49.143;
const LON = 7.765;

const at = (fb, x, y) => fb.pixels[y * fb.width + x];

test('polygons are filled with the pattern at the screen position', () => {
  const fb = makeFramebuffer(8, 8);
  fillPolygon(fb, [[0, 0, 8, 0, 8, 8, 0, 8]], tint(GREEN, P50));
  assert.equal(at(fb, 0, 0), GREEN);
  assert.equal(at(fb, 1, 0), WHITE);
  assert.equal(at(fb, 1, 1), GREEN);
  // holes stay free
  const holes = makeFramebuffer(8, 8);
  fillPolygon(holes, [[0, 0, 8, 0, 8, 8, 0, 8], [2, 2, 6, 2, 6, 6, 2, 6]], BLUE);
  assert.equal(at(holes, 1, 1), BLUE);
  assert.equal(at(holes, 4, 4), WHITE);
});

test('map icons are centered on the position, transparent pixels keep the ground', () => {
  const fb = makeFramebuffer(40, 40);
  assert.equal(rasterTarget(fb).icon(20, 20, 'hospital'), true);
  // the icon covers 12..27, its corner is transparent and the border of the sign black
  assert.equal(at(fb, 12, 12), WHITE);
  assert.equal(at(fb, 13, 13), BLACK);
  assert.equal(at(fb, 20, 20), RED);
  assert.equal(rasterTarget(fb).icon(20, 20, 'no_such_icon'), false);
});

test('wide lines cover their width', () => {
  const fb = makeFramebuffer(20, 20);
  polyline(fb, [2, 10, 18, 10], BLACK, 4);
  assert.equal(at(fb, 10, 9), BLACK);
  assert.equal(at(fb, 10, 10), BLACK);
  assert.equal(at(fb, 10, 13), WHITE);
});

test('names are written with the letters of the font', () => {
  assert.equal(toAscii('Hütte Ölberg'), 'Huette Oelberg');
  assert.equal(toAscii('Москва'), '??????');
});

test('place names do not overlap', () => {
  const label = labelPlacer(makeFramebuffer(200, 100));
  assert.equal(label(100, 50, 'Dahn', 1), true);
  assert.equal(label(104, 52, 'Busenberg', 3), false);
  assert.equal(label(100, 80, 'Busenberg', 3), true);
  // not at the edge, the halo would not fit
  assert.equal(label(2, 50, 'Erfweiler', 3), false);
});

test('the screen has the bars of the device around the map', () => {
  const map = openMap(bufferSource(buildTestMap({
    lat: LAT,
    lon: LON,
    ways: [{ tags: ['natural=water'], blocks: [[[LAT - 0.01, LON - 0.01], [LAT - 0.01, LON + 0.01], [LAT + 0.01, LON + 0.01], [LAT + 0.01, LON - 0.01], [LAT - 0.01, LON - 0.01]]] }],
  })));
  const { fb, tiles, error } = renderNaviScreen({ maps: [map], lat: LAT, lon: LON, trackColor: RED });
  assert.equal(error, null);
  assert.equal(tiles, 1);
  assert.equal(fb.width, SCREEN_WIDTH);
  assert.equal(fb.height, SCREEN_HEIGHT);
  // the top bar has a black frame, the info strip at the bottom is black
  assert.equal(at(fb, 200, 0), BLACK);
  assert.equal(at(fb, 200, 13), WHITE);
  assert.equal(at(fb, 2, SCREEN_HEIGHT - 1), BLACK);
  // the lake is around the position, the marker has the color of the track
  assert.equal(at(fb, 300, 200), BLUE);
  const markers = [];
  for (let i = 0; i < fb.pixels.length; i++) {
    if (fb.pixels[i] === RED) {
      markers.push(i);
    }
  }
  assert.ok(markers.length > 50);
});

test('neighbouring maps are drawn together, an older copy of one is left out', () => {
  // three maps of one zoom 14 tile each: A with a forest, B east of it with a lake, OLD an older A with a lake
  const a = testTileBounds(LAT, LON);
  const lat = (a.minLat + a.maxLat) / 2;
  const span = a.maxLon - a.minLon;
  const fill = (tag, lon) => [{
    tags: [tag],
    blocks: [[[lat - 0.008, lon - span / 2 + 1e-5], [lat - 0.008, lon + span / 2 - 1e-5], [lat + 0.008, lon + span / 2 - 1e-5],
      [lat + 0.008, lon - span / 2 + 1e-5], [lat - 0.008, lon - span / 2 + 1e-5]]],
  }];
  const lonA = (a.minLon + a.maxLon) / 2;
  const open = (centerLon, tag, created) => openMap(bufferSource(buildTestMap({ lat, lon: centerLon, created, ways: fill(tag, centerLon) })));
  const mapA = open(lonA, 'landuse=forest', 2000);
  const mapB = open(lonA + span, 'natural=water', 2000);
  const old = open(lonA, 'natural=water', 1000);

  // at the border of A and B
  const { fb, drawn, tiles } = renderNaviScreen({ maps: [old, mapB, mapA], lat, lon: a.maxLon });
  assert.equal(drawn.length, 2);
  assert.ok(drawn.includes(mapA) && drawn.includes(mapB));
  assert.equal(tiles, 2);
  const count = (ink) => fb.pixels.filter((pixel) => pixel === ink).length;
  // the position is at x = 97 on the device, A is left of it
  assert.ok(count(GREEN) > 20000, 'the forest of A');
  assert.ok(count(BLUE) > 50000, 'the lake of B');

  // only the old map: its lake is drawn where A has the forest
  assert.equal(renderNaviScreen({ maps: [old], lat, lon: a.maxLon }).drawn.length, 1);
});

test('without a vector map at the position the tiles of the card are drawn', () => {
  const map = openMap(bufferSource(buildTestMap({ lat: LAT, lon: LON, ways: [] })));
  const requested = [];
  // the tile in the middle is orange on the left and yellow on the right pixel of every byte, the others are missing
  const readTile = (tile) => {
    requested.push(tile);
    return requested.length === 5 ? new Uint8Array(32768).fill(0x65) : null;
  };
  const far = renderNaviScreen({ maps: [map], readTile, lat: LAT + 1, lon: LON });
  assert.equal(far.source, 'tiles');
  assert.equal(far.tiles, 1);
  assert.equal(requested.length, 9);
  assert.ok(requested.every(({ zoom }) => zoom === 16));
  // the middle tile is at 97..352 x 171..426 on the display
  assert.equal(at(far.fb, 97, 300), 6);
  assert.equal(at(far.fb, 98, 300), 5);
  // "Not Found" in black in the tile above it
  assert.ok(far.fb.pixels.slice(30 * SCREEN_WIDTH, 150 * SCREEN_WIDTH).some((ink, i) => ink === BLACK && i % SCREEN_WIDTH > 100 && i % SCREEN_WIDTH < 350));

  // on the vector map the tiles are not read
  requested.length = 0;
  assert.equal(renderNaviScreen({ maps: [map], readTile, lat: LAT, lon: LON }).source, 'vector');
  assert.equal(requested.length, 0);
});

test('a track gets its line and the height graph', () => {
  const line = Array.from({ length: 40 }, (_, i) => [LON - 0.002 + i * 0.0001, LAT, 200 + i * 5]);
  const withTrack = renderNaviScreen({ lat: LAT, lon: LON, track: { name: 'Felsenland', lines: [line] }, trackColor: RED });
  const without = renderNaviScreen({ lat: LAT, lon: LON, showHeightGraph: false });
  const reds = (fb) => fb.pixels.filter((ink) => ink === RED).length;
  assert.ok(reds(withTrack.fb) > reds(without.fb) + 100);
  // the graph frame is above the info strip
  const graphTop = SCREEN_HEIGHT - 45;
  assert.equal(at(withTrack.fb, 200, graphTop), BLACK);
  assert.notEqual(at(without.fb, 200, graphTop), BLACK);
});

test('the two scales of the button', () => {
  assert.deepEqual(NAVI_ZOOMS.map(({ zoom, text }) => [zoom, text]), [[16, '100m'], [14, '500m']]);
});
