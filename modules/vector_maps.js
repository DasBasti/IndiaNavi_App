// The vector maps (Mapsforge .map files) on the phone: downloaded into the documents of the app, read by the simulated
// IndiaNavi. A map is read in parts through a file handle, the files have several hundred MB up to a few GB.

import { Directory, File, Paths } from 'expo-file-system';

import { openMap } from './mapsforge';

const PART = '.part';

export const mapsDirectory = () => new Directory(Paths.document, 'maps');

const ensureDirectory = () => {
  const directory = mapsDirectory();
  if (!directory.exists) {
    directory.create({ intermediates: true });
  }
  return directory;
};

// The maps on the phone as { name, size }, sorted by name. Unfinished downloads are not listed, a folder that can
// not be read has no maps.
export const listMaps = () => {
  try {
    const directory = mapsDirectory();
    if (!directory.exists) {
      return [];
    }
    return directory.list()
      .filter((entry) => entry instanceof File && entry.name.toLowerCase().endsWith('.map'))
      .map((file) => ({ name: file.name, size: file.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
};

export const mapFile = (name) => new File(mapsDirectory(), name);

export const deleteMap = (name) => {
  const file = mapFile(name);
  if (file.exists) {
    file.delete();
  }
};

// Opens a map on the phone, returns the map of mapsforge.js with a close() for its file handle.
// Throws if the file is missing or not a Mapsforge map.
export const openMapFile = (name) => {
  const file = mapFile(name);
  if (!file.exists) {
    throw new Error(`${name} is not on the phone`);
  }
  const handle = file.open();
  const source = {
    size: file.size,
    read: (offset, length) => {
      handle.offset = offset;
      return handle.readBytes(Math.min(length, file.size - offset));
    },
  };
  try {
    const map = openMap(source);
    return { ...map, name, close: () => handle.close() };
  } catch (e) {
    handle.close();
    throw e;
  }
};

// Downloads a map. It is written to a .part file first, so an interrupted download never looks like a map. onProgress
// gets { bytesWritten, totalBytes }. Returns the name of the map.
export const downloadMap = async (url, name, { signal, onProgress } = {}) => {
  const directory = ensureDirectory();
  const part = new File(directory, name + PART);
  if (part.exists) {
    part.delete();
  }
  try {
    await File.downloadFileAsync(url, part, { signal, onProgress, idempotent: true });
    // a map that can not be read is not kept
    const handle = part.open();
    try {
      openMap({ size: part.size, read: (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(Math.min(length, part.size - offset));
      } });
    } finally {
      handle.close();
    }
    deleteMap(name);
    part.rename(name);
    return name;
  } catch (e) {
    if (part.exists) {
      part.delete();
    }
    throw e;
  }
};

// Free space on the phone in bytes
export const freeSpace = () => Paths.availableDiskSpace;
