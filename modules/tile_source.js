// Tiles are loaded from the outdoors map of thunderforest.com by default.
// The API key is added to every request to thunderforest.com, so it is not part of the URL the user
// sees and edits. EXPO_PUBLIC_THUNDERFOREST_API_KEY replaces the key of the app.
// The user can change the URL in the app.
const THUNDERFOREST_API_KEY = process.env.EXPO_PUBLIC_THUNDERFOREST_API_KEY ?? "4a7a45656e334e7b96330676604ebd01";

export const DEFAULT_TILE_URL = "https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png";

// Adds the API key to URLs of thunderforest.com that have none
const withApiKey = (url) => {
    if (!/^https?:\/\/([^/?#]+\.)?thunderforest\.com[/?#]/.test(url) || /[?&]apikey=/.test(url)) {
        return url;
    }
    return `${url}${url.includes("?") ? "&" : "?"}apikey=${THUNDERFOREST_API_KEY}`;
}

export const tileUrl = (template, { zoom, x, y }) =>
    withApiKey(template.replaceAll("{z}", zoom).replaceAll("{x}", x).replaceAll("{y}", y));

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
