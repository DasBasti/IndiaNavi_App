import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIMULATED_PASSWORD,
  SIMULATED_SSID,
  clearSimulatedMaps,
  isSimulatedWifi,
  simulatedResponse,
} from './simulated_device.js';

test('only the documented name and password select the simulated device', () => {
  assert.equal(isSimulatedWifi(SIMULATED_SSID, SIMULATED_PASSWORD), true);
  assert.equal(isSimulatedWifi(SIMULATED_SSID, 'other'), false);
  assert.equal(isSimulatedWifi('IndiaNavi-E3ED', SIMULATED_PASSWORD), false);
});

test('the simulated device describes itself like the firmware', () => {
  const { status, text } = simulatedResponse('GET', '/api/info');
  const info = JSON.parse(text);
  assert.equal(status, 200);
  assert.equal(typeof info.api, 'number');
  assert.equal(info.sd.present, true);
  assert.ok(info.sd.free < info.sd.total);
});

test('the SD card starts without tiles and accepts uploads', () => {
  assert.equal(simulatedResponse('GET', '/sd/MAPS/14/8000/').status, 404);
  assert.equal(simulatedResponse('PUT', '/sd/MAPS/14/8000/5400.raw').status, 204);
  assert.equal(simulatedResponse('POST', '/api/reload').status, 204);
});

test('vector maps can be sent to the simulated card, listed and deleted', () => {
  clearSimulatedMaps();
  const bounds = { minLat: 48.96, minLon: 6.11, maxLat: 50.95, maxLon: 8.51 };
  const listed = () => JSON.parse(simulatedResponse('GET', '/api/maps').text).maps;
  assert.deepEqual(listed(), []);
  assert.equal(JSON.parse(simulatedResponse('GET', '/api/info').text).api, 3);

  assert.equal(simulatedResponse('PUT', '/sd/MAPS/rheinl01.map', { map: { size: 1000, created: 1, bounds } }).status, 204);
  assert.equal(simulatedResponse('PUT', '/sd/MAPS/rheinl02.map', { map: { size: 2000, created: 2, bounds } }).status, 204);
  assert.deepEqual(listed().map(({ file, used }) => [file, used]), [['rheinl01.map', false], ['rheinl02.map', true]]);
  assert.deepEqual(listed()[0].bounds, [48.96, 6.11, 50.95, 8.51]);

  // names that do not fit into 8.3 are refused like by the firmware
  assert.notEqual(simulatedResponse('PUT', '/sd/MAPS/rheinland-pfalz.map', { map: { size: 1, created: 1, bounds } }).status, 204);
  // a map bigger than the card
  assert.equal(simulatedResponse('PUT', '/sd/MAPS/big.map', { map: { size: 2 ** 40, created: 1, bounds } }).status, 507);

  assert.equal(simulatedResponse('DELETE', '/sd/MAPS/rheinl01.map').status, 204);
  assert.equal(simulatedResponse('DELETE', '/sd/MAPS/rheinl01.map').status, 404);
  assert.deepEqual(listed().map(({ file }) => file), ['rheinl02.map']);
  clearSimulatedMaps();
});

test('an upload of a map that broke is continued where it ended', () => {
  clearSimulatedMaps();
  const map = { size: 1000, created: 7, bounds: { minLat: 49, minLon: 7, maxLat: 49.5, maxLon: 7.5 } };
  const maps = () => JSON.parse(simulatedResponse('GET', '/api/maps').text);
  const put = (start, received) =>
    simulatedResponse('PUT', '/sd/MAPS/saarla01.map', { map, range: { start, end: 999, total: 1000 }, received });

  // the connection breaks after 400 bytes, the card keeps them with the size and date of the header
  assert.equal(put(0, 400).status, 0);
  assert.deepEqual(maps(), { maps: [], partial: [{ file: 'saarla01.map', size: 400, total: 1000, created: 7 }] });

  // the rest has to start where the part on the card ends
  assert.equal(put(300).status, 416);
  assert.equal(put(400).status, 204);
  assert.deepEqual(maps().partial, []);
  assert.deepEqual(maps().maps.map(({ file, size }) => [file, size]), [['saarla01.map', 1000]]);

  // a part without the whole header has no size and date yet, deleting the map removes the part
  assert.equal(put(0, 20).status, 0);
  assert.deepEqual(maps().partial, [{ file: 'saarla01.map', size: 20, total: 0, created: 0 }]);
  assert.equal(simulatedResponse('DELETE', '/sd/MAPS/saarla01.map').status, 204);
  assert.deepEqual(maps(), { maps: [], partial: [] });
});
