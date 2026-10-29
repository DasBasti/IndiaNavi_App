import { requireNativeView, requireOptionalNativeModule } from 'expo';

// Only available on Android, in a build of the app (not in Expo Go). Without it mapsforge.js draws the maps.
const IndiaNaviMapsforge = requireOptionalNativeModule('IndiaNaviMapsforge');

export const isNativeMapsforge = IndiaNaviMapsforge !== null;

// Opens the Mapsforge map at the path (not a file:// URI), returns its id. Throws if it is not a map.
export const openNativeMap = (path) => IndiaNaviMapsforge.open(path);

export const closeNativeMap = (id) => IndiaNaviMapsforge.close(id);

// Draws the maps (ids, in this order into one scene) at the view ({ lat, lon, zoom, width, height, anchorX, anchorY })
// into pixels, a Uint8Array of width x height inks with the background. Returns { tiles, labels }: labels are
// { x, y, text, rank } of the names of places to draw on top, the most important first.
export const renderNativeMaps = (ids, view, pixels) => IndiaNaviMapsforge.render(ids, view, pixels);

// Shows a framebuffer (Uint8Array of width x height inks) sharp in a view, without a PNG: setFrame puts the pixels
// under a key, a FramebufferView with that key and a new version shows them
export const FramebufferView = IndiaNaviMapsforge ? requireNativeView('IndiaNaviMapsforge') : null;

// palette is [r, g, b] by ink
export const setFrame = (key, pixels, width, height, palette) =>
  IndiaNaviMapsforge.setFrame(key, pixels, width, height, palette.map(([r, g, b]) => (r << 16) | (g << 8) | b));

export const dropFrame = (key) => IndiaNaviMapsforge?.dropFrame(key);
