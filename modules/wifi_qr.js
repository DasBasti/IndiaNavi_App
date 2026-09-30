// Reads the WiFi QR code format shown by the IndiaNavi:
//   WIFI:T:WPA;S:IndiaNavi-E3ED;P:<password>;;
// Special characters in values are escaped with a backslash.
// Returns { ssid, password } or null if the text is no WiFi QR code.
export const parseWifiQr = (text) => {

    if (typeof text !== "string" || !text.startsWith("WIFI:")) {
        return null;
    }

    const fields = {};
    let key = "";
    let value = "";
    let inValue = false;
    for (let i = "WIFI:".length; i < text.length; i++) {
        const c = text[i];
        if (inValue) {
            if (c === "\\" && i + 1 < text.length) {
                value += text[++i];
            } else if (c === ";") {
                fields[key] = value;
                key = "";
                value = "";
                inValue = false;
            } else {
                value += c;
            }
        } else if (c === ":") {
            inValue = true;
        } else if (c !== ";") {
            key += c;
        }
    }

    if (!fields.S) {
        return null;
    }
    return { ssid: fields.S, password: fields.P ?? "" };

}
