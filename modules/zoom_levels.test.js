import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ZOOM_LEVELS, FAR_CHOICES, NEAR_CHOICES, ZOOM_MAX, ZOOM_MIN, isZoomLevels, scaleBar, withLevel, zoomLevelsOf, zoomList,
} from './zoom_levels.js';

test('the closer level has to be above the wider one inside of the range', () => {
  assert.ok(isZoomLevels({ near: 16, far: 14 }));
  assert.ok(isZoomLevels({ near: ZOOM_MAX, far: ZOOM_MIN }));
  assert.ok(!isZoomLevels({ near: 14, far: 14 }));
  assert.ok(!isZoomLevels({ near: 14, far: 16 }));
  assert.ok(!isZoomLevels({ near: ZOOM_MAX + 1, far: 14 }));
  assert.ok(!isZoomLevels({ near: 16, far: ZOOM_MIN - 1 }));
  assert.ok(!isZoomLevels({ near: 16.5, far: 14 }));
  assert.ok(!isZoomLevels(undefined));
});

test('settings that are not valid are the default', () => {
  assert.deepEqual(zoomLevelsOf(undefined), DEFAULT_ZOOM_LEVELS);
  assert.deepEqual(zoomLevelsOf({ near: 12, far: 15 }), DEFAULT_ZOOM_LEVELS);
  assert.deepEqual(zoomLevelsOf({ near: 17, far: 13 }), { near: 17, far: 13 });
  assert.deepEqual(zoomList({ near: 16, far: 14 }), [14, 16]);
});

test('changing one level moves the other one out of the way', () => {
  assert.deepEqual(withLevel({ near: 16, far: 14 }, 'near', 17), { near: 17, far: 14 });
  assert.deepEqual(withLevel({ near: 16, far: 14 }, 'far', 12), { near: 16, far: 12 });
  assert.deepEqual(withLevel({ near: 16, far: 14 }, 'near', 13), { near: 13, far: 12 });
  assert.deepEqual(withLevel({ near: 16, far: 14 }, 'far', 16), { near: 17, far: 16 });
  assert.deepEqual(withLevel({ near: 16, far: 14 }, 'near', ZOOM_MIN + 1), { near: ZOOM_MIN + 1, far: ZOOM_MIN });
  // every choice gives levels the device accepts
  for (const zoom of NEAR_CHOICES) assert.ok(isZoomLevels(withLevel(DEFAULT_ZOOM_LEVELS, 'near', zoom)), `near ${zoom}`);
  for (const zoom of FAR_CHOICES) assert.ok(isZoomLevels(withLevel(DEFAULT_ZOOM_LEVELS, 'far', zoom)), `far ${zoom}`);
});

test('the scales of the two default levels are the ones the device always had', () => {
  const near = scaleBar(16, 48);
  assert.equal(near.text, '100m');
  assert.ok(Math.abs(near.width - 63) <= 2);
  const far = scaleBar(14, 48);
  assert.equal(far.text, '500m');
  assert.ok(Math.abs(far.width - 77) <= 2);
});

test('other levels get other round scales', () => {
  assert.equal(scaleBar(17, 48).text, '50m');
  assert.equal(scaleBar(15, 48).text, '200m');
  assert.equal(scaleBar(12, 48).text, '2km');
  assert.equal(scaleBar(10, 48).text, '5km');
  for (let zoom = ZOOM_MIN; zoom <= ZOOM_MAX; zoom++) {
    assert.ok(scaleBar(zoom, 48).width <= 90, `zoom ${zoom}`);
  }
});
