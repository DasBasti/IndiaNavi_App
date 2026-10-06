import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_FILTER, convertPixels } from './map_color.js';

const SIZE = 16;

// A tile of a single color
const plain = (r, g, b) => {
    const rgba = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
        rgba.set([r, g, b, 255], i * 4);
    }
    return rgba;
}

const count = (pixels, color) => pixels.filter((pixel) => pixel === color).length;

test('two colors without share are a checkerboard like before', () => {
    const filter = [{ rgb: [127, 127, 127], colors: [0, 1] }];
    const pixels = convertPixels(plain(127, 127, 127), SIZE, SIZE, filter);
    pixels.forEach((pixel, i) => {
        const x = i % SIZE;
        const y = Math.floor(i / SIZE);
        assert.equal(pixel, (x + y) % 2 === 0 ? 0 : 1);
    });
});

test('share is the part of the second color', () => {
    for (const share of [1 / 16, 1 / 8, 1 / 4, 3 / 8, 3 / 4]) {
        const filter = [{ rgb: [0, 0, 0], colors: [1, 2], share }];
        const pixels = convertPixels(plain(0, 0, 0), SIZE, SIZE, filter);
        assert.equal(count(pixels, 2), share * SIZE * SIZE);
    }
});

test('a single color fills every pixel', () => {
    const filter = [{ rgb: [0, 0, 0], colors: [4], share: 0.5 }];
    assert.equal(count(convertPixels(plain(0, 0, 0), SIZE, SIZE, filter), 4), SIZE * SIZE);
});

test('the paper of the default map stays white', () => {
    assert.equal(count(convertPixels(plain(0xf6, 0xf8, 0xd5), SIZE, SIZE, DEFAULT_FILTER), 1), SIZE * SIZE);
});

test('the default forest is a quarter green', () => {
    const pixels = convertPixels(plain(0xd6, 0xef, 0xca), SIZE, SIZE, DEFAULT_FILTER);
    assert.equal(count(pixels, 2), SIZE * SIZE / 4);
    assert.equal(count(pixels, 1), SIZE * SIZE * 3 / 4);
});

test('a thin dark line in a dithered entry is drawn solid in the darker color', () => {
    const filter = [{ rgb: [255, 255, 255], colors: [1, 2], share: 1 / 4 }];
    const rgba = plain(255, 255, 255);
    for (let x = 0; x < SIZE; x++) {
        rgba.set([200, 200, 200], (5 * SIZE + x) * 4);
    }
    const pixels = convertPixels(rgba, SIZE, SIZE, filter);
    for (let x = 0; x < SIZE; x++) {
        assert.equal(pixels[5 * SIZE + x], 2);
    }
    // the rows around the line keep the pattern
    const pattern = convertPixels(plain(255, 255, 255), SIZE, SIZE, filter);
    for (const row of [4, 6]) {
        assert.deepEqual(pixels.subarray(row * SIZE, (row + 1) * SIZE), pattern.subarray(row * SIZE, (row + 1) * SIZE));
    }
});

test('smooth shading is no line', () => {
    const filter = [{ rgb: [255, 255, 255], colors: [1, 2], share: 1 / 4 }];
    const rgba = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
        const value = 255 - (i % SIZE) * 4;
        rgba.set([value, value, value, 255], i * 4);
    }
    assert.equal(count(convertPixels(rgba, SIZE, SIZE, filter), 2), SIZE * SIZE / 4);
});
