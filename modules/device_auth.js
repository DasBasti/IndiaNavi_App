// Requests that change the IndiaNavi (uploads, deletes, reload, transfer, firmware) are only accepted over its own
// access point, which is protected by its WPA2 password. In the WiFi of a router the device wants that password as
// token: "Authorization: Bearer <password of the access point>", see docs/wifi_upload_api.md.

// token of each device address
const tokens = new Map();

// Remembers the password of the access point of the device at base, an empty one forgets it
export const setDeviceToken = (base, token) => {
    if (token) {
        tokens.set(base, token);
    } else {
        tokens.delete(base);
    }
};

// Headers for a request: the token for everything but GET, when it is known
export const authHeaders = (base, method) => {
    const token = tokens.get(base);
    return token && method !== "GET" ? { Authorization: `Bearer ${token}` } : {};
};

// The text for a 401 of the device
export const UNAUTHORIZED_TEXT =
    "The IndiaNavi only accepts changes from the WiFi of a router with the password of its own WiFi. Type it into " +
    "the password field (it is shown with the QR code on the charging screen) and connect again.";
