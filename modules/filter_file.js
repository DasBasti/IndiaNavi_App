import { Directory, File } from "expo-file-system";

import { filterSettingsJson, parseFilterSettings } from "./filter_settings";

const FILE_NAME = "indianavi-filter.json";

// Lets the user pick a folder and saves the filter and the tile server there.
// Returns false if the picker was closed.
export const exportFilterSettings = async (filter, tileUrl) => {
    let directory;
    try {
        directory = await Directory.pickDirectoryAsync();
    } catch (e) {
        if (e?.code === "ERR_PICKER_CANCELLED" || /cancel/i.test(e?.message ?? "")) {
            return false;
        }
        throw e;
    }
    // a folder that already has the file gets a copy with a number added to the name
    const file = directory.createFile(FILE_NAME, "application/json");
    file.write(filterSettingsJson(filter, tileUrl));
    return true;
}

// Lets the user pick an exported file and returns { filter, tileUrl }, or null if the picker was closed
export const importFilterSettings = async () => {
    // JSON files have no reliable mime type on Android, so all files are offered
    const picked = await File.pickFileAsync();
    if (picked.canceled) {
        return null;
    }
    return parseFilterSettings(await picked.result.text());
}
