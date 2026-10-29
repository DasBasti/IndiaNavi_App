import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { Badge, Card, Hint, Message, ProgressWindow, ScreenHeader, SectionTitle } from './ui';
import { BORDER, colors, font } from '../theme';
import { MAP_SERVER, breadcrumbs, displayName, localName, parseListing } from '../modules/map_listing';
import { deleteMap, downloadMap, freeSpace, listMaps } from '../modules/vector_maps';

const megabytes = (bytes) => (bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
  : `${Math.max(bytes / 1024 ** 2, 0.1).toFixed(1)} MB`);

// some space stays free on the phone
const SPACE_RESERVE = 200 * 1024 * 1024;

// The vector maps on the phone and the Mapsforge maps to download. The checked maps are the maps for the IndiaNavi:
// the simulated IndiaNavi draws them and they are sent to its SD card. onCheckedChange gets the new list of names.
export default function MapsScreen({ checked, onCheckedChange, onBack }) {
  const [maps, setMaps] = useState(listMaps);
  // name of the map that waits for the confirmation to be deleted
  const [deleting, setDeleting] = useState(null);
  // folder of the server that is shown, its entries and the state of loading it
  const [folder, setFolder] = useState(MAP_SERVER);
  const [entries, setEntries] = useState(null);
  const [listError, setListError] = useState(null);
  // counts the tries to load the folder again after an error
  const [reload, setReload] = useState(0);
  // { name, done, total } while a map is downloaded
  const [download, setDownload] = useState(null);
  const [message, setMessage] = useState(null);
  const abort = useRef(null);

  const loadFolder = useCallback(async (url, signal) => {
    setEntries(null);
    setListError(null);
    try {
      const response = await fetch(url, { signal, headers: { 'User-Agent': 'IndiaNaviApp/1.0' } });
      if (!response.ok) {
        throw new Error(`the server answered ${response.status}`);
      }
      const list = parseListing(await response.text(), url);
      if (!signal.aborted) {
        setEntries(list);
      }
    } catch (e) {
      if (!signal.aborted) {
        setListError(`Could not load the list of maps: ${e.message}`);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadFolder(folder, controller.signal);
    return () => controller.abort();
  }, [folder, reload, loadFolder]);

  // a running download is cancelled when the screen is left
  useEffect(() => () => abort.current?.abort(), []);

  const remove = (name) => {
    try {
      deleteMap(name);
      setMessage(null);
    } catch (e) {
      setMessage({ tone: 'red', text: `Could not delete ${name}: ${e.message}` });
    }
    setMaps(listMaps());
    setDeleting(null);
    if (checked.includes(name)) {
      onCheckedChange(checked.filter((other) => other !== name));
    }
  };

  const start = async (entry) => {
    const name = localName(entry.url);
    if (entry.size !== null && entry.size + SPACE_RESERVE > freeSpace()) {
      setMessage({ tone: 'red', text: `${displayName(entry.name)} needs ${megabytes(entry.size)}, the phone has ${megabytes(freeSpace())} free.` });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setMessage(null);
    setDownload({ name: displayName(entry.name), done: 0, total: entry.size ?? 0 });
    try {
      await downloadMap(entry.url, name, {
        signal: controller.signal,
        onProgress: ({ bytesWritten, totalBytes }) =>
          setDownload((current) => current && { ...current, done: bytesWritten, total: totalBytes > 0 ? totalBytes : current.total }),
      });
      setMaps(listMaps());
      setMessage({ tone: 'green', text: `${displayName(entry.name)} is on the phone.` });
      // the first map is used right away
      if (checked.length === 0) {
        onCheckedChange([name]);
      }
    } catch (e) {
      setMessage(controller.signal.aborted
        ? { tone: 'yellow', text: 'The download was cancelled.' }
        : { tone: 'red', text: `Could not download ${displayName(entry.name)}: ${e.message}` });
    } finally {
      if (abort.current === controller) {
        abort.current = null;
      }
      setDownload(null);
    }
  };

  const onPhone = new Set(maps.map((map) => map.name));

  return (
    <View style={styles.screen}>
      <ProgressWindow
        visible={download !== null}
        text={`Downloading ${download?.name ?? ''}`}
        done={download?.done ?? 0}
        total={download?.total ?? 0}
        detail={download && (download.total > 0
          ? `${megabytes(download.done)} of ${megabytes(download.total)}`
          : megabytes(download.done))}
        onCancel={() => abort.current?.abort()}
      />
      <ScreenHeader title="Vector maps" icon="SD" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {message && <Message tone={message.tone} icon={message.tone === 'red' ? 'noSD' : 'SD'}>{message.text}</Message>}

        <SectionTitle>On the phone</SectionTitle>
        {maps.length > 0 && (
          <Hint>
            Tap the maps for the IndiaNavi. The simulated IndiaNavi draws them, and Connection, WiFi transfer sends them
            to its SD card. Like the device it draws the maps that cover the screen, at most 4, and a newer map of a
            region replaces an older one.
          </Hint>
        )}
        {maps.length === 0 ? (
          <Hint>
            There is no vector map on the phone yet. Download the map of the region you want to walk in below, the
            simulated IndiaNavi draws it like the device does.
          </Hint>
        ) : maps.map((map) => (
          <Card
            key={map.name}
            onPress={() => onCheckedChange(checked.includes(map.name)
              ? checked.filter((other) => other !== map.name)
              : [...checked, map.name])}
            color={checked.includes(map.name) ? colors.green : colors.paper}
            selected={checked.includes(map.name)}
            style={styles.item}>
            <View style={[styles.check, checked.includes(map.name) && styles.checked]}>
              {checked.includes(map.name) && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <View style={styles.details}>
              <Text style={styles.name} numberOfLines={2}>{displayName(map.name)}</Text>
              <Text style={styles.meta}>{map.name} · {megabytes(map.size)}</Text>
              {checked.includes(map.name) && <View style={styles.row}><Badge color={colors.ink}>for the IndiaNavi</Badge></View>}
            </View>
            {deleting === map.name ? (
              <View style={styles.row}>
                <Button title="Delete" onPress={() => remove(map.name)} variant="danger" compact />
                <Button title="Keep" onPress={() => setDeleting(null)} variant="plain" compact />
              </View>
            ) : (
              <Pressable onPress={() => setDeleting(map.name)} hitSlop={12} style={styles.delete} accessibilityLabel={`Delete ${map.name}`}>
                <Text style={styles.deleteText}>✕</Text>
              </Pressable>
            )}
          </Card>
        ))}

        <SectionTitle>Download</SectionTitle>
        <Hint>
          Maps of download.mapsforge.org (© OpenStreetMap contributors). Pick a region as small as possible, a map of a
          country can have several GB.
        </Hint>
        <View style={styles.row}>
          {breadcrumbs(folder).map((crumb, index, all) => (
            <Button
              key={crumb.url}
              title={crumb.name}
              onPress={() => setFolder(crumb.url)}
              variant={index === all.length - 1 ? 'primary' : 'plain'}
              compact
            />
          ))}
        </View>
        {listError && (
          <>
            <Message tone="red" icon="noSD">{listError}</Message>
            <Button title="Try again" variant="plain" onPress={() => setReload((count) => count + 1)} />
          </>
        )}
        {entries === null && !listError && <ActivityIndicator color={colors.ink} />}
        {entries?.length === 0 && <Hint>This folder has no maps.</Hint>}
        {entries?.map((entry) => {
          const name = localName(entry.url);
          return entry.folder ? (
            <Card key={entry.url} onPress={() => setFolder(entry.url)} style={styles.item}>
              <Text style={styles.name}>{displayName(entry.name)}</Text>
              <View style={styles.spacer} />
              <Text style={styles.arrow}>›</Text>
            </Card>
          ) : (
            <Card key={entry.url} style={styles.item}>
              <View style={styles.details}>
                <Text style={styles.name} numberOfLines={2}>{displayName(entry.name)}</Text>
                <Text style={styles.meta}>{entry.size !== null ? megabytes(entry.size) : 'size unknown'}</Text>
              </View>
              {onPhone.has(name) ? (
                <Badge color={colors.blue}>on the phone</Badge>
              ) : (
                <Button title="Download" onPress={() => start(entry)} disabled={download !== null} variant="secondary" compact />
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignSelf: 'stretch',
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  list: {
    gap: 12,
    paddingBottom: 24,
    paddingRight: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  details: {
    flex: 1,
    gap: 4,
  },
  spacer: {
    flex: 1,
  },
  name: {
    fontFamily: font.mono,
    fontWeight: 'bold',
    color: colors.ink,
  },
  meta: {
    fontSize: 13,
    color: colors.ink,
  },
  arrow: {
    fontFamily: font.mono,
    fontWeight: 'bold',
    fontSize: 24,
    color: colors.ink,
  },
  check: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  checked: {
    backgroundColor: colors.ink,
  },
  checkMark: {
    fontWeight: 'bold',
    fontSize: 16,
    color: colors.paper,
  },
  delete: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER,
    borderColor: colors.ink,
    backgroundColor: colors.red,
  },
  deleteText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.paper,
  },
});
