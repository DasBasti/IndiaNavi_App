import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_SERVER, breadcrumbs, displayName, localName, parseListing, parseSize } from './map_listing.js';

// A folder as the Apache server of download.mapsforge.org lists it
const TABLE = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<html><head><title>Index of /maps/v5/europe/germany</title></head><body>
<h1>Index of /maps/v5/europe/germany</h1>
<table>
<tr><th valign="top"><img src="/icons/blank.gif" alt="[ICO]"></th><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=M;O=A">Last modified</a></th><th><a href="?C=S;O=A">Size</a></th></tr>
<tr><th colspan="5"><hr></th></tr>
<tr><td valign="top"><img src="/icons/back.gif" alt="[PARENTDIR]"></td><td><a href="/maps/v5/europe/">Parent Directory</a></td><td>&nbsp;</td><td align="right">  - </td></tr>
<tr><td valign="top"><img src="/icons/unknown.gif" alt="[   ]"></td><td><a href="baden-wuerttemberg.map">baden-wuerttemberg.map</a></td><td align="right">2026-10-04 06:12  </td><td align="right">614M</td><td>&nbsp;</td></tr>
<tr><td valign="top"><img src="/icons/unknown.gif" alt="[   ]"></td><td><a href="bayern.map">bayern.map</a></td><td align="right">2026-10-04 06:31  </td><td align="right">1.0G</td><td>&nbsp;</td></tr>
<tr><td valign="top"><img src="/icons/folder.gif" alt="[DIR]"></td><td><a href="nordrhein-westfalen/">nordrhein-westfalen/</a></td><td align="right">2026-10-04 07:00  </td><td align="right">  - </td><td>&nbsp;</td></tr>
<tr><td valign="top"><img src="/icons/text.gif" alt="[TXT]"></td><td><a href="README.txt">README.txt</a></td><td align="right">2026-10-04 07:00  </td><td align="right">1.2K</td><td>&nbsp;</td></tr>
</table></body></html>`;

// The same as a <pre> listing of a mirror
const PRE = `<html><body><h1>Index of /pub/Mirrors/download.mapsforge.org/maps/v5/europe/</h1><pre>
<a href="../">../</a>
<a href="germany/">germany/</a>                                           04-Oct-2026 07:00       -
<a href="andorra.map">andorra.map</a>                                        04-Oct-2026 03:38    2662912
<a href="https://example.com/x.map">elsewhere.map</a>                       04-Oct-2026 03:38    100
</pre></body></html>`;

test('sizes of the listing', () => {
  assert.equal(parseSize('614M'), 614 * 1024 ** 2);
  assert.equal(parseSize('1.0G'), 1024 ** 3);
  assert.equal(parseSize('2662912'), 2662912);
  assert.equal(parseSize('-'), null);
  assert.equal(parseSize('2026-10-04'), null);
});

test('a table listing has the folders first and the maps with their sizes', () => {
  const base = `${MAP_SERVER}europe/germany/`;
  assert.deepEqual(parseListing(TABLE, base), [
    { name: 'nordrhein-westfalen', url: `${base}nordrhein-westfalen/`, folder: true, size: null },
    { name: 'baden-wuerttemberg.map', url: `${base}baden-wuerttemberg.map`, folder: false, size: 614 * 1024 ** 2 },
    { name: 'bayern.map', url: `${base}bayern.map`, folder: false, size: 1024 ** 3 },
  ]);
});

test('a pre listing without the parent folder and links to other places', () => {
  const base = 'https://mirror.example.org/pub/Mirrors/download.mapsforge.org/maps/v5/europe/';
  assert.deepEqual(parseListing(PRE, base), [
    { name: 'germany', url: `${base}germany/`, folder: true, size: null },
    { name: 'andorra.map', url: `${base}andorra.map`, folder: false, size: 2662912 },
  ]);
});

test('names of maps and folders', () => {
  assert.equal(displayName('baden-wuerttemberg.map'), 'Baden-Wuerttemberg');
  assert.equal(displayName('north-america/'), 'North-America');
  assert.equal(displayName('germany-hessen.map'), 'Germany-Hessen');
  assert.equal(localName(`${MAP_SERVER}europe/germany/hessen.map`), 'germany-hessen.map');
  assert.equal(localName(`${MAP_SERVER}europe/andorra.map`), 'europe-andorra.map');
});

test('the path to a folder', () => {
  assert.deepEqual(breadcrumbs(`${MAP_SERVER}europe/germany/`), [
    { name: 'Maps', url: MAP_SERVER },
    { name: 'Europe', url: `${MAP_SERVER}europe/` },
    { name: 'Germany', url: `${MAP_SERVER}europe/germany/` },
  ]);
  assert.deepEqual(breadcrumbs(MAP_SERVER), [{ name: 'Maps', url: MAP_SERVER }]);
});
