// components/localMusic/LocalDownloadsSection.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { getAllLocalTracks, type LocalTrack } from '@/db/localDatabase';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import { triggerHaptic } from '@/helpers/haptics';

interface LocalDownloadsSectionProps {
  limit?: number;
}

export function LocalDownloadsSection({ limit = 10 }: LocalDownloadsSectionProps) {
  const { colors } = useTheme();
  const { playAudio } = useMusicPlayer();
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  
  useEffect(() => {
    loadTracks();
  }, []);
  
  const loadTracks = async () => {
    const allTracks = await getAllLocalTracks();
    setTracks(allTracks.slice(0, limit));
  };
  
  const handlePlay = (track: LocalTrack) => {
    triggerHaptic();
    playAudio({
      id: track.id,
      title: track.title,
      artist: track.artist,
      thumbnail: track.artwork_path || '',
      url: track.file_path,
      duration: track.duration,
    });
  };
  
  if (tracks.length === 0) return null;
  
  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Local Downloads</Text>
      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.trackCard, { backgroundColor: colors.surface }]} onPress={() => handlePlay(item)}>
            <Image
              source={{ uri: item.artwork_path || '' }}
              style={styles.artwork}
              contentFit="cover"
            />
            <Text style={[styles.trackTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
            <Text style={[styles.trackArtist, { color: colors.textSub }]} numberOfLines={1}>{item.artist}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingHorizontal: 12,
  },
  trackCard: {
    width: 140,
    marginHorizontal: 4,
    borderRadius: 10,
    padding: 8,
  },
  artwork: {
    width: 124,
    height: 124,
    borderRadius: 8,
    marginBottom: 8,
  },
  trackTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  trackArtist: {
    fontSize: 11,
    marginTop: 2,
  },
});
