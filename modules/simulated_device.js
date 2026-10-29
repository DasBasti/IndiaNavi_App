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

export const clearSimulatedMaps = () => maps.clear();

const mapName = (path) => {
    const name = path.slice("/sd/MAPS/".length).toLowerCase();
    return path.toUpperCase().startsWith("/SD/MAPS/") && isCardName(name) ? name : null;
};

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
// needs map: { size, created, bounds } of its header, the simulation does not read the file.
export const simulatedResponse = (method, path, { map } = {}) => {

    const usedByMaps = [...maps.values()].reduce((sum, entry) => sum + entry.size, 0);
    if (method === "GET" && path === "/api/info") {
        return json({
            id: "IndiaNavi-7A21",
            firmware: "1.2.3",
            api: 2,
            ota: true,
            vector_maps: true,
            sd: { present: true, free: SD_FREE - usedByMaps, total: SD_TOTAL },
        });
    }
    if (method === "GET" && path === "/api/maps") {
        return json({ maps: mapList() });
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
        if (map.size + 32768 > SD_FREE - usedByMaps + (maps.get(name)?.size ?? 0)) {
            return empty(507);
        }
        maps.set(name, { size: map.size, created: map.created, bounds: map.bounds });
        return empty(204);
    }
    if (method === "DELETE" && name) {
        return empty(maps.delete(name) ? 204 : 404);
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
