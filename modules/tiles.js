// Zoom levels the IndiaNavi map screen uses (zoom_min/zoom_max in config.xml)
export const ZOOM_LEVELS = [14, 16];

// Number of tiles loaded around the track in every direction
export const DEFAULT_MARGIN = 10;

// Zoom levels that only get a part of the margin, their tiles cover a larger area
const MARGIN_FACTORS = { 14: 0.5 };

export const zoomMargin = (margin, zoom) => Math.ceil(margin * (MARGIN_FACTORS[zoom] ?? 1));

// A converted tile is 256x256 pixels with 4 bit per pixel
export const RAW_TILE_BYTES = 256 * 256 / 2;

// Position on the map of the whole world, from 0 in the west/north to 1 in the east/south
export const lon2world = (lon) => (lon + 180) / 360;

export const lat2world = (lat) =>
    (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;

export const lon2tile = (lon, zoom) => Math.floor(lon2world(lon) * 2 ** zoom);

export const lat2tile = (lat, zoom) => Math.floor(lat2world(lat) * 2 ** zoom);

const geometryLines = (geometry) => {
    switch (geometry?.type) {
        case "LineString":
            return [geometry.coordinates];
        case "MultiLineString":
            return geometry.coordinates;
        case "GeometryCollection":
            return geometry.geometries.flatMap(geometryLines);
        default:
            return [];
    }
}

// Takes the GeoJSON of a GPX file and returns its tracks and routes as lists of [lon, lat]
export const trackLines = (geojson) =>
    geojson.features
        .flatMap((feature) => geometryLines(feature.geometry))
        .map((line) => line.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)))
        .filter((line) => line.length > 0);

// Returns the area covered by the lines of a GPX file.
// Returns null if there is neither a track nor a route in the file.
export const calculateBoundaries = (lines) => {

    let bounds = null;
    for (const [lon, lat] of lines.flat()) {
        if (bounds === null) {
            bounds = { minLon: lon, maxLon: lon, minLat: lat, maxLat: lat };
            continue;
        }
        bounds.minLon = Math.min(bounds.minLon, lon);
        bounds.maxLon = Math.max(bounds.maxLon, lon);
        bounds.minLat = Math.min(bounds.minLat, lat);
        bounds.maxLat = Math.max(bounds.maxLat, lat);
    }
    return bounds;

}

// Returns the inclusive tile range [from, to] for x and y on the given zoom level
export const tileRanges = (bounds, margin, zoom) => {

    margin = zoomMargin(margin, zoom);
    const last = 2 ** zoom - 1;
    const clamp = (tile) => Math.min(Math.max(tile, 0), last);

    // tile y grows to the south, so the northern border is the lower tile number
    return {
        x: [clamp(lon2tile(bounds.minLon, zoom) - margin), clamp(lon2tile(bounds.maxLon, zoom) + margin)],
        y: [clamp(lat2tile(bounds.maxLat, zoom) - margin), clamp(lat2tile(bounds.minLat, zoom) + margin)],
    };

}

// Returns the area the tiles of a zoom level cover in world positions
export const tileArea = (bounds, margin, zoom) => {
    const { x, y } = tileRanges(bounds, margin, zoom);
    const size = 2 ** zoom;
    return { west: x[0] / size, east: (x[1] + 1) / size, north: y[0] / size, south: (y[1] + 1) / size };
}

export const countTiles = (bounds, margin, zoom) => {
    const { x, y } = tileRanges(bounds, margin, zoom);
    return (x[1] - x[0] + 1) * (y[1] - y[0] + 1);
}

// Returns all tiles needed for the area as a list of { zoom, x, y }
export const listTiles = (bounds, margin, zooms = ZOOM_LEVELS) => {

    const tiles = [];
    for (const zoom of zooms) {
        const range = tileRanges(bounds, margin, zoom);
        for (let x = range.x[0]; x <= range.x[1]; x++) {
            for (let y = range.y[0]; y <= range.y[1]; y++) {
                tiles.push({ zoom, x, y });
            }
        }
    }
    return tiles;

}
