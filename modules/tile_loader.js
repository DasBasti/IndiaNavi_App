import { fetch } from "expo/fetch";
import UPNG from "upng-js";

import { convertImage } from "./map_color";
import { hasFile, tileFile, writeFile } from "./sd_card";
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
    const image = UPNG.decode(png.buffer);
    return { png, rgba: new Uint8Array(UPNG.toRGBA8(image)[0]), width: image.width, height: image.height };

}

// Downloads a tile and returns it as raw image for the IndiaNavi, converted with the filter
export const downloadTile = async (template, tile, filter, signal) => {
    const { rgba, width, height } = await fetchTile(template, tile, signal);
    return convertImage(rgba, width, height, filter);
}

// Loads all tiles that are not on the phone yet from the server of the URL template,
// converts them with the filter and stores them as raw images.
// onProgress is called with { done, total, failed } after every tile.
// Returns the list of tiles that could not be loaded.
export const loadTiles = async (template, tiles, filter, { onProgress, signal } = {}) => {

    const failed = [];
    let next = 0;
    let done = 0;

    const worker = async () => {
        while (next < tiles.length && !signal?.aborted) {
            const tile = tiles[next++];
            try {
                const file = tileFile(tile);
                if (!hasFile(file)) {
                    writeFile(file, await downloadTile(template, tile, filter, signal));
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
