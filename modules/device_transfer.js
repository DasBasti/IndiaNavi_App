import { fetch } from "expo/fetch";
import { File } from "expo-file-system";

import { checkFirmwareImage } from "./firmware_release";
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

    const body = await new File(file.uri).bytes();
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
