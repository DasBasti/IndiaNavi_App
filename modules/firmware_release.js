// Finds the newest firmware of the IndiaNavi in the releases on GitHub and downloads it.
// A release is tagged vMAJOR.MINOR.PATCH and carries indianavi-<tag>.bin (the application, for the update) and
// indianavi-<tag>-full.bin (with the bootloader, for a cable). The device reports its version as the text of
// `git describe`, like "Version: v3.0.0-4-gabc1234 built: 06 Oct 2026 20:20".

export const RELEASES_URL = 'https://api.github.com/repos/DasBasti/IndiaNavi_Firmware/releases?per_page=20';

// First byte of every ESP32 application image
const FIRMWARE_MAGIC = 0xe9;
const CHECK_TIMEOUT = 15000;
const DOWNLOAD_TIMEOUT = 120000;

// vMAJOR.MINOR.PATCH and the commits after the tag, if any
const VERSION = /\bv?(\d+)\.(\d+)\.(\d+)(?:-(\d+)-g[0-9a-f]+)?/;

// Returns [major, minor, patch, commits after the tag] or null for a text without a version
export const parseFirmwareVersion = (text) => {
  const match = VERSION.exec(text ?? '');
  return match ? [1, 2, 3, 4].map((group) => Number(match[group] ?? 0)) : null;
};

export const compareVersions = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
};

// A firmware image starts with the magic byte of the ESP32
export const checkFirmwareImage = (bytes) => {
  if (bytes.length < 1024 || bytes[0] !== FIRMWARE_MAGIC) {
    throw new Error('This is not a firmware file of the IndiaNavi');
  }
  return bytes;
};

// The image for the update, not the one with the bootloader
const updateAsset = (release) =>
  release.assets?.find((asset) => asset.name.endsWith('.bin') && !asset.name.endsWith('-full.bin'));

// Returns the newest published release with an image as { version, tag, name, notes, url, size }, or null
export const latestRelease = (releases) =>
  releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => ({ release, version: parseFirmwareVersion(release.tag_name), asset: updateAsset(release) }))
    .filter(({ version, asset }) => version && asset)
    .sort((a, b) => compareVersions(b.version, a.version))
    .map(({ release, version, asset }) => ({
      version,
      tag: release.tag_name,
      name: release.name || release.tag_name,
      notes: plainNotes(release.body ?? ''),
      url: asset.browser_download_url,
      size: asset.size,
    }))[0] ?? null;

// The release notes are Markdown, the dialog shows plain text
export const plainNotes = (markdown) =>
  markdown
    .replace(/\r/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();

// true when the release is newer than the firmware of the device, null when the device reports no version
export const isNewer = (release, deviceFirmware) => {
  const installed = parseFirmwareVersion(deviceFirmware);
  return installed ? compareVersions(release.version, installed) > 0 : null;
};

const withTimeout = async (signal, timeout, action) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeout);
  signal?.addEventListener('abort', abort);
  try {
    return await action(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error('GitHub did not answer, is the phone online?');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};

// Asks GitHub for the newest release, see latestRelease
export const fetchLatestRelease = ({ signal, fetch = globalThis.fetch } = {}) =>
  withTimeout(signal, CHECK_TIMEOUT, async (timeoutSignal) => {
    const response = await fetch(RELEASES_URL, {
      signal: timeoutSignal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'IndiaNaviApp/1.0' },
    });
    if (!response.ok) {
      throw new Error(`GitHub answered HTTP ${response.status}`);
    }
    return latestRelease(await response.json());
  });

// Downloads the image of the release and checks it
export const downloadRelease = (release, { signal, fetch = globalThis.fetch } = {}) =>
  withTimeout(signal, DOWNLOAD_TIMEOUT, async (timeoutSignal) => {
    const response = await fetch(release.url, { signal: timeoutSignal });
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (release.size && bytes.length !== release.size) {
      throw new Error('The download is incomplete');
    }
    return checkFirmwareImage(bytes);
  });
