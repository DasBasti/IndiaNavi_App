import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import Button from './Button';
import { DEFAULT_TILE_URL, checkTileUrl, tileServerName } from '../modules/tile_source';

// Shows the tile server and lets the user change its URL
export default function TileServerSetting({ url, onChange, disabled }) {
  // text of the URL while it is edited, null otherwise
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);

  const edit = (text) => {
    setDraft(text);
    setError(null);
  };

  const save = () => {
    const newUrl = draft.trim();
    const problem = checkTileUrl(newUrl);
    if (problem) {
      setError(problem);
      return;
    }
    if (newUrl !== url) {
      onChange(newUrl);
    }
    setDraft(null);
  };

  if (draft === null) {
    return (
      <View style={styles.row}>
        <Text style={styles.server} numberOfLines={1}>Tiles: {tileServerName(url)}</Text>
        <Button title="Edit" onPress={() => edit(url)} disabled={disabled} />
      </View>
    );
  }

  return (
    <View style={styles.editor}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={edit}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        multiline
      />
      <Text style={styles.hint}>
        {'{z}'}, {'{x}'} and {'{y}'} are replaced by the zoom level and the tile numbers.
        Tiles already loaded from the old URL are deleted.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.row}>
        <Button title="Save" onPress={save} />
        <Button title="Default" onPress={() => edit(DEFAULT_TILE_URL)} />
        <Button title="Cancel" onPress={() => setDraft(null)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  server: {
    flexShrink: 1,
  },
  editor: {
    alignSelf: 'stretch',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 6,
    padding: 8,
  },
  hint: {
    color: '#666',
  },
  error: {
    color: '#c62828',
  },
});
