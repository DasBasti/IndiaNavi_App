import { gpx } from "@tmcw/togeojson"
import { DOMParser } from "@xmldom/xmldom"

// Takes the contents of a GPX file and returns it as a GeoJSON FeatureCollection
export const parse = (gpxText) => {

    // some GPX files start with a byte order mark the parser can not handle
    const doc = new DOMParser().parseFromString(gpxText.replace(/^\uFEFF/, ""), "text/xml");
    return gpx(doc);

}
