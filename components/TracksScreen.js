import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import Icon from './Icon';
import { Badge, Card, Hint, ScreenHeader } from './ui';
import { BORDER, colors, font } from '../theme';
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
      <ScreenHeader title="Tracks" icon="path" onBack={onBack} />

      <Button title="Open GPX file" icon="GPS" onPress={onOpenGpx} />
      <Hint>
        Choose the track for the IndiaNavi. Its map is prepared and it is sent to the device as track.gpx.
      </Hint>

      <ScrollView contentContainerStyle={styles.list}>
        {tracks.length === 0 && <Hint>No tracks yet. Open a GPX file to add one.</Hint>}
        {tracks.map((track) => (
          <Card
            key={track.id}
            onPress={() => onSelect(track)}
            color={track.id === selectedId ? colors.green : colors.paper}
            selected={track.id === selectedId}
            style={styles.track}>
            <Icon name="path" size={32} />
            <View style={styles.details}>
              <Text style={styles.name} numberOfLines={2}>{track.name}</Text>
              <Text style={styles.meta}>
                {kilometers(track.length)} · added {date(track.addedAt)}
              </Text>
              <View style={styles.row}>
                {track.id === selectedId && <Badge color={colors.ink}>selected</Badge>}
                {track.id === deviceTrackId && <Badge color={colors.blue}>on the IndiaNavi</Badge>}
              </View>
            </View>
            {deleting === track.id ? (
              <View style={styles.row}>
                <Button title="Delete" onPress={() => remove(track.id)} variant="danger" compact />
                <Button title="Keep" onPress={() => setDeleting(null)} variant="plain" compact />
              </View>
            ) : (
              <Pressable onPress={() => setDeleting(track.id)} hitSlop={12} style={styles.delete}>
                <Text style={styles.deleteText}>✕</Text>
              </Pressable>
            )}
          </Card>
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
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  details: {
    flex: 1,
    gap: 4,
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
