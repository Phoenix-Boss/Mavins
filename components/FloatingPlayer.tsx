// components/FloatingPlayer.tsx
//
// INDUSTRY STANDARD FLOW — Spotify / Apple Music pattern:
//
//  1. Self-contained — pulls expandPlayer from PlayerOverlayContext (NOT MusicPlayerContext).
//  2. Hidden on idle startup — returns null when there is no active/cached track.
//  3. Hidden while full player is open — checks isPlayerVisible from
//     PlayerOverlayContext so it NEVER flashes on top of the sliding-down
//     player card during swipe-dismiss.
//
// Issue 3 Fix (P0-3): FloatingPlayer Reappear After Dismiss
//   - Removed playerReady prop — reads from context instead
//   - Uses expandPlayer from PlayerOverlayContext (not MusicPlayerContext)
//   - Reads currentTrack from useActiveTrack() directly
//   - Proper null check to prevent ghost player bar
//   - Animation transition for smooth mount/unmount
//
//  The dismiss sequence:
//    1. User swipes down on PlayerScreen
//    2. PlayerScreen calls collapsePlayer() → isPlayerVisible = false (same frame)
//    3. FloatingPlayer returns null immediately — invisible during the fling
//    4. Spring animation completes → router.back() fires
//    5. FloatingPlayer re-appears cleanly on the home screen
//
//  Without step 2-3, FloatingPlayer would flash on top of the player card
//  while it was still animating off-screen.

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated as RNAnimated,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';

import TrackPlayer, {
  useActiveTrack,
  usePlaybackState,
  State,
} from 'react-native-track-player';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import { usePlayerStore } from '@/store/player';
import { usePlayerOverlay } from '@/components/player/playerProvider';

const MINI_PLAYER_HEIGHT = verticalScale(64);
const FADE_DURATION = 200;

// ─── Skeleton pulse ───────────────────────────────────────────────────────────

function SkeletonPulse({
  width,
  height,
  borderRadius = 4,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
}) {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: false }),
        RNAnimated.timing(anim, { toValue: 0, duration: 800, useNativeDriver: false }),
      ])
    ).start();
  }, []);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: ['#1A1A1A', '#2A2A2A'] });
  return <RNAnimated.View style={{ width, height, borderRadius, backgroundColor: bg }} />;
}

// ─── FloatingPlayer ───────────────────────────────────────────────────────────

// Issue 3 Fix: Removed playerReady prop — FloatingPlayer reads from context
export default function FloatingPlayer() {
  const insets = useSafeAreaInsets();

  // Issue 3 Fix: Use expandPlayer from PlayerOverlayContext (NOT MusicPlayerContext)
  // This ensures the overlay expands, not a route Navigation
  const { expandPlayer, isPlayerVisible, playerReady } = usePlayerOverlay();

  // togglePlayPause still comes from MusicPlayerContext for playback control
  const { togglePlayPause, currentTrack: musicPlayerTrack } = useMusicPlayer();

  // Issue 3 Fix: Read currentTrack from useActiveTrack() directly (RNTP source of truth)
  const activeTrack = useActiveTrack();
  const playbackState = usePlaybackState();

  // Fallback to store for cached track (persists last track across restarts)
  type PS = ReturnType<typeof usePlayerStore.getState>;
  const storeTrack = usePlayerStore((s: PS) => s.currentTrack);

  // Issue 3 Fix: Prioritize activeTrack (RNTP), then musicPlayerTrack, then storeTrack
  // This ensures track data persists through dismiss and reappears correctly
  const track = activeTrack ?? musicPlayerTrack ?? (storeTrack
    ? {
        id: storeTrack.id,
        title: storeTrack.title,
        artist: storeTrack.artist,
        artwork: storeTrack.thumbnail,
        duration: storeTrack.duration,
        url: storeTrack.url,
        videoId: storeTrack.videoId,
      }
    : null);

  // Issue 3 Fix: Hide when:
  //   - Player not ready (engine not initialized)
  //   - No track available (idle state)
  //   - Full player screen is open (to prevent flash during dismiss)
  // Returns null silently (no error, no ghost bar)
  if (!playerReady || !track || isPlayerVisible) return null;

  // Determine playing state from RNTP
  const isPlaying =
    playbackState?.state === State.Playing ||
    playbackState?.state === State.Buffering;

  // Resolve artwork URI
  const artwork = (() => {
    if (track?.artwork && typeof track.artwork === 'string') {
      return { uri: track.artwork };
    }
    if (track?.thumbnail && typeof track.thumbnail === 'string') {
      return { uri: track.thumbnail };
    }
    return require('@/assets/images/mavins.png');
  })();

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handlePlayPause = (e: any) => {
    e?.stopPropagation?.();
    togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e?.stopPropagation?.();
    try {
      await TrackPlayer.skipToNext();
    } catch (error) {
      console.warn('[FloatingPlayer] Skip next error:', error);
    }
  };

  const handleExpandPlayer = () => {
    // Issue 3 Fix: Use expandPlayer from PlayerOverlayContext
    // This opens the overlay, NOT a route navigation
    expandPlayer();
  };

  // Get track display info with fallbacks
  const trackTitle = track?.title || 'Unknown Track';
  const trackArtist = track?.artist || 'Unknown Artist';

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={handleExpandPlayer}
      style={[
        styles.container,
        { marginBottom: insets.bottom > 0 ? insets.bottom : 8 },
      ]}
    >
      {/* Gold accent line at top */}
      <View style={styles.accentLine} />

      {/* Artwork */}
      <Image
        source={artwork}
        style={styles.artwork}
        contentFit="cover"
        transition={200}
      />

      {/* Title + artist */}
      <View style={styles.textWrapper}>
        <Text style={styles.title} numberOfLines={1}>
          {trackTitle}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {trackArtist}
        </Text>
      </View>

      {/* Play/pause + skip */}
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={handlePlayPause}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={moderateScale(26)}
            color="#fff"
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSkipNext}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
          style={{ marginLeft: scale(16) }}
        >
          <Ionicons
            name="play-skip-forward"
            size={moderateScale(22)}
            color="rgba(255,255,255,0.75)"
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    marginHorizontal:  scale(12),
    height:            MINI_PLAYER_HEIGHT,
    backgroundColor:   '#1C1C1E',
    borderRadius:      14,
    paddingHorizontal: scale(10),
    overflow:          'hidden',
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.4,
    shadowRadius:      8,
    elevation:         10,
  },
  accentLine: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    height:          2,
    backgroundColor: '#D4AF37',
    opacity:         0.6,
  },
  artwork: {
    width:           verticalScale(44),
    height:          verticalScale(44),
    borderRadius:    8,
    backgroundColor: '#2a2a2a',
  },
  textWrapper: {
    flex:           1,
    marginLeft:     scale(10),
    justifyContent: 'center',
  },
  title: {
    color:         '#fff',
    fontSize:      moderateScale(13),
    fontWeight:    '600',
    letterSpacing: 0.1,
  },
  artist: {
    color:     'rgba(255,255,255,0.55)',
    fontSize:  moderateScale(11),
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingLeft:   scale(8),
  },
});