import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DRAWN, cardName, isCardName, isSuperseded, screenBounds, selectMaps } from './map_catalog.js';

// regions of about the size of the official maps of German states, as in the test of the firmware
const RHEINLAND_PFALZ = { minLat: 48.96, minLon: 6.11, maxLat: 50.95, maxLon: 8.51 };
const SAARLAND = { minLat: 49.11, minLon: 6.35, maxLat: 49.64, maxLon: 7.41 };
const BADEN_WUERTTEMBERG = { minLat: 47.53, minLon: 7.51, maxLat: 49.80, maxLon: 10.50 };
const GERMANY = { minLat: 47.27, minLon: 5.86, maxLat: 55.06, maxLon: 15.04 };

const map = (name, created, bounds) => ({ name, created, bounds });

const screen = (lat, lon, zoom = 14) => screenBounds({ lat, lon, zoom, width: 448, height: 600, anchorX: 224, anchorY: 300 });

test('a newer map of the same region tops the old one', () => {
  const old = map('old', 1000, RHEINLAND_PFALZ);
  const fresh = map('new', 2000, { ...RHEINLAND_PFALZ, maxLat: RHEINLAND_PFALZ.maxLat - 0.05 });
  assert.ok(isSuperseded(old, [old, fresh]));
  assert.ok(!isSuperseded(fresh, [old, fresh]));
});

test('a newer country tops an older region but not the other way', () => {
  const saar = map('saar', 1000, SAARLAND);
  const germany = map('de', 2000, GERMANY);
  assert.ok(isSuperseded(saar, [saar, germany]));
  const newSaar = map('saar', 3000, SAARLAND);
  assert.ok(!isSuperseded(newSaar, [newSaar, germany]));
  assert.ok(!isSuperseded(germany, [newSaar, germany]));
});

test('neighbours and maps of the same age are kept', () => {
  const maps = [map('rlp', 1000, RHEINLAND_PFALZ), map('bw', 2000, BADEN_WUERTTEMBERG), map('rlp2', 1000, RHEINLAND_PFALZ)];
  assert.deepEqual(maps.filter((m) => !isSuperseded(m, maps)).map((m) => m.name), ['rlp', 'bw', 'rlp2']);
});

test('the screen in degrees', () => {
  const b = screenBounds({ lat: 49.143, lon: 7.765, zoom: 16, width: 448, height: 600, anchorX: 224, anchorY: 300 });
  assert.ok(Math.abs((b.minLat + b.maxLat) / 2 - 49.143) < 1e-4);
  assert.ok(Math.abs((b.minLon + b.maxLon) / 2 - 7.765) < 1e-6);
  assert.ok(Math.abs(b.maxLon - b.minLon - 448 * 360 / 2 ** 24) < 1e-9);
  const left = screenBounds({ lat: 49.143, lon: 7.765, zoom: 16, width: 448, height: 600, anchorX: 0, anchorY: 300 });
  assert.ok(Math.abs(left.minLon - 7.765) < 1e-9);
});

test('the maps of a screen, smallest first', () => {
  const maps = [map('de', 1000, GERMANY), map('rlp', 2000, RHEINLAND_PFALZ), map('bw', 2000, BADEN_WUERTTEMBERG), map('saar', 2000, SAARLAND)];
  // in the Palatinate near the border of Saarland, Baden-Wuerttemberg is too far away
  assert.deepEqual(selectMaps(maps, screen(49.2, 7.4)).map((m) => m.name), ['saar', 'rlp', 'de']);
  assert.deepEqual(selectMaps(maps, screen(49.2, 7.4), 2).map((m) => m.name), ['saar', 'rlp']);
  assert.deepEqual(selectMaps(maps, screen(40, -3.7, 16)), []);
  assert.equal(MAX_DRAWN, 4);
});

test('names on the SD card', () => {
  assert.ok(isCardName('rheinl01.map'));
  assert.ok(isCardName('DE_BW-2.MAP'));
  assert.ok(!isCardName('toolongna.map'));
  assert.ok(!isCardName('../x.map'));
  assert.equal(cardName('germany-rheinland-pfalz.map', []), 'rheinl01.map');
  assert.equal(cardName('germany-rheinland-pfalz.map', ['rheinl01.map']), 'rheinl02.map');
  assert.equal(cardName('europe-andorra.map', []), 'andorr01.map');
  assert.equal(cardName('world.map', []), 'world01.map');
  assert.equal(cardName('germany-ä.map', []), 'map01.map');
  assert.ok(isCardName(cardName('north-america-us-california.map', [])));
});
