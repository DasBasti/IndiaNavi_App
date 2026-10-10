import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_FILTER } from './map_color.js';
import { filterSettingsJson, parseFilterSettings } from './filter_settings.js';
import { DEFAULT_TILE_URL } from './tile_source.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const exported = (changes) => JSON.stringify({ ...JSON.parse(filterSettingsJson(DEFAULT_FILTER, TILE_URL)), ...changes });

test('an export is imported with the same filter and tile server', () => {
    const filter = [{ rgb: [1, 2, 3], colors: [4] }, { rgb: [200, 100, 0], colors: [1, 5], share: 0.25 }];
    assert.deepEqual(parseFilterSettings(filterSettingsJson(filter, DEFAULT_TILE_URL)), { filter, tileUrl: DEFAULT_TILE_URL });
});

test('files that are no export are rejected', () => {
    assert.throws(() => parseFilterSettings('<gpx></gpx>'), /not a filter export/);
    assert.throws(() => parseFilterSettings('{"filter": []}'), /not a filter export/);
    assert.throws(() => parseFilterSettings('null'), /not a filter export/);
});

test('exports of a newer version are rejected', () => {
    assert.throws(() => parseFilterSettings(exported({ version: 2 })), /newer version/);
});

test('broken filters are rejected', () => {
    for (const filter of [[], [{ rgb: [1, 2], colors: [0] }], [{ rgb: [1, 2, 300], colors: [0] }],
        [{ rgb: [1, 2, 3], colors: [7] }], [{ rgb: [1, 2, 3], colors: [] }], [{ rgb: [1, 2, 3], colors: [0, 1, 2] }],
        [{ rgb: [1, 2, 3], colors: [0, 1], share: 2 }], [null]]) {
        assert.throws(() => parseFilterSettings(exported({ filter })), /filter in the file is broken/);
    }
});

test('a missing or broken tile server is rejected', () => {
    assert.throws(() => parseFilterSettings(exported({ tileUrl: undefined })), /tile server is missing/);
    assert.throws(() => parseFilterSettings(exported({ tileUrl: 'https://example.com/{z}/{x}.png' })), /needs \{y\}/);
});
