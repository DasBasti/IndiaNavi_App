import { Directory, File, Paths } from "expo-file-system";

// All GPX files opened in the app are kept, so the user can choose the track for the IndiaNavi.
// tracks/tracks.json lists them as { id, name, size, length, addedAt, usedAt },
// the content of every track is in tracks/{id}.gpx.
const tracksDirectory = () => new Directory(Paths.document, "tracks");
const indexFile = () => new File(tracksDirectory(), "tracks.json");
const gpxFile = (id) => new File(tracksDirectory(), `${id}.gpx`);

const writeText = (file, text) => {
    file.create({ intermediates: true, overwrite: true });
    file.write(text);
}

// Returns the tracks, the track used last first
export const listTracks = () => {
    try {
        const file = indexFile();
        const tracks = file.exists ? JSON.parse(file.textSync()) : [];
        return tracks.filter((track) => gpxFile(track.id).exists).sort((a, b) => b.usedAt - a.usedAt);
    } catch {
        return [];
    }
}

const saveIndex = (tracks) => writeText(indexFile(), JSON.stringify(tracks));

// Adds a GPX file to the tracks and returns its entry.
// A file that is already there is not added again, it just becomes the track used last.
export const addTrack = (name, text, length) => {

    const tracks = listTracks();
    const now = Date.now();
    const existing = tracks.find((track) => track.size === text.length && gpxFile(track.id).textSync() === text);
    if (existing) {
        existing.usedAt = now;
        saveIndex(tracks);
        return existing;
    }

    const track = {
        id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name,
        size: text.length,
        length,
        addedAt: now,
        usedAt: now,
    };
    writeText(gpxFile(track.id), text);
    saveIndex([...tracks, track]);
    return track;

}

export const readTrack = (id) => gpxFile(id).textSync();

// Marks the track as used last
export const touchTrack = (id) => {
    const tracks = listTracks();
    const track = tracks.find((entry) => entry.id === id);
    if (track) {
        track.usedAt = Date.now();
        saveIndex(tracks);
    }
}

export const deleteTrack = (id) => {
    const file = gpxFile(id);
    if (file.exists) {
        file.delete();
    }
    saveIndex(listTracks().filter((track) => track.id !== id));
}
