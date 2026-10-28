// An IndiaNavi that exists only in the app. Typing in its WiFi name and password in the file transfer connects to it
// instead of a real device, so the screens can be tried and tested without hardware (for example in automated tests).
// It answers the requests of the WiFi upload API like the firmware does, see docs/wifi_upload_api.md.

export const SIMULATED_SSID = "IndiaNavi-7A21";
export const SIMULATED_PASSWORD = "wanderweg42";

// Address the app sends the requests to, nothing leaves the phone
export const SIMULATED_BASE = "http://simulated.indianavi";

const SD_TOTAL = 8 * 1024 * 1024 * 1024;
const SD_FREE = 6 * 1024 * 1024 * 1024;

export const isSimulatedWifi = (ssid, password) => ssid === SIMULATED_SSID && password === SIMULATED_PASSWORD;

const json = (value) => ({ status: 200, text: JSON.stringify(value) });
const empty = (status) => ({ status, text: "" });

// Returns { status, text } for a request to the simulated device
export const simulatedResponse = (method, path) => {

    if (method === "GET" && path === "/api/info") {
        return json({
            id: "IndiaNavi-7A21",
            firmware: "1.2.3",
            api: 1,
            ota: true,
            sd: { present: true, free: SD_FREE, total: SD_TOTAL },
        });
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
