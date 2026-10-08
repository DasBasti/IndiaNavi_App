import { File, Paths } from "expo-file-system";

// The recordings of the IndiaNavi that the app knows, also the ones that are only on the phone any more.
// recordings.json lists them as { id, size, onDevice, trackId, downloadedSize }: id is the start time in seconds,
// trackId the track in track_library.js once it is downloaded, downloadedSize the size of the file at that time.
const indexFile = () => new File(Paths.document, "recordings.json");

// Returns the recordings, the newest first
export const listRecordings = () => {
    try {
        const file = indexFile();
        const recordings = file.exists ? JSON.parse(file.textSync()) : [];
        return recordings.sort((a, b) => b.id - a.id);
    } catch {
        return [];
    }
}

const save = (recordings) => {
    const file = indexFile();
    file.create({ overwrite: true });
    file.write(JSON.stringify(recordings));
    return recordings.sort((a, b) => b.id - a.id);
}

// Takes over the list of the device ([{ id, size }]): new recordings are added, the ones that are gone from the card
// are marked, or forgotten if they were never downloaded. Returns all recordings.
export const updateFromDevice = (entries) => {
    const onDevice = new Map(entries.map((entry) => [entry.id, entry]));
    const recordings = listRecordings().map((recording) => ({
        ...recording,
        onDevice: onDevice.has(recording.id),
        size: onDevice.get(recording.id)?.size ?? recording.size,
    }));
    const known = new Set(recordings.map((recording) => recording.id));
    entries
        .filter((entry) => !known.has(entry.id))
        .forEach((entry) => recordings.push({ id: entry.id, size: entry.size, onDevice: true }));
    return save(recordings.filter((recording) => recording.onDevice || recording.trackId));
}

// The recording is a track of the app now
export const markDownloaded = (id, trackId, size) =>
    save(listRecordings().map((recording) =>
        recording.id === id ? { ...recording, trackId, downloadedSize: size } : recording));

// Deleted from the card: a downloaded recording stays, the others are forgotten
export const markDeletedFromDevice = (id) =>
    save(listRecordings()
        .map((recording) => (recording.id === id ? { ...recording, onDevice: false } : recording))
        .filter((recording) => recording.onDevice || recording.trackId));

// The track of a recording was deleted from the tracks of the app
export const trackDeleted = (trackId) =>
    save(listRecordings()
        .map((recording) =>
            recording.trackId === trackId ? { ...recording, trackId: undefined, downloadedSize: undefined } : recording)
        .filter((recording) => recording.onDevice || recording.trackId));

// The download is older than the file on the card, for example of a recording that went on after a restart
export const isDownloaded = (recording) => !!recording.trackId && recording.downloadedSize === recording.size;

// "Recording 2026-10-08 14:30" in the time zone of the phone
export const recordingName = (id) => {
    const date = new Date(id * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `Recording ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
