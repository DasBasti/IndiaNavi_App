import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkFirmwareImage,
  downloadRelease,
  fetchLatestRelease,
  isNewer,
  latestRelease,
  parseFirmwareVersion,
  plainNotes,
} from './firmware_release.js';

const asset = (name, size = 2048) => ({
  name,
  size,
  browser_download_url: `https://github.com/DasBasti/IndiaNavi_Firmware/releases/download/x/${name}`,
});

// like the answer of GitHub, newest first
const RELEASES = [
  { tag_name: 'v3.1.0-rc1', name: 'rc', prerelease: true, draft: false, assets: [asset('indianavi-v3.1.0-rc1.bin')] },
  {
    tag_name: 'v3.0.0',
    name: 'IndiaNavi 3.0.0',
    body: 'Bluetooth',
    prerelease: false,
    draft: false,
    assets: [asset('indianavi-v3.0.0-full.bin'), asset('indianavi-v3.0.0.bin')],
  },
  { tag_name: 'v2.1.1', name: '', prerelease: false, draft: false, assets: [asset('indianavi-v2.1.1.bin')] },
  { tag_name: '2.0r2', name: 'India Navi 2.0r2', prerelease: false, draft: false, assets: [asset('indianavi.2.0r2.bin')] },
];

test('the version of the device is read from the text of git describe', () => {
  assert.deepEqual(parseFirmwareVersion('Version: v3.0.0 built: 06 Oct 2026 20:20'), [3, 0, 0, 0]);
  assert.deepEqual(parseFirmwareVersion('Version: v3.0.0-4-gabc1234-dirty built: 06 Oct 2026 20:20'), [3, 0, 0, 4]);
  assert.deepEqual(parseFirmwareVersion('v2.10.1'), [2, 10, 1, 0]);
  assert.equal(parseFirmwareVersion('Version: 82d6e1d built: 06 Oct 2026 20:20'), null);
  assert.equal(parseFirmwareVersion(undefined), null);
});

test('the newest release with an update image is chosen', () => {
  const release = latestRelease(RELEASES);
  assert.equal(release.tag, 'v3.0.0');
  assert.equal(release.name, 'IndiaNavi 3.0.0');
  assert.match(release.url, /indianavi-v3\.0\.0\.bin$/);
  assert.deepEqual(release.version, [3, 0, 0, 0]);
});

test('the order of the releases does not matter', () => {
  assert.equal(latestRelease([...RELEASES].reverse()).tag, 'v3.0.0');
});

test('a release without an update image is skipped', () => {
  const releases = [{ ...RELEASES[1], assets: [asset('indianavi-v3.0.0-full.bin')] }, RELEASES[2]];
  assert.equal(latestRelease(releases).tag, 'v2.1.1');
  assert.equal(latestRelease([]), null);
});

test('a release is offered only when it is newer than the device', () => {
  const release = latestRelease(RELEASES);
  assert.equal(isNewer(release, 'Version: v2.1.1 built: 1 Jan 2026 10:00'), true);
  assert.equal(isNewer(release, 'Version: v3.0.0 built: 1 Jan 2026 10:00'), false);
  // a build after the tag already has everything of the release
  assert.equal(isNewer(release, 'Version: v3.0.0-2-g1234567 built: 1 Jan 2026 10:00'), false);
  assert.equal(isNewer(release, 'Version: v3.1.0 built: 1 Jan 2026 10:00'), false);
  assert.equal(isNewer(release, 'Version: 82d6e1d built: 1 Jan 2026 10:00'), null);
});

const image = (length) => Uint8Array.from({ length }, (_, i) => (i === 0 ? 0xe9 : i & 0xff));

const fakeFetch = (routes) => async (url) => {
  const body = routes[url];
  if (body === undefined) {
    return { ok: false, status: 404 };
  }
  return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => body.buffer };
};

test('the latest release is fetched from GitHub', async () => {
  const fetch = async (url, { headers }) => {
    assert.match(url, /api\.github\.com\/repos\/DasBasti\/IndiaNavi_Firmware\/releases/);
    assert.ok(headers.Accept);
    return { ok: true, status: 200, json: async () => RELEASES };
  };
  assert.equal((await fetchLatestRelease({ fetch })).tag, 'v3.0.0');
});

test('an error of GitHub is reported', async () => {
  await assert.rejects(fetchLatestRelease({ fetch: fakeFetch({}) }), /HTTP 404/);
});

test('the image is downloaded and checked', async () => {
  const release = latestRelease(RELEASES);
  const data = image(2048);
  assert.deepEqual(await downloadRelease(release, { fetch: fakeFetch({ [release.url]: data }) }), data);

  await assert.rejects(downloadRelease(release, { fetch: fakeFetch({ [release.url]: image(1500) }) }), /incomplete/);
  const wrong = image(2048);
  wrong[0] = 0;
  await assert.rejects(downloadRelease(release, { fetch: fakeFetch({ [release.url]: wrong }) }), /not a firmware/);
});

test('a file without the magic byte is no firmware', () => {
  assert.throws(() => checkFirmwareImage(new Uint8Array(2048)), /not a firmware/);
  assert.throws(() => checkFirmwareImage(image(100)), /not a firmware/);
});

test('the release notes are shown without Markdown', () => {
  assert.equal(
    plainNotes('## Bluetooth\r\n- Set the **clock**\n* see [the docs](https://x) and `ble_api.md`\n'),
    'Bluetooth\n• Set the clock\n• see the docs and ble_api.md'
  );
});
