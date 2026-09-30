import { Directory, File, Paths } from "expo-file-system";

const fileName = (file) => {
    try {
        return decodeURIComponent(file.name) || "track.gpx";
    } catch {
        return "track.gpx";
    }
}

// Content uris of Android often do not contain the file name (for example .../document/msf:64).
// A copy in the cache gets the real name of the file, so the copy is used instead.
const withRealName = async (file) => {
    if (!file.uri.startsWith("content://")) {
        return file;
    }
    try {
        const opened = new Directory(Paths.cache, "opened");
        if (opened.exists) {
            opened.delete();
        }
        opened.create();
        await file.copy(opened);
        return opened.list().find((entry) => entry instanceof File) ?? file;
    } catch {
        return file;
    }
}

// Reads a GPX file from a file:// or content:// uri
export const readGpxFile = async (uri) => {
    const file = await withRealName(uri instanceof File ? uri : new File(uri));
    return { name: fileName(file), text: await file.text() };
}

// Lets the user pick a GPX file. Returns null if the picker was closed.
export const pickGpxFile = async () => {
    // GPX files have no reliable mime type on Android, so all files are offered
    const picked = await File.pickFileAsync();
    if (picked.canceled) {
        return null;
    }
    return readGpxFile(picked.result);
}

// Only files can be opened with the app, other links are ignored
export const isFileUrl = (url) => /^(file|content):\/\//.test(url ?? "");
