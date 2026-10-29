import { fetch } from "expo/fetch";
import { File, UploadTask } from "expo-file-system";

import { recordingPath } from "./ble/protocol";
import { checkFirmwareImage } from "./firmware_release";
import { SIMULATED_BASE, simulatedResponse } from "./simulated_device";
import { TRACK_PATH } from "./sd_card";

// Address of the IndiaNavi in its own access point
export const ACCESS_POINT_ADDRESS = "192.168.4.1";

// Address of the IndiaNavi in the WiFi of a router
export const DEFAULT_ROUTER_ADDRESS = "indianavi.local";

// The device stores about 5 tiles per second
export const FILES_PER_SECOND = 5;

// The server of the device accepts 3 connections, the API asks to use at most 2
const PARALLEL_REQUESTS = 2;
const RETRIES = 3;
const INFO_TIMEOUT = 5000;
const REQUEST_TIMEOUT = 30000;
// Writing a firmware image of 1 to 2 MB to the flash of the device
const FIRMWARE_TIMEOUT = 180000;

// The card needs some space for the temporary file of an upload
const SPACE_RESERVE = 1024 * 1024;

export const deviceUrl = (address) => `http://${address}`;

class TimeoutError extends Error { }

const wait = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("cancelled"));
    });
});

// Sends a request to the device and returns { status, text }
const request = async (base, method, path, { body, headers, signal, timeout = REQUEST_TIMEOUT } = {}) => {

    if (base === SIMULATED_BASE) {
        // a short pause, so the progress of a transfer can be seen
        await wait(method === "PUT" ? 30 : 5, signal);
        return simulatedResponse(method, path);
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeout);
    signal?.addEventListener("abort", abort);
    try {
        const response = await fetch(`${base}${path}`, { method, body, headers, signal: controller.signal });
        return { status: response.status, text: await response.text() };
    } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) {
            throw new TimeoutError(`No answer from ${base}`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    }

}

const httpError = (what, { status, text }) =>
    new Error(`${what}: HTTP ${status}${text ? ` ${text.trim()}` : ""}`);

export const isTimeout = (error) => error instanceof TimeoutError;

// Returns { id, firmware, api, sd: { present, free, total } } of the device
export const getDeviceInfo = async (base, signal) => {
    const response = await request(base, "GET", "/api/info", { signal, timeout: INFO_TIMEOUT });
    if (response.status !== 200) {
        throw httpError("Device info", response);
    }
    const info = JSON.parse(response.text);
    if (typeof info.api !== "number" || !info.sd) {
        throw new Error(`${base} is no IndiaNavi`);
    }
    return info;
}

// Returns the names of the files in a folder of the SD card with their size, in lower case
const listFolder = async (base, folder, signal) => {
    const response = await request(base, "GET", `/sd/${folder}/`, { signal });
    if (response.status === 404) {
        return new Map();
    }
    if (response.status !== 200) {
        throw httpError(`Folder ${folder}`, response);
    }
    return new Map(
        JSON.parse(response.text)
            .filter((entry) => !entry.dir)
            .map((entry) => [entry.name.toLowerCase(), entry.size])
    );
}

const putFile = async (base, file, signal) => {

    const body = base === SIMULATED_BASE ? null : await new File(file.uri).bytes();
    for (let attempt = 1; ; attempt++) {
        let response;
        try {
            response = await request(base, "PUT", `/sd/${file.path}`, {
                body,
                headers: { "Content-Type": "application/octet-stream" },
                signal,
            });
        } catch (error) {
            if (signal?.aborted || attempt >= RETRIES) {
                throw error;
            }
            await wait(attempt * 1000, signal);
            continue;
        }

        if (response.status === 204) {
            return;
        }
        if (response.status === 507) {
            throw new Error("The SD card of the IndiaNavi is full");
        }
        // SD card busy or write failed, worth another try
        if ((response.status === 500 || response.status === 503) && attempt < RETRIES) {
            await wait(attempt * 1000, signal);
            continue;
        }
        throw httpError(file.path, response);
    }

}

// Deletes a file of the SD card, a file that is not there is fine
const deleteFile = async (base, path, signal) => {
    const response = await request(base, "DELETE", `/sd/${path}`, { signal });
    if (response.status !== 204 && response.status !== 404) {
        throw httpError(`Delete ${path}`, response);
    }
}

// Runs task for all items with a few requests at the same time
const runParallel = async (items, task, signal) => {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            if (signal?.aborted) {
                throw new Error("cancelled");
            }
            await task(items[next++]);
        }
    };
    await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, worker));
}

const folderOf = (path) => path.slice(0, path.lastIndexOf("/"));
const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1).toLowerCase();

// Copies the files ({ path, uri, size }, paths relative to the SD card) to the device.
// Tiles that are already on the card are skipped, with replaceTiles all of them are sent again, for example after the
// filter was changed. track.gpx is sent last and always. Without track.gpx in the files the old track is deleted from
// the card, unless keepTrack is set.
// onProgress gets { phase: "check" | "upload" | "finish", done, total, bytesDone, bytesTotal }.
// Returns { uploaded, skipped, bytes }.
export const transferToDevice = async (base, files, { signal, onProgress, replaceTiles = false, keepTrack = false } = {}) => {

    const info = await getDeviceInfo(base, signal);
    if (!info.sd.present) {
        throw new Error("The IndiaNavi has no SD card");
    }

    const track = files.filter((file) => !file.path.startsWith("MAPS/"));
    const tiles = files.filter((file) => file.path.startsWith("MAPS/"));

    // which tiles are already on the card
    let missing = tiles;
    if (!replaceTiles) {
        const folders = [...new Set(tiles.map((tile) => folderOf(tile.path)))];
        const listings = new Map();
        let checked = 0;
        onProgress?.({ phase: "check", done: 0, total: folders.length });
        await runParallel(folders, async (folder) => {
            listings.set(folder, await listFolder(base, folder, signal));
            onProgress?.({ phase: "check", done: ++checked, total: folders.length });
        }, signal);
        missing = tiles.filter((tile) => listings.get(folderOf(tile.path)).get(nameOf(tile.path)) !== tile.size);
    }

    const upload = [...missing, ...track];
    const bytesTotal = upload.reduce((sum, file) => sum + file.size, 0);
    // replaced tiles take the place of the old ones, a full card answers with 507
    if (!replaceTiles && bytesTotal + SPACE_RESERVE > info.sd.free) {
        throw new Error(`Not enough space on the SD card of the IndiaNavi: ${bytesTotal} bytes needed, ${info.sd.free} free`);
    }

    // the device shows the progress on its display. Without a track and with all tiles on the card nothing is sent,
    // the device does not accept an announcement of 0 files.
    if (upload.length > 0) {
        const announced = await request(base, "POST", "/api/transfer", {
            body: JSON.stringify({ files: upload.length, bytes: bytesTotal }),
            headers: { "Content-Type": "application/json" },
            signal,
        });
        if (announced.status !== 200) {
            throw httpError("Transfer", announced);
        }
    }

    let done = 0;
    let bytesDone = 0;
    const uploaded = (file) => {
        done++;
        bytesDone += file.size;
        onProgress?.({ phase: "upload", done, total: upload.length, bytesDone, bytesTotal });
    };
    onProgress?.({ phase: "upload", done, total: upload.length, bytesDone, bytesTotal });

    try {
        await runParallel(missing, async (tile) => {
            await putFile(base, tile, signal);
            uploaded(tile);
        }, signal);
        // an interrupted transfer never leaves a new track without its map
        for (const file of track) {
            await putFile(base, file, signal);
            uploaded(file);
        }
        if (track.length === 0 && !keepTrack) {
            await deleteFile(base, TRACK_PATH, signal);
        }
    } catch (error) {
        if (signal?.aborted) {
            // removes the progress from the display
            await request(base, "DELETE", "/api/transfer", { timeout: INFO_TIMEOUT }).catch(() => { });
        }
        throw error;
    }

    onProgress?.({ phase: "finish", done, total: upload.length, bytesDone, bytesTotal });
    const reloaded = await request(base, "POST", "/api/reload", { signal });
    if (reloaded.status !== 204) {
        throw httpError("Reload", reloaded);
    }

    return { uploaded: upload.length, skipped: tiles.length - missing.length, bytes: bytesTotal };

}

// Downloads a recorded track and returns the GPX text. Outside of the access point of the IndiaNavi the device wants its
// password as token.
export const downloadRecording = async (base, id, { signal, token } = {}) => {
    const response = await request(base, "GET", `/sd/${recordingPath(id)}`, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (response.status === 409) {
        throw new Error("The track is still recorded, stop the recording first");
    }
    if (response.status === 404) {
        throw new Error("The track is not on the SD card any more");
    }
    if (response.status !== 200) {
        throw httpError("Download", response);
    }
    return response.text;
}

// true if the device takes vector maps over WiFi (API version 2)
export const supportsMaps = (info) => info.api >= 2 && info.vector_maps === true;

// The vector maps on the SD card of the device, read from their headers:
// [{ file, size, created, bounds: { minLat, minLon, maxLat, maxLon }, used }], used is false for a map that is
// replaced by a newer one of the same region
export const getDeviceMaps = async (base, signal) => {
    const response = await request(base, "GET", "/api/maps", { signal });
    if (response.status !== 200) {
        throw httpError("Maps", response);
    }
    return JSON.parse(response.text).maps.map(({ bounds: [minLat, minLon, maxLat, maxLon], ...map }) => ({
        ...map,
        bounds: { minLat, minLon, maxLat, maxLon },
    }));
}

export const mapPath = (file) => `MAPS/${file}`;

// Deletes a vector map of the SD card and lets the device read its maps again
export const deleteDeviceMap = async (base, file, signal) => {
    await deleteFile(base, mapPath(file), signal);
    await request(base, "POST", "/api/reload", { signal });
}

// Sends a vector map ({ uri, size, created, bounds } of the map on the phone) to the SD card as file (an 8.3 name).
// The file is streamed from the phone, maps have hundreds of MB. The device shows the progress on its display and
// reads its maps again afterwards. onProgress gets { bytesSent, totalBytes }.
export const sendMap = async (base, map, file, { signal, onProgress } = {}) => {

    const path = mapPath(file);
    const announced = await request(base, "POST", "/api/transfer", {
        body: JSON.stringify({ files: 1, bytes: map.size }),
        headers: { "Content-Type": "application/json" },
        signal,
    });
    if (announced.status !== 200) {
        throw httpError("Transfer", announced);
    }

    let result;
    try {
        if (base === SIMULATED_BASE) {
            // a few steps of progress, nothing is sent
            for (let step = 1; step <= 10; step++) {
                await wait(100, signal);
                onProgress?.({ bytesSent: map.size * step / 10, totalBytes: map.size });
            }
            result = simulatedResponse("PUT", `/sd/${path}`, { map });
        } else {
            const task = new UploadTask(new File(map.uri), `${base}/sd/${path}`, {
                httpMethod: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                onProgress,
                signal,
            });
            try {
                const response = await task.uploadAsync();
                result = { status: response.status, text: response.body };
            } finally {
                task.release();
            }
        }
    } catch (error) {
        // removes the progress from the display
        await request(base, "DELETE", "/api/transfer", { timeout: INFO_TIMEOUT }).catch(() => { });
        throw error;
    }

    if (result.status === 507) {
        throw new Error("The SD card of the IndiaNavi is full");
    }
    if (result.status !== 204) {
        throw httpError(path, result);
    }
    const reloaded = await request(base, "POST", "/api/reload", { signal });
    if (reloaded.status !== 204) {
        throw httpError("Reload", reloaded);
    }

}

// Reads a firmware image (.bin of the IndiaNavi firmware) from a picked file
export const readFirmware = async (file) => {
    return checkFirmwareImage(await (file instanceof File ? file : new File(file)).bytes());
}

// Installs the firmware image (bytes) on the device and restarts it. The device checks the image
// and keeps the old firmware if anything is wrong. Returns once the device accepted the restart.
export const updateFirmware = async (base, bytes, { signal } = {}) => {

    const info = await getDeviceInfo(base, signal);
    if (!info.ota) {
        throw new Error("The firmware of the IndiaNavi can not be updated over WiFi. Update it with a cable once.");
    }

    const uploaded = await request(base, "PUT", "/api/firmware", {
        body: bytes,
        headers: { "Content-Type": "application/octet-stream" },
        signal,
        timeout: FIRMWARE_TIMEOUT,
    });
    if (uploaded.status !== 204) {
        throw httpError("Firmware", uploaded);
    }

    const restarted = await request(base, "POST", "/api/restart", { signal, timeout: INFO_TIMEOUT });
    if (restarted.status !== 204) {
        throw httpError("Restart", restarted);
    }

}
