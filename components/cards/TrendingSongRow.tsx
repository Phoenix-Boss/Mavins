/**
 * TrendingSongRow
 *
 * Displays a single trending track in a row layout.
 *
 * Fixed from original:
 *   - Accepts full TrendingItem (which extends Song) so playAudio receives
 *     a valid Song object with url, videoId etc.
 *   - Calls useMusicPlayer().playAudio() before navigating to the player.
 *     Previously it called router.navigate('/player') with no song loaded,
 *     causing the "screen doesn't exist" error.
 *   - Router path corrected to '/(player)' (the actual group route).
 *   - Tracks without a video_id (url === '') show a disabled state and
 *     alert the user instead of attempting broken extraction.
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

// ─── Palette ─────────────────────────────────────────────────────────────────

const COLORS = {
  background:    '#000000',
  surface:       '#121212',
  surfaceLight:  '#1F1F1F',
  surfaceDark:   '#0A0A0A',
  goldPrimary:   '#D4AF37',
  goldShiny:     '#FFD700',
  goldShimmer:   '#E6C16A',
  goldMuted:     '#C9A96A',
  text:          '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary:  '#808080',
  border:        '#333333',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface TrendingSongRowProps {
  /** Full TrendingItem — includes Song fields (url, videoId, etc.) */
  item:           TrendingItem;
  /** All items in the section — passed as queue so skip works */
  allItems:       TrendingItem[];
  index:          number;
  isCurrentTrack?: boolean;
  isPlaying?:     boolean;
  /** Override the default press handler entirely */
  onPress?:       () => void;
  onAddToQueue?:  () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TrendingSongRow = ({
  item,
  allItems,
  index,
  isCurrentTrack = false,
  isPlaying      = false,
  onPress,
  onAddToQueue,
}: TrendingSongRowProps) => {
  const router          = useRouter();
  const { playAudio }   = useMusicPlayer();

  const hasVideo = !!item.url;   // url is '' when video_id is null in DB

  const handlePress = async () => {
    triggerHaptic();

    // Explicit override
    if (onPress) { onPress(); return; }

    // Track has no YouTube ID — cannot extract stream
    if (!hasVideo) {
      Alert.alert(
        'Not Available',
        `"${item.title}" is not available for streaming yet.`,
      );
      return;
    }

    // Load the track into TrackPlayer, then open the player screen.
    // playAudio is non-blocking from the UI perspective — it sets
    // isLoading immediately and resolves in the background. We push
    // to the player right after calling it so the screen opens while
    // the stream is being resolved, exactly like Spotify's behaviour.
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
        isCurrentTrack && styles.rowActive,
        !hasVideo      && styles.rowDisabled,
      ]}
      onPress={handlePress}
      activeOpacity={hasVideo ? 0.7 : 1}
    >
      {/* Left: thumbnail + info */}
      <View style={styles.left}>
        <View style={styles.thumbWrap}>
          {item.thumbnail ? (
            <Image
              source={{ uri: item.thumbnail }}
              style={styles.thumb}
            />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons name="musical-notes" size={18} color={COLORS.textTertiary} />
            </View>
          )}
          {isCurrentTrack && (
            <View style={styles.playingDot}>
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={10}
                color={COLORS.goldShiny}
              />
            </View>
          )}
          {!hasVideo && (
            <View style={styles.unavailableOverlay}>
              <Ionicons name="ban-outline" size={14} color="rgba(255,255,255,0.4)" />
            </View>
          )}
        </View>

        <View style={styles.info}>
          <Text
            style={[styles.title, isCurrentTrack && styles.titleActive]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {item.artist}
          </Text>
          <Text style={styles.plays}>
            {item.views > 0 ? `${formatViews(item.views)} plays` : ''}
          </Text>
        </View>
      </View>

      {/* Right: duration + queue button */}
      <View style={styles.right}>
        <Text style={[styles.duration, isCurrentTrack && styles.titleActive]}>
          {formatDuration(item.duration)}
        </Text>
        <TouchableOpacity
          style={styles.queueBtn}
          onPress={handleAddToQueue}
          hitSlop={8}
        >
          <Ionicons
            name="add-circle-outline"
            size={20}
            color={hasVideo ? COLORS.goldShimmer : COLORS.textTertiary}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViews(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rowActive: {
    backgroundColor: COLORS.goldPrimary + '15',
    borderColor:     COLORS.goldPrimary,
    borderWidth: 1.5,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  left: {
    flexDirection: 'row',
    alignItems:    'center',
    flex: 1,
  },
  thumbWrap: {
    position: 'relative',
  },
  thumb: {
    width:         46,
    height:        46,
    borderRadius:  6,
    backgroundColor: COLORS.surfaceLight,
  },
  thumbPlaceholder: {
    alignItems:      'center',
    justifyContent:  'center',
  },
  playingDot: {
    position:        'absolute',
    top:  -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 1.5,
    borderColor: COLORS.goldPrimary,
    justifyContent: 'center',
    alignItems:     'center',
    zIndex: 1,
    shadowColor:   COLORS.goldShiny,
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius:  4,
    elevation: 4,
  },
  unavailableOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    alignItems:     'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    marginLeft: 10,
    maxWidth:   '70%',
  },
  title: {
    fontSize:   14,
    fontWeight: '600',
    color:      COLORS.text,
    marginBottom: 2,
  },
  titleActive: {
    color:      COLORS.goldPrimary,
    fontWeight: '700',
  },
  artist: {
    fontSize: 12,
    color:    COLORS.goldShimmer,
    marginBottom: 2,
  },
  plays: {
    fontSize: 10,
    color:    COLORS.textTertiary,
  },
  right: {
    flexDirection: 'row',
    alignItems:    'center',
    gap: 10,
  },
  duration: {
    fontSize: 10,
    color:    COLORS.goldMuted,
  },
  queueBtn: {
    padding: 3,
  },
});