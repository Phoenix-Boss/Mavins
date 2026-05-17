/**
 * PodcastCard Component - Theme-aware
 */
import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';

interface PodcastCardProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    episodeCount: number;
    type: string;
  };
  onPress?: () => void;
}

export const PodcastCard: React.FC<PodcastCardProps> = ({ item, onPress }) => {
  const { colors } = useTheme();
  const { title, artist, thumbnail, episodeCount } = item;

  const episodeLabel = episodeCount > 0
    ? episodeCount > 500 ? `${episodeCount} min` : `Ep. ${episodeCount}`
    : null;

  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      <View style={[styles.imageContainer, { backgroundColor: colors.surfaceLight }]}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={[styles.thumbnail, styles.placeholderContainer, { backgroundColor: colors.surfaceLight }]}>
            <Ionicons name="headset" size={40} color={colors.textMuted} />
          </View>
        )}
      </View>

      <View style={styles.infoContainer}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {title || 'Unknown Episode'}
        </Text>
        <Text style={[styles.artist, { color: colors.gold }]} numberOfLines={1}>
          {artist || 'Unknown Podcast'}
        </Text>
        {episodeLabel && <Text style={[styles.episodeCount, { color: colors.textSub }]}>{episodeLabel}</Text>}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%' },
  imageContainer: { width: '100%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%' },
  placeholderContainer: { justifyContent: 'center', alignItems: 'center' },
  infoContainer: { marginTop: 5 },
  title: { fontSize: 11, fontWeight: '600', marginBottom: 1, lineHeight: 14 },
  artist: { fontSize: 10, marginBottom: 1 },
  episodeCount: { fontSize: 9 },
});
