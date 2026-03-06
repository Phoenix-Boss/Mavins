/**
 * MusicChannelsSection
 *
 * Displays genre-filtered music tracks as channel-style cards.
 *
 * Data flow:
 *   useGenreStations(selectedGenre)
 *     → MavinEngine.search("{genre} music", "songs")
 *       → Kotlin: performSearch(query, "songs", null, 0)
 *
 * MusicChannelCard receives only fields present on GenreItem —
 * no fabricated properties.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useGenreStations, GenreItem } from '../../hooks/useGenreStations';
import { MusicChannelCard } from '../cards/MusicChannelCard';
import { SectionHeader } from '../common/SectionHeader';

const COLORS = {
  surface: '#121212',
  surfaceLight: '#1F1F1F',
  goldPrimary: '#D4AF37',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
  border: '#333333',
  danger: '#EF4444',
};

const CHANNEL_GENRES = [
  { id: 'afrobeats',  name: 'Afrobeats',  icon: '🎵' },
  { id: 'hip-hop',    name: 'Hip-Hop',    icon: '🎤' },
  { id: 'rnb',        name: 'R&B',        icon: '🎹' },
  { id: 'pop',        name: 'Pop',        icon: '🎸' },
  { id: 'electronic', name: 'Electronic', icon: '🎧' },
  { id: 'reggae',     name: 'Reggae',     icon: '🥁' },
] as const;

type GenreId = typeof CHANNEL_GENRES[number]['id'];

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

interface GenreSelectorProps {
  active: GenreId;
  onChange: (id: GenreId) => void;
}

const GenreSelector = ({ active, onChange }: GenreSelectorProps) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={styles.genreScroll}
    contentContainerStyle={styles.genreScrollContent}
  >
    {CHANNEL_GENRES.map(({ id, name, icon }) => {
      const isActive = active === id;
      return (
        <TouchableOpacity
          key={id}
          style={[styles.genreChip, isActive && styles.genreChipActive]}
          onPress={() => onChange(id)}
          activeOpacity={0.75}
        >
          <Text style={styles.genreIcon}>{icon}</Text>
          <Text style={[styles.genreText, isActive && styles.genreTextActive]}>
            {name}
          </Text>
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export const MusicChannelsSection = () => {
  const [selectedGenre, setSelectedGenre] = useState<GenreId>('afrobeats');
  const { data, loading, error, refetch } = useGenreStations(selectedGenre);

  const handleGenreChange = useCallback((id: GenreId) => {
    setSelectedGenre(id);
  }, []);

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  // ── Loading ───────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll />
        <GenreSelector active={selectedGenre} onChange={handleGenreChange} />
        <View style={styles.centeredBox}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading music channels…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll />
        <GenreSelector active={selectedGenre} onChange={handleGenreChange} />
        <View style={styles.centeredBox}>
          <Ionicons name="alert-circle-outline" size={24} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Empty ─────────────────────────────────
  if (!data.length) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Music Channels" showPlayAll />
        <GenreSelector active={selectedGenre} onChange={handleGenreChange} />
        <View style={styles.centeredBox}>
          <Ionicons name="musical-note-outline" size={24} color={COLORS.textTertiary} />
          <Text style={styles.subtleText}>No channels found for {selectedGenre}</Text>
          <Text style={styles.subtleText}>Try another genre</Text>
        </View>
      </View>
    );
  }

  // ── Success ───────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Music Channels" showPlayAll />
      <GenreSelector active={selectedGenre} onChange={handleGenreChange} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {data.map((item: GenreItem) => (
          <MusicChannelCard
            key={item.id}
            item={{
              id: item.videoId,       // full stream url for playback
              title: item.title,
              artist: item.artist,
              thumbnail: item.thumbnail,
              duration: item.duration,
              views: item.views,
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
};

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  genreScroll: {
    marginBottom: 12,
  },
  genreScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  genreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  genreChipActive: {
    backgroundColor: COLORS.goldPrimary,
    borderColor: COLORS.goldPrimary,
  },
  genreIcon: {
    fontSize: 14,
  },
  genreText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  genreTextActive: {
    color: '#000',
    fontWeight: '700',
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
    textAlign: 'center',
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 12,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
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