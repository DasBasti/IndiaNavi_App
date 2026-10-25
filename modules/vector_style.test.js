import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import * as vs from './vector_style.js';

const {
  AREA_GROUPS, BLACK, BLUE, DIAG, GREEN, HLINES, P12, P25, P50, P6, P75, PATTERN_MASKS, POI_GROUPS, POI_RULES,
  PLACE_ROWS, RED, SOLID, WAY_GROUPS, WAY_RULES, WHITE, YELLOW, coverage, inkAt, mix, overlay, ruleIndex, solid,
  styleOf, tint, widthAt,
} = vs;

// The style table of the firmware, next to the app in the IndiaNavi folder
const STYLE_RS = new URL('../../IndiaNavi_Firmware/lib/mapsforge-rs/src/style.rs', import.meta.url);

test('coverage of the patterns', () => {
  assert.equal(coverage(tint(GREEN, P50)), 8);
  assert.equal(coverage(tint(GREEN, P25)), 4);
  assert.equal(coverage(tint(GREEN, P75)), 12);
  assert.equal(coverage(tint(GREEN, P12)), 2);
  assert.equal(coverage(tint(GREEN, P6)), 1);
  assert.equal(coverage(tint(GREEN, HLINES)), 4);
  assert.equal(coverage(tint(GREEN, DIAG)), 4);
  assert.equal(coverage(solid(GREEN)), 16);
});

test('the pixels of a paint, at absolute positions', () => {
  const scrub = mix(GREEN, YELLOW, P50);
  assert.equal(inkAt(scrub, 0, 0), GREEN);
  assert.equal(inkAt(scrub, 1, 0), YELLOW);
  assert.equal(inkAt(scrub, 5, 3), GREEN);
  assert.equal(inkAt(tint(BLUE, P25), 1, 0), WHITE);
  assert.equal(inkAt(overlay(BLUE, HLINES), 0, 1), null);
  assert.equal(inkAt(overlay(BLUE, HLINES), 7, 4), BLUE);
  assert.equal(inkAt(tint(BLACK, DIAG), 1, 3), BLACK);
  assert.equal(inkAt(solid(RED), 2, 3), RED);
  // the building fill is the old MFR_FILL_CHECKER
  assert.equal(tint(BLACK, P50), 0x01000000);
  assert.equal(overlay(RED, DIAG), 0xf7000004);
});

test('roads are one pixel thinner on the 500 m scale', () => {
  const path = styleOf(WAY_RULES, 'highway=path');
  assert.equal(widthAt(path, 16), 4);
  assert.equal(widthAt(path, 14), 3);
  assert.equal(widthAt(styleOf(WAY_RULES, 'highway=road'), 14), 1);
  assert.equal(widthAt(styleOf(WAY_RULES, 'railway=rail'), 14), 3);
});

const rowsOf = (groups) => groups.flatMap((group) => group.rows);

test('every tag of a row looks the same, and every drawn rule has a row', () => {
  for (const [rules, rows] of [
    [WAY_RULES, [...rowsOf(AREA_GROUPS), ...rowsOf(WAY_GROUPS)]],
    [POI_RULES, [...rowsOf(POI_GROUPS), ...PLACE_ROWS]],
  ]) {
    const covered = new Set();
    for (const row of rows) {
      assert.ok(row.style, row.name);
      for (const tag of row.tags) {
        assert.deepEqual(styleOf(rules, tag), row.style, `${row.name}: ${tag}`);
        covered.add(ruleIndex(rules, tag));
      }
    }
    rules.forEach(([key, value, style], index) => {
      assert.ok(!style || covered.has(index), `no row for ${key}=${value}`);
    });
  }
  rowsOf(AREA_GROUPS).forEach((row) => assert.equal(row.style.kind, 'area', row.name));
  rowsOf(WAY_GROUPS).forEach((row) => assert.equal(row.style.kind, 'line', row.name));
});

test('walkable ways are thicker than car roads', () => {
  const [walk, cars] = WAY_GROUPS;
  const thinnest = Math.min(...walk.rows.map((row) => row.style.width));
  cars.rows.forEach((row) => assert.ok(row.style.width < thinnest, row.name));
});

// Turns a style expression of style.rs into JavaScript built with the functions of vector_style.js
const SCOPE = {
  ...vs,
  minor_road: vs.minorRoad,
  poi_plain: vs.poiPlain,
  Black: BLACK, White: WHITE, Green: GREEN, Blue: BLUE, Red: RED, Yellow: YELLOW, Orange: vs.ORANGE,
  Solid: SOLID, P50, P25, P75, P12, P6, HLines: HLINES, Diag: DIAG,
  Symbol: { Disc: 'disc', Square: 'square', Triangle: 'triangle', Diamond: 'diamond' },
};

const evaluate = (rust) => {
  const js = rust
    .replace(/Some\(Style \{/g, 'style({')
    .replace(/\.\.BASE \}\)/g, '})')
    .replace(/\bNone\b/g, 'null')
    .replace(/::/g, '.');
  return new Function(...Object.keys(SCOPE), `return ${js};`)(...Object.values(SCOPE));
};

const rulesOf = (source, name) => {
  const block = source.split(`const ${name}: &[Rule] = &[`)[1].split('\n];')[0];
  return block
    .split('\n')
    .map((text) => text.match(/^\s*\("([^"]+)", "([^"]+)", (.*)\),\s*$/))
    .filter(Boolean)
    .map(([, key, value, rust]) => [key, value, evaluate(rust)]);
};

test('the rules are the same as in style.rs of the firmware', { skip: !existsSync(STYLE_RS) && 'no firmware' }, () => {
  const source = readFileSync(STYLE_RS, 'utf8');
  const masks = source.match(/PATTERN_MASKS: \[u16; 8\] = \[([^\]]+)\]/)[1].split(',').map((mask) => Number(mask));
  assert.deepEqual(masks, PATTERN_MASKS);
  // the area looks and widths, by their names (the palette numbers of eink7_index are not part of the style)
  for (const [, name, rust] of source.matchAll(/^(?:pub )?const ((?!EINK7)[A-Z_]+): (?:u32|u8) = (.+);$/gm)) {
    assert.deepEqual(evaluate(rust), vs[name], name);
  }
  assert.deepEqual(rulesOf(source, 'WAY_RULES'), WAY_RULES);
  assert.deepEqual(rulesOf(source, 'POI_RULES'), POI_RULES);
  for (const [, name, value] of source.matchAll(/pub const ([A-Z_]+): u8 = (\d+);/g)) {
    if (name in vs.order) {
      assert.equal(vs.order[name], Number(value), name);
    }
  }
});
