// Tiles are loaded from opentopomap.org like the IndiaNavi converter describes it.
// With EXPO_PUBLIC_THUNDERFOREST_API_KEY set, the outdoors map of thunderforest.com is the default instead.
// The user can change the URL in the app.
const THUNDERFOREST_API_KEY = process.env.EXPO_PUBLIC_THUNDERFOREST_API_KEY;

export const DEFAULT_TILE_URL = THUNDERFOREST_API_KEY
    ? `https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_API_KEY}`
    : "https://tile.opentopomap.org/{z}/{x}/{y}.png";

export const tileUrl = (template, { zoom, x, y }) =>
    template.replaceAll("{z}", zoom).replaceAll("{x}", x).replaceAll("{y}", y);

// Returns why the URL can not be used to load tiles, or null if it is fine
export const checkTileUrl = (template) => {
    if (!/^https?:\/\/[^/?#]+/.test(template)) {
        return "The URL has to start with http:// or https://";
    }
    const missing = ["{z}", "{x}", "{y}"].filter((placeholder) => !template.includes(placeholder));
    if (missing.length > 0) {
        return `The URL needs ${missing.join(", ")}`;
    }
    return null;
}

// Name of the tile server to show to the user
export const tileServerName = (template) =>
    template.match(/^https?:\/\/([^/?#]+)/)?.[1] ?? template;
