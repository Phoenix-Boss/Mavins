/**
 * FloatingPlayer
 *
 * Fixed from original:
 *   [1] router.push("/(player)") — correct Expo Router group path.
 *       Original used router.push("/player") (no parentheses) which
 *       does not match the (player) group folder → "screen doesn't exist".
 *
 *   [2] Removed useNavigation from @react-navigation/native.
 *       canGoBack() is now router.canGoBack() — the Expo Router v3 API.
 *       Mixing @react-navigation/native with expo-router's router caused
 *       inconsistent back-stack reads.
 *
 *   [3] Image swapped from react-native → expo-image.
 *       Consistent with PlayerScreen, related.tsx, and index.tsx.
 *       expo-image handles blurhash placeholders and disk caching automatically.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { triggerHaptic } from '@/helpers/haptics';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useActiveTrack, usePlaybackState, State } from 'react-native-track-player';
import TrackPlayer from 'react-native-track-player';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

// ─── Singleton guard ──────────────────────────────────────────────────────────
// Tracks how many FloatingPlayer instances are currently mounted.
// If more than one mounts at the same time (e.g. tab layout + screen layout),
// every instance beyond the first renders null to prevent the double-player bug.
let _floatingPlayerMountCount = 0;

// ─── Props ────────────────────────────────────────────────────────────────────

interface FloatingPlayerProps {
  tabHeight?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FloatingPlayer: React.FC<FloatingPlayerProps> = ({ tabHeight = 56 }) => {
  const router        = useRouter();
  const pathname      = usePathname();
  const activeTrack   = useActiveTrack();
  const playbackState = usePlaybackState();
  const { togglePlayPause, isLoading } = useMusicPlayer();

  // Singleton guard — only the first mounted instance renders UI.
  // Any duplicate mount (e.g. tab shell + screen layout) renders null.
  const isOwnerRef = useRef(false);
  useEffect(() => {
    _floatingPlayerMountCount += 1;
    isOwnerRef.current = _floatingPlayerMountCount === 1;
    return () => {
      if (isOwnerRef.current) _floatingPlayerMountCount = 0;
      else _floatingPlayerMountCount -= 1;
    };
  }, []);

  // Hide when any modal screen is active — they render above the tab layout
  // so the global FloatingPlayer from the tab shell would appear twice.
  // Also hide on the player screen itself since it has its own full UI.
  const isModalOrPlayer =
    pathname.includes('/(modals)') ||
    pathname.includes('/modals/')  ||
    pathname.includes('/(player)') ||
    pathname.includes('/player');

  const currentState: State = (() => {
    if (!playbackState) return State.None;
    if (typeof playbackState === 'object' && 'state' in playbackState) {
      return (playbackState as { state: State }).state ?? State.None;
    }
    return playbackState as unknown as State;
  })();

  const isPlaying =
    currentState === State.Playing ||
    currentState === State.Buffering;

  const floatingPlayerBottom = tabHeight + 4;

  const animatedStyle = useAnimatedStyle(
    () => ({ bottom: withTiming(floatingPlayerBottom, { duration: 300 }) }),
    [floatingPlayerBottom],
  );

  // Don't render on modals/player — prevents the double-player bug.
  // Also bail if this is a duplicate mount (singleton guard above).
  if (!activeTrack || isModalOrPlayer || !isOwnerRef.current) return null;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openPlayerScreen = () => {
    triggerHaptic();
    // ✅ '/(player)' matches the app/(player)/ group folder.
    // router.canGoBack() is the Expo Router v3 API — no @react-navigation/native needed.
    if (router.canGoBack()) {
      router.push('/(player)');
    } else {
      router.replace('/(player)');
    }
  };

  const handleTogglePlay = async (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    await togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    try { await TrackPlayer.skipToNext(); } catch {}
  };

  const artworkUri: string | null =
    activeTrack?.artwork
      ? typeof activeTrack.artwork === 'string'
        ? activeTrack.artwork
        : null   // number (local require) — expo-image uses source prop differently
      : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Animated.View style={[styles.wrapper, { left: 8, right: 8 }, animatedStyle]}>
      <View style={styles.glassBase} />

      <View style={styles.card}>
        <TouchableOpacity
          style={styles.content}
          onPress={openPlayerScreen}
          activeOpacity={0.9}
        >
          {/* Artwork */}
          <View style={styles.artWrap}>
            {artworkUri ? (
              <Image
                source={{ uri: artworkUri }}
                style={styles.art}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={styles.artPlaceholder}>
                <Ionicons name="musical-notes" size={20} color="rgba(255,255,255,0.7)" />
              </View>
            )}
          </View>

          {/* Track info */}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {activeTrack.title || 'Unknown Title'}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {activeTrack.artist || 'Unknown Artist'}
            </Text>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity
              style={styles.controlBtn}
              onPress={handleSkipNext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="play-skip-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlBtn, styles.playBtn]}
              onPress={handleTogglePlay}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={isLoading}
            >
              <Ionicons
                name={isLoading ? 'hourglass-outline' : isPlaying ? 'pause' : 'play'}
                size={22}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    zIndex: 999,
  },
  card: {
    height: 64,
    borderRadius: 16,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  glassBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Platform.select({
      ios:     'rgba(20,20,25,0.85)',
      android: 'rgba(18,18,23,0.95)',
      default: 'rgba(18,18,23,0.9)',
    }),
    borderRadius: 16,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    zIndex: 1,
  },
  artWrap: { marginRight: 12, zIndex: 1 },
  art: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  artPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 10,
    zIndex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  artist: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
    gap: 8,
  },
  controlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  playBtn: {
    backgroundColor: 'rgba(139,115,85,0.8)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
});

export default FloatingPlayer;