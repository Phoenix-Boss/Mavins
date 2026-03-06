/**
 * CoversSection
 *
 * Displays cover songs and acoustic versions.
 *
 * Data flow:
 *   useCoverSongs()
 *     → MavinEngine.search("cover songs acoustic 2025", "songs")
 *       → Kotlin: performSearch(query, "songs", null, 0)
 *
 * MixCard receives only fields present on CoverItem —
 * no fabricated properties (originalArtist does not exist on StreamInfoItem).
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCoverSongs } from '../../hooks/useCoverSongs';
import { MixCard } from '../cards/MixCard';
import { SectionHeader } from '../common/SectionHeader';

const COLORS = {
  surface: '#121212',
  goldPrimary: '#D4AF37',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
};

export const CoversSection = () => {
  const { data, loading, error, refetch } = useCoverSongs();

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Covers" showPlayAll />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading covers…</Text>
        </View>
      </View>
    );
  }

  // ── Error / Empty — section hides silently ─
  if (error || !data.length) {
    // Non-critical section: don't break the home screen layout.
    // Uncomment the block below to show a retry instead of hiding.
    //
    // return (
    //   <View style={styles.section}>
    //     <SectionHeader title="Covers" showPlayAll />
    //     <View style={styles.centeredBox}>
    //       <Ionicons name="musical-note-outline" size={28} color={COLORS.textTertiary} />
    //       <Text style={styles.subtleText}>Covers unavailable</Text>
    //       <TouchableOpacity style={styles.retryButton} onPress={refetch}>
    //         <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
    //         <Text style={styles.retryText}>Retry</Text>
    //       </TouchableOpacity>
    //     </View>
    //   </View>
    // );
    return null;
  }

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Covers" showPlayAll />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map(item => (
          <MixCard
            key={item.id}
            item={{
              id: item.videoId,     // full stream url for playback
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              duration: item.duration,
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 14,
  },
  centeredBox: {
    padding: 36,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  subtleText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.goldPrimary + '20',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
    gap: 5,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
});