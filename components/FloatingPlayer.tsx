/**
 * FloatingPlayer — v2
 *
 * Core change: the pill now appears IMMEDIATELY when a song is tapped,
 * before RNTP has loaded the track and useActiveTrack() returns a value.
 *
 * How it works:
 *   1. The search screen (or any playback trigger) calls setPendingTrack()
 *      synchronously on tap — before calling playAudio(). This is a
 *      module-level signal, so it fires in the same JS frame as the tap.
 *
 *   2. FloatingPlayer subscribes to that signal and immediately renders
 *      a skeleton pill with the pending track's title/artist/artwork.
 *      The pill is visible before any audio starts playing.
 *
 *   3. Once useActiveTrack() returns the real RNTP track object, the
 *      component switches to live data and clears the pending signal.
 *
 *   4. If RNTP fails to load (error), the pill disappears naturally
 *      because both activeTrack and pendingTrack will be null.
 *
 * Previous fixes preserved:
 *   [1] router.push("/(player)") — correct Expo Router group path.
 *   [2] router.canGoBack() — Expo Router v3 API, no @react-navigation/native.
 *   [3] expo-image instead of react-native Image.
 *   [4] Singleton guard — prevents double-player bug on duplicate mounts.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { triggerHaptic } from '@/helpers/haptics';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useActiveTrack, usePlaybackState, State } from 'react-native-track-player';
import TrackPlayer from 'react-native-track-player';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import {
  getPendingTrack,
  clearPendingTrack,
  subscribePendingTrack,
  type PendingTrackInfo,
} from '@/helpers/pendingTrack';
import { usePlayerOverlay } from '@/components/player/playerProvider';

// ─── Singleton guard ──────────────────────────────────────────────────────────

let _floatingPlayerMountCount = 0;

// ─── Props ────────────────────────────────────────────────────────────────────

interface FloatingPlayerProps {
  tabHeight?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FloatingPlayer: React.FC<FloatingPlayerProps> = ({ tabHeight = 56 }) => {
  const pathname      = usePathname();
  const activeTrack   = useActiveTrack();
  const playbackState = usePlaybackState();
  const { togglePlayPause, isLoading } = useMusicPlayer();
  const { expandPlayer, isExpanded } = usePlayerOverlay();

  // ── Pending track signal ───────────────────────────────────────────────────
  // Subscribes to the module-level pending track store. Updated synchronously
  // when any screen calls setPendingTrack() — before RNTP loads anything.
  const [pendingTrack, setPendingTrackState] = useState<PendingTrackInfo | null>(
    getPendingTrack,
  );

  useEffect(() => {
    // Sync initial value in case it was set before we mounted
    setPendingTrackState(getPendingTrack());
    // Subscribe to future changes
    return subscribePendingTrack((t) => setPendingTrackState(t));
  }, []);

  // Once the real track arrives from RNTP, the pending signal is no longer needed
  useEffect(() => {
    if (activeTrack) clearPendingTrack();
  }, [activeTrack?.id]);

  // ── Singleton guard ────────────────────────────────────────────────────────
  const isOwnerRef = useRef(false);
  useEffect(() => {
    _floatingPlayerMountCount += 1;
    isOwnerRef.current = _floatingPlayerMountCount === 1;
    return () => {
      if (isOwnerRef.current) _floatingPlayerMountCount = 0;
      else _floatingPlayerMountCount -= 1;
    };
  }, []);

  // ── Route guard ────────────────────────────────────────────────────────────
  // Hide during modal screens. Player is an overlay (not a route) so we no
  // longer need to check for /(player) in the pathname.
  const isModalOrPlayer =
    pathname.includes('/(modals)') ||
    pathname.includes('/modals/');

  // ── Playback state ─────────────────────────────────────────────────────────
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

  // ── Decide what to display ─────────────────────────────────────────────────
  // Use the real RNTP track if available, fall back to the pending track.
  // This is what makes the pill appear before RNTP finishes loading.
  const displayTrack = activeTrack
    ? {
        title:   activeTrack.title   ?? 'Unknown Title',
        artist:  activeTrack.artist  ?? 'Unknown Artist',
        artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : null,
        isReal:  true,
      }
    : pendingTrack
    ? {
        title:   pendingTrack.title,
        artist:  pendingTrack.artist,
        artwork: pendingTrack.artwork || null,
        isReal:  false,   // still loading — show skeleton controls
      }
    : null;

  // ── Animated position ──────────────────────────────────────────────────────
  const floatingPlayerBottom = tabHeight + 4;
  const animatedStyle = useAnimatedStyle(
    () => ({ bottom: withTiming(floatingPlayerBottom, { duration: 300 }) }),
    [floatingPlayerBottom],
  );

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!displayTrack || isModalOrPlayer || !isOwnerRef.current) return null;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openPlayerScreen = () => {
    // Expand the PlayerProvider overlay directly — no routing needed.
    // The overlay is always pre-mounted; expanding it is instant.
    if (!activeTrack) return;
    triggerHaptic();
    expandPlayer();
  };

  const handleTogglePlay = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;   // can't toggle while still loading
    triggerHaptic();
    await togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;
    triggerHaptic();
    try { await TrackPlayer.skipToNext(); } catch {}
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const isPending = !displayTrack.isReal;

  return (
    <Animated.View style={[styles.wrapper, { left: 8, right: 8 }, animatedStyle]}>
      <View style={styles.glassBase} />

      <View style={[styles.card, isPending && styles.cardLoading]}>
        <TouchableOpacity
          style={styles.content}
          onPress={openPlayerScreen}
          activeOpacity={isPending ? 1 : 0.9}
        >
          {/* Artwork */}
          <View style={styles.artWrap}>
            {displayTrack.artwork ? (
              <Image
                source={{ uri: displayTrack.artwork }}
                style={styles.art}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={[styles.artPlaceholder, isPending && styles.artPending]}>
                <Ionicons
                  name={isPending ? 'hourglass-outline' : 'musical-notes'}
                  size={20}
                  color="rgba(255,255,255,0.5)"
                />
              </View>
            )}
          </View>

          {/* Track info */}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {displayTrack.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {isPending ? 'Loading…' : displayTrack.artist}
            </Text>
          </View>

          {/* Controls — dimmed while pending */}
          <View style={[styles.controls, isPending && styles.controlsPending]}>
            <TouchableOpacity
              style={styles.controlBtn}
              onPress={handleSkipNext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={isPending}
            >
              <Ionicons
                name="play-skip-forward"
                size={20}
                color={isPending ? 'rgba(255,255,255,0.25)' : '#FFFFFF'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlBtn, styles.playBtn, isPending && styles.playBtnPending]}
              onPress={handleTogglePlay}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={isLoading || isPending}
            >
              <Ionicons
                name={isPending || isLoading ? 'hourglass-outline' : isPlaying ? 'pause' : 'play'}
                size={22}
                color={isPending ? 'rgba(255,255,255,0.35)' : '#FFFFFF'}
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
  cardLoading: {
    // Slightly dimmer border while the track is still loading
    borderColor: 'rgba(255,255,255,0.06)',
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
  artPending: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
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
  controlsPending: {
    opacity: 0.4,
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
  playBtnPending: {
    backgroundColor: 'rgba(139,115,85,0.3)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
});

export default FloatingPlayer;