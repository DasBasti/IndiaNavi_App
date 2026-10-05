import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { Hint, Input, Message } from './ui';
import { colors, font } from '../theme';
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
        <Text style={styles.server} numberOfLines={1}>
          <Text style={styles.label}>TILES </Text>
          {tileServerName(url)}
        </Text>
        <Button title="Edit" onPress={() => edit(url)} disabled={disabled} variant="plain" compact />
      </View>
    );
  }

  return (
    <View style={styles.editor}>
      <Input
        value={draft}
        onChangeText={edit}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        multiline
      />
      <Hint>
        {'{z}'}, {'{x}'} and {'{y}'} are replaced by the zoom level and the tile numbers.
        Tiles already loaded from the old URL are deleted.
      </Hint>
      {error && <Message tone="red">{error}</Message>}
      <View style={styles.row}>
        <Button title="Save" onPress={save} compact />
        <Button title="Default" onPress={() => edit(DEFAULT_TILE_URL)} variant="secondary" compact />
        <Button title="Cancel" onPress={() => setDraft(null)} variant="plain" compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  server: {
    flexShrink: 1,
    color: colors.ink,
  },
  label: {
    fontFamily: font.mono,
    fontWeight: 'bold',
  },
  editor: {
    alignSelf: 'stretch',
    gap: 8,
  },
});
