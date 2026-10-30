// The drawing style of the vector maps (the .map files in MAPS), a copy of the style of the firmware: inks, patterns
// and draw orders of lib/mapsforge-rs/src/style.rs, the rules of its built-in stylesheet styles/hiking.style (see
// docs/COLOR_SCHEMA.md there). The info pages of the app show from it what the IndiaNavi draws. Names, numbers and
// the order of the rules are the same as there, vector_style.test.js compares them with the files of the firmware.

// Inks of the display, the numbers of the firmware's color_t
export const BLACK = 0;
export const WHITE = 1;
export const GREEN = 2;
export const BLUE = 3;
export const RED = 4;
export const YELLOW = 5;
export const ORANGE = 6;

export const INK_NAMES = ['black', 'white', 'green', 'blue', 'red', 'yellow', 'orange'];

// Patterns: which pixels of a 4x4 cell get ink A, the cell is anchored at the screen pixel x & 3, y & 3
export const SOLID = 0;
export const P50 = 1; // checkerboard
export const P25 = 2; // square grid of dots
export const P75 = 3;
export const P12 = 4; // diagonal grid of dots
export const P6 = 5; // sparse dots
export const HLINES = 6; // horizontal hatching
export const DIAG = 7; // diagonal hatching

// Bit x & 3 of nibble y & 3 set means ink A
export const PATTERN_MASKS = [0xffff, 0xa5a5, 0x0505, 0xafaf, 0x0401, 0x0001, 0x000f, 0x2481];

// Paint codes as in the C API of the firmware: ink A in bits 0..7, pattern in bits 24..27, B in bits 28..31
// (0 = the background, 1..7 = ink + 1, 15 = transparent). Built with arithmetic, the codes do not fit an int32.
export const B_BACKGROUND = 0;
export const B_TRANSPARENT = 15;

const code = (a, pattern, b) => a + pattern * 2 ** 24 + b * 2 ** 28;

export const solid = (a) => a;
// a with pattern on the background (white)
export const tint = (a, pattern) => code(a, pattern, B_BACKGROUND);
// a with pattern, b in the other pixels
export const mix = (a, b, pattern) => code(a, pattern, b + 1);
// only the pixels of a, whatever is below stays visible
export const overlay = (a, pattern) => code(a, pattern, B_TRANSPARENT);

export const inkA = (paint) => paint % 256;
export const patternOf = (paint) => Math.floor(paint / 2 ** 24) % 16;
export const bCode = (paint) => Math.floor(paint / 2 ** 28);
export const isOverlay = (paint) => patternOf(paint) !== SOLID && bCode(paint) === B_TRANSPARENT;

const maskOf = (paint) => PATTERN_MASKS[patternOf(paint)] ?? 0xffff;

// Pixels of ink A in a 4x4 cell (0..16)
export const coverage = (paint) => {
  let count = 0;
  for (let mask = maskOf(paint); mask; mask >>= 1) {
    count += mask & 1;
  }
  return count;
};

// Ink of the pixel at the screen position x, y; null where an overlay lets the ground through
export const inkAt = (paint, x, y, background = WHITE) => {
  if ((maskOf(paint) >> ((y & 3) * 4 + (x & 3))) & 1) {
    return inkA(paint);
  }
  const b = bCode(paint);
  if (b === B_BACKGROUND) {
    return background;
  }
  return b === B_TRANSPARENT ? null : b - 1;
};

// Draw order within a layer, low values first
export const order = {
  SEA: 0,
  LAND: 1,
  LANDUSE: 2,
  GREEN: 3,
  SCRUB: 4,
  FOREST: 5,
  BARE: 6,
  WATER: 7,
  OVERLAY: 8,
  BUILDING: 9,
  WATERWAY_CASING: 10, // casings of streams
  WATERWAY: 11,
  BORDER: 12,
  MINOR_LINE: 13,
  CASING: 20, // casings of all roads
  RAILWAY: 21,
  ROAD: 22,
  STREET: 23,
  PATH: 24,
  STEPS: 25,
  POI: 100,
};

// Zoom level of the 100 m scale, the 500 m scale is below it
export const ZOOM_100M = 15;

// Number of label importance levels of the place names
export const LABEL_RANKS = 4;

// kind: 'line', 'area' (filled when closed) or 'poi'. width is the line width in pixels or the radius of a symbol,
// outline the ink of the 1 px line around areas and the ring around symbols, casing the white pixels on each side
// of a line, minZoom hides it on lower zoom levels, shrink makes it one pixel thinner below zoom 15, label is the
// importance of a place name (1 = city, 0 = no name). icon is the name of a picture (poi_<icon> in modules/icons.js,
// ICON_NAMES) that is drawn instead of the symbol of a POI.
// The icons of POIs, same names as the icons of the firmware (lib/icons_16, MFR_ICON_* in mapsforge.h)
export const ICON_NAMES = [
  'drinking_water', 'spring', 'food', 'supermarket', 'pharmacy', 'hospital', 'train', 'bus', 'tram', 'parking', 'castle',
  'tower', 'other',
];

export const BASE = {
  kind: 'line',
  color: 0,
  width: 1,
  order: 0,
  outline: null,
  casing: 0,
  symbol: 'disc',
  icon: null,
  minZoom: 0,
  shrink: false,
  label: 0,
};

export const style = (fields) => ({ ...BASE, ...fields });

export const area = (color, ord) => style({ kind: 'area', color, order: ord });
export const outlined = (color, outline, ord) => style({ kind: 'area', color, order: ord, outline });
export const line = (color, width, ord) => style({ color, width, order: ord });
// Railway: 3 px black and white checkerboard, with a white casing so it stays visible on forest
export const rail = () => style({ color: mix(BLACK, WHITE, P50), width: 3, order: order.RAILWAY, casing: 1 });
// Road: white casing, thinner below zoom 15
export const road = (color, width, ord) => style({ color, width, order: ord, casing: 1, shrink: true });
// Road that is only drawn from zoom 15 on
export const minorRoad = (color, width, ord) =>
  style({ color, width, order: ord, casing: 1, shrink: true, minZoom: ZOOM_100M });
export const poi = (symbol, color, radius, minZoom) =>
  style({ kind: 'poi', color, width: radius, order: order.POI, outline: BLACK, symbol, minZoom });
// A POI that is drawn as an icon
export const marked = (icon, fields) => ({ ...fields, icon });
// Place name: no symbol, the name is drawn
export const place = (rank, minZoom) => style({ kind: 'poi', order: order.POI, minZoom, label: rank });
// Black symbol with a white ring, so it stays apart from the black paths
export const poiPlain = (symbol, color, radius, minZoom) =>
  style({ kind: 'poi', color, width: radius, order: order.POI, outline: WHITE, symbol, minZoom });

// The area looks of the schema
export const WATER = solid(BLUE);
export const WETLAND = overlay(BLUE, HLINES);
export const FOREST = tint(GREEN, P75);
export const SCRUB = mix(GREEN, YELLOW, P50);
export const MEADOW = tint(GREEN, P25);
export const FARMLAND = tint(YELLOW, P50);
export const ORCHARD = tint(GREEN, HLINES);
export const RESIDENTIAL = tint(ORANGE, P12);
export const INDUSTRIAL = tint(ORANGE, P25);
export const SCREE = tint(BLACK, P12);
export const SAND = tint(YELLOW, P25);
export const QUARRY = tint(BLACK, DIAG);
export const RESTRICTED = overlay(RED, DIAG);
export const BUILDING = tint(BLACK, P50);

// Line widths: everything walkable is thicker than the roads for cars only
export const PATH_W = 4;
export const STREET_W = 3;
export const ROAD_W = 2;

// [key, value pattern, style]. A pattern ending in * matches by prefix, null hides the feature. Earlier rules win
// when a feature has several matching tags.
export const WAY_RULES = [
  ['tunnel', 'yes', null],
  ['highway', 'route*', null],
  ['highway', 'construction*', null],
  ['highway', 'raceway', null],
  ['highway', 'bus_guideway', null],
  ['highway', 'services', null],
  ['piste:type', '*', null],
  ['piste:difficulty', '*', null],
  ['admin_level', '2', line(tint(RED, P50), 4, order.BORDER)],
  ['boundary', '*', null],
  ['admin_level', '*', null],
  ['leisure', 'nature_reserve', null],
  ['natural', 'sea', area(WATER, order.SEA)],
  ['natural', 'nosea', area(solid(WHITE), order.LAND)],
  ['freizeitkarte', 'meer', area(WATER, order.SEA)],
  ['freizeitkarte', 'land', area(solid(WHITE), order.LAND)],
  ['natural', 'coastline', null],
  ['natural', 'water*', area(WATER, order.WATER)],
  ['landuse', 'reservoir*', area(WATER, order.WATER)],
  ['landuse', 'basin*', area(WATER, order.WATER)],
  ['leisure', 'swimming_pool', area(WATER, order.WATER)],
  ['natural', 'wetland*', area(WETLAND, order.OVERLAY)],
  ['waterway', 'dam', line(solid(BLACK), 3, order.WATERWAY)],
  ['waterway', 'river*', line(solid(BLUE), 3, order.WATERWAY)],
  ['waterway', 'canal*', line(solid(BLUE), 3, order.WATERWAY)],
  ['waterway', 'stream*', style({ color: solid(BLUE), width: 2, order: order.WATERWAY, casing: 1 })],
  ['waterway', '*', style({ color: solid(BLUE), width: 1, order: order.WATERWAY, casing: 1 })],
  ['building', '*', outlined(BUILDING, BLACK, order.BUILDING)],
  ['building:part', '*', null],
  ['railway', 'rail*', rail()],
  ['railway', 'narrow_gauge*', rail()],
  ['railway', 'light_rail*', rail()],
  ['railway', 'preserved*', rail()],
  ['railway', 'funicular*', rail()],
  ['railway', 'monorail*', rail()],
  ['railway', 'miniature*', line(solid(BLACK), 1, order.RAILWAY)],
  ['railway', 'tram*', line(solid(BLACK), 1, order.RAILWAY)],
  ['railway', '*', null],
  ['aerialway', 'cable_car', line(solid(RED), 1, order.MINOR_LINE)],
  ['aerialway', 'gondola', line(solid(RED), 1, order.MINOR_LINE)],
  ['aerialway', 'chair_lift', line(solid(RED), 1, order.MINOR_LINE)],
  ['aerialway', 'mixed_lift', line(solid(RED), 1, order.MINOR_LINE)],
  ['aerialway', '*', null],
  ['route', 'ferry', line(solid(BLACK), 1, order.MINOR_LINE)],
  ['power', 'line', line(solid(BLACK), 1, order.MINOR_LINE)],
  ['power', '*', null],
  ['barrier', 'city_wall', line(solid(BLACK), 2, order.MINOR_LINE)],
  ['barrier', '*', null],
  ['man_made', 'pier', line(solid(BLACK), 3, order.STREET)],
  ['aeroway', 'runway', line(mix(BLACK, WHITE, P50), 6, order.ROAD)],
  ['aeroway', 'taxiway', line(mix(BLACK, WHITE, P50), 2, order.ROAD)],
  ['aeroway', 'apron', area(INDUSTRIAL, order.LANDUSE)],
  ['aeroway', '*', null],
  ['highway', 'steps*', road(solid(RED), PATH_W, order.STEPS)],
  ['highway', 'path*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'footway*', minorRoad(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'fussweg*', minorRoad(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'bergweg*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'track*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'feldweg*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'bridleway*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'reitweg*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'cycleway*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'radfussweg*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'radweg*', road(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'pedestrian*', minorRoad(solid(BLACK), PATH_W, order.PATH)],
  ['highway', 'living_street*', road(solid(BLACK), STREET_W, order.STREET)],
  ['highway', 'residential*', road(solid(BLACK), STREET_W, order.STREET)],
  ['highway', 'unclassified*', road(solid(BLACK), STREET_W, order.STREET)],
  ['highway', 'service*', minorRoad(solid(BLACK), STREET_W, order.STREET)],
  ['highway', 'motorway*', road(solid(RED), ROAD_W, order.ROAD)],
  ['highway', 'trunk*', road(solid(RED), ROAD_W, order.ROAD)],
  ['highway', 'primary*', road(solid(RED), ROAD_W, order.ROAD)],
  ['highway', 'secondary*', road(solid(BLACK), ROAD_W, order.ROAD)],
  ['highway', 'tertiary*', road(solid(BLACK), ROAD_W, order.ROAD)],
  ['highway', '*', road(solid(BLACK), 1, order.ROAD)],
  ['landuse', 'military*', area(RESTRICTED, order.OVERLAY)],
  ['natural', 'wood*', area(FOREST, order.FOREST)],
  ['landuse', 'forest*', area(FOREST, order.FOREST)],
  ['natural', 'scrub*', area(SCRUB, order.SCRUB)],
  ['natural', 'heath*', area(SCRUB, order.SCRUB)],
  ['natural', 'grassland*', area(MEADOW, order.GREEN)],
  ['natural', 'fell*', area(MEADOW, order.GREEN)],
  ['landuse', 'grass*', area(MEADOW, order.GREEN)],
  ['landuse', 'greenfield*', area(MEADOW, order.GREEN)],
  ['landuse', 'meadow*', area(MEADOW, order.GREEN)],
  ['landuse', 'village_green', area(MEADOW, order.GREEN)],
  ['landuse', 'recreation_ground', area(MEADOW, order.GREEN)],
  ['landuse', 'cemetery*', area(MEADOW, order.GREEN)],
  ['leisure', 'park', area(MEADOW, order.GREEN)],
  ['leisure', 'garden', area(MEADOW, order.GREEN)],
  ['leisure', 'golf_course', area(MEADOW, order.GREEN)],
  ['leisure', 'common', area(MEADOW, order.GREEN)],
  ['leisure', 'dog_park', area(MEADOW, order.GREEN)],
  ['leisure', 'pitch', area(MEADOW, order.GREEN)],
  ['landuse', 'farmland*', area(FARMLAND, order.LANDUSE)],
  ['landuse', 'farm', area(FARMLAND, order.LANDUSE)],
  ['landuse', 'orchard*', area(ORCHARD, order.GREEN)],
  ['landuse', 'vineyard*', area(ORCHARD, order.GREEN)],
  ['landuse', 'allotments*', area(ORCHARD, order.GREEN)],
  ['natural', 'scree*', area(SCREE, order.BARE)],
  ['natural', 'shingle*', area(SCREE, order.BARE)],
  ['natural', 'bare_rock*', area(SCREE, order.BARE)],
  ['natural', 'beach*', area(SAND, order.BARE)],
  ['natural', 'sand*', area(SAND, order.BARE)],
  ['landuse', 'quarry*', area(QUARRY, order.BARE)],
  ['landuse', 'residential*', area(RESIDENTIAL, order.LANDUSE)],
  ['landuse', 'farmyard*', area(RESIDENTIAL, order.LANDUSE)],
  ['landuse', 'commercial*', area(INDUSTRIAL, order.LANDUSE)],
  ['landuse', 'retail*', area(INDUSTRIAL, order.LANDUSE)],
  ['landuse', 'industrial*', area(INDUSTRIAL, order.LANDUSE)],
  ['landuse', 'railway*', area(INDUSTRIAL, order.LANDUSE)],
  ['landuse', 'construction*', area(INDUSTRIAL, order.LANDUSE)],
  ['landuse', 'brownfield*', area(INDUSTRIAL, order.LANDUSE)],
  ['landuse', 'landfill*', area(INDUSTRIAL, order.LANDUSE)],
];

export const POI_RULES = [
  ['place', 'city', place(1, 0)],
  ['place', 'town', place(2, 0)],
  ['place', 'village', place(3, 0)],
  ['place', 'suburb', place(4, 15)],
  ['place', 'hamlet', place(4, 15)],
  ['natural', 'peak', poiPlain('triangle', solid(BLACK), 4, 0)],
  ['natural', 'volcano', poiPlain('triangle', solid(BLACK), 4, 0)],
  ['mountain_pass', 'yes', poiPlain('diamond', solid(BLACK), 3, 0)],
  ['natural', 'cave_entrance', poiPlain('disc', solid(BLACK), 2, 0)],
  ['tourism', 'viewpoint', poi('diamond', solid(YELLOW), 4, 0)],
  ['tourism', 'alpine_hut', poi('square', solid(RED), 4, 0)],
  ['amenity', 'shelter', poi('square', solid(ORANGE), 3, 0)],
  ['tourism', 'camp_site', poi('square', solid(RED), 3, 15)],
  ['tourism', 'hostel', poi('square', solid(RED), 3, 15)],
  ['tourism', 'hotel*', poi('square', solid(RED), 3, 15)],
  ['amenity', 'drinking_water', marked('drinking_water', poi('disc', solid(BLUE), 3, 0))],
  ['natural', 'spring', marked('spring', poi('disc', solid(BLUE), 3, 0))],
  ['amenity', 'restaurant*', marked('food', poi('disc', solid(ORANGE), 3, 15))],
  ['amenity', 'cafe', marked('food', poi('disc', solid(ORANGE), 3, 15))],
  ['amenity', 'pub', marked('food', poi('disc', solid(ORANGE), 3, 15))],
  ['amenity', 'bar', marked('food', poi('disc', solid(ORANGE), 3, 15))],
  ['amenity', 'fast_food*', marked('food', poi('disc', solid(ORANGE), 3, 15))],
  ['shop', 'supermarket', marked('supermarket', poi('square', solid(ORANGE), 3, 15))],
  ['amenity', 'pharmacy', marked('pharmacy', poi('disc', solid(RED), 3, 15))],
  ['amenity', 'hospital', marked('hospital', poi('disc', solid(RED), 4, 0))],
  ['railway', 'station', marked('train', poi('square', solid(BLACK), 3, 0))],
  ['railway', 'halt', marked('train', poi('square', solid(BLACK), 3, 0))],
  ['highway', 'bus_stop', marked('bus', poi('square', solid(WHITE), 2, 15))],
  ['railway', 'tram_stop', marked('tram', poi('square', solid(WHITE), 2, 15))],
  ['amenity', 'parking', marked('parking', poi('square', solid(BLUE), 3, 15))],
  ['tourism', 'information', poi('square', solid(YELLOW), 2, 15)],
  ['tourism', 'picnic_site', poi('disc', solid(GREEN), 2, 15)],
  ['historic', 'castle', marked('castle', poiPlain('disc', solid(BLACK), 3, 0))],
  ['man_made', 'tower', marked('tower', poiPlain('disc', solid(BLACK), 2, 0))],
  ['man_made', 'windmill', marked('tower', poiPlain('disc', solid(BLACK), 2, 0))],
  ['man_made', 'lighthouse', marked('tower', poiPlain('disc', solid(BLACK), 2, 0))],
  ['amenity', 'place_of_worship', marked('other', poiPlain('disc', solid(BLACK), 2, 15))],
  ['historic', 'monument', marked('other', poiPlain('disc', solid(BLACK), 2, 15))],
  ['tourism', 'attraction', marked('other', poiPlain('disc', solid(BLACK), 2, 15))],
];

const matches = (pattern, value) =>
  pattern.endsWith('*') ? value.startsWith(pattern.slice(0, -1)) : pattern === value;

// Index of the first rule matching the tag 'key=value', -1 if none
export const ruleIndex = (rules, tag) => {
  const [key, value] = tag.split('=');
  return rules.findIndex(([k, v]) => k === key && matches(v, value));
};

// Style of a tag, null if it is hidden or not styled
export const styleOf = (rules, tag) => rules[ruleIndex(rules, tag)]?.[2] ?? null;

// Line width at a zoom level
export const widthAt = (s, zoom) => (s.shrink && zoom < ZOOM_100M && s.width > 1 ? s.width - 1 : s.width);

// Draw order of the casing: below all roads of the layer, lines below the roads get theirs just below themselves
export const casingOrder = (s) => (s.order > order.CASING ? order.CASING : Math.max(s.order - 1, 0));

// The rows of the info pages: things that look the same in one row, tags as they are in the map (a rule
// 'natural', 'water*' is 'natural=water' here), the style comes from the rules.
const rows = (rules, groups) =>
  groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => ({ ...row, style: styleOf(rules, row.tags[0]) })),
  }));

export const AREA_GROUPS = rows(WAY_RULES, [
  {
    title: 'Water',
    rows: [
      {
        name: 'Lake, river, pool',
        tags: ['natural=water', 'landuse=reservoir', 'landuse=basin', 'leisure=swimming_pool'],
      },
      { name: 'Sea', tags: ['natural=sea', 'freizeitkarte=meer'] },
      { name: 'Land in sea tiles', tags: ['natural=nosea', 'freizeitkarte=land'] },
      { name: 'Wetland, marsh', tags: ['natural=wetland'] },
    ],
  },
  {
    title: 'Vegetation',
    rows: [
      { name: 'Forest', tags: ['landuse=forest', 'natural=wood'] },
      { name: 'Scrub, heath, mountain pine', tags: ['natural=scrub', 'natural=heath'] },
      {
        name: 'Meadow, grass, park',
        tags: [
          'landuse=meadow', 'landuse=grass', 'landuse=greenfield', 'landuse=village_green', 'landuse=recreation_ground',
          'landuse=cemetery', 'natural=grassland', 'natural=fell', 'leisure=park', 'leisure=garden',
          'leisure=golf_course', 'leisure=common', 'leisure=dog_park', 'leisure=pitch',
        ],
      },
      { name: 'Orchard, vineyard, allotments', tags: ['landuse=orchard', 'landuse=vineyard', 'landuse=allotments'] },
      { name: 'Farmland', tags: ['landuse=farmland', 'landuse=farm'] },
    ],
  },
  {
    title: 'Rock and sand',
    rows: [
      { name: 'Scree, shingle, rock', tags: ['natural=scree', 'natural=shingle', 'natural=bare_rock'] },
      { name: 'Beach, sand', tags: ['natural=beach', 'natural=sand'] },
      { name: 'Quarry', tags: ['landuse=quarry'] },
    ],
  },
  {
    title: 'Towns',
    rows: [
      { name: 'Houses, farmyards', tags: ['landuse=residential', 'landuse=farmyard'] },
      {
        name: 'Industry, shops, railway land',
        tags: [
          'landuse=commercial', 'landuse=retail', 'landuse=industrial', 'landuse=railway', 'landuse=construction',
          'landuse=brownfield', 'landuse=landfill', 'aeroway=apron',
        ],
      },
      { name: 'Building', tags: ['building=*'] },
    ],
  },
  {
    title: 'No entry',
    rows: [
      { name: 'Military area', tags: ['landuse=military'] },
    ],
  },
]);

export const WAY_GROUPS = rows(WAY_RULES, [
  {
    title: 'Ways to walk',
    rows: [
      { name: 'Steps', tags: ['highway=steps'] },
      {
        name: 'Path, track, bridleway, cycleway',
        tags: [
          'highway=path', 'highway=track', 'highway=bridleway', 'highway=cycleway', 'highway=bergweg',
          'highway=feldweg', 'highway=reitweg', 'highway=radweg', 'highway=radfussweg',
        ],
      },
      { name: 'Footway, pedestrian street', tags: ['highway=footway', 'highway=pedestrian', 'highway=fussweg'] },
      { name: 'Street in town', tags: ['highway=residential', 'highway=living_street', 'highway=unclassified'] },
      { name: 'Service road, driveway', tags: ['highway=service'] },
    ],
  },
  {
    title: 'Roads for cars',
    rows: [
      { name: 'Motorway, trunk, primary', tags: ['highway=motorway', 'highway=trunk', 'highway=primary'] },
      { name: 'Secondary, tertiary', tags: ['highway=secondary', 'highway=tertiary'] },
      { name: 'Other road', tags: ['highway=road'] },
    ],
  },
  {
    title: 'Railways and lifts',
    rows: [
      {
        name: 'Railway',
        tags: [
          'railway=rail', 'railway=narrow_gauge', 'railway=light_rail', 'railway=preserved', 'railway=funicular',
          'railway=monorail',
        ],
      },
      { name: 'Tram, miniature railway', tags: ['railway=tram', 'railway=miniature'] },
      {
        name: 'Cable car, gondola, chair lift',
        tags: ['aerialway=cable_car', 'aerialway=gondola', 'aerialway=chair_lift', 'aerialway=mixed_lift'],
      },
      { name: 'Ferry', tags: ['route=ferry'] },
    ],
  },
  {
    title: 'Water',
    rows: [
      { name: 'River, canal', tags: ['waterway=river', 'waterway=canal'] },
      { name: 'Dam', tags: ['waterway=dam'] },
      { name: 'Stream', tags: ['waterway=stream'] },
      { name: 'Ditch, drain', tags: ['waterway=ditch', 'waterway=drain'] },
    ],
  },
  {
    title: 'Other lines',
    rows: [
      { name: 'Runway', tags: ['aeroway=runway'] },
      { name: 'National border', tags: ['admin_level=2'] },
      { name: 'Pier', tags: ['man_made=pier'] },
      { name: 'City wall', tags: ['barrier=city_wall'] },
      { name: 'Taxiway', tags: ['aeroway=taxiway'] },
      { name: 'Power line', tags: ['power=line'] },
    ],
  },
]);

// Not drawn, though they are in the map
export const HIDDEN_WAYS = [
  'tunnels', 'construction sites', 'raceways', 'ski runs', 'other boundaries', 'nature reserves', 'fences',
  'minor power lines', 'drag lifts', 'abandoned railways', 'coastline',
];

export const POI_GROUPS = rows(POI_RULES, [
  {
    title: 'Mountains',
    rows: [
      { name: 'Peak, volcano', tags: ['natural=peak', 'natural=volcano'] },
      { name: 'Mountain pass', tags: ['mountain_pass=yes'] },
      { name: 'Cave entrance', tags: ['natural=cave_entrance'] },
      { name: 'Viewpoint', tags: ['tourism=viewpoint'] },
    ],
  },
  {
    title: 'Shelter and sleeping',
    rows: [
      { name: 'Alpine hut', tags: ['tourism=alpine_hut'] },
      { name: 'Shelter', tags: ['amenity=shelter'] },
      { name: 'Camp site, hostel, hotel', tags: ['tourism=camp_site', 'tourism=hostel', 'tourism=hotel'] },
    ],
  },
  {
    title: 'Water',
    rows: [
      { name: 'Drinking water', tags: ['amenity=drinking_water'] },
      { name: 'Spring', tags: ['natural=spring'] },
    ],
  },
  {
    title: 'Food and supplies',
    rows: [
      {
        name: 'Restaurant, cafe, pub, bar, fast food',
        tags: ['amenity=restaurant', 'amenity=cafe', 'amenity=pub', 'amenity=bar', 'amenity=fast_food'],
      },
      { name: 'Supermarket', tags: ['shop=supermarket'] },
      { name: 'Pharmacy', tags: ['amenity=pharmacy'] },
      { name: 'Hospital', tags: ['amenity=hospital'] },
    ],
  },
  {
    title: 'Transport',
    rows: [
      { name: 'Train station, halt', tags: ['railway=station', 'railway=halt'] },
      { name: 'Bus stop', tags: ['highway=bus_stop'] },
      { name: 'Tram stop', tags: ['railway=tram_stop'] },
      { name: 'Parking', tags: ['amenity=parking'] },
    ],
  },
  {
    title: 'Orientation and landmarks',
    rows: [
      { name: 'Tourist information, guidepost board', tags: ['tourism=information'] },
      { name: 'Picnic site', tags: ['tourism=picnic_site'] },
      { name: 'Castle', tags: ['historic=castle'] },
      { name: 'Tower, windmill, lighthouse', tags: ['man_made=tower', 'man_made=windmill', 'man_made=lighthouse'] },
      {
        name: 'Church, monument, attraction',
        tags: ['amenity=place_of_worship', 'historic=monument', 'tourism=attraction'],
      },
    ],
  },
]);

export const PLACE_ROWS = rows(POI_RULES, [
  {
    title: 'Place names',
    rows: [
      { name: 'City', tags: ['place=city'] },
      { name: 'Town', tags: ['place=town'] },
      { name: 'Village', tags: ['place=village'] },
      { name: 'Suburb, hamlet', tags: ['place=suburb', 'place=hamlet'] },
    ],
  },
])[0].rows;

// Tags in short: 'highway=path, track · natural=wood'
export const formatTags = (tags) => {
  const byKey = new Map();
  tags.forEach((tag) => {
    const [key, value] = tag.split('=');
    byKey.set(key, [...(byKey.get(key) ?? []), value]);
  });
  return [...byKey].map(([key, values]) => `${key}=${values.join(', ')}`).join(' · ');
};
