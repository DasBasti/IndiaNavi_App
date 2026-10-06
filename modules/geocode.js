// Finds places by name with Nominatim of OpenStreetMap, or takes coordinates like "49.143, 7.765"
const COORDINATES = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

// Returns a list of { name, lon, lat }
export const searchPlaces = async (query, signal) => {
    const match = query.match(COORDINATES);
    if (match) {
        const [lat, lon] = [Number(match[1]), Number(match[2])];
        if (Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
            return [{ name: `${lat}, ${lon}`, lon, lat }];
        }
    }

    const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`,
        { signal, headers: { 'User-Agent': 'IndiaNaviApp/1.0', Accept: 'application/json' } }
    );
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json())
        .map((place) => ({ name: place.display_name, lon: Number(place.lon), lat: Number(place.lat) }))
        .filter(({ lon, lat }) => Number.isFinite(lon) && Number.isFinite(lat));
}
