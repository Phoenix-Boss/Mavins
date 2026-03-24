/**
 * FloatingPlayer — v4
 *
 * Changes from v3:
 *
 * 1. Hide on ALL (modals) routes — no exceptions. The equalizer screen must use
 *    its own inline player bar if needed, not the floating pill.
 *
 * 2. Simplified route detection: any pathname containing /(modals) or /modals/
 *    hides the floating player entirely.
 *
 * 3. All previous fixes preserved (pending track, singleton guard, expo-image).
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
  playerReady: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FloatingPlayer: React.FC<FloatingPlayerProps> = ({
  tabHeight = 56,
  playerReady,
}) => {
  const pathname      = usePathname();
  const activeTrack   = useActiveTrack();
  const playbackState = usePlaybackState();
  const { togglePlayPause, isLoading } = useMusicPlayer();
  const { expandPlayer } = usePlayerOverlay();

  // ── Pending track signal ───────────────────────────────────────────────────
  const [pendingTrack, setPendingTrackState] = useState<PendingTrackInfo | null>(
    getPendingTrack,
  );

  useEffect(() => {
    setPendingTrackState(getPendingTrack());
    return subscribePendingTrack((t) => setPendingTrackState(t));
  }, []);

  useEffect(() => {
    if (activeTrack) clearPendingTrack();
  }, [activeTrack?.id]);

  // ── Singleton guard ─────────────────────────────────────────────────────────
  const isOwnerRef = useRef(false);
  useEffect(() => {
    _floatingPlayerMountCount += 1;
    isOwnerRef.current = _floatingPlayerMountCount === 1;
    return () => {
      if (isOwnerRef.current) _floatingPlayerMountCount = 0;
      else _floatingPlayerMountCount -= 1;
    };
  }, []);

  // ── Route guard ─────────────────────────────────────────────────────────────
  // Hide the floating pill on ALL modal screens — lyrics, queue, EQ, playlists,
  // everything. Each modal decides for itself whether to show a player bar.
  const isAnyModal =
    pathname?.includes('/(modals)') ||
    pathname?.includes('/modals/');

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
        isReal:  false,
      }
    : null;

  // ── Animated bottom position ────────────────────────────────────────────────
  const floatingBottom = tabHeight + 4;
  const animatedStyle = useAnimatedStyle(
    () => ({ bottom: withTiming(floatingBottom, { duration: 300 }) }),
    [floatingBottom],
  );

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!displayTrack || isAnyModal || !isOwnerRef.current || !playerReady) {
    return null;
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openPlayer = () => {
    if (!activeTrack) return;
    triggerHaptic();
    expandPlayer();
  };

  const handleTogglePlay = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;
    triggerHaptic();
    await togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;
    triggerHaptic();
    try { await TrackPlayer.skipToNext(); } catch {}
  };

  const handleSkipPrev = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;
    triggerHaptic();
    try { await TrackPlayer.skipToPrevious(); } catch {}
  };

  // ── Shared card content ──────────────────────────────────────────────────
  const isPending = !displayTrack.isReal;

  return (
    <Animated.View style={[styles.wrapper, { left: 8, right: 8 }, animatedStyle]}>
      <View style={styles.glassBase} />
      <View style={[styles.card, isPending && styles.cardLoading]}>
        <TouchableOpacity
          style={styles.content}
          onPress={openPlayer}
          activeOpacity={isPending ? 1 : 0.88}
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
              <View style={[styles.art, styles.artPlaceholder, isPending && styles.artPending]}>
                <Ionicons
                  name={isPending ? 'hourglass-outline' : 'musical-notes'}
                  size={20}
                  color="rgba(255,255,255,0.5)"
                />
              </View>
            )}
            {/* Playing indicator dot */}
            {isPlaying && !isPending && (
              <View style={styles.playingDot}>
                <View style={styles.playingDotInner} />
              </View>
            )}
          </View>

          {/* Track info */}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>{displayTrack.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>
              {isPending ? 'Loading…' : displayTrack.artist}
            </Text>
          </View>

          {/* Controls */}
          <View style={[styles.controls, isPending && styles.controlsPending]}>
            <TouchableOpacity
              style={styles.controlBtn}
              onPress={handleSkipPrev}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={isPending}
            >
              <Ionicons
                name="play-skip-back"
                size={18}
                color={isPending ? 'rgba(255,255,255,0.25)' : '#fff'}
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
                color={isPending ? 'rgba(255,255,255,0.35)' : '#fff'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.controlBtn}
              onPress={handleSkipNext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={isPending}
            >
              <Ionicons
                name="play-skip-forward"
                size={18}
                color={isPending ? 'rgba(255,255,255,0.25)' : '#fff'}
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
  artWrap: {
    marginRight: 12,
    position: 'relative',
  },
  art: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  artPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  artPending: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  playingDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  playingDotInner: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(139,115,85,1)',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  artist: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  controlsPending: {
    opacity: 0.35,
  },
  controlBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  playBtn: {
    backgroundColor: 'rgba(139,115,85,0.8)',
    borderColor: 'rgba(255,255,255,0.25)',
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  playBtnPending: {
    backgroundColor: 'rgba(139,115,85,0.3)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
});

export default FloatingPlayer;