import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_UPLOAD_RATE, contentRange, measuredRate, minutesFor, resumeOffset } from './map_upload.js';

const map = { size: 301234567, created: 1759550000000 };

test('an upload is continued only on the start of the same map', () => {
  assert.equal(resumeOffset(map, { file: 'rheinl01.map', size: 1000, total: map.size, created: map.created }), 1000);
  assert.equal(resumeOffset(map, undefined), 0);
  // another version of the map, a part without the whole header, nothing or everything on the card
  assert.equal(resumeOffset(map, { size: 1000, total: map.size, created: map.created - 1 }), 0);
  assert.equal(resumeOffset(map, { size: 1000, total: map.size + 1, created: map.created }), 0);
  assert.equal(resumeOffset(map, { size: 20, total: 0, created: 0 }), 0);
  assert.equal(resumeOffset(map, { size: 0, total: map.size, created: map.created }), 0);
  assert.equal(resumeOffset(map, { size: map.size, total: map.size, created: map.created }), 0);
});

test('the range of the rest of a file', () => {
  assert.equal(contentRange(0, 1000), 'bytes 0-999/1000');
  assert.equal(contentRange(400, 1000), 'bytes 400-999/1000');
});

test('the upload rate is measured and averaged', () => {
  assert.equal(measuredRate(undefined, 30 * 1024 * 1024, 100), Math.round(30 * 1024 * 1024 / 100));
  assert.equal(measuredRate(200000, 30000000, 100), 250000);
  // too short to tell
  assert.equal(measuredRate(200000, 1000000, 2), 200000);
  assert.equal(measuredRate(undefined, 0, 100), undefined);
});

test('minutes of an upload', () => {
  assert.equal(minutesFor(300 * 1024 * 1024), Math.ceil(300 * 1024 * 1024 / DEFAULT_UPLOAD_RATE / 60));
  assert.equal(minutesFor(1000), 1);
  assert.equal(minutesFor(60 * 1000 * 1000, 1000 * 1000), 1);
});
