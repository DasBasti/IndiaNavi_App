#!/usr/bin/env python3
"""Draws the splash screen of the app with the big 8x16 font and the north arrow of the IndiaNavi firmware.

Usage: tools/generate_splash.py [path to IndiaNavi_Firmware]

Writes assets/splash.png and the splashscreen_logo.png of every density of the Android project.
The logo is transparent, the green background is set in app.json (and android/.../colors.xml).
Needs Pillow.
"""
import os
import re
import sys

from PIL import Image

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
firmware = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, '..', 'IndiaNavi_Firmware')

GRID = 96  # the logo is 288 dp, one pixel of the display font is 3 dp
BLACK = (0, 0, 0, 255)
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
LINES = ['WANDER', 'NAVI']


def read_font():
    source = open(os.path.join(firmware, 'lib', 'Platinenmacher', 'fonts', 'font8x16.c')).read()
    body = re.sub(r'//.*', '', source[source.index('font8x16[]'):])
    data = [int(v, 0) for v in re.findall(r'0x[0-9a-fA-F]+|\d+', body.split('{', 1)[1].split('}', 1)[0])]
    assert data[:3] == [8, 16, 0x20], 'unexpected font header'
    return data[4:]


def glyph(font, char):
    """16 rows of 8 pixels. Every column is 2 bytes, the first has the upper 8 rows, bit 0 is the top."""
    offset = (ord(char) - 0x20) * 16
    return [[(font[offset + (col + 8 * (row // 8))] >> (row % 8)) & 1 for col in range(8)]
            for row in range(16)]


def read_icon(name):
    source = open(os.path.join(firmware, 'lib', 'icons_16', f'{name}.c')).read()
    data = [int(v, 16) for v in re.findall(r'0x([0-9a-fA-F]{2})', source)]
    pixels = [value for byte in data for value in (byte >> 4, byte & 15)]
    return [[pixels[y * 16 + x] for x in range(16)] for y in range(16)]


def compose():
    font = read_font()
    grid = [[0] * GRID for _ in range(GRID)]

    def plot(x0, y0, rows):
        for y, row in enumerate(rows):
            for x, value in enumerate(row):
                if value:
                    grid[y0 + y][x0 + x] = 1

    arrow = read_icon('norden')
    gap = 4
    height = 16 + gap + 16 * len(LINES)
    top = (GRID - height) // 2
    plot((GRID - 16) // 2, top, [[int(v == 0) for v in row] for row in arrow])
    for index, line in enumerate(LINES):
        left = (GRID - 8 * len(line)) // 2
        for char_index, char in enumerate(line):
            plot(left + 8 * char_index, top + 16 + gap + 16 * index, glyph(font, char))
    return grid


def render(grid, scale):
    size = round(GRID * 3 * scale)
    per_pixel = size / GRID
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            if grid[int(y / per_pixel)][int(x / per_pixel)]:
                pixels[x, y] = BLACK
    return image


def main():
    grid = compose()
    render(grid, 4).save(os.path.join(root, 'assets', 'splash.png'))
    for density, scale in DENSITIES.items():
        folder = os.path.join(root, 'android', 'app', 'src', 'main', 'res', f'drawable-{density}')
        render(grid, scale).save(os.path.join(folder, 'splashscreen_logo.png'))
    print('splash screen written')


if __name__ == '__main__':
    main()
