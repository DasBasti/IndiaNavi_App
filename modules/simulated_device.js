// An IndiaNavi that exists only in the app. Typing in its WiFi name and password in the file transfer connects to it
// instead of a real device, so the screens can be tried and tested without hardware (for example in automated tests).
// It answers the requests of the WiFi upload API like the firmware does, see docs/wifi_upload_api.md.

import { isCardName, isSuperseded } from "./map_catalog.js";

export const SIMULATED_SSID = "IndiaNavi-7A21";
export const SIMULATED_PASSWORD = "wanderweg42";

// Address the app sends the requests to, nothing leaves the phone
export const SIMULATED_BASE = "http://simulated.indianavi";

const SD_TOTAL = 8 * 1024 * 1024 * 1024;
const SD_FREE = 6 * 1024 * 1024 * 1024;

export const isSimulatedWifi = (ssid, password) => ssid === SIMULATED_SSID && password === SIMULATED_PASSWORD;

// The vector maps on the simulated SD card: name => { size, created, bounds }, kept while the app runs
const maps = new Map();
// Maps whose upload was not finished: name => { size (on the card), total, created }
const partials = new Map();

// the start of a map with its size and creation date in the header (MAP_CATALOG_HEADER_START of the firmware)
const HEADER_START = 44;

export const clearSimulatedMaps = () => {
    maps.clear();
    partials.clear();
};

const mapName = (path) => {
    const name = path.slice("/sd/MAPS/".length).toLowerCase();
    return path.toUpperCase().startsWith("/SD/MAPS/") && isCardName(name) ? name : null;
};

const partialList = () => [...partials].map(([file, { size, total, created }]) => ({
    file,
    size,
    total: size >= HEADER_START ? total : 0,
    created: size >= HEADER_START ? created : 0,
}));

const mapList = () => [...maps].map(([file, { size, created, bounds }], index, all) => ({
    file,
    size,
    created,
    bounds: [bounds.minLat, bounds.minLon, bounds.maxLat, bounds.maxLon],
    used: !isSuperseded({ created, bounds }, all.map(([, other]) => other)),
}));

const json = (value) => ({ status: 200, text: JSON.stringify(value) });
const empty = (status) => ({ status, text: "" });

// Returns { status, text } for a request to the simulated device. A map that is uploaded (PUT /sd/MAPS/{name}.map)
// needs map: { size, created, bounds } of its header, the simulation does not read the file. range is the
// Content-Range { start, end, total } of the request, received the bytes that arrived when the connection broke
// (status 0 then), like on the firmware the card keeps them.
export const simulatedResponse = (method, path, { map, range, received } = {}) => {

    const usedByMaps = [...maps.values()].reduce((sum, entry) => sum + entry.size, 0);
    if (method === "GET" && path === "/api/info") {
        return json({
            id: "IndiaNavi-7A21",
            firmware: "1.2.3",
            api: 3,
            ota: true,
            vector_maps: true,
            sd: { present: true, free: SD_FREE - usedByMaps, total: SD_TOTAL },
        });
    }
    if (method === "GET" && path === "/api/maps") {
        return json({ maps: mapList(), partial: partialList() });
    }
    const name = mapName(path);
    // a file directly in MAPS has to be a map with an 8.3 name, as on the firmware
    const inMaps = path.toUpperCase().startsWith("/SD/MAPS/") && !path.slice("/sd/MAPS/".length).includes("/");
    if ((method === "PUT" || method === "DELETE") && inMaps && !name) {
        return empty(400);
    }
    if (method === "PUT" && name) {
        if (!map) {
            return empty(400);
        }
        const length = range ? range.end - range.start + 1 : map.size;
        if (length + 32768 > SD_FREE - usedByMaps) {
            return empty(507);
        }
        const partial = partials.get(name)?.size ?? 0;
        if (range && range.start > 0 && partial !== range.start) {
            return { status: 416, text: `the card has ${partial} bytes of the file` };
        }
        const arrived = Math.min(received ?? length, length);
        const size = (range?.start ?? 0) + arrived;
        if (arrived === length && size === map.size) {
            partials.delete(name);
            maps.set(name, { size: map.size, created: map.created, bounds: map.bounds });
            return empty(204);
        }
        // only parts of maps are kept, as on the firmware
        if (range) {
            partials.set(name, { size, total: range.total, created: map.created });
        }
        return arrived === length ? empty(204) : { status: 0, text: "connection lost" };
    }
    if (method === "DELETE" && name) {
        const deleted = maps.delete(name);
        return empty(partials.delete(name) || deleted ? 204 : 404);
    }
    // no tiles on the card yet
    if (method === "GET" && path.startsWith("/sd/")) {
        return empty(404);
    }
    if (method === "POST" && path === "/api/transfer") {
        return empty(200);
    }
    if (method === "POST" && path === "/api/reload") {
        return empty(204);
    }
    if (method === "PUT" || method === "DELETE" || method === "POST") {
        return empty(204);
    }
    return empty(404);

}
