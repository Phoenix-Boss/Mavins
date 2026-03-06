/**
 * MavinsBestSection
 *
 * Displays curated/editorial music picks.
 *
 * Data flow:
 *   useEditorPicks()
 *     → MavinEngine.search("best music videos 2025", "songs")
 *       → Kotlin: performSearch(query, "songs", null, 0)
 *
 * AlbumCard receives only fields present on EditorPickItem —
 * description and curator do not exist on StreamInfoItem and
 * are not passed.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useEditorPicks, EditorPickItem } from '../../hooks/useEditorPicks';
import { AlbumCard } from '../cards/AlbumCard';
import { SectionHeader } from '../common/SectionHeader';

const COLORS = {
  surface: '#121212',
  goldPrimary: '#D4AF37',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
};

export const MavinsBestSection = () => {
  const { data, loading, error } = useEditorPicks();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Mavins Player Best" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading curated picks…</Text>
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) return null;

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Mavins Player Best" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: EditorPickItem) => (
          <AlbumCard
            key={item.id}
            item={{
              id: item.videoId,       // full stream url for playback
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              duration: item.duration,
              plays: item.views > 0 ? formatViews(item.views) : undefined,
            }}
            showPlayButton
          />
        ))}
      </ScrollView>
    </View>
  );
};

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000)     return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 14,
  },
  centeredBox: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  subtleText: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});