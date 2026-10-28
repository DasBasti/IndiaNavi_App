import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIMULATED_PASSWORD,
  SIMULATED_SSID,
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
