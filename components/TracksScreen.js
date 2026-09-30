import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { deleteTrack, listTracks } from '../modules/track_library';

const kilometers = (meters) => `${(meters / 1000).toFixed(1)} km`;

const date = (time) => new Date(time).toLocaleDateString();

// Lists all GPX files opened in the app. The selected track is the one that is prepared and sent to the IndiaNavi.
export default function TracksScreen({ selectedId, deviceTrackId, onSelect, onOpenGpx, onDeleted, onBack }) {
  const [tracks, setTracks] = useState(listTracks);
  // id of the track that waits for the confirmation to be deleted
  const [deleting, setDeleting] = useState(null);

  const remove = (id) => {
    deleteTrack(id);
    setTracks(listTracks());
    setDeleting(null);
    onDeleted(id);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.row}>
        <Button title="‹ Back" onPress={onBack} />
        <Text style={styles.title}>Tracks</Text>
      </View>

      <Button title="Open GPX file" onPress={onOpenGpx} />
      <Text style={styles.hint}>
        Choose the track for the IndiaNavi. Its map is prepared and it is sent to the device as track.gpx.
      </Text>

      <ScrollView contentContainerStyle={styles.list}>
        {tracks.length === 0 && <Text style={styles.hint}>No tracks yet. Open a GPX file to add one.</Text>}
        {tracks.map((track) => (
          <Pressable
            key={track.id}
            onPress={() => onSelect(track)}
            style={[styles.track, track.id === selectedId && styles.selected]}>
            <View style={styles.details}>
              <Text style={styles.name} numberOfLines={2}>{track.name}</Text>
              <Text style={styles.hint}>
                {kilometers(track.length)} · added {date(track.addedAt)}
              </Text>
              <View style={styles.row}>
                {track.id === selectedId && <Text style={[styles.badge, styles.selectedBadge]}>selected</Text>}
                {track.id === deviceTrackId && <Text style={[styles.badge, styles.deviceBadge]}>on the IndiaNavi</Text>}
              </View>
            </View>
            {deleting === track.id ? (
              <View style={styles.row}>
                <Button title="Delete" onPress={() => remove(track.id)} />
                <Button title="Keep" onPress={() => setDeleting(null)} />
              </View>
            ) : (
              <Pressable onPress={() => setDeleting(track.id)} hitSlop={12}>
                <Text style={styles.delete}>✕</Text>
              </Pressable>
            )}
          </Pressable>
        ))}
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
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  list: {
    gap: 8,
    paddingBottom: 24,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
  },
  selected: {
    borderColor: '#2e7d32',
    borderWidth: 2,
  },
  details: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontWeight: 'bold',
  },
  hint: {
    color: '#666',
  },
  badge: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  selectedBadge: {
    backgroundColor: '#2e7d32',
  },
  deviceBadge: {
    backgroundColor: '#1565c0',
  },
  delete: {
    fontSize: 18,
    color: '#c62828',
  },
});
