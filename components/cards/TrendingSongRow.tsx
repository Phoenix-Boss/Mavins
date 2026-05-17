/**
 * TrendingSongRow - Theme-aware
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { triggerHaptic } from '@/helpers/haptics';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import type { TrendingItem } from '@/hooks/useTrending';
import { useTheme } from '@/contexts/ThemeContext';

interface TrendingSongRowProps {
  item: TrendingItem;
  allItems: TrendingItem[];
  index: number;
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
  onAddToQueue?: () => void;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViews(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const TrendingSongRow = ({ item, allItems, index, isCurrentTrack = false, isPlaying = false, onPress, onAddToQueue }: TrendingSongRowProps) => {
  const router = useRouter();
  const { playAudio } = useMusicPlayer();
  const { colors, isDark } = useTheme();

  const hasVideo = !!item.url;

  const handlePress = async () => {
    triggerHaptic();
    if (onPress) { onPress(); return; }
    if (!hasVideo) {
      Alert.alert('Not Available', `"${item.title}" is not available for streaming yet.`);
      return;
    }
    await playAudio(item, allItems);
    router.push('/(player)');
  };

  const handleAddToQueue = (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    if (onAddToQueue) onAddToQueue();
  };

  return (
    <TouchableOpacity
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
        isCurrentTrack && { backgroundColor: `${colors.gold}15`, borderColor: colors.gold, borderWidth: 1.5 },
        !hasVideo && { opacity: 0.5 }
      ]}
      onPress={handlePress}
      activeOpacity={hasVideo ? 0.7 : 1}
    >
      <View style={styles.left}>
        <View style={styles.thumbWrap}>
          {item.thumbnail ? (
            <Image source={{ uri: item.thumbnail }} style={[styles.thumb, { backgroundColor: colors.surfaceLight }]} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: colors.surfaceLight }]}>
              <Ionicons name="musical-notes" size={18} color={colors.textMuted} />
            </View>
          )}
          {isCurrentTrack && (
            <View style={[styles.playingDot, { backgroundColor: colors.surfaceDark, borderColor: colors.gold, shadowColor: colors.gold }]}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={10} color={colors.gold} />
            </View>
          )}
          {!hasVideo && (
            <View style={styles.unavailableOverlay}>
              <Ionicons name="ban-outline" size={14} color="rgba(255,255,255,0.4)" />
            </View>
          )}
        </View>

        <View style={styles.info}>
          <Text style={[styles.title, { color: colors.text }, isCurrentTrack && { color: colors.gold }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.artist, { color: colors.gold }]} numberOfLines={1}>
            {item.artist}
          </Text>
          <Text style={[styles.plays, { color: colors.textSub }]}>
            {item.views > 0 ? `${formatViews(item.views)} plays` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <Text style={[styles.duration, { color: colors.textMuted }, isCurrentTrack && { color: colors.gold }]}>
          {formatDuration(item.duration)}
        </Text>
        <TouchableOpacity style={styles.queueBtn} onPress={handleAddToQueue} hitSlop={8}>
          <Ionicons name="add-circle-outline" size={20} color={hasVideo ? colors.gold : colors.textMuted} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, padding: 10, borderWidth: 1 },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 46, height: 46, borderRadius: 6 },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  playingDot: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', zIndex: 1, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  unavailableOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginLeft: 10, maxWidth: '70%' },
  title: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  artist: { fontSize: 12, marginBottom: 2 },
  plays: { fontSize: 10 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  duration: { fontSize: 10 },
  queueBtn: { padding: 3 },
});
