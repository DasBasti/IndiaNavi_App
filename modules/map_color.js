// Converts map tiles to the 7 color raw format of the IndiaNavi display.
// This is a port of indianavi_map_color from the IndiaNavi converter.

// Colors of the display, the position in the list is the raw value of the color
export const DISPLAY_COLORS = [
    { name: "Black", rgb: [0, 0, 0] },
    { name: "White", rgb: [255, 255, 255] },
    { name: "Green", rgb: [0, 255, 0] },
    { name: "Blue", rgb: [0, 0, 255] },
    { name: "Red", rgb: [255, 0, 0] },
    { name: "Yellow", rgb: [255, 255, 50] },
    { name: "Orange", rgb: [255, 127, 0] },
];

const BLACK = 0;
const WHITE = 1;
const GREEN = 2;
const BLUE = 3;
const RED = 4;
const YELLOW = 5;
const ORANGE = 6;

// The converter calculates with f32, so every step is rounded to stay bit compatible
const f = Math.fround;

const KAPPA = f(24389 / 27);
const EPSILON = f(216 / 24389);
const E_0_255 = f(f(3294.6) * f(0.003130668442500564));
const WHITE_X = f(0.9504492182750991);
const WHITE_Z = f(1.0889166484304715);

const mul3 = (a0, a1, a2, b0, b1, b2) =>
    f(f(f(a0 * f(b0)) + f(a1 * f(b1))) + f(a2 * f(b2)));

const rgbToXyzMap = (c) =>
    c > E_0_255
        ? f(Math.pow(f(f(c + f(f(0.055) * 255)) / f(f(1.055) * 255)), f(2.4)))
        : f(c / f(f(12.92) * 255));

const xyzToLabMap = (c) =>
    c > EPSILON
        ? f(Math.pow(c, f(1 / 3)))
        : f(f(f(KAPPA * c) + 16) / 116);

// Same conversion as Lab::from_rgb of the lab crate
export const rgbToLab = (red, green, blue) => {

    const r = rgbToXyzMap(red);
    const g = rgbToXyzMap(green);
    const b = rgbToXyzMap(blue);

    const x = xyzToLabMap(f(mul3(r, g, b, 0.4124108464885388, 0.3575845678529519, 0.18045380393360833) / WHITE_X));
    const y = xyzToLabMap(mul3(r, g, b, 0.21264934272065283, 0.7151691357059038, 0.07218152157344333));
    const z = xyzToLabMap(f(mul3(r, g, b, 0.019331758429150258, 0.11919485595098397, 0.9503900340503373) / WHITE_Z));

    return [f(f(116 * y) - 16), f(500 * f(x - y)), f(200 * f(y - z))];

}

// A filter is a list of { rgb, colors }. Every pixel of the map gets the display colors of
// the entry with the most similar rgb color. Two display colors are dithered in a checkerboard pattern.
export const DEFAULT_FILTER = [
    { rgb: [255, 255, 255], colors: [WHITE] },
    { rgb: [0, 0, 0], colors: [BLACK] },
    { rgb: [0x90, 0x90, 0x90], colors: [BLACK] },
    { rgb: [0x6b, 0x6b, 0x6b], colors: [BLACK] },
    { rgb: [0, 0, 255], colors: [BLUE] },
    { rgb: [255, 0, 0], colors: [RED] },
    { rgb: [0, 255, 0], colors: [GREEN] },
    { rgb: [255, 127, 0], colors: [ORANGE] },
    { rgb: [255, 255, 0], colors: [YELLOW] },
    { rgb: [0x5c, 0x5c, 0xd4], colors: [BLUE] },
    { rgb: [0xc9, 0x73, 0x66], colors: [RED] },
    { rgb: [127, 127, 127], colors: [BLACK, WHITE] },
    { rgb: [255, 255, 155], colors: [YELLOW, WHITE] },
    { rgb: [64, 255, 64], colors: [GREEN] },
    { rgb: [191, 255, 191], colors: [GREEN, WHITE] },
    { rgb: [212, 250, 212], colors: [GREEN, WHITE] },
    { rgb: [251, 212, 157], colors: [RED, WHITE] },
    { rgb: [127, 0, 255], colors: [RED, BLUE] },
];

// Tiles only use a few colors, so the result of the color search is kept
const MAX_CACHED_COLORS = 1 << 16;

// Lab colors and the search cache of every filter, filters are never changed but replaced
const preparedFilters = new WeakMap();

const prepare = (filter) => {
    let prepared = preparedFilters.get(filter);
    if (prepared === undefined) {
        prepared = { labs: filter.map((entry) => rgbToLab(...entry.rgb)), cache: new Map() };
        preparedFilters.set(filter, prepared);
    }
    return prepared;
}

const findEntry = ({ labs }, r, g, b) => {

    const lab = rgbToLab(r, g, b);
    let mostFittingDE = Infinity;
    let mostFitting = 0;
    labs.forEach((entry, index) => {
        const dESquared = f(f(f(f(lab[0] - entry[0]) ** 2) + f(f(lab[1] - entry[1]) ** 2)) + f(f(lab[2] - entry[2]) ** 2));
        if (dESquared < mostFittingDE) {
            mostFitting = index;
            mostFittingDE = dESquared;
        }
    });
    return mostFitting;

}

// Returns the index of the filter entry used for a color of the map
export const findFilterEntry = (filter, r, g, b) => {

    const prepared = prepare(filter);
    const key = (r << 16) | (g << 8) | b;
    let index = prepared.cache.get(key);
    if (index === undefined) {
        if (prepared.cache.size >= MAX_CACHED_COLORS) {
            prepared.cache.clear();
        }
        index = findEntry(prepared, r, g, b);
        prepared.cache.set(key, index);
    }
    return index;

}

// Takes RGBA pixels and returns the raw display color of every pixel
export const convertPixels = (rgba, width, height, filter = DEFAULT_FILTER) => {

    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) {
        const { colors } = filter[findFilterEntry(filter, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])];
        const x = i % width;
        const y = (i - x) / width;
        pixels[i] = colors.length === 1 || (x + y) % 2 === 0 ? colors[0] : colors[1];
    }
    return pixels;

}

// Takes RGBA pixels and returns the raw image with two pixels per byte
export const convertImage = (rgba, width, height, filter = DEFAULT_FILTER) => {

    const pixels = convertPixels(rgba, width, height, filter);
    const raw = new Uint8Array(pixels.length >> 1);
    for (let i = 0; i < raw.length; i++) {
        raw[i] = (pixels[i * 2] << 4) | pixels[i * 2 + 1];
    }
    return raw;

}
