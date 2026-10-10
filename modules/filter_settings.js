import { isFilter } from "./map_color.js";
import { checkTileUrl } from "./tile_source.js";

// The conversion filter and the tile server are exported together, the filter is made for the colors of the map
const FORMAT = "indianavi-filter";
const VERSION = 1;

export const filterSettingsJson = (filter, tileUrl) =>
    JSON.stringify({ format: FORMAT, version: VERSION, tileUrl, filter }, null, 2);

// Returns { filter, tileUrl } of an exported file, or throws an error that can be shown to the user
export const parseFilterSettings = (text) => {
    let settings;
    try {
        settings = JSON.parse(text);
    } catch {
        throw new Error("The file is not a filter export of the app");
    }
    if (settings?.format !== FORMAT) {
        throw new Error("The file is not a filter export of the app");
    }
    if (!Number.isInteger(settings.version) || settings.version > VERSION) {
        throw new Error("The file was exported by a newer version of the app");
    }
    if (!isFilter(settings.filter)) {
        throw new Error("The filter in the file is broken");
    }
    const problem = typeof settings.tileUrl === "string" ? checkTileUrl(settings.tileUrl) : "The tile server is missing";
    if (problem) {
        throw new Error(`The tile server in the file can not be used: ${problem}`);
    }
    return { filter: settings.filter, tileUrl: settings.tileUrl };
}
