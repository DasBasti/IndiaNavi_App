// Converts map tiles to the 7 color raw format of the IndiaNavi display.
// This is a port of indianavi_map_color from the IndiaNavi converter.

// Colors of the display, the position in the list is the raw value of the color.
// panel is how the color looks on the ACeP 5.65" display (measured by Pimoroni for the Inky Impression 5.7"),
// the previews use it so they look like the device.
export const DISPLAY_COLORS = [
    { name: "Black", rgb: [0, 0, 0], panel: [57, 48, 57] },
    { name: "White", rgb: [255, 255, 255], panel: [255, 255, 255] },
    { name: "Green", rgb: [0, 255, 0], panel: [58, 91, 70] },
    { name: "Blue", rgb: [0, 0, 255], panel: [61, 59, 94] },
    { name: "Red", rgb: [255, 0, 0], panel: [156, 72, 75] },
    { name: "Yellow", rgb: [255, 255, 50], panel: [208, 190, 71] },
    { name: "Orange", rgb: [255, 127, 0], panel: [177, 106, 73] },
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

// A filter is a list of { rgb, colors, share }. Every pixel of the map gets the display colors of
// the entry with the most similar rgb color. With two display colors, share is the part of the second
// color (0.5 if it is missing). They are mixed with an ordered dither pattern, at 0.5 it is a checkerboard.
// The default is made for the outdoors map of thunderforest.com.
export const DEFAULT_FILTER = [
    // paper, residential land and track fills stay white
    { rgb: [0xff, 0xff, 0xff], colors: [WHITE] },
    { rgb: [0xf6, 0xf8, 0xd5], colors: [WHITE] },
    { rgb: [0xe3, 0xe3, 0xde], colors: [WHITE] },
    { rgb: [0xf3, 0xf3, 0xdf], colors: [WHITE] },
    // main road fill
    { rgb: [0xff, 0xff, 0xd3], colors: [WHITE, YELLOW], share: 1 / 2 },
    // buildings and strong hillshading
    { rgb: [0xce, 0xce, 0xcd], colors: [WHITE, BLACK], share: 1 / 8 },
    // forest, a bit denser on the shaded side, meadows light
    { rgb: [0xd6, 0xef, 0xca], colors: [WHITE, GREEN], share: 1 / 4 },
    { rgb: [0xbd, 0xd3, 0xb4], colors: [WHITE, GREEN], share: 3 / 8 },
    { rgb: [0xed, 0xf8, 0xd9], colors: [WHITE, GREEN], share: 1 / 16 },
    { rgb: [0xd0, 0xe7, 0x8d], colors: [WHITE, GREEN], share: 3 / 8 },
    // water areas and streams
    { rgb: [0xab, 0xde, 0xff], colors: [WHITE, BLUE], share: 1 / 4 },
    { rgb: [0x43, 0x9a, 0xd4], colors: [BLUE] },
    { rgb: [0x00, 0x00, 0xff], colors: [BLUE] },
    // text and lines
    { rgb: [0x00, 0x00, 0x00], colors: [BLACK] },
    { rgb: [0x6b, 0x6b, 0x6b], colors: [BLACK] },
    { rgb: [0x90, 0x90, 0x90], colors: [BLACK] },
    // strong colors of routes, roads and symbols
    { rgb: [0xff, 0x00, 0x00], colors: [RED] },
    { rgb: [0xd6, 0x7b, 0x74], colors: [RED] },
    { rgb: [0x6a, 0x69, 0xe0], colors: [BLUE] },
    { rgb: [0xb1, 0x6a, 0xca], colors: [RED, BLUE], share: 1 / 2 },
    { rgb: [0x00, 0xff, 0x00], colors: [GREEN] },
    { rgb: [0x3d, 0x90, 0x42], colors: [GREEN] },
    { rgb: [0x9e, 0xd1, 0x95], colors: [GREEN] },
    { rgb: [0xff, 0x7f, 0x00], colors: [ORANGE] },
    { rgb: [0xff, 0xff, 0x00], colors: [YELLOW] },
    { rgb: [0xff, 0xff, 0x9b], colors: [WHITE, YELLOW], share: 1 / 2 },
    { rgb: [0xfb, 0xd4, 0x9d], colors: [WHITE, RED], share: 1 / 4 },
];

// Steps of the dither pattern, the share of an entry is rounded to them
export const SHARE_STEPS = 64;

// 8x8 Bayer matrix with the values 0..63. Tiles are 256 pixels wide, so the pattern continues over the tile borders.
const BAYER = (() => {
    let matrix = [[0]];
    while (matrix.length < 8) {
        const n = matrix.length;
        matrix = Array.from({ length: 2 * n }, (_, y) => Array.from({ length: 2 * n }, (_, x) =>
            4 * matrix[y % n][x % n] + [[0, 2], [3, 1]][Math.floor(y / n)][Math.floor(x / n)]));
    }
    return matrix.flat();
})();

// Number of pattern positions out of SHARE_STEPS that get the first color of the entry
const firstColorSteps = ({ colors, share = 0.5 }) =>
    colors.length === 1 ? SHARE_STEPS : Math.round((1 - share) * SHARE_STEPS);

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

// A pixel that is darker than the lightest pixel around it by more than this (in L*) is part of a line
// or text. It is drawn solid in the darker color of its entry, so lines are not broken by the dither pattern.
export const LINE_CONTRAST = 14;

// L* of the display colors, to find the darker color of an entry
const PANEL_LIGHTNESS = DISPLAY_COLORS.map(({ panel }) => rgbToLab(...panel)[0]);

const darkerColor = ({ colors }) =>
    colors.reduce((darker, color) => (PANEL_LIGHTNESS[color] < PANEL_LIGHTNESS[darker] ? color : darker));

const lightnessCache = new Map();

const lightness = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let l = lightnessCache.get(key);
    if (l === undefined) {
        if (lightnessCache.size >= MAX_CACHED_COLORS) {
            lightnessCache.clear();
        }
        l = rgbToLab(r, g, b)[0];
        lightnessCache.set(key, l);
    }
    return l;
}

// Takes RGBA pixels and returns the raw display color of every pixel
export const convertPixels = (rgba, width, height, filter = DEFAULT_FILTER) => {

    const steps = filter.map(firstColorSteps);
    const lineColors = filter.map(darkerColor);
    const entries = new Uint16Array(width * height);
    const lightnesses = new Float32Array(width * height);
    for (let i = 0; i < entries.length; i++) {
        const [r, g, b] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
        entries[i] = findFilterEntry(filter, r, g, b);
        lightnesses[i] = lightness(r, g, b);
    }

    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const index = entries[i];

            // the pixels at the border of the tile only compare with the pixels inside the tile
            let lightest = lightnesses[i];
            for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, height - 1); ny++) {
                for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, width - 1); nx++) {
                    lightest = Math.max(lightest, lightnesses[ny * width + nx]);
                }
            }

            const { colors } = filter[index];
            if (lightest - lightnesses[i] > LINE_CONTRAST) {
                pixels[i] = lineColors[index];
            } else {
                pixels[i] = BAYER[(y % 8) * 8 + x % 8] < steps[index] ? colors[0] : colors[colors.length - 1];
            }
        }
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
