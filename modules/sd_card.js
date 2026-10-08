import { Directory, File, Paths } from "expo-file-system";

// The files are stored like they have to be on the SD card of the IndiaNavi:
//   track.gpx
//   MAPS/{zoom}/{x}/{y}.raw
export const sdCardRoot = () => new Directory(Paths.document, "sdcard");

export const tilePath = ({ zoom, x, y }) => `MAPS/${zoom}/${x}/${y}.raw`;

export const tileFile = (tile) => new File(sdCardRoot(), tilePath(tile));

// The tiles as the server sent them, so they can be converted again with another filter:
//   {zoom}/{x}/{y}.png
export const originalsRoot = () => new Directory(Paths.document, "originals");

export const originalFile = ({ zoom, x, y }) => new File(originalsRoot(), `${zoom}/${x}/${y}.png`);

export const TRACK_PATH = "track.gpx";

export const trackFile = () => new File(sdCardRoot(), TRACK_PATH);

// A tile that was not written completely is loaded again
export const hasFile = (file) => file.exists && file.size > 0;

export const writeFile = (file, content) => {
    file.create({ intermediates: true, overwrite: true });
    file.write(content);
}

// Without a track the SD card files only have tiles, an old track must not be sent along
export const deleteTrack = () => {
    const file = trackFile();
    if (file.exists) {
        file.delete();
    }
}

// Deletes all tiles and their originals, for example when they have to be loaded from another server
export const deleteTiles = () => {
    for (const directory of [new Directory(sdCardRoot(), "MAPS"), originalsRoot()]) {
        if (directory.exists) {
            directory.delete();
        }
    }
}

// Returns all tiles on the phone as { zoom, x, y }, of all tracks
export const listStoredTiles = () => {

    const maps = new Directory(sdCardRoot(), "MAPS");
    if (!maps.exists) {
        return [];
    }
    const numbered = (directory) =>
        directory.list().filter((entry) => entry instanceof Directory && /^\d+$/.test(entry.name));
    const tiles = [];
    for (const zoom of numbered(maps)) {
        for (const x of numbered(zoom)) {
            for (const entry of x.list()) {
                const y = entry instanceof File && /^(\d+)\.raw$/.exec(entry.name);
                if (y) {
                    tiles.push({ zoom: Number(zoom.name), x: Number(x.name), y: Number(y[1]) });
                }
            }
        }
    }
    return tiles;

}

const existingFiles = (files) => files
    .filter(([, file]) => hasFile(file))
    .map(([path, file]) => ({ path, uri: file.uri, size: file.size }));

const tileFiles = (tiles) => tiles.map((tile) => [tilePath(tile), tileFile(tile)]);

// Returns the files to transfer to the device as a list of { path, uri, size }.
// Tiles of other tracks stay on the phone, but are not part of the list.
export const listSdCardFiles = (tiles) => existingFiles([[TRACK_PATH, trackFile()], ...tileFiles(tiles)]);

// Returns the files of the tiles, without the track
export const listTileFiles = (tiles) => existingFiles(tileFiles(tiles));
