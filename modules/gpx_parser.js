import { gpx } from "@tmcw/togeojson"
import { DOMParser } from "@xmldom/xmldom"

// Takes the contents of a GPX file and returns it as a GeoJSON FeatureCollection
export const parse = (gpxText) => {

    const doc = new DOMParser().parseFromString(gpxText, "text/xml");
    return gpx(doc);

}
