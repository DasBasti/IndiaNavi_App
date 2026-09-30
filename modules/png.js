import pako from "pako";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});

const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

const chunk = (type, data) => {
    const bytes = new Uint8Array(12 + data.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) {
        bytes[4 + i] = type.charCodeAt(i);
    }
    bytes.set(data, 8);
    view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
    return bytes;
}

const concat = (arrays) => {
    const result = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
    let offset = 0;
    for (const array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }
    return result;
}

// Encodes an image of palette indices as PNG. Every pixel is drawn as a square of scale x scale
// pixels, so the image stays sharp when it is shown larger than 1:1.
export const encodePalettePng = (indices, width, height, palette, scale = 1) => {

    const outWidth = width * scale;
    const outHeight = height * scale;

    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, outWidth);
    view.setUint32(4, outHeight);
    header[8] = 8; // bit depth
    header[9] = 3; // palette

    // every row starts with the filter type 0
    const rows = new Uint8Array((outWidth + 1) * outHeight);
    for (let y = 0; y < outHeight; y++) {
        const source = Math.floor(y / scale) * width;
        const row = y * (outWidth + 1) + 1;
        for (let x = 0; x < outWidth; x++) {
            rows[row + x] = indices[source + Math.floor(x / scale)];
        }
    }

    return concat([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("PLTE", new Uint8Array(palette.flat())),
        chunk("IDAT", pako.deflate(rows)),
        chunk("IEND", new Uint8Array(0)),
    ]);

}

export const pngDataUri = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:image/png;base64,${btoa(binary)}`;
}
