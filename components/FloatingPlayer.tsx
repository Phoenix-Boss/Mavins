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
// FIXES:
//  • Fixed import: usePlayerOverlay from @/app/_layout (was broken @/components/player/playerProvider)
//  • Changed artwork to thumbnail (unified field name)
//  • Removed playerReady dependency (handled by track null check)

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

import { usePlayerEngine } from '@/libs/playerSetup';
import { usePlayerOverlay } from '@/app/_layout';

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

export default function FloatingPlayer() {
  const insets = useSafeAreaInsets();

  // FIXED: Import from @/app/_layout (was broken path)
  const { expandPlayer, isPlayerVisible } = usePlayerOverlay();

  const engine = usePlayerEngine();

  const track = engine.currentTrack;
  const isPlaying = engine.isPlaying;
  const isBuffering = engine.isBuffering;

  // FIXED: Simplified visibility check — track null handles idle state,
  // isPlayerVisible handles full-player open state. Removed playerReady.
  if (!track || isPlayerVisible) return null;

  const showPlayingState = isBuffering ? false : isPlaying;

  // FIXED: Changed artwork to thumbnail (unified field name)
  const artworkSource = (() => {
    if (track?.thumbnail && typeof track.thumbnail === 'string' && track.thumbnail.length > 0) {
      return { uri: track.thumbnail };
    }
    return require('@/assets/images/mavins.png');
  })();

  // ─── Handlers ───────────────────────────────────────────────────────────────
  
  const handlePlayPause = (e: any) => {
    e?.stopPropagation?.();
    engine.togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e?.stopPropagation?.();
    try {
      await engine.skipToNext();
    } catch (error) {
      console.warn('[FloatingPlayer] Skip next error:', error);
    }
  };

  const handleExpandPlayer = () => {
    expandPlayer();
  };

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
        source={artworkSource}
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
            name={showPlayingState ? 'pause' : 'play'}
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