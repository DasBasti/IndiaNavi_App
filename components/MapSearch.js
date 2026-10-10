import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { Input } from './ui';
import { BORDER, colors } from '../theme';
import { searchPlaces } from '../modules/geocode';

// Search field for places or coordinates, the chosen result is given to onSelect as { name, lon, lat }
export default function MapSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef(null);

  const search = async () => {
    Keyboard.dismiss();
    const text = query.trim();
    if (text === '') {
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const places = await searchPlaces(text, controller.signal);
      if (!controller.signal.aborted) {
        setResults(places);
        if (places.length === 0) {
          setError('Nothing found');
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setResults(null);
        setError(`Search failed: ${e.message}`);
      }
    } finally {
      if (abort.current === controller) {
        setBusy(false);
      }
    }
  };

  const choose = (place) => {
    setResults(null);
    setError(null);
    onSelect(place);
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.input}>
          <Input
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={search}
            placeholder="Search a place or lat, lon"
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
        <Button title={busy ? '…' : 'Go'} onPress={search} disabled={busy} compact />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {results?.map((place, index) => (
        <Pressable key={index} onPress={() => choose(place)} style={styles.result}>
          <Text style={styles.resultText} numberOfLines={2}>{place.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
  },
  error: {
    marginTop: 4,
    padding: 4,
    backgroundColor: colors.red,
    color: colors.paper,
  },
  result: {
    padding: 8,
    backgroundColor: colors.paper,
    borderWidth: BORDER,
    borderTopWidth: 0,
    borderColor: colors.ink,
  },
  resultText: {
    color: colors.ink,
  },
});
