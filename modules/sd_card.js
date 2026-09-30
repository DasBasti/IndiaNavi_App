import { Directory, File, Paths } from "expo-file-system";

// The files are stored like they have to be on the SD card of the IndiaNavi:
//   track.gpx
//   MAPS/{zoom}/{x}/{y}.raw
export const sdCardRoot = () => new Directory(Paths.document, "sdcard");

export const tilePath = ({ zoom, x, y }) => `MAPS/${zoom}/${x}/${y}.raw`;

export const tileFile = (tile) => new File(sdCardRoot(), tilePath(tile));

export const TRACK_PATH = "track.gpx";

export const trackFile = () => new File(sdCardRoot(), TRACK_PATH);

// A tile that was not written completely is loaded again
export const hasFile = (file) => file.exists && file.size > 0;

export const writeFile = (file, content) => {
    file.create({ intermediates: true, overwrite: true });
    file.write(content);
}

// Deletes all tiles, for example when they have to be loaded from another server
export const deleteTiles = () => {
    const maps = new Directory(sdCardRoot(), "MAPS");
    if (maps.exists) {
        maps.delete();
    }
}

// Returns the files to transfer to the device as a list of { path, uri, size }.
// Tiles of other tracks stay on the phone, but are not part of the list.
export const listSdCardFiles = (tiles) => {

    const files = [[TRACK_PATH, trackFile()], ...tiles.map((tile) => [tilePath(tile), tileFile(tile)])];
    return files
        .filter(([, file]) => hasFile(file))
        .map(([path, file]) => ({ path, uri: file.uri, size: file.size }));

}
