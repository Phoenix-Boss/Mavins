/**
 * PodcastCard Component
 *
 * Displays a podcast episode with title, creator name, and duration/episode info.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface PodcastCardProps {
  item: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    episodeCount: number; // episode number if available, else duration in minutes
    type: string;
  };
  onPress?: () => void;
}

const COLORS = {
  surface:       "#121212",
  surfaceLight:  "#1F1F1F",
  goldPrimary:   "#D4AF37",
  text:          "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary:  "#808080",
};

export const PodcastCard: React.FC<PodcastCardProps> = ({ item, onPress }) => {
  const { title, artist, thumbnail, episodeCount } = item;

  // If episodeCount looks like a duration (>100 min likely), label it as "X min"
  // Episode numbers are typically < 500; durations in minutes can be much higher
  const episodeLabel = episodeCount > 0
    ? episodeCount > 500
      ? `${episodeCount} min`
      : `Ep. ${episodeCount}`
    : null;

  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      <View style={styles.imageContainer}>
        {thumbnail ? (
          <Image
            source={{ uri: thumbnail }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnail, styles.placeholderContainer]}>
            <Ionicons name="headset" size={40} color={COLORS.textTertiary} />
          </View>
        )}
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.title} numberOfLines={2}>
          {title || 'Unknown Episode'}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {artist || 'Unknown Podcast'}
        </Text>
        {episodeLabel && (
          <Text style={styles.episodeCount}>{episodeLabel}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceLight,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
  },
  infoContainer: {
    marginTop: 5,
  },
  title: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 1,
    lineHeight: 14,
  },
  artist: {
    color: COLORS.goldPrimary,
    fontSize: 10,
    marginBottom: 1,
  },
  episodeCount: {
    color: COLORS.textTertiary,
    fontSize: 9,
  },
});