import { fetch } from "expo/fetch";
import UPNG from "upng-js";

import { convertImage } from "./map_color";
import { hasFile, listStoredTiles, originalFile, tileFile, writeFile } from "./sd_card";
import { tileUrl } from "./tile_source";

const PARALLEL_DOWNLOADS = 4;

// Downloads a tile from the server of the URL template.
// Returns the PNG file and its pixels as { png, rgba, width, height }.
export const fetchTile = async (template, tile, signal) => {

    const response = await fetch(tileUrl(template, tile), {
        signal,
        headers: { "User-Agent": "IndiaNaviApp/1.0" },
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const png = new Uint8Array(await response.arrayBuffer());
    return { png, ...decodePng(png) };

}

const decodePng = (png) => {
    const image = UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
    return { rgba: new Uint8Array(UPNG.toRGBA8(image)[0]), width: image.width, height: image.height };
}

// Returns the pixels { rgba, width, height } of a tile, from the original on the phone or from the server.
// Downloaded tiles are kept, so they can be converted again with another filter.
export const loadOriginal = async (template, tile, signal) => {
    const file = originalFile(tile);
    if (hasFile(file)) {
        try {
            return decodePng(await file.bytes());
        } catch {
            // a broken file is loaded again
        }
    }
    const { png, ...pixels } = await fetchTile(template, tile, signal);
    writeFile(file, png);
    return pixels;
}

// the screen is drawn between two tiles, converting takes a while
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// Converts the tiles with the filter and stores them as raw images. Without all only the tiles that are not on the
// phone yet, with all of them again. onProgress is called with { done, total, failed } after every tile.
// Returns the list of tiles that could not be converted.
const convertTiles = async (template, tiles, filter, { all, onProgress, signal }) => {

    const failed = [];
    let next = 0;
    let done = 0;

    const worker = async () => {
        while (next < tiles.length && !signal?.aborted) {
            const tile = tiles[next++];
            try {
                const file = tileFile(tile);
                if (all || !hasFile(file)) {
                    const { rgba, width, height } = await loadOriginal(template, tile, signal);
                    writeFile(file, convertImage(rgba, width, height, filter));
                    await nextFrame();
                }
            } catch (error) {
                if (signal?.aborted) {
                    return;
                }
                failed.push({ tile, error });
            }
            done++;
            onProgress?.({ done, total: tiles.length, failed: failed.length });
        }
    };

    await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
    return failed;

}

// Loads all tiles that are not on the phone yet from the server of the URL template,
// converts them with the filter and stores them as raw images.
// onProgress is called with { done, total, failed } after every tile.
// Returns the list of tiles that could not be loaded.
export const loadTiles = (template, tiles, filter, options = {}) =>
    convertTiles(template, tiles, filter, { ...options, all: false });

// Converts all tiles on the phone again, after the filter was changed. Like loadTiles otherwise.
export const reconvertTiles = (template, filter, options = {}) =>
    convertTiles(template, listStoredTiles(), filter, { ...options, all: true });
