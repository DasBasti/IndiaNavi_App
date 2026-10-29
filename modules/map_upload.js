// Sending vector maps to the IndiaNavi: when an upload can be continued, the Content-Range of the rest and the time
// it takes. See docs/wifi_upload_api.md, version 3.

// bytes per second when no map was sent yet, measured with tiles (2 connections)
export const DEFAULT_UPLOAD_RATE = 180 * 1024;

// a measurement over a shorter time says little
const MIN_MEASURE_SECONDS = 10;

// The byte to continue the upload of a map at: the size of the part on the card if it is the start of the same map
// (the header of the part has the size and the creation date of the map), else 0.
// map is { size, created }, partial the entry of GET /api/maps or undefined.
export const resumeOffset = (map, partial) =>
  partial !== undefined && partial.total === map.size && partial.created === map.created
    && partial.size > 0 && partial.size < map.size
    ? partial.size
    : 0;

// The Content-Range header of the bytes from start to the end of a file of total bytes
export const contentRange = (start, total) => `bytes ${start}-${total - 1}/${total}`;

// The upload rate after an upload of bytes in seconds, averaged with the one before; previous without a usable
// measurement
export const measuredRate = (previous, bytes, seconds) => {
  if (seconds < MIN_MEASURE_SECONDS || bytes <= 0) {
    return previous;
  }
  const rate = bytes / seconds;
  return Math.round(previous ? (previous + rate) / 2 : rate);
};

// Minutes to send bytes at a rate, at least 1
export const minutesFor = (bytes, rate = DEFAULT_UPLOAD_RATE) => Math.max(1, Math.ceil(bytes / rate / 60));
