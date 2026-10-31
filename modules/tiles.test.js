import assert from 'node:assert/strict';
import test from 'node:test';

import { ZOOM_LEVELS, countTiles, lat2world, listTiles, lon2world, pointBounds, tileArea, zoomMargin } from './tiles.js';

const bounds = pointBounds(7.765, 49.143);

test('the default levels are 14 and 16 with half of the margin on the wider one', () => {
  assert.deepEqual(ZOOM_LEVELS, [14, 16]);
  assert.equal(zoomMargin(10, 16), 10);
  assert.equal(zoomMargin(10, 14), 5);
  assert.equal(zoomMargin(5, 14), 3);
});

test('the tiles follow the chosen zoom levels', () => {
  const zooms = [12, 17];
  const tiles = listTiles(bounds, 4, zooms);
  assert.deepEqual([...new Set(tiles.map(({ zoom }) => zoom))], zooms);
  assert.equal(tiles.filter(({ zoom }) => zoom === 17).length, countTiles(bounds, 4, 17, zooms));
  assert.equal(tiles.filter(({ zoom }) => zoom === 12).length, countTiles(bounds, 4, 12, zooms));
  // a margin of 4 tiles around one tile is 9x9, and 2 around on the wider level is 5x5
  assert.equal(countTiles(bounds, 4, 17, zooms), 81);
  assert.equal(countTiles(bounds, 4, 12, zooms), 25);
});

test('tiles of the levels that stay are the same when the other level changes', () => {
  const before = listTiles(bounds, 10, [14, 16]).filter(({ zoom }) => zoom === 16);
  const after = listTiles(bounds, 10, [13, 16]).filter(({ zoom }) => zoom === 16);
  assert.deepEqual(after, before);
});

test('the area of a level covers the position', () => {
  const area = tileArea(bounds, 2, 15, [15, 17]);
  assert.ok(area.west <= lon2world(7.765) && lon2world(7.765) <= area.east);
  assert.ok(area.north <= lat2world(49.143) && lat2world(49.143) <= area.south);
});
