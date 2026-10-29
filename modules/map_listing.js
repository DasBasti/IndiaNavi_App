// The list of the vector maps to download: the folders of the Mapsforge download server (and its mirrors) are plain
// directory listings of the web server, continents and countries are folders, the maps are .map files in them.

export const MAP_SERVER = 'https://download.mapsforge.org/maps/v5/';

const UNITS = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

// '614M' or '2.6G' as bytes, null for '-' or anything else
export const parseSize = (text) => {
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT])?i?B?$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  return Math.round(Number(match[1]) * (match[2] ? UNITS[match[2].toUpperCase()] : 1));
};

const decodeEntities = (text) => text
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, ' ');

// Name of a folder or map as it is shown: 'baden-wuerttemberg.map' => 'Baden-Wuerttemberg'
export const displayName = (name) => decodeURIComponent(name.replace(/\/$/, '').replace(/\.map$/, ''))
  .split(/([-_ ])/)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join('')
  .replace(/_/g, ' ');

// Entries of a directory listing: { name, url, folder, size } sorted folders first, then by name. size is in bytes
// (approximate, the server rounds it), null if unknown. Links to other places, the parent folder and the sort links
// of the server are left out.
export const parseListing = (html, baseUrl) => {
  const entries = new Map();
  // one entry per row of a table or line of a <pre> listing
  for (const row of html.split(/<tr[\s>]|\n/i)) {
    const link = /<a\s[^>]*href="([^"]+)"[^>]*>/i.exec(row);
    if (!link) {
      continue;
    }
    const href = decodeEntities(link[1]);
    if (/^[?#/]|^\.\.?\/?$|:\/\//.test(href) || href.includes('../')) {
      continue;
    }
    const folder = href.endsWith('/');
    if (!folder && !href.toLowerCase().endsWith('.map')) {
      continue;
    }
    // the size is the last word that looks like one after the link
    const after = decodeEntities(row.slice(link.index + link[0].length).replace(/<[^>]*>/g, ' '));
    const sizes = after.split(/\s+/).map(parseSize).filter((size) => size !== null);
    const size = folder ? null : sizes.length > 0 ? sizes[sizes.length - 1] : null;
    const name = href.split('/').filter(Boolean).pop();
    entries.set(href, { name, url: new URL(href, baseUrl).href, folder, size });
  }
  return [...entries.values()].sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1));
};

// The folders from the server root to the url, for the path above the list: [{ name, url }]
export const breadcrumbs = (url, root = MAP_SERVER) => {
  if (!url.startsWith(root)) {
    return [{ name: 'Maps', url: root }];
  }
  const parts = url.slice(root.length).split('/').filter(Boolean);
  return [{ name: 'Maps', url: root }, ...parts.map((part, i) => ({
    name: displayName(part),
    url: root + parts.slice(0, i + 1).map((p) => `${p}/`).join(''),
  }))];
};

// Name of the file on the phone for a map url: 'europe/germany/hessen.map' => 'germany-hessen.map', so maps of
// regions with the same name in different countries do not overwrite each other
export const localName = (url, root = MAP_SERVER) => {
  const path = url.startsWith(root) ? url.slice(root.length) : url.split('/').pop();
  const parts = decodeURIComponent(path).split('/').filter(Boolean);
  return parts.slice(-2).join('-').replace(/[^A-Za-z0-9._-]/g, '_');
};
